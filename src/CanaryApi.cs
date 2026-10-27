using System;
using System.Diagnostics;
using Canary.Recording;

namespace Canary;

// For other mods. Safe from any thread; does nothing when Canary isn't recording.
public static class CanaryApi
{
    public static bool IsRecording => Recorder.Active;

    // Per-second totals go in each sample's "sections".
    public static SectionScope Section(string name) =>
        Recorder.Active && !string.IsNullOrEmpty(name) ? new SectionScope(name, Stopwatch.GetTimestamp()) : default;

    // The latest value goes in each sample's "metrics".
    public static void Metric(string name, double value)
    {
        if (Recorder.Active && !string.IsNullOrEmpty(name)) Recorder.SetMetric(name, value);
    }

    // Main thread only.
    public static void Mark(string text)
    {
        if (Recorder.Active && !string.IsNullOrEmpty(text)) Recorder.Add(new MarkRecord { Text = text });
    }

    public readonly struct SectionScope : IDisposable
    {
        private readonly string _name;
        private readonly long _start;

        internal SectionScope(string name, long start)
        {
            _name = name;
            _start = start;
        }

        public void Dispose()
        {
            if (_name != null) Recorder.AddSection(_name, Stopwatch.GetTimestamp() - _start);
        }
    }
}
