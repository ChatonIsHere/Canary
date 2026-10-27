using System;
using Alta.Console;
using Canary.Recording;

namespace Canary;

// C# events for mods, and Canary* console events for websocket subscribers. A console event is only
// serialized when something's subscribed.
public static class CanaryEvents
{
    public static event Action<Sample> Sample;
    public static event Action<SpikeRecord> LagSpike;
    public static event Action<ErrorRecord> NewError;
    public static event Action<PositionsRecord> Positions;
    public static event Action<CensusRecord> Census;
    public static event Action<ResourceRecord> Resources;
    public static event Action<MarkRecord> Mark;

    private static ConsoleEvent<Sample> _consoleSample;
    private static ConsoleEvent<SpikeRecord> _consoleSpike;
    private static ConsoleEvent<ErrorRecord> _consoleError;
    private static ConsoleEvent<PositionsRecord> _consolePositions;
    private static ConsoleEvent<CensusRecord> _consoleCensus;
    private static ConsoleEvent<ResourceRecord> _consoleResources;
    private static ConsoleEvent<MarkRecord> _consoleMark;

    internal static void RegisterConsoleEvents()
    {
        _consoleSample = new ConsoleEvent<Sample>("CanarySample");
        _consoleSpike = new ConsoleEvent<SpikeRecord>("CanaryLagSpike");
        _consoleError = new ConsoleEvent<ErrorRecord>("CanaryNewError");
        _consolePositions = new ConsoleEvent<PositionsRecord>("CanaryPlayerPositions");
        _consoleCensus = new ConsoleEvent<CensusRecord>("CanaryEntityCensus");
        _consoleResources = new ConsoleEvent<ResourceRecord>("CanaryResources");
        _consoleMark = new ConsoleEvent<MarkRecord>("CanaryMark");
    }

    internal static void Raise(Record record)
    {
        switch (record)
        {
            case Sample r: Fire(Sample, r); _consoleSample?.Invoke(() => r); break;
            case SpikeRecord r: Fire(LagSpike, r); _consoleSpike?.Invoke(() => r); break;
            case ErrorRecord r: Fire(NewError, r); _consoleError?.Invoke(() => r); break;
            case PositionsRecord r: Fire(Positions, r); _consolePositions?.Invoke(() => r); break;
            case CensusRecord r: Fire(Census, r); _consoleCensus?.Invoke(() => r); break;
            case ResourceRecord r: Fire(Resources, r); _consoleResources?.Invoke(() => r); break;
            case MarkRecord r: Fire(Mark, r); _consoleMark?.Invoke(() => r); break;
        }
    }

    // A throwing subscriber mustn't break the rest.
    private static void Fire<T>(Action<T> handlers, T record)
    {
        if (handlers == null) return;
        foreach (var handler in handlers.GetInvocationList())
        {
            try
            {
                ((Action<T>)handler)(record);
            }
            catch (Exception e)
            {
                CanaryMod.Log.Warning($"A {typeof(T).Name} subscriber ({handler.Method.DeclaringType?.FullName}) threw: {e.Message}");
            }
        }
    }
}
