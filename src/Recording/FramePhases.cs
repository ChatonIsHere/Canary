using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine.LowLevel;

namespace Canary.Recording;

// Where a frame's time goes, by Unity player-loop phase: physics, script updates, async continuations,
// animation, and so on. A timestamp marker before every phase charges the time since the last marker to
// the phase that was running, so nothing in the frame goes uncounted (the game's own update modules only
// cover what runs through its update manager). Main thread only.
internal static class FramePhases
{
    private const string Gap = "(between frames)";

    private struct CanaryMarker { }

    private static string[] _names;
    private static long[] _secondTicks;
    private static long[] _frameTicks;
    private static int _current = -1;
    private static long _last;

    public static bool Installed { get; private set; }

    // The slowest phases of the last frame that finished, and its length.
    public static List<KeyValuePair<string, float>> LastFrameTop { get; private set; }
    public static float LastFrameMs { get; private set; }

    public static void Install()
    {
        if (Installed) return;
        var root = PlayerLoop.GetCurrentPlayerLoop();
        var top = root.subSystemList;
        if (top == null || top.Length == 0) return;

        var names = new List<string>();
        var newTop = new PlayerLoopSystem[top.Length];
        for (var i = 0; i < top.Length; i++)
        {
            var system = top[i];
            var subs = system.subSystemList ?? new PlayerLoopSystem[0];
            var list = new List<PlayerLoopSystem>(subs.Length * 2 + 1);
            foreach (var sub in subs)
            {
                var slot = names.Count;
                names.Add($"{system.type?.Name}.{sub.type?.Name}");
                list.Add(Marker(slot, frameStart: i == 0 && list.Count == 0));
                list.Add(sub);
            }
            // After the last phase of the loop the frame is done; the rest is waiting for the next one.
            if (i == top.Length - 1)
            {
                names.Add(Gap);
                list.Add(Marker(names.Count - 1, frameStart: false));
            }
            system.subSystemList = list.ToArray();
            newTop[i] = system;
        }

        _names = names.ToArray();
        _secondTicks = new long[_names.Length];
        _frameTicks = new long[_names.Length];
        root.subSystemList = newTop;
        PlayerLoop.SetPlayerLoop(root);
        Installed = true;
    }

    private static PlayerLoopSystem Marker(int slot, bool frameStart) => new()
    {
        type = typeof(CanaryMarker),
        updateDelegate = () => Enter(slot, frameStart),
    };

    private static void Enter(int slot, bool frameStart)
    {
        var now = Stopwatch.GetTimestamp();
        if (_current >= 0)
        {
            var elapsed = now - _last;
            _secondTicks[_current] += elapsed;
            _frameTicks[_current] += elapsed;
        }
        if (frameStart) FinishFrame();
        _current = slot;
        _last = now;
    }

    // The waiting between frames isn't part of the next frame's cost, so it's left out of the frame total.
    private static void FinishFrame()
    {
        long total = 0;
        var gap = _names.Length - 1;
        for (var i = 0; i < _frameTicks.Length; i++)
            if (i != gap) total += _frameTicks[i];
        LastFrameMs = Ms(total);
        if (LastFrameMs >= CanaryConfig.SpikeMs)
        {
            LastFrameTop = Enumerable.Range(0, _frameTicks.Length)
                .Where(i => i != gap && _frameTicks[i] > 0)
                .OrderByDescending(i => _frameTicks[i])
                .Take(3)
                .Select(i => new KeyValuePair<string, float>(_names[i], Round(Ms(_frameTicks[i]))))
                .ToList();
        }
        Array.Clear(_frameTicks, 0, _frameTicks.Length);
    }

    // Phases that took at least 0.5 ms in total since the last call.
    public static Dictionary<string, float> TakeSecond()
    {
        if (!Installed) return null;
        Dictionary<string, float> phases = null;
        for (var i = 0; i < _secondTicks.Length; i++)
        {
            var ms = Ms(_secondTicks[i]);
            _secondTicks[i] = 0;
            if (ms < 0.5f) continue;
            (phases ??= new Dictionary<string, float>())[_names[i]] = Round(ms);
        }
        return phases;
    }

    // The last spike frame's breakdown, once: a spike takes it, so the next one can't reuse it.
    public static List<KeyValuePair<string, float>> TakeSpikeBreakdown()
    {
        var top = LastFrameTop;
        LastFrameTop = null;
        return top;
    }

    private static float Ms(long ticks) => (float)(ticks * 1000.0 / Stopwatch.Frequency);

    private static float Round(float value) => (float)Math.Round(value, 2);
}
