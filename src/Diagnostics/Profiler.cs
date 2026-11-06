using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Canary.Recording;
using HarmonyLib;

namespace Canary.Diagnostics;

// 'canary profile start': times every script's Update, FixedUpdate, LateUpdate and collision and trigger
// callbacks by type, and every other mod's Harmony patches, for a few minutes; or, given a pattern, every method
// of the matching types. It works by patching them itself, a batch per frame so starting and stopping don't
// freeze the server, and takes its patches off again at the end. Times are inclusive: a method's time includes
// what it calls, mod patches on it included. The profiler's own cost per call is measured and taken off, for
// the method itself and for each timed call inside it. Time on the main thread (frame time) is kept apart from
// time on other threads (pathfinding and networking threads).
internal static class Profiler
{
    private const int PatchesPerFrame = 25;
    private const int RecordedEntries = 300;
    private const int MaxMethods = 5000;

    private static readonly string[] Messages =
    [
        "Update", "FixedUpdate", "LateUpdate",
        "OnCollisionEnter", "OnCollisionStay", "OnCollisionExit",
        "OnTriggerEnter", "OnTriggerStay", "OnTriggerExit",
    ];

    private static readonly string[] SkippedAssemblies = ["Canary", "MelonLoader", "0Harmony", "MonoMod", "Mono.", "mscorlib", "System", "UnityEngine", "Unity.", "Il2Cpp"];

    private sealed class Target
    {
        public MethodBase Method;
        public string Name, Kind, Mod;
    }

    private enum Phase { Idle, Collecting, Patching, Running, Unpatching }

    private static readonly HarmonyLib.Harmony Patcher = new("ChatonIsHere.Canary.Profiler");
    private static Phase _phase = Phase.Idle;
    private static List<Target> _targets;
    private static Dictionary<MethodBase, int> _slots;
    private static long[] _ticks, _calls, _mainTicks, _mainCalls;
    // Timed calls finished on this thread so far, to take their cost off the calls they ran inside.
    [ThreadStatic] private static long _finished;
    [ThreadStatic] private static bool _isMain;
    private static double _pairTicks;

    private struct Mark
    {
        public long Start, Finished;
    }
    private static int _cursor, _failed, _frames;
    private static long _startedTicks;
    private static double _seconds, _endAt, _overheadTicks;
    private static string _pattern;
    private static Task<List<Target>> _collecting;

    public static ProfileRecord Last { get; private set; }

    public static string Status => _phase switch
    {
        Phase.Idle => Last == null ? "Not profiling." : $"Not profiling. The last profile ({Last.Seconds:F0} s) is in 'canary profile last'.",
        Phase.Collecting => "Finding methods to time...",
        Phase.Patching => $"Patching {_cursor} of {_targets.Count} methods...",
        Phase.Running => $"Profiling {_targets.Count - _failed} methods, {Math.Max(0, (_endAt - Now) / 1000):F0} s left.",
        _ => "Finishing...",
    };

    // pattern: comma-separated type names, or Type.Method, with * for any run of characters ("Pathfinding.*").
    public static string Start(int minutes, string pattern)
    {
        if (_phase != Phase.Idle) return Status;
        _seconds = Math.Max(1, Math.Min(30, minutes)) * 60;
        _pattern = string.IsNullOrWhiteSpace(pattern) ? null : pattern.Trim();
        if (_pattern == null)
        {
            // Patch info has to be read before any of our own patches exist.
            var patched = PatchedByMods();
            _collecting = Task.Run(() => FindMessages().Concat(patched).GroupBy(t => t.Method).Select(g => g.First()).ToList());
        }
        else
        {
            var match = Matcher(_pattern);
            _collecting = Task.Run(() => FindMatching(match).GroupBy(t => t.Method).Select(g => g.First()).ToList());
        }
        _phase = Phase.Collecting;
        return $"Profiling for {_seconds / 60:F0} minute(s) once the methods are patched; 'canary profile status' for progress.";
    }

    public static string Stop()
    {
        if (_phase != Phase.Running) return _phase == Phase.Idle ? "Not profiling." : "Not running yet; " + Status;
        _endAt = Now;
        return "Stopping.";
    }

    // Main thread, every frame.
    public static void Tick()
    {
        switch (_phase)
        {
            case Phase.Collecting:
                if (!_collecting.IsCompleted) return;
                if (_collecting.IsFaulted)
                {
                    CanaryMod.Log.Error($"Profiler couldn't list methods: {_collecting.Exception?.GetBaseException()}");
                    _phase = Phase.Idle;
                    return;
                }
                _targets = _collecting.Result;
                if (_targets.Count == 0 || _targets.Count > MaxMethods)
                {
                    CanaryMod.Log.Warning($"Profile not started: '{_pattern}' matched {_targets.Count} methods (1 to {MaxMethods} can be timed).");
                    _targets = null;
                    _phase = Phase.Idle;
                    return;
                }
                _slots = new Dictionary<MethodBase, int>();
                for (var i = 0; i < _targets.Count; i++) _slots[_targets[i].Method] = i;
                _ticks = new long[_targets.Count];
                _calls = new long[_targets.Count];
                _mainTicks = new long[_targets.Count];
                _mainCalls = new long[_targets.Count];
                _cursor = _failed = 0;
                _phase = Phase.Patching;
                return;

            case Phase.Patching:
                var before = new HarmonyMethod(typeof(Profiler), nameof(Before)) { priority = Priority.First };
                var after = new HarmonyMethod(typeof(Profiler), nameof(After)) { priority = Priority.Last };
                for (var n = 0; n < PatchesPerFrame && _cursor < _targets.Count; n++, _cursor++)
                {
                    try { Patcher.Patch(_targets[_cursor].Method, prefix: before, postfix: after); }
                    catch { _failed++; _targets[_cursor].Kind = null; }
                }
                if (_cursor < _targets.Count) return;
                _isMain = true;
                _overheadTicks = Calibrate();
                Array.Clear(_ticks, 0, _ticks.Length);
                Array.Clear(_calls, 0, _calls.Length);
                Array.Clear(_mainTicks, 0, _mainTicks.Length);
                Array.Clear(_mainCalls, 0, _mainCalls.Length);
                _frames = 0;
                _startedTicks = Stopwatch.GetTimestamp();
                _endAt = Now + _seconds * 1000;
                _phase = Phase.Running;
                CanaryMod.Log.Msg($"Profiling {_targets.Count - _failed} methods ({_failed} couldn't be patched).");
                return;

            case Phase.Running:
                _isMain = true;
                _frames++;
                if (Now < _endAt) return;
                Last = Snapshot();
                Recorder.Add(Last);
                CanaryMod.Log.Msg("Profile done:\n" + Describe(Last, 15));
                _cursor = 0;
                _phase = Phase.Unpatching;
                return;

            case Phase.Unpatching:
                for (var n = 0; n < PatchesPerFrame && _cursor < _targets.Count; n++, _cursor++)
                {
                    if (_targets[_cursor].Kind == null) continue;
                    try { Patcher.Unpatch(_targets[_cursor].Method, HarmonyPatchType.All, Patcher.Id); }
                    catch (Exception e) { CanaryMod.Log.Warning($"Profiler couldn't unpatch {_targets[_cursor].Name}: {e.Message}"); }
                }
                if (_cursor < _targets.Count) return;
                _targets = null;
                _slots = null;
                _phase = Phase.Idle;
                return;
        }
    }

    private static void Before(out Mark __state)
    {
        __state.Finished = _finished;
        __state.Start = Stopwatch.GetTimestamp();
    }

    private static void After(MethodBase __originalMethod, Mark __state)
    {
        var ticks = Stopwatch.GetTimestamp() - __state.Start - (long)((_finished - __state.Finished) * _pairTicks);
        _finished++;
        var slots = _slots;
        if (slots == null || !slots.TryGetValue(__originalMethod, out var i)) return;
        Interlocked.Add(ref _ticks[i], ticks);
        Interlocked.Increment(ref _calls[i]);
        if (!_isMain) return;
        _mainTicks[i] += ticks;
        _mainCalls[i]++;
    }

    // What the profiler charges a call with nothing in it: reading the clock and keeping count, measured on this
    // machine (under Wine the clock is slower to read).
    // The whole of a timed call's own cost (both halves) is what each call inside another adds to it.
    private static double Calibrate()
    {
        const int n = 20000;
        var key = _targets[0].Method;
        _pairTicks = 0;
        var before = Interlocked.Read(ref _ticks[0]);
        var started = Stopwatch.GetTimestamp();
        for (var i = 0; i < n; i++)
        {
            Before(out var state);
            After(key, state);
        }
        _pairTicks = (Stopwatch.GetTimestamp() - started) / (double)n;
        return (Interlocked.Read(ref _ticks[0]) - before) / (double)n;
    }

    private static ProfileRecord Snapshot()
    {
        var seconds = (Stopwatch.GetTimestamp() - _startedTicks) / (double)Stopwatch.Frequency;
        var entries = new List<ProfileEntry>();
        for (var i = 0; i < _targets.Count; i++)
        {
            var calls = Interlocked.Read(ref _calls[i]);
            if (calls == 0 || _targets[i].Kind == null) continue;
            entries.Add(new ProfileEntry
            {
                Name = _targets[i].Name,
                Kind = _targets[i].Kind,
                Mod = _targets[i].Mod,
                Ms = Ms(Interlocked.Read(ref _ticks[i]) - calls * _overheadTicks),
                MainMs = Ms(_mainTicks[i] - _mainCalls[i] * _overheadTicks),
                Calls = calls,
            });
        }
        return new ProfileRecord
        {
            Seconds = (float)Math.Round(seconds, 1),
            Frames = _frames,
            Methods = _targets.Count - _failed,
            Pattern = _pattern,
            OverheadUs = (float)Math.Round(_overheadTicks * 1e6 / Stopwatch.Frequency, 3),
            Entries = entries.OrderByDescending(e => e.Ms).Take(RecordedEntries).ToList(),
            ByMod = entries.GroupBy(e => e.Mod).ToDictionary(g => g.Key, g => (float)Math.Round(g.Sum(e => e.Ms), 2)),
        };
    }

    private static float Ms(double ticks) => (float)Math.Round(Math.Max(0, ticks) * 1000.0 / Stopwatch.Frequency, 2);

    public static string Describe(ProfileRecord p, int count)
    {
        var perSecond = 1 / Math.Max(1, p.Seconds);
        var what = p.Pattern == null ? "" : $" matching '{p.Pattern}'";
        var lines = new List<string> { $"{p.Seconds:F0} s, {p.Frames} frames, {p.Methods} methods{what} timed ({p.OverheadUs:F2} µs of timing taken off each call). Inclusive ms per second:" };
        lines.AddRange(p.Entries.Take(count).Select(e => $"  {e.Ms * perSecond,8:F2}  {e.Kind,-10} {e.Name} ({e.Mod}, {e.Calls * perSecond:0.#} calls/s"
            + (e.MainMs < e.Ms * 0.99f ? $", {e.MainMs * perSecond:F2} on the main thread)" : ")")));
        var mods = p.ByMod.Where(kv => kv.Key != "game").OrderByDescending(kv => kv.Value).ToList();
        if (mods.Count > 0)
            lines.Add("Mods: " + string.Join(", ", mods.Select(kv => $"{kv.Key} {kv.Value * perSecond:F2}")));
        return string.Join("\n", lines);
    }

    private static double Now => Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;

    // Unity messages on MonoBehaviours, outside Unity's and the runtime's own assemblies.
    private static IEnumerable<Target> FindMessages()
    {
        var monoBehaviour = typeof(UnityEngine.MonoBehaviour);
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            var name = assembly.GetName().Name;
            if (assembly.IsDynamic || SkippedAssemblies.Any(s => name.StartsWith(s, StringComparison.Ordinal))) continue;
            var mod = ModAttribution.ForAssembly(assembly);
            foreach (var type in Types(assembly))
            {
                if (type.ContainsGenericParameters || !monoBehaviour.IsAssignableFrom(type)) continue;
                foreach (var message in Messages)
                {
                    MethodInfo method;
                    try { method = type.GetMethod(message, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly); }
                    catch (AmbiguousMatchException) { continue; }
                    if (method == null || method.IsAbstract || method.ContainsGenericParameters || method.GetMethodBody() == null) continue;
                    yield return new Target { Method = method, Name = $"{type.FullName}.{message}", Kind = KindOf(message), Mod = mod };
                }
            }
        }
    }

    private static Func<string, bool> Matcher(string pattern)
    {
        var regexes = pattern.Split(',').Select(p => p.Trim()).Where(p => p.Length > 0)
            .Select(p => new Regex("^" + Regex.Escape(p).Replace(@"\*", ".*") + "$"))
            .ToList();
        return name => regexes.Any(r => r.IsMatch(name));
    }

    // Every method with a body, of each type whose name (or Type.Method) matches. Canary's own are left out.
    private static IEnumerable<Target> FindMatching(Func<string, bool> match)
    {
        const BindingFlags all = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            if (assembly.IsDynamic || assembly == typeof(Profiler).Assembly) continue;
            var mod = ModAttribution.ForAssembly(assembly);
            foreach (var type in Types(assembly))
            {
                if (type.FullName == null || type.ContainsGenericParameters) continue;
                var typeMatches = match(type.FullName);
                foreach (var method in type.GetMethods(all))
                {
                    if (method.IsAbstract || method.ContainsGenericParameters || (!typeMatches && !match($"{type.FullName}.{method.Name}"))) continue;
                    MethodBody body;
                    try { body = method.GetMethodBody(); } catch { continue; }
                    if (body == null) continue;
                    yield return new Target { Method = method, Name = $"{type.FullName}.{method.Name}", Kind = "method", Mod = mod };
                }
            }
        }
    }

    private static string KindOf(string message) =>
        message.StartsWith("OnCollision", StringComparison.Ordinal) ? "collision"
        : message.StartsWith("OnTrigger", StringComparison.Ordinal) ? "trigger"
        : message.Substring(0, 1).ToLowerInvariant() + message.Substring(1);

    // Other mods' prefixes, postfixes and finalizers, and the whole of methods they transpile.
    private static List<Target> PatchedByMods()
    {
        var targets = new List<Target>();
        var seen = new HashSet<MethodBase>();
        foreach (var original in HarmonyLib.Harmony.GetAllPatchedMethods().ToList())
        {
            var info = HarmonyLib.Harmony.GetPatchInfo(original);
            if (info == null) continue;
            var where = $"{original.DeclaringType?.FullName}.{original.Name}";
            void Add(IEnumerable<Patch> patches, string kind)
            {
                foreach (var patch in patches)
                {
                    var method = patch.PatchMethod;
                    var mod = ModAttribution.ForAssembly(method.DeclaringType?.Assembly);
                    if (mod == "Canary" || method.ContainsGenericParameters || !seen.Add(method)) continue;
                    targets.Add(new Target { Method = method, Name = $"{method.DeclaringType?.Name}.{method.Name} on {where}", Kind = kind, Mod = mod });
                }
            }
            Add(info.Prefixes, "prefix");
            Add(info.Postfixes, "postfix");
            Add(info.Finalizers, "finalizer");
            var transpiler = info.Transpilers.FirstOrDefault(t => ModAttribution.ForAssembly(t.PatchMethod.DeclaringType?.Assembly) != "Canary");
            if (transpiler != null && !original.ContainsGenericParameters && seen.Add(original))
                targets.Add(new Target { Method = original, Name = where, Kind = "transpiled", Mod = ModAttribution.ForAssembly(transpiler.PatchMethod.DeclaringType?.Assembly) });
        }
        return targets;
    }

    private static IEnumerable<Type> Types(Assembly assembly)
    {
        try { return assembly.GetTypes(); }
        catch (ReflectionTypeLoadException e) { return e.Types.Where(t => t != null); }
        catch { return []; }
    }
}
