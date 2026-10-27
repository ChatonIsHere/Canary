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
    private static MelonPreferences_Entry<float> _resourceSeconds;
    private static MelonPreferences_Entry<bool> _recordOnBoot;
    private static MelonPreferences_Entry<bool> _compress;
    private static MelonPreferences_Entry<int> _rotateMinutes;
    private static MelonPreferences_Entry<int> _retentionDays;
    private static MelonPreferences_Entry<int> _maxStorageMb;

    public static int BufferMinutes => Math.Max(1, _bufferMinutes.Value);
    public static float SpikeMs => Math.Max(1f, _spikeMs.Value);
    public static float PositionSeconds => Math.Max(1f, _positionSeconds.Value);
    public static float CensusSeconds => Math.Max(10f, _censusSeconds.Value);
    public static bool RecordUpdateModules => _recordUpdateModules.Value;
    public static float ResourceSeconds => Math.Max(1f, _resourceSeconds.Value);
    public static bool RecordOnBoot => _recordOnBoot.Value;
    public static bool Compress => _compress.Value;
    public static int RotateMinutes => Math.Max(1, _rotateMinutes.Value);
    public static int RetentionDays => Math.Max(0, _retentionDays.Value);
    public static int MaxStorageMb => Math.Max(0, _maxStorageMb.Value);

    public static string DataDirectory => Path.Combine(MelonEnvironment.UserDataDirectory, "Canary");

    public static void Init()
    {
        var category = MelonPreferences.CreateCategory("Canary", "Canary");
        _bufferMinutes = category.CreateEntry("BufferMinutes", 10, description: "How many minutes of history the always-on buffer keeps in memory.");
        _spikeMs = category.CreateEntry("SpikeMs", 200f, description: "A frame longer than this many milliseconds counts as a lag spike.");
        _positionSeconds = category.CreateEntry("PositionSeconds", 5f, description: "How often player positions are recorded.");
        _censusSeconds = category.CreateEntry("CensusSeconds", 60f, description: "How often every entity is counted by type and chunk.");
        _recordUpdateModules = category.CreateEntry("RecordUpdateModules", true, description: "Record how many ms per second each of the game's update modules takes.");
        _resourceSeconds = category.CreateEntry("ResourceSeconds", 5f, description: "How often CPU, memory, disk and network use is recorded (server, its child processes and the machine).");
        _recordOnBoot = category.CreateEntry("RecordOnBoot", false, description: "Start recording to disk as soon as the server boots, as if 'canary record start boot' had been run.");
        _compress = category.CreateEntry("Compress", true, description: "Gzip recordings and saved buffers (about 10x smaller).");
        _rotateMinutes = category.CreateEntry("RotateMinutes", 60, description: "Start a new file (part) of a recording this often.");
        _retentionDays = category.CreateEntry("RetentionDays", 14, description: "Delete recordings and reports older than this many days (0 keeps them forever).");
        _maxStorageMb = category.CreateEntry("MaxStorageMb", 1024, description: "Delete the oldest recordings and reports once together they pass this many MB (0 for no limit).");
        // MelonLoader only writes the file on a clean exit, which a server killed by its host never gets;
        // writing it now means the settings are there to find and edit from the first boot.
        category.SaveToFile(false);
    }
}
