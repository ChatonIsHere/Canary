using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using Alta.Core.Runtime;
using Alta.Networking;
using Canary.Diagnostics;
using HarmonyLib;
using UnityEngine;

namespace Canary.Recording;

// Main thread. Keeps the last BufferMinutes of records, and writes them out while recording.
internal static class Recorder
{
    private static readonly Queue<Record> Buffer = new();
    private static readonly List<float> FrameTimes = new(256);
    private static readonly Stopwatch FrameClock = new();
    private static readonly int[] GcAtSecondStart = new int[3];
    private static readonly object ApiLock = new();
    private static Dictionary<string, double> _sections = new();
    private static Dictionary<string, double> _metrics = new();

    private static double _lastFrame = -1;
    private static double _secondStart;
    private static double _nextPositions;
    private static double _nextCensus;
    private static int _gc0LastFrame;
    private static bool _serverStarted;
    private static double _spikesFrom = double.MaxValue;
    private static double _nextSpikeLog;
    private static int _unloggedSpikes;

    public static bool Active { get; private set; }
    public static RecordingSession Recording { get; private set; }
    public static Sample LastSample { get; private set; }
    public static ResourceRecord LastResources { get; private set; }
    public static long StartedAt { get; private set; }

    public static void Start()
    {
        Active = true;
        StartedAt = UnixMs.Now;
        FrameClock.Start();
        // World loading is one long spike.
        GeneralGameEvents.ServerStarted += () =>
        {
            _serverStarted = true;
            _spikesFrom = FrameClock.Elapsed.TotalMilliseconds + 10_000;
        };
        if (CanaryConfig.RecordOnBoot)
            CanaryMod.Log.Msg($"RecordOnBoot is on: recording to {StartRecording("boot").Path}");
    }

    public static void Tick()
    {
        var now = FrameClock.Elapsed.TotalMilliseconds;
        if (_lastFrame < 0)
        {
            _lastFrame = _secondStart = now;
            SnapshotGc();
            return;
        }

        var frameMs = (float)(now - _lastFrame);
        _lastFrame = now;
        FrameTimes.Add(frameMs);

        var gc0 = GC.CollectionCount(0);
        var gcThisFrame = gc0 != _gc0LastFrame;
        _gc0LastFrame = gc0;

        if (frameMs >= CanaryConfig.SpikeMs && now >= _spikesFrom)
            Spike(frameMs, gcThisFrame, now);

        while (ErrorGroups.TryTakeNew(out var error))
            Add(error);
        while (ResourceMonitor.TryTake(out var resources))
        {
            LastResources = resources;
            Add(resources);
        }

        if (now - _secondStart >= 1000)
        {
            FlushSample();
            _secondStart = now;
        }

        if (_serverStarted && now >= _nextPositions)
        {
            _nextPositions = now + CanaryConfig.PositionSeconds * 1000;
            RecordPositions();
        }

        if (_serverStarted && now >= _nextCensus)
        {
            _nextCensus = now + CanaryConfig.CensusSeconds * 1000;
            Census.Take(Add);
        }

        Recording?.Tick();
    }

    public static void Add(Record record)
    {
        Buffer.Enqueue(record);
        var oldest = record.Time - CanaryConfig.BufferMinutes * 60_000L;
        while (Buffer.Count > 0 && Buffer.Peek().Time < oldest)
            Buffer.Dequeue();

        Recording?.Write(record);
        CanaryEvents.Raise(record);
    }

    public static List<Record> Snapshot(int minutes = 0)
    {
        if (minutes <= 0) return Buffer.ToList();
        var from = UnixMs.Now - minutes * 60_000L;
        return Buffer.Where(r => r.Time >= from).ToList();
    }

    public static int BufferCount => Buffer.Count;
    public static long BufferOldest => Buffer.Count > 0 ? Buffer.Peek().Time : 0;

    // Starts with the buffer, so it includes the run-up.
    public static RecordingSession StartRecording(string name)
    {
        if (Recording != null) return null;
        var session = new RecordingSession(name);
        foreach (var record in Buffer) session.Write(record);
        Recording = session;
        return session;
    }

    public static RecordingSession StopRecording()
    {
        var recording = Recording;
        Recording = null;
        recording?.Dispose();
        return recording;
    }

    // Any thread.
    public static void AddSection(string name, long elapsedTicks)
    {
        var ms = elapsedTicks * 1000.0 / Stopwatch.Frequency;
        lock (ApiLock)
        {
            _sections.TryGetValue(name, out var total);
            _sections[name] = total + ms;
        }
    }

    public static void SetMetric(string name, double value)
    {
        lock (ApiLock) _metrics[name] = value;
    }

    private static void FlushSample()
    {
        if (FrameTimes.Count == 0) return;
        FrameTimes.Sort();
        var count = FrameTimes.Count;

        var sample = new Sample
        {
            Frames = count,
            AvgMs = Round(FrameTimes.Average()),
            P50Ms = Round(FrameTimes[count / 2]),
            P95Ms = Round(FrameTimes[Math.Min(count - 1, (int)(count * 0.95))]),
            MaxMs = Round(FrameTimes[count - 1]),
            GcCollections = new[]
            {
                GC.CollectionCount(0) - GcAtSecondStart[0],
                GC.CollectionCount(1) - GcAtSecondStart[1],
                GC.CollectionCount(2) - GcAtSecondStart[2],
            },
            HeapMb = Round(GC.GetTotalMemory(false) / 1048576f),
            WorkingSetMb = Round(ProcessMemory.WorkingSetBytes() / 1048576f),
            Players = Player.AllPlayers.Count,
            Entities = NetworkEntity.SpawnedCount,
            Errors = ErrorGroups.TakeCount(),
            Modules = ReadUpdateModules(),
            Phases = CanaryConfig.RecordPhases ? FramePhases.TakeSecond() : null,
            LoadedChunks = Alta.Chunks.Chunk.LoadedCount,
        };
        lock (ApiLock)
        {
            if (_sections.Count > 0)
            {
                sample.Sections = _sections.ToDictionary(kv => kv.Key, kv => Round((float)kv.Value));
                _sections = new Dictionary<string, double>();
            }
            if (_metrics.Count > 0)
                sample.Metrics = new Dictionary<string, double>(_metrics);
        }

        FrameTimes.Clear();
        SnapshotGc();
        LastSample = sample;
        Add(sample);
    }

    // The game times its update modules every frame whatever IsProfiling says, but only exposes an
    // average per call; the per-second total comes from the private field.
    private static Dictionary<string, float> ReadUpdateModules()
    {
        if (!CanaryConfig.RecordUpdateModules || DurationField == null) return null;
        Dictionary<string, float> modules = null;
        foreach (var kv in UnityUpdateManager.AllModuleInfos)
        {
            if (DurationField.GetValue(kv.Value) is not AverageNumber duration) continue;
            var total = (float)Math.Round(duration.Total, 3);
            kv.Value.ResetDuration();
            if (total <= 0) continue;
            (modules ??= new Dictionary<string, float>())[kv.Key] = total;
        }
        return modules;
    }

    private static readonly FieldInfo DurationField = AccessTools.Field(typeof(UpdateModuleInfo), "duration");

    private static void Spike(float frameMs, bool gc, double now)
    {
        var phases = FramePhases.TakeSpikeBreakdown();
        Add(new SpikeRecord
        {
            Ms = Round(frameMs),
            Gc = gc,
            Players = Player.AllPlayers.Count,
            Entities = NetworkEntity.SpawnedCount,
            Phases = phases?.ToDictionary(kv => kv.Key, kv => kv.Value),
        });

        // At most one console line per 10 s.
        if (now < _nextSpikeLog)
        {
            _unloggedSpikes++;
            return;
        }
        var more = _unloggedSpikes > 0 ? $" (+{_unloggedSpikes} more since the last warning)" : "";
        var where = phases is { Count: > 0 } ? $" ({phases[0].Key} {phases[0].Value:F0} ms)" : "";
        CanaryMod.Log.Warning($"Lag spike: {frameMs:F0} ms{where}{(gc ? ", garbage collection ran" : "")}{more}");
        _unloggedSpikes = 0;
        _nextSpikeLog = now + 10_000;
    }

    private static void RecordPositions()
    {
        var record = new PositionsRecord();
        foreach (var player in Player.AllPlayers)
        {
            try
            {
                var info = player.UserInfo?.UserInfo;
                var head = player.PlayerController != null ? player.PlayerController.Head : null;
                var entity = player as NetworkEntity;
                var position = head != null ? head.position : entity != null ? entity.transform.position : Vector3.zero;
                record.Players.Add(new PlayerPosition
                {
                    Id = info?.Identifier ?? 0,
                    Name = info?.Username,
                    X = Round(position.x),
                    Y = Round(position.y),
                    Z = Round(position.z),
                    Chunk = entity != null && entity.Chunk != null ? entity.Chunk.ChunkIdentifier : null,
                });
            }
            catch (Exception e)
            {
                CanaryMod.Log.Warning($"Couldn't read a player's position: {e.Message}");
            }
        }
        if (record.Players.Count > 0) Add(record);
    }

    private static void SnapshotGc()
    {
        for (var i = 0; i < 3; i++) GcAtSecondStart[i] = GC.CollectionCount(i);
        _gc0LastFrame = GcAtSecondStart[0];
    }

    private static float Round(float value) => (float)Math.Round(value, 2);
    private static float Round(double value) => (float)Math.Round(value, 2);
}
