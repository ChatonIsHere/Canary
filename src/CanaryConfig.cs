using System;
using System.IO;
using MelonLoader;
using MelonLoader.Utils;

namespace Canary;

// [Canary] in UserData/MelonPreferences.cfg.
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
        _bufferMinutes = category.CreateEntry("BufferMinutes", 10, description: "Minutes of history kept in memory.");
        _spikeMs = category.CreateEntry("SpikeMs", 200f, description: "Frames longer than this many ms are lag spikes.");
        _positionSeconds = category.CreateEntry("PositionSeconds", 5f, description: "Seconds between player position records.");
        _censusSeconds = category.CreateEntry("CensusSeconds", 60f, description: "Seconds between entity counts.");
        _recordUpdateModules = category.CreateEntry("RecordUpdateModules", true, description: "Record the game's per-module update times.");
        _resourceSeconds = category.CreateEntry("ResourceSeconds", 5f, description: "Seconds between CPU, memory, disk and network readings.");
        _recordOnBoot = category.CreateEntry("RecordOnBoot", false, description: "Start recording to disk on every boot.");
        _compress = category.CreateEntry("Compress", true, description: "Gzip recordings.");
        _rotateMinutes = category.CreateEntry("RotateMinutes", 60, description: "Minutes per recording part.");
        _retentionDays = category.CreateEntry("RetentionDays", 14, description: "Delete recordings and reports older than this (0 keeps them).");
        _maxStorageMb = category.CreateEntry("MaxStorageMb", 1024, description: "Delete the oldest recordings and reports past this many MB (0 for no limit).");
        // MelonLoader only saves on a clean exit, which a killed server never gets.
        category.SaveToFile(false);
    }
}
