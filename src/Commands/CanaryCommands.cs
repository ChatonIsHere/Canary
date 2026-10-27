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
            : $"Recording since {ServerTime.Of(recording.Started):yyyy-MM-dd HH:mm:ss}: {recording.Records} records, {recording.Bytes / 1048576.0:F2} MB, part {recording.Part}, now writing {recording.Path}.");

        if (Recorder.LastSample is { } s)
            sb.AppendLine($"Last second: {s.Frames} frames, avg {s.AvgMs} ms, p95 {s.P95Ms} ms, max {s.MaxMs} ms; {s.Players} player(s), {s.Entities} entities, heap {s.HeapMb} MB.");

        if (Recorder.LastResources is { } r)
        {
            var m = r.Machine;
            var host = r.Container != null ? "host" : "machine";
            sb.AppendLine("Server process: " + Join(
                r.CpuPct is { } cpu ? $"CPU {cpu}% of the {host} ({r.CpuCores} cores)" : null,
                r.MemMb is { } mem ? $"{mem} MB" : null,
                r.DiskReadKBps is { } dr ? $"disk read {dr} / write {r.DiskWriteKBps} KB/s" : null,
                r.GameOutKBps is { } go ? $"game traffic out {go} KB/s" : null,
                r.Children != null ? $"with child processes CPU {r.TotalCpuPct}%, {r.TotalMemMb} MB" : null));
            if (m != null)
                sb.AppendLine($"{(r.Container != null ? "Host" : "Machine")}: " + Join(
                    m.CpuPct is { } mc ? $"CPU {mc}% of {m.Cores} cores" : null,
                    m.MemUsedMb is { } mu ? $"memory {mu} of {m.MemTotalMb} MB" : null,
                    m.NetRxKBps is { } rx ? $"network in {rx} / out {m.NetTxKBps} KB/s" : null,
                    m.DiskFreeGb is { } free ? $"{free} of {m.DiskTotalGb} GB free on the game's drive" : null));
            if (r.Container is { } c)
                sb.AppendLine($"{c.Kind} container: " + Join(
                    c.CpuCores is { } cc ? $"CPU {cc} cores" + (c.CpuLimitCores is { } l ? $" of a {l}-core limit (throttled {c.ThrottledPct}% of the time)" : ", no limit") : null,
                    c.MemMb is { } cm ? $"memory {cm}" + (c.MemLimitMb is { } ml ? $" of {ml}" : "") + " MB" : null,
                    c.Processes is { } p ? $"{p} processes" : null,
                    c.DiskReadKBps is { } cr ? $"disk read {cr} / write {c.DiskWriteKBps} KB/s" : null,
                    c.NetRxKBps is { } crx ? $"network in {crx} / out {c.NetTxKBps} KB/s" : null));
        }

        var spikes = Recorder.Snapshot().OfType<SpikeRecord>().ToList();
        sb.AppendLine($"Lag spikes over {CanaryConfig.SpikeMs} ms in the buffer: {spikes.Count}{(spikes.Count > 0 ? $", worst {spikes.Max(x => x.Ms)} ms" : "")}.");
        sb.AppendLine($"Error groups since boot: {ErrorGroups.All.Count()} ({ErrorGroups.All.Sum(g => g.Count)} occurrences).");
        foreach (var (pattern, left) in DebugLogging.Active)
            sb.AppendLine($"Trace logging on for '{pattern}', {Math.Max(0, left.TotalMinutes):F1} minute(s) left.");
        sb.AppendLine(ServerTime.Legend());
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
        return ServerTime.Legend() + "\n" + string.Join("\n", spikes.Select(s =>
            $"{ServerTime.Of(s.Time):HH:mm:ss}  {s.Ms,7:F0} ms{(s.Gc ? "  GC" : "    ")}  {s.Players} player(s), {s.Entities} entities"));
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
               + $"{g.Count} time(s), first {ServerTime.Of(g.FirstSeen):yyyy-MM-dd HH:mm:ss}, last {ServerTime.Of(g.LastSeen):yyyy-MM-dd HH:mm:ss}\n"
               + ServerTime.Legend() + "\n"
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
            return $"Recording to {recording.Path}, starting with the {recording.Records} records already in the buffer. "
                   + $"A new part starts every {CanaryConfig.RotateMinutes} minute(s).";
        }

        [ServerOnly]
        [Command("stop", "Stops the recording.")]
        private static string Stop()
        {
            var recording = Recorder.StopRecording();
            return recording == null
                ? "Not recording."
                : $"Stopped. {recording.Records} records, {recording.Bytes / 1048576.0:F2} MB in {recording.Part} part(s); the last is {recording.Path}.";
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

    // A reading that isn't available on this platform is left out rather than printed blank.
    private static string Join(params string[] parts) => string.Join(", ", parts.Where(p => p != null)) + ".";

    private static string OneLine(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var line = s.Split('\n')[0].Trim();
        return line.Length > 160 ? line.Substring(0, 160) + "…" : line;
    }
}
