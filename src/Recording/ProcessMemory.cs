using System;
using UnityEngine.Profiling;

namespace Canary.Recording;

// Mono's Process.WorkingSet64 is always 0 on Windows.
internal static class ProcessMemory
{
    private static bool _nativeFailed;

    public static long WorkingSetBytes()
    {
        if (!_nativeFailed)
        {
            try
            {
                if (Native.MemoryInfo(Native.GetCurrentProcess(), out var counters))
                    return (long)counters.WorkingSetSize.ToUInt64();
            }
            catch (Exception)
            {
                // Neither Windows nor Wine.
            }
            _nativeFailed = true;
        }
        return Profiler.GetTotalReservedMemoryLong();
    }
}
