using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace Canary.Recording;

// Parts are written plain and gzipped once closed: Mono's GZipStream writes nothing until it's closed,
// so a crash would lose the whole part. Saved buffers are written in one go, so they're gzipped directly.
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

    // Records never change, so the snapshot can be serialized off the main thread.
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

    // Worker thread. A finished part and the boot sweep can reach the same file.
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

    // UTC, so names sort the same everywhere.
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
