using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Canary.Recording;

// One line of a recording (.jsonl). Every record carries its type and a unix-ms timestamp, so a viewer can
// read the always-on buffer, a saved buffer and a long recording the same way.
public abstract class Record
{
    [JsonProperty("type", Order = -3)] public abstract string Type { get; }
    [JsonProperty("t", Order = -2)] public long Time { get; set; } = UnixMs.Now;
}

public static class UnixMs
{
    public static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

public sealed class HeaderRecord : Record
{
    public override string Type => "header";
    [JsonProperty("canary")] public string CanaryVersion { get; set; } = CanaryMod.Version;
    [JsonProperty("game")] public string GameVersion { get; set; }
    [JsonProperty("kind")] public string Kind { get; set; }
    [JsonProperty("name", NullValueHandling = NullValueHandling.Ignore)] public string Name { get; set; }
}

// One per second.
public sealed class Sample : Record
{
    public override string Type => "sample";
    [JsonProperty("frames")] public int Frames { get; set; }
    [JsonProperty("avgMs")] public float AvgMs { get; set; }
    [JsonProperty("p50Ms")] public float P50Ms { get; set; }
    [JsonProperty("p95Ms")] public float P95Ms { get; set; }
    [JsonProperty("maxMs")] public float MaxMs { get; set; }
    [JsonProperty("gc")] public int[] GcCollections { get; set; }
    [JsonProperty("heapMb")] public float HeapMb { get; set; }
    [JsonProperty("memMb")] public float WorkingSetMb { get; set; }
    [JsonProperty("players")] public int Players { get; set; }
    [JsonProperty("entities")] public int Entities { get; set; }
    [JsonProperty("errors")] public int Errors { get; set; }
    [JsonProperty("modules", NullValueHandling = NullValueHandling.Ignore)] public Dictionary<string, float> Modules { get; set; }
    [JsonProperty("sections", NullValueHandling = NullValueHandling.Ignore)] public Dictionary<string, float> Sections { get; set; }
    [JsonProperty("metrics", NullValueHandling = NullValueHandling.Ignore)] public Dictionary<string, double> Metrics { get; set; }
}

public sealed class PositionsRecord : Record
{
    public override string Type => "positions";
    [JsonProperty("players")] public List<PlayerPosition> Players { get; set; } = new();
}

public sealed class PlayerPosition
{
    [JsonProperty("id")] public int Id { get; set; }
    [JsonProperty("name")] public string Name { get; set; }
    [JsonProperty("x")] public float X { get; set; }
    [JsonProperty("y")] public float Y { get; set; }
    [JsonProperty("z")] public float Z { get; set; }
    [JsonProperty("chunk", NullValueHandling = NullValueHandling.Ignore)] public string Chunk { get; set; }
}

public sealed class CensusRecord : Record
{
    public override string Type => "census";
    [JsonProperty("total")] public int Total { get; set; }
    [JsonProperty("durationMs")] public float DurationMs { get; set; }
    [JsonProperty("byPrefab")] public Dictionary<string, int> ByPrefab { get; set; }
    [JsonProperty("byChunk")] public Dictionary<string, int> ByChunk { get; set; }
}

public sealed class SpikeRecord : Record
{
    public override string Type => "spike";
    [JsonProperty("ms")] public float Ms { get; set; }
    // A garbage collection ran during the frame: the usual suspect for an otherwise unexplained spike.
    [JsonProperty("gc")] public bool Gc { get; set; }
    [JsonProperty("players")] public int Players { get; set; }
    [JsonProperty("entities")] public int Entities { get; set; }
}

public sealed class MarkRecord : Record
{
    public override string Type => "mark";
    [JsonProperty("text")] public string Text { get; set; }
}

// The first time an error group is seen; later repeats only raise Sample.Errors.
public sealed class ErrorRecord : Record
{
    public override string Type => "error";
    [JsonProperty("id")] public string Id { get; set; }
    [JsonProperty("level")] public string Level { get; set; }
    [JsonProperty("logger")] public string Logger { get; set; }
    [JsonProperty("mod")] public string Mod { get; set; }
    [JsonProperty("message")] public string Message { get; set; }
}
