using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Alta.Console;
using Canary.Diagnostics;
using Canary.Recording;

namespace Canary.Commands;

[Module("canary", "Canary diagnostics: the always-on recording buffer, lag spikes, grouped errors and debug logging")]
public static class CanaryCommands
{
    [ServerOnly]
    [Command("status", "Shows what Canary is recording, the last second's frame times and how many lag spikes and error groups it has seen.")]
    private static string Status()
    {
        var sb = new StringBuilder();
        var oldest = Recorder.BufferOldest;
        var span = oldest == 0 ? TimeSpan.Zero : TimeSpan.FromMilliseconds(UnixMs.Now - oldest);
        sb.AppendLine($"Canary {CanaryMod.Version}: buffer holds {span.TotalMinutes:F1} of {CanaryConfig.BufferMinutes} minute(s) ({Recorder.BufferCount} records).");

        var recording = Recorder.Recording;
        sb.AppendLine(recording == null
            ? "Not recording to disk ('canary record start' to begin)."
            : $"Recording to {recording.Path} since {recording.Started.ToLocalTime():HH:mm:ss} ({recording.Records} records).");

        if (Recorder.LastSample is { } s)
            sb.AppendLine($"Last second: {s.Frames} frames, avg {s.AvgMs} ms, p95 {s.P95Ms} ms, max {s.MaxMs} ms; {s.Players} player(s), {s.Entities} entities, heap {s.HeapMb} MB.");

        var spikes = Recorder.Snapshot().OfType<SpikeRecord>().ToList();
        sb.AppendLine($"Lag spikes over {CanaryConfig.SpikeMs} ms in the buffer: {spikes.Count}{(spikes.Count > 0 ? $", worst {spikes.Max(x => x.Ms)} ms" : "")}.");
        sb.AppendLine($"Error groups since boot: {ErrorGroups.All.Count()} ({ErrorGroups.All.Sum(g => g.Count)} occurrences).");
        foreach (var (pattern, left) in DebugLogging.Active)
            sb.AppendLine($"Trace logging on for '{pattern}', {Math.Max(0, left.TotalMinutes):F1} minute(s) left.");
        return sb.ToString().TrimEnd();
    }

    [ServerOnly]
    [Command("save", "Saves the always-on buffer (optionally only its last N minutes) to UserData/Canary/recordings.")]
    private static string Save(int minutes = 0)
    {
        var records = Recorder.Snapshot(minutes);
        if (records.Count == 0) return "The buffer is empty; nothing to save yet.";
        Report(RecordingFile.SaveAsync(records, null), "Saved the buffer to");
        return $"Saving {records.Count} records to {RecordingFile.Directory}...";
    }

    [ServerOnly]
    [Command("mark", "Adds a note to the timeline, like 'starting the boss fight', so you can find that moment in a recording.")]
    private static string Mark(string text)
    {
        CanaryApi.Mark(text);
        return $"Marked: {text}";
    }

    [ServerOnly]
    [Command("spikes", "Lists the most recent lag spikes in the buffer.")]
    private static string Spikes(int count = 10)
    {
        var spikes = Recorder.Snapshot().OfType<SpikeRecord>().Reverse().Take(Math.Max(1, count)).ToList();
        if (spikes.Count == 0) return $"No lag spikes over {CanaryConfig.SpikeMs} ms in the last {CanaryConfig.BufferMinutes} minute(s).";
        return string.Join("\n", spikes.Select(s =>
            $"{Local(s.Time):HH:mm:ss}  {s.Ms,7:F0} ms{(s.Gc ? "  GC" : "    ")}  {s.Players} player(s), {s.Entities} entities"));
    }

    [ServerOnly]
    [Command("errors", "Lists the most frequent error groups since boot, with the mod each came from.")]
    private static string Errors(int count = 10)
    {
        var groups = ErrorGroups.All.OrderByDescending(g => g.Count).Take(Math.Max(1, count)).ToList();
        if (groups.Count == 0) return "No warnings or errors since boot.";
        return string.Join("\n", groups.Select(g =>
            $"[{g.Id}] {g.Count}x {g.Level} from {g.Mod} ({g.Logger}){(g.ExceptionType != null ? $" {g.ExceptionType}" : "")}: {OneLine(g.Message)}"));
    }

    [ServerOnly]
    [Command("error", "Shows one error group in full, stack trace included, by the id 'canary errors' prints.")]
    private static string Error(string id)
    {
        var g = ErrorGroups.All.FirstOrDefault(x => x.Id == id);
        if (g == null) return $"No error group '{id}'.";
        return $"[{g.Id}] {g.Level} from {g.Mod}, logger {g.Logger}\n"
               + $"{g.Count} time(s), first {g.FirstSeen.ToLocalTime():HH:mm:ss}, last {g.LastSeen.ToLocalTime():HH:mm:ss}\n"
               + $"{g.Message}\n{g.Stack}";
    }

    [ServerOnly]
    [Command("report", "Bundles the buffer, error groups, mod list and logs into one zip for a bug report.")]
    private static string BugReport()
    {
        Report(ReportBundle.CreateAsync(), "Wrote the report to");
        return $"Writing a report to {ReportBundle.Directory}...";
    }

    [Module("record", "A recording to disk with no time limit, alongside the always-on buffer")]
    public static class RecordCommands
    {
        [ServerOnly]
        [Command("start", "Starts recording to UserData/Canary/recordings until 'canary record stop'. The name is optional.")]
        private static string Start(string name = "")
        {
            if (Recorder.Recording is { } current) return $"Already recording to {current.Path}.";
            var recording = Recorder.StartRecording(name);
            return $"Recording to {recording.Path}.";
        }

        [ServerOnly]
        [Command("stop", "Stops the recording.")]
        private static string Stop()
        {
            var recording = Recorder.StopRecording();
            return recording == null ? "Not recording." : $"Stopped. {recording.Records} records in {recording.Path}.";
        }
    }

    [Module("debug", "Temporary Trace logging, for when the normal logs don't say enough")]
    public static class DebugCommands
    {
        [ServerOnly]
        [Command("on", "Turns Trace logging on for loggers matching a pattern (default * for all) for some minutes (default 10, max 120).")]
        private static string On(string pattern = "*", int minutes = 10) => DebugLogging.On(pattern, minutes);

        [ServerOnly]
        [Command("off", "Turns Trace logging off again, for one pattern or all of them.")]
        private static string Off(string pattern = "") => DebugLogging.Off(string.IsNullOrEmpty(pattern) ? null : pattern);
    }

    private static void Report(Task<string> task, string done)
    {
        task.ContinueWith(t =>
        {
            if (t.IsFaulted) CanaryMod.Log.Error($"Canary couldn't write the file: {t.Exception?.GetBaseException().Message}");
            else CanaryMod.Log.Msg($"{done} {t.Result}");
        });
    }

    private static DateTime Local(long unixMs) => DateTimeOffset.FromUnixTimeMilliseconds(unixMs).LocalDateTime;

    private static string OneLine(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var line = s.Split('\n')[0].Trim();
        return line.Length > 160 ? line.Substring(0, 160) + "…" : line;
    }
}
