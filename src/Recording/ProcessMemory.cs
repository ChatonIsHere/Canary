using System;
using UnityEngine.Profiling;

namespace Canary.Recording;

// Mono's Process.WorkingSet64 reads 0 on Windows, so the working set comes from the OS directly (Wine
// implements the same call); anywhere it's missing falls back to Unity's own figure.
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
                // Not Windows or Wine.
            }
            _nativeFailed = true;
        }
        return Profiler.GetTotalReservedMemoryLong();
    }
}
