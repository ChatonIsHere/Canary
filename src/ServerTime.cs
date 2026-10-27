using System;

namespace Canary;

// Every time Canary records is a UTC unix timestamp. Anything it shows a person (console output, report
// summaries) is the server's local time, always labelled with the server's UTC offset and time zone so a
// reader in another zone knows how to read it.
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

    // What every list of times in the console starts with.
    public static string Legend() => $"Times are server time ({Zone(DateTimeOffset.Now)}).";
}
