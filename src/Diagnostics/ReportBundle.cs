using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Canary.Recording;
using MelonLoader;
using MelonLoader.Utils;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NLog;
using NLog.Targets;
using NLog.Targets.Wrappers;
using UnityEngine;

namespace Canary.Diagnostics;

// `canary report`: one zip with everything a bug report needs. Game state is read on the main thread;
// the zip is written on a worker thread so a big log doesn't stall the server.
internal static class ReportBundle
{
    // Launch arguments whose next value is a credential.
    private static readonly string[] SecretArgs = ["/access_token", "/refresh_token", "/identity_token", "/launcherauth"];

    public static string Directory => Path.Combine(CanaryConfig.DataDirectory, "reports");

    public static Task<string> CreateAsync()
    {
        var path = Path.Combine(Directory, $"canary-report-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
        var summary = Summary();
        var records = Recorder.Snapshot();
        var errors = ErrorGroups.All.OrderByDescending(g => g.Count).ToList();
        var mods = Mods();
        var logs = LogFiles();

        return Task.Run(() =>
        {
            System.IO.Directory.CreateDirectory(Directory);
            using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
            AddText(zip, "summary.txt", summary);
            AddText(zip, "buffer.jsonl", string.Join("\n", records.Select(r => JsonConvert.SerializeObject(r))));
            AddText(zip, "errors.json", JsonConvert.SerializeObject(errors, Formatting.Indented));
            AddText(zip, "mods.json", mods.ToString(Formatting.Indented));
            foreach (var (name, file) in logs) AddFile(zip, "logs/" + name, file);
            return path;
        });
    }

    private static string Summary()
    {
        var sb = new StringBuilder();
        var uptime = TimeSpan.FromMilliseconds(UnixMs.Now - Recorder.StartedAt);
        var last = Recorder.LastSample;
        sb.AppendLine($"Canary {CanaryMod.Version} report, {DateTime.Now:yyyy-MM-dd HH:mm:ss zzz}");
        sb.AppendLine($"Game {Application.version}, MelonLoader {MelonLoader.Properties.BuildInfo.Version}, Unity {Application.unityVersion}");
        sb.AppendLine($"OS {SystemInfo.operatingSystem}; {SystemInfo.processorType} x{SystemInfo.processorCount}; {SystemInfo.systemMemorySize} MB RAM");
        sb.AppendLine($"Uptime {uptime:d\\.hh\\:mm\\:ss}");
        if (last != null)
            sb.AppendLine($"Last second: {last.Frames} frames, avg {last.AvgMs} ms, max {last.MaxMs} ms; {last.Players} players; {last.Entities} entities; heap {last.HeapMb} MB");
        sb.AppendLine($"Error groups: {ErrorGroups.All.Count()}");
        sb.AppendLine($"Arguments: {string.Join(" ", RedactedArgs())}");
        return sb.ToString();
    }

    private static IEnumerable<string> RedactedArgs()
    {
        var args = Environment.GetCommandLineArgs();
        for (var i = 1; i < args.Length; i++)
        {
            yield return args[i];
            if (SecretArgs.Contains(args[i], StringComparer.OrdinalIgnoreCase) && i + 1 < args.Length && !args[i + 1].StartsWith("/"))
            {
                yield return "<redacted>";
                i++;
            }
        }
    }

    private static JObject Mods()
    {
        var melons = new JArray(MelonBase.RegisteredMelons.Select(m => new JObject
        {
            ["name"] = m.Info.Name,
            ["version"] = m.Info.Version,
            ["author"] = m.Info.Author,
            ["file"] = m.MelonAssembly?.Location is { } location ? Path.GetFileName(location) : null,
        }));

        // The mod manager's installs: Mods/<id>/manifest.json. Anything else in Mods/ is listed as a plain file.
        var installed = new JArray();
        var modsDir = MelonEnvironment.ModsDirectory;
        if (System.IO.Directory.Exists(modsDir))
        {
            foreach (var dir in System.IO.Directory.GetDirectories(modsDir))
            {
                var manifest = Path.Combine(dir, "manifest.json");
                JObject entry = new() { ["folder"] = Path.GetFileName(dir) };
                try
                {
                    if (File.Exists(manifest))
                    {
                        var json = JObject.Parse(File.ReadAllText(manifest));
                        entry["id"] = json["id"];
                        entry["version"] = json["version"];
                    }
                }
                catch (Exception e)
                {
                    entry["error"] = e.Message;
                }
                entry["files"] = new JArray(System.IO.Directory.GetFiles(dir, "*", SearchOption.AllDirectories)
                    .Select(f => f.Substring(dir.Length + 1).Replace('\\', '/')));
                installed.Add(entry);
            }
            foreach (var file in System.IO.Directory.GetFiles(modsDir))
                installed.Add(new JObject { ["file"] = Path.GetFileName(file) });
        }
        return new JObject { ["melons"] = melons, ["modsFolder"] = installed };
    }

    // MelonLoader's log plus the game's own NLog files (wherever its NLog.config put them).
    private static List<(string Name, string Path)> LogFiles()
    {
        var files = new List<(string, string)> { ("MelonLoader-Latest.log", Path.Combine(MelonEnvironment.MelonLoaderDirectory, "Latest.log")) };
        var config = LogManager.Configuration;
        if (config != null)
        {
            foreach (var name in new[] { "logFile", "errorLogFile", "unhandledLogFile" })
            {
                var target = config.FindTargetByName(name);
                while (target is WrapperTargetBase wrapper) target = wrapper.WrappedTarget;
                if (target is FileTarget file)
                {
                    try
                    {
                        var path = file.FileName.Render(LogEventInfo.CreateNullEvent());
                        files.Add((Path.GetFileName(path), path));
                    }
                    catch
                    {
                        // An unrenderable path just leaves that log out.
                    }
                }
            }
        }
        return files;
    }

    private static void AddText(ZipArchive zip, string name, string text)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        writer.Write(text);
    }

    // Logs are open for writing by the game, hence FileShare.ReadWrite.
    private static void AddFile(ZipArchive zip, string name, string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var entry = zip.CreateEntry(name).Open();
            source.CopyTo(entry);
        }
        catch (Exception e)
        {
            AddText(zip, name + ".error.txt", $"Couldn't read {path}: {e.Message}");
        }
    }
}
