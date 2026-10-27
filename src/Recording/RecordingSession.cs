using System;

namespace Canary.Recording;

// `canary record start` (or RecordOnBoot). Flushed every few seconds, split into a new part every
// RotateMinutes.
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
    // Uncompressed.
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
