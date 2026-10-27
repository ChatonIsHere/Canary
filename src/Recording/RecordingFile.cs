using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace Canary.Recording;

// One .jsonl file of records. A recording part is written as plain text, which flushes to disk reliably
// (Mono's GZipStream only writes its data when closed, so a crash would lose a whole gzipped part), and is
// gzipped once it's closed. A part left plain by a crash is gzipped on the next boot. A saved buffer is
// written in one go, so it's gzipped directly.
internal sealed class RecordingFile : IDisposable
{
    private static readonly JsonSerializerSettings Json = new() { Formatting = Formatting.None };

    private readonly FileStream _file;
    private readonly StreamWriter _writer;

    public string Path { get; }
    public long Records { get; private set; }
    public long Bytes => _file.Length;

    private RecordingFile(string path, bool gzip)
    {
        Path = path;
        _file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        Stream stream = gzip ? new GZipStream(_file, CompressionMode.Compress) : _file;
        _writer = new StreamWriter(stream, new UTF8Encoding(false), 65536);
    }

    public static string Directory => System.IO.Path.Combine(CanaryConfig.DataDirectory, "recordings");

    public static RecordingFile Create(string kind, string name, int part = 0)
    {
        System.IO.Directory.CreateDirectory(Directory);
        var file = new RecordingFile(NewPath(kind, name, part, false), false);
        file.Write(HeaderRecord.Create(kind, name, part));
        return file;
    }

    // Serializes on a worker thread; records never change once added, so the snapshot is safe to share.
    public static Task<string> SaveAsync(List<Record> records, string name)
    {
        var header = HeaderRecord.Create("saved-buffer", name, 0);
        var gzip = CanaryConfig.Compress;
        var path = NewPath("buffer", name, 0, gzip);
        return Task.Run(() =>
        {
            System.IO.Directory.CreateDirectory(Directory);
            using var file = new RecordingFile(path, gzip);
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

    public void Flush()
    {
        _writer.Flush();
        _file.Flush();
    }

    public void Dispose() => _writer.Dispose();

    private static readonly object GzipLock = new();

    // path -> path.gz, then the plain file is deleted. Worker thread only. A finished part and the boot-time
    // sweep for crash leftovers can both reach the same file, so one runs at a time and a file already
    // compressed is skipped.
    public static void Gzip(string path)
    {
        lock (GzipLock)
        {
            if (!File.Exists(path)) return;
            var gz = path + ".gz";
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(gz, FileMode.Create, FileAccess.Write))
            using (var zip = new GZipStream(output, CompressionMode.Compress))
                input.CopyTo(zip);
            File.Delete(path);
        }
    }

    public static void GzipAsync(string path) => Task.Run(() =>
    {
        try
        {
            Gzip(path);
        }
        catch (Exception e)
        {
            CanaryMod.Log.Warning($"Couldn't compress {path}; it's kept uncompressed: {e.Message}");
        }
    });

    // File names are in UTC (the trailing Z), so they sort and compare the same on every machine.
    private static string NewPath(string kind, string name, int part, bool gzip)
    {
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'");
        var suffix = string.IsNullOrEmpty(name) ? "" : "-" + Sanitize(name);
        var partSuffix = part > 0 ? $"-part{part:000}" : "";
        return System.IO.Path.Combine(Directory, $"{kind}-{stamp}{suffix}{partSuffix}.jsonl{(gzip ? ".gz" : "")}");
    }

    private static string Sanitize(string name)
    {
        var sb = new StringBuilder();
        foreach (var c in name)
            sb.Append(char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_');
        return sb.Length > 40 ? sb.ToString(0, 40) : sb.ToString();
    }
}
