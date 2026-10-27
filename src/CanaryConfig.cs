using System;
using System.IO;
using MelonLoader;
using MelonLoader.Utils;

namespace Canary;

// UserData/MelonPreferences.cfg, [Canary] section. Read live, so an edit applies once MelonLoader reloads the file.
internal static class CanaryConfig
{
    private static MelonPreferences_Entry<int> _bufferMinutes;
    private static MelonPreferences_Entry<float> _spikeMs;
    private static MelonPreferences_Entry<float> _positionSeconds;
    private static MelonPreferences_Entry<float> _censusSeconds;
    private static MelonPreferences_Entry<bool> _recordUpdateModules;

    public static int BufferMinutes => Math.Max(1, _bufferMinutes.Value);
    public static float SpikeMs => Math.Max(1f, _spikeMs.Value);
    public static float PositionSeconds => Math.Max(1f, _positionSeconds.Value);
    public static float CensusSeconds => Math.Max(10f, _censusSeconds.Value);
    public static bool RecordUpdateModules => _recordUpdateModules.Value;

    public static string DataDirectory => Path.Combine(MelonEnvironment.UserDataDirectory, "Canary");

    public static void Init()
    {
        var category = MelonPreferences.CreateCategory("Canary", "Canary");
        _bufferMinutes = category.CreateEntry("BufferMinutes", 10, description: "How many minutes of history the always-on buffer keeps in memory.");
        _spikeMs = category.CreateEntry("SpikeMs", 200f, description: "A frame longer than this many milliseconds counts as a lag spike.");
        _positionSeconds = category.CreateEntry("PositionSeconds", 5f, description: "How often player positions are recorded.");
        _censusSeconds = category.CreateEntry("CensusSeconds", 60f, description: "How often every entity is counted by type and chunk.");
        _recordUpdateModules = category.CreateEntry("RecordUpdateModules", true, description: "Record how many ms per second each of the game's update modules takes.");
    }
}
