using System;

namespace Canary.Recording;

// `canary record start` until `stop` (or from boot, with RecordOnBoot). Written as it happens, flushed every
// few seconds, and split into a new part every RotateMinutes; each finished part is gzipped in the
// background, so a long recording is a series of complete files and a crash costs at most a few seconds.
internal sealed class RecordingSession : IDisposable
{
    private const double FlushSeconds = 5;

    private RecordingFile _file;
    private DateTime _nextFlush = DateTime.UtcNow;
    private DateTime _partStarted = DateTime.UtcNow;
    private bool _open = true;

    public string Name { get; }
    public DateTime Started { get; } = DateTime.UtcNow;
    public int Part { get; private set; } = 1;
    public long Records { get; private set; }
    public long BytesInEarlierParts { get; private set; }
    public string Path => _file.Path;
    // Uncompressed: what's been written, before each finished part is gzipped.
    public long Bytes => BytesInEarlierParts + (_open ? _file.Bytes : 0);

    public RecordingSession(string name)
    {
        Name = name;
        _file = RecordingFile.Create("recording", name, Part);
        Retention.ApplyAsync(_file.Path);
    }

    public void Write(Record record)
    {
        _file.Write(record);
        Records++;
    }

    public void Tick()
    {
        var now = DateTime.UtcNow;
        if (now >= _partStarted.AddMinutes(CanaryConfig.RotateMinutes))
        {
            Rotate();
            return;
        }
        if (now < _nextFlush) return;
        _nextFlush = now.AddSeconds(FlushSeconds);
        _file.Flush();
    }

    private void Rotate()
    {
        Close();
        Part++;
        _partStarted = DateTime.UtcNow;
        _file = RecordingFile.Create("recording", Name, Part);
        _open = true;
        Retention.ApplyAsync(_file.Path);
    }

    private void Close()
    {
        if (!_open) return;
        BytesInEarlierParts += _file.Bytes;
        _open = false;
        _file.Dispose();
        if (CanaryConfig.Compress) RecordingFile.GzipAsync(_file.Path);
    }

    public void Dispose() => Close();
}
