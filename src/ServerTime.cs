using System;

namespace Canary;

// Console and report times are server-local and always say which zone.
internal static class ServerTime
{
    public static DateTimeOffset Of(long unixMs) =>
        TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(unixMs), TimeZoneInfo.Local);

    public static DateTimeOffset Of(DateTime utc) =>
        TimeZoneInfo.ConvertTime(new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)), TimeZoneInfo.Local);

    // "UTC+01:00"
    public static string Offset(DateTimeOffset at)
    {
        var o = at.Offset;
        return $"UTC{(o < TimeSpan.Zero ? "-" : "+")}{o:hh\\:mm}";
    }

    // "UTC+01:00, GMT Standard Time (daylight saving)"
    public static string Zone(DateTimeOffset at)
    {
        var zone = TimeZoneInfo.Local;
        var dst = zone.IsDaylightSavingTime(at) ? " (daylight saving)" : "";
        return $"{Offset(at)}, {zone.Id}{dst}";
    }

    public static string Legend() => $"Times are server time ({Zone(DateTimeOffset.Now)}).";
}
