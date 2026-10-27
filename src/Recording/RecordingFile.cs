using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;

namespace Canary.Recording;

// A .jsonl file of records under UserData/Canary/recordings. A long recording is written as it happens;
// a saved buffer is written in one go off the main thread.
internal sealed class RecordingFile : IDisposable
{
    private static readonly JsonSerializerSettings Json = new() { Formatting = Formatting.None };
    private const double FlushSeconds = 5;

    private readonly StreamWriter _writer;
    private DateTime _nextFlush = DateTime.UtcNow;

    public string Path { get; }
    public long Records { get; private set; }
    public DateTime Started { get; } = DateTime.UtcNow;

    private RecordingFile(string path)
    {
        Path = path;
        _writer = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(false), 65536);
    }

    public static string Directory => System.IO.Path.Combine(CanaryConfig.DataDirectory, "recordings");

    public static RecordingFile Create(string kind, string name)
    {
        System.IO.Directory.CreateDirectory(Directory);
        var file = new RecordingFile(NewPath(kind, name));
        file.Write(Header(kind, name));
        return file;
    }

    // Serializes on a worker thread; records never change once added, so the snapshot is safe to share.
    public static Task<string> SaveAsync(List<Record> records, string name)
    {
        var header = Header("saved-buffer", name);
        var path = NewPath("buffer", name);
        return Task.Run(() =>
        {
            System.IO.Directory.CreateDirectory(Directory);
            using var file = new RecordingFile(path);
            file.Write(header);
            foreach (var record in records) file.Write(record);
            return path;
        });
    }

    public void Write(Record record)
    {
        _writer.WriteLine(JsonConvert.SerializeObject(record, Json));
        Records++;
    }

    public void FlushIfDue()
    {
        if (DateTime.UtcNow < _nextFlush) return;
        _nextFlush = DateTime.UtcNow.AddSeconds(FlushSeconds);
        _writer.Flush();
    }

    public void Dispose() => _writer.Dispose();

    private static HeaderRecord Header(string kind, string name) =>
        new() { Kind = kind, Name = string.IsNullOrEmpty(name) ? null : name, GameVersion = Application.version };

    private static string NewPath(string kind, string name)
    {
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var suffix = string.IsNullOrEmpty(name) ? "" : "-" + Sanitize(name);
        return System.IO.Path.Combine(Directory, $"{kind}-{stamp}{suffix}.jsonl");
    }

    private static string Sanitize(string name)
    {
        var sb = new StringBuilder();
        foreach (var c in name)
            sb.Append(char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_');
        return sb.Length > 40 ? sb.ToString(0, 40) : sb.ToString();
    }
}
