using System;
using System.Collections.Generic;
using System.Linq;
using NLog;
using NLog.Config;
using NLog.Targets;

namespace Canary.Diagnostics;

// `canary debug on`: turns Trace logging on for loggers matching a pattern, for a limited time. The game's
// NLog.config already writes Debug and up to its log file and server console, and leaves Trace off because
// it's expensive, so a debug session adds only the Trace level and switches itself off again.
internal static class DebugLogging
{
    // The game's own log file and server console, as named in its NLog.config.
    private static readonly string[] TargetNames = ["logFile", "ServerConsole"];
    public const int MaxMinutes = 120;

    private sealed class Session
    {
        public string Pattern;
        public DateTime Until;
        public LoggingRule Rule;
    }

    private static readonly List<Session> Sessions = new();
    private static bool _hooked;

    public static IReadOnlyList<(string Pattern, TimeSpan Left)> Active =>
        Sessions.Select(s => (s.Pattern, s.Until - DateTime.UtcNow)).ToList();

    public static string On(string pattern, int minutes)
    {
        minutes = Math.Max(1, Math.Min(MaxMinutes, minutes));
        var config = LogManager.Configuration;
        if (config == null) return "NLog isn't configured yet; try again once the server has started.";
        if (!_hooked)
        {
            _hooked = true;
            LogManager.ConfigurationChanged += (_, args) => Reapply(args.ActivatedConfiguration);
        }

        var existing = Sessions.FirstOrDefault(s => s.Pattern == pattern);
        if (existing != null)
        {
            existing.Until = DateTime.UtcNow.AddMinutes(minutes);
            return $"Trace logging for '{pattern}' extended to {minutes} minute(s) from now.";
        }

        var session = new Session { Pattern = pattern, Until = DateTime.UtcNow.AddMinutes(minutes) };
        session.Rule = Apply(config, pattern);
        if (session.Rule == null) return "Couldn't find the game's log targets (logFile, ServerConsole) to send Trace logging to.";
        Sessions.Add(session);
        return $"Trace logging on for '{pattern}' for {minutes} minute(s), into the game's log file and server console. "
               + "Trace is expensive; 'canary debug off' stops it early.";
    }

    public static string Off(string pattern)
    {
        var removing = Sessions.Where(s => pattern == null || s.Pattern == pattern).ToList();
        if (removing.Count == 0) return pattern == null ? "No debug logging is on." : $"No debug logging is on for '{pattern}'.";
        foreach (var session in removing) Remove(session);
        return $"Trace logging off for {string.Join(", ", removing.Select(s => $"'{s.Pattern}'"))}.";
    }

    public static void Tick()
    {
        if (Sessions.Count == 0) return;
        var now = DateTime.UtcNow;
        foreach (var session in Sessions.Where(s => s.Until <= now).ToList())
        {
            Remove(session);
            CanaryMod.Log.Msg($"Trace logging for '{session.Pattern}' timed out and is off again.");
        }
    }

    private static LoggingRule Apply(LoggingConfiguration config, string pattern)
    {
        var targets = TargetNames.Select(config.FindTargetByName).Where(t => t != null).ToList();
        if (targets.Count == 0) return null;
        // Trace only: the existing "*" rule already sends Debug and up, and a wider rule would log those twice.
        var rule = new LoggingRule(pattern, LogLevel.Trace, LogLevel.Trace, targets[0]);
        foreach (var target in targets.Skip(1)) rule.Targets.Add(target);
        // First, so a final rule earlier in the file can't swallow it.
        config.LoggingRules.Insert(0, rule);
        LogManager.ReconfigExistingLoggers();
        return rule;
    }

    private static void Remove(Session session)
    {
        Sessions.Remove(session);
        LogManager.Configuration?.LoggingRules.Remove(session.Rule);
        LogManager.ReconfigExistingLoggers();
    }

    // A reload of NLog.config replaces every rule, ours included.
    private static void Reapply(LoggingConfiguration config)
    {
        if (config == null) return;
        foreach (var session in Sessions)
            session.Rule = Apply(config, session.Pattern) ?? session.Rule;
    }
}
