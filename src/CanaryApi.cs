using System;
using System.Diagnostics;
using Canary.Recording;

namespace Canary;

// For other mods. Every call is cheap and safe from any thread, and does nothing where Canary isn't
// recording (a client, for now), so a mod can call it unconditionally.
public static class CanaryApi
{
    public static bool IsRecording => Recorder.Active;

    // Times a block of code; the total per second shows up under "sections" in each sample.
    //   using (CanaryApi.Section("MyMod.Pathfinding")) { ... }
    public static SectionScope Section(string name) =>
        Recorder.Active && !string.IsNullOrEmpty(name) ? new SectionScope(name, Stopwatch.GetTimestamp()) : default;

    // A number worth graphing over time; the latest value goes under "metrics" in each sample.
    public static void Metric(string name, double value)
    {
        if (Recorder.Active && !string.IsNullOrEmpty(name)) Recorder.SetMetric(name, value);
    }

    // A note on the timeline, like "boss fight started". Main thread only.
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
