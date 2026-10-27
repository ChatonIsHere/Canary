using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Canary.Recording;

// One .jsonl line. Buffers and recordings share the format.
public abstract class Record
{
    [JsonProperty("type", Order = -3)] public abstract string Type { get; }
    [JsonProperty("t", Order = -2)] public long Time { get; set; } = UnixMs.Now;
}

public static class UnixMs
{
    public static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

// First line of every file. Records are UTC; this says which zone the server was in, and comes again
// with each part in case daylight saving changes.
public sealed class HeaderRecord : Record
{
    public override string Type => "header";
    [JsonProperty("canary")] public string CanaryVersion { get; set; } = CanaryMod.Version;
    [JsonProperty("game")] public string GameVersion { get; set; }
    [JsonProperty("kind")] public string Kind { get; set; }
    [JsonProperty("name", NullValueHandling = NullValueHandling.Ignore)] public string Name { get; set; }
    [JsonProperty("part", NullValueHandling = NullValueHandling.Ignore)] public int? Part { get; set; }
    [JsonProperty("utc")] public string Utc { get; set; }
    [JsonProperty("serverTime")] public string ServerTime { get; set; }
    [JsonProperty("utcOffsetMin")] public int UtcOffsetMinutes { get; set; }
    [JsonProperty("timeZone")] public string TimeZone { get; set; }
    [JsonProperty("timeZoneName")] public string TimeZoneName { get; set; }
    [JsonProperty("daylightSaving")] public bool DaylightSaving { get; set; }
    [JsonProperty("settings")] public Dictionary<string, object> Settings { get; set; }
    // In a container, the "machine" figures are the host.
    [JsonProperty("environment")] public Dictionary<string, object> Environment { get; set; }

    // Main thread (reads the game version).
    public static HeaderRecord Create(string kind, string name, int part)
    {
        var header = new HeaderRecord
        {
            Kind = kind,
            Name = string.IsNullOrEmpty(name) ? null : name,
            Part = part > 0 ? part : null,
            GameVersion = UnityEngine.Application.version,
        };
        var local = Canary.ServerTime.Of(header.Time);
        header.Utc = DateTimeOffset.FromUnixTimeMilliseconds(header.Time).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
        header.ServerTime = local.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz");
        header.UtcOffsetMinutes = (int)local.Offset.TotalMinutes;
        header.TimeZone = TimeZoneInfo.Local.Id;
        header.TimeZoneName = TimeZoneInfo.Local.DisplayName;
        header.DaylightSaving = TimeZoneInfo.Local.IsDaylightSavingTime(local);
        header.Settings = new Dictionary<string, object>
        {
            ["spikeMs"] = CanaryConfig.SpikeMs,
            ["bufferMinutes"] = CanaryConfig.BufferMinutes,
            ["positionSeconds"] = CanaryConfig.PositionSeconds,
            ["censusSeconds"] = CanaryConfig.CensusSeconds,
            ["recordUpdateModules"] = CanaryConfig.RecordUpdateModules,
            ["resourceSeconds"] = CanaryConfig.ResourceSeconds,
        };
        header.Environment = new Dictionary<string, object>
        {
            ["platform"] = LinuxHost.WineVersion != null ? $"Wine {LinuxHost.WineVersion}" : "Windows",
            ["os"] = UnityEngine.SystemInfo.operatingSystem,
            ["cores"] = System.Environment.ProcessorCount,
        };
        if (LinuxHost.Kernel != null) header.Environment["linuxKernel"] = LinuxHost.Kernel;
        if (LinuxHost.Container != null) header.Environment["container"] = LinuxHost.Container;
        return header;
    }
}

// One per second.
public sealed class Sample : Record
{
    public override string Type => "sample";
    [JsonProperty("frames")] public int Frames { get; set; }
    [JsonProperty("avgMs")] public float AvgMs { get; set; }
    [JsonProperty("p50Ms")] public float P50Ms { get; set; }
    [JsonProperty("p95Ms")] public float P95Ms { get; set; }
    [JsonProperty("maxMs")] public float MaxMs { get; set; }
    [JsonProperty("gc")] public int[] GcCollections { get; set; }
    [JsonProperty("heapMb")] public float HeapMb { get; set; }
    [JsonProperty("memMb")] public float WorkingSetMb { get; set; }
    [JsonProperty("players")] public int Players { get; set; }
    [JsonProperty("entities")] public int Entities { get; set; }
    [JsonProperty("errors")] public int Errors { get; set; }
    [JsonProperty("modules", NullValueHandling = NullValueHandling.Ignore)] public Dictionary<string, float> Modules { get; set; }
    [JsonProperty("sections", NullValueHandling = NullValueHandling.Ignore)] public Dictionary<string, float> Sections { get; set; }
    [JsonProperty("metrics", NullValueHandling = NullValueHandling.Ignore)] public Dictionary<string, double> Metrics { get; set; }
}

public sealed class PositionsRecord : Record
{
    public override string Type => "positions";
    [JsonProperty("players")] public List<PlayerPosition> Players { get; set; } = new();
}

public sealed class PlayerPosition
{
    [JsonProperty("id")] public int Id { get; set; }
    [JsonProperty("name")] public string Name { get; set; }
    [JsonProperty("x")] public float X { get; set; }
    [JsonProperty("y")] public float Y { get; set; }
    [JsonProperty("z")] public float Z { get; set; }
    [JsonProperty("chunk", NullValueHandling = NullValueHandling.Ignore)] public string Chunk { get; set; }
}

public sealed class CensusRecord : Record
{
    public override string Type => "census";
    [JsonProperty("total")] public int Total { get; set; }
    [JsonProperty("durationMs")] public float DurationMs { get; set; }
    [JsonProperty("byPrefab")] public Dictionary<string, int> ByPrefab { get; set; }
    [JsonProperty("byChunk")] public Dictionary<string, int> ByChunk { get; set; }
}

public sealed class SpikeRecord : Record
{
    public override string Type => "spike";
    [JsonProperty("ms")] public float Ms { get; set; }
    // A GC ran in that frame.
    [JsonProperty("gc")] public bool Gc { get; set; }
    [JsonProperty("players")] public int Players { get; set; }
    [JsonProperty("entities")] public int Entities { get; set; }
}

// CPU % is of the whole machine. "total" adds the server's child processes.
public sealed class ResourceRecord : Record
{
    public override string Type => "resources";
    [JsonProperty("cpuPct", NullValueHandling = NullValueHandling.Ignore)] public double? CpuPct { get; set; }
    [JsonProperty("cpuCores", NullValueHandling = NullValueHandling.Ignore)] public double? CpuCores { get; set; }
    [JsonProperty("memMb", NullValueHandling = NullValueHandling.Ignore)] public double? MemMb { get; set; }
    [JsonProperty("privateMb", NullValueHandling = NullValueHandling.Ignore)] public double? PrivateMb { get; set; }
    [JsonProperty("handles", NullValueHandling = NullValueHandling.Ignore)] public int? Handles { get; set; }
    [JsonProperty("threads", NullValueHandling = NullValueHandling.Ignore)] public int? Threads { get; set; }
    [JsonProperty("diskReadKBps", NullValueHandling = NullValueHandling.Ignore)] public double? DiskReadKBps { get; set; }
    [JsonProperty("diskWriteKBps", NullValueHandling = NullValueHandling.Ignore)] public double? DiskWriteKBps { get; set; }
    [JsonProperty("gameOutKBps", NullValueHandling = NullValueHandling.Ignore)] public double? GameOutKBps { get; set; }
    [JsonProperty("gamePacketsOut", NullValueHandling = NullValueHandling.Ignore)] public double? GamePacketsOutPerSec { get; set; }
    [JsonProperty("gamePacketsIn", NullValueHandling = NullValueHandling.Ignore)] public double? GamePacketsInPerSec { get; set; }
    [JsonProperty("children", NullValueHandling = NullValueHandling.Ignore)] public List<ChildProcess> Children { get; set; }
    [JsonProperty("totalCpuPct")] public double TotalCpuPct { get; set; }
    [JsonProperty("totalMemMb")] public double TotalMemMb { get; set; }
    [JsonProperty("machine")] public MachineResources Machine { get; set; }
    [JsonProperty("container", NullValueHandling = NullValueHandling.Ignore)] public ContainerResources Container { get; set; }
}

// From the container's cgroup, so everything in it counts. cpuPct is of its limit when it has one.
public sealed class ContainerResources
{
    [JsonProperty("kind")] public string Kind { get; set; }
    [JsonProperty("cpuCores", NullValueHandling = NullValueHandling.Ignore)] public double? CpuCores { get; set; }
    [JsonProperty("cpuPct", NullValueHandling = NullValueHandling.Ignore)] public double? CpuPct { get; set; }
    [JsonProperty("cpuLimitCores", NullValueHandling = NullValueHandling.Ignore)] public double? CpuLimitCores { get; set; }
    [JsonProperty("throttledPct", NullValueHandling = NullValueHandling.Ignore)] public double? ThrottledPct { get; set; }
    [JsonProperty("throttles", NullValueHandling = NullValueHandling.Ignore)] public long? Throttles { get; set; }
    [JsonProperty("memMb", NullValueHandling = NullValueHandling.Ignore)] public double? MemMb { get; set; }
    [JsonProperty("memLimitMb", NullValueHandling = NullValueHandling.Ignore)] public double? MemLimitMb { get; set; }
    [JsonProperty("diskReadKBps", NullValueHandling = NullValueHandling.Ignore)] public double? DiskReadKBps { get; set; }
    [JsonProperty("diskWriteKBps", NullValueHandling = NullValueHandling.Ignore)] public double? DiskWriteKBps { get; set; }
    [JsonProperty("netRxKBps", NullValueHandling = NullValueHandling.Ignore)] public double? NetRxKBps { get; set; }
    [JsonProperty("netTxKBps", NullValueHandling = NullValueHandling.Ignore)] public double? NetTxKBps { get; set; }
    [JsonProperty("processes", NullValueHandling = NullValueHandling.Ignore)] public int? Processes { get; set; }
}

public sealed class ChildProcess
{
    [JsonProperty("pid")] public int Pid { get; set; }
    [JsonProperty("name")] public string Name { get; set; }
    [JsonProperty("threads")] public int Threads { get; set; }
    [JsonProperty("cpuPct", NullValueHandling = NullValueHandling.Ignore)] public double? CpuPct { get; set; }
    [JsonProperty("memMb", NullValueHandling = NullValueHandling.Ignore)] public double? MemMb { get; set; }
}

public sealed class MachineResources
{
    [JsonProperty("cores")] public int Cores { get; set; }
    [JsonProperty("cpuPct", NullValueHandling = NullValueHandling.Ignore)] public double? CpuPct { get; set; }
    [JsonProperty("memUsedMb", NullValueHandling = NullValueHandling.Ignore)] public double? MemUsedMb { get; set; }
    [JsonProperty("memTotalMb", NullValueHandling = NullValueHandling.Ignore)] public double? MemTotalMb { get; set; }
    [JsonProperty("netRxKBps", NullValueHandling = NullValueHandling.Ignore)] public double? NetRxKBps { get; set; }
    [JsonProperty("netTxKBps", NullValueHandling = NullValueHandling.Ignore)] public double? NetTxKBps { get; set; }
    [JsonProperty("diskFreeGb", NullValueHandling = NullValueHandling.Ignore)] public double? DiskFreeGb { get; set; }
    [JsonProperty("diskTotalGb", NullValueHandling = NullValueHandling.Ignore)] public double? DiskTotalGb { get; set; }
}

public sealed class MarkRecord : Record
{
    public override string Type => "mark";
    [JsonProperty("text")] public string Text { get; set; }
}

// Only the first of each group; repeats just count in Sample.Errors.
public sealed class ErrorRecord : Record
{
    public override string Type => "error";
    [JsonProperty("id")] public string Id { get; set; }
    [JsonProperty("level")] public string Level { get; set; }
    [JsonProperty("logger")] public string Logger { get; set; }
    [JsonProperty("mod")] public string Mod { get; set; }
    [JsonProperty("message")] public string Message { get; set; }
}
