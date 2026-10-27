using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using Canary.Recording;
using NLog;
using NLog.Config;
using NLog.Targets;

namespace Canary.Diagnostics;

public sealed class ErrorGroup
{
    private int _count;

    public string Id { get; internal set; }
    public string Level { get; internal set; }
    public string Logger { get; internal set; }
    public string Mod { get; internal set; }
    public string ExceptionType { get; internal set; }
    public string Message { get; internal set; }
    public string Stack { get; internal set; }
    public DateTime FirstSeen { get; internal set; }
    public DateTime LastSeen { get; internal set; }
    public int Count => _count;

    internal void Hit()
    {
        Interlocked.Increment(ref _count);
        LastSeen = DateTime.UtcNow;
    }
}

// Groups every Warn-or-worse log line by where it came from, so "NullReferenceException in SomeMod, 4,312
// times" is one entry instead of 4,312 lines. Every log the game writes goes through NLog, and Unity's own
// log (uncaught exceptions included) is forwarded into NLog by the game under the "Unhandled" logger, so
// this one target sees everything exactly once.
internal static class ErrorGroups
{
    private const string TargetName = "Canary";
    private const int MaxGroups = 1000;
    private static readonly Regex Numbers = new(@"\d+", RegexOptions.Compiled);
    private static readonly Regex Hex = new(@"\b[0-9a-fA-F]{8,}\b", RegexOptions.Compiled);
    private static readonly Regex ExceptionLine = new(@"([\w.]+Exception)\b", RegexOptions.Compiled);

    private static readonly ConcurrentDictionary<string, ErrorGroup> Groups = new();
    private static readonly ConcurrentQueue<ErrorGroup> New = new();
    private static int _sinceLastTake;

    public static IEnumerable<ErrorGroup> All => Groups.Values;

    // As early as possible, so errors from other mods' own startup are caught too.
    public static void HookMelonLoader()
    {
        MelonLoader.MelonLogger.ErrorCallbackHandler += (section, text) => Safe(() => RecordMelon("Error", section, text));
        MelonLoader.MelonLogger.WarningCallbackHandler += (section, text) => Safe(() => RecordMelon("Warn", section, text));
    }

    public static void Install()
    {
        AddTarget(LogManager.Configuration);
        // The game's NLog.config has autoReload on, and a reload drops targets that aren't in the file.
        LogManager.ConfigurationChanged += (_, args) =>
        {
            if (args.ActivatedConfiguration != null && args.ActivatedConfiguration.FindTargetByName(TargetName) == null)
                AddTarget(args.ActivatedConfiguration);
        };
    }

    public static bool TryTakeNew(out ErrorRecord record)
    {
        record = null;
        if (!New.TryDequeue(out var group)) return false;
        record = new ErrorRecord { Id = group.Id, Level = group.Level, Logger = group.Logger, Mod = group.Mod, Message = group.Message };
        return true;
    }

    public static int TakeCount() => Interlocked.Exchange(ref _sinceLastTake, 0);

    private static void AddTarget(LoggingConfiguration config)
    {
        if (config == null) return;
        var target = new CanaryTarget { Name = TargetName };
        config.AddTarget(target);
        config.LoggingRules.Insert(0, new LoggingRule("*", LogLevel.Warn, LogLevel.Fatal, target));
        LogManager.ReconfigExistingLoggers();
    }

    private static void Record(LogEventInfo e)
    {
        var unityType = e.HasProperties && e.Properties.TryGetValue("unity.logType", out var t) ? t as string : null;
        // The game forwards every Unity log line as a Warn on "Unhandled"; plain Debug.Log lines aren't problems.
        if (unityType is "Log") return;
        var level = unityType is "Error" or "Assert" ? "Error" : e.Level.Name;

        var stack = e.HasProperties && e.Properties.TryGetValue("stacktrace", out var s) ? s as string : null;
        var exceptionType = e.Exception?.GetType().FullName;
        if (exceptionType == null && e.LoggerName == "UnhandledExceptions" && e.Message != null)
            exceptionType = ExceptionTypeFromUnity(e);

        // A structured template ("Player {0} left") is already the same for every occurrence; a pre-formatted
        // message has its numbers and ids blanked so "entity 4123" and "entity 9981" land in one group.
        var shape = e.Parameters is { Length: > 0 } ? e.Message : Hex.Replace(Numbers.Replace(e.FormattedMessage ?? "", "#"), "#");
        if (shape.Length > 300) shape = shape.Substring(0, 300);
        var key = $"{level}|{e.LoggerName}|{exceptionType}|{shape}|{TopFrame(e.Exception, stack)}";

        Hit(key, () => new ErrorGroup
        {
            Level = level,
            Logger = e.LoggerName,
            ExceptionType = exceptionType,
            Message = Truncate(e.FormattedMessage, 500),
            Stack = Truncate(e.Exception?.ToString() ?? stack, 4000),
            Mod = ModAttribution.For(e.Exception, stack, e.LoggerName),
        });
    }

    // MelonLoader's own log: what mods write with MelonLogger, and the exceptions MelonLoader catches from a
    // mod's callbacks. The section is the mod's name, so attribution comes for free.
    private static void RecordMelon(string level, string section, string text)
    {
        if (section == "Canary" || string.IsNullOrEmpty(text)) return;
        var mod = string.IsNullOrEmpty(section) ? "MelonLoader" : section;
        var lines = text.Split('\n');
        var exceptionType = ExceptionLine.Match(text) is { Success: true } m ? m.Groups[1].Value : null;
        var topFrame = lines.Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("at ", StringComparison.Ordinal)) ?? "";
        var shape = Hex.Replace(Numbers.Replace(lines[0], "#"), "#");
        if (shape.Length > 300) shape = shape.Substring(0, 300);

        Hit($"{level}|melon:{mod}|{exceptionType}|{shape}|{topFrame}", () => new ErrorGroup
        {
            Level = level,
            Logger = "MelonLoader",
            ExceptionType = exceptionType,
            Message = Truncate(lines[0].Trim(), 500),
            Stack = Truncate(text, 4000),
            Mod = mod,
        });
    }

    private static void Hit(string key, Func<ErrorGroup> create)
    {
        Interlocked.Increment(ref _sinceLastTake);
        if (!Groups.TryGetValue(key, out var group))
        {
            // Past the cap, new kinds of error still count towards each sample's total, just ungrouped.
            if (Groups.Count >= MaxGroups) return;
            var created = false;
            group = Groups.GetOrAdd(key, k =>
            {
                created = true;
                var g = create();
                g.Id = Hash(k);
                g.FirstSeen = DateTime.UtcNow;
                return g;
            });
            if (created) New.Enqueue(group);
        }
        group.Hit();
    }

    private static string ExceptionTypeFromUnity(LogEventInfo e)
    {
        if (e.HasProperties && e.Properties.TryGetValue("exception", out var ex) && ex != null)
        {
            var type = ex.GetType().GetProperty("type")?.GetValue(ex) as string;
            if (!string.IsNullOrEmpty(type)) return type;
        }
        return null;
    }

    private static string TopFrame(Exception exception, string stack)
    {
        if (exception != null)
        {
            var frames = new System.Diagnostics.StackTrace(exception, false).GetFrames();
            var method = frames?.FirstOrDefault(f => f.GetMethod() != null)?.GetMethod();
            return method == null ? "" : $"{method.DeclaringType?.FullName}.{method.Name}";
        }
        if (string.IsNullOrEmpty(stack)) return "";
        var line = stack.Split('\n')[0].Trim();
        var paren = line.IndexOf(" (", StringComparison.Ordinal);
        return paren > 0 ? line.Substring(0, paren) : line;
    }

    // FNV-1a, so a group keeps the same short id across restarts.
    private static string Hash(string key)
    {
        var hash = 2166136261;
        foreach (var c in key)
        {
            hash ^= c;
            hash *= 16777619;
        }
        return hash.ToString("x8");
    }

    private static string Truncate(string s, int max) => s == null || s.Length <= max ? s : s.Substring(0, max) + "…";

    private static void Safe(Action action)
    {
        try
        {
            action();
        }
        catch
        {
            // Logging an error from inside the error hook would recurse.
        }
    }

    [Target("Canary")]
    private sealed class CanaryTarget : Target
    {
        protected override void Write(LogEventInfo logEvent) => Safe(() => Record(logEvent));
    }
}
