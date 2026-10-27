using System;
using System.Runtime.InteropServices;
using UnityEngine.Profiling;

namespace Canary.Recording;

// Mono's Process.WorkingSet64 reads 0 on Windows, so the working set comes from the OS directly. Wine
// implements the same call for a server in a container; anywhere else falls back to Unity's own figure.
internal static class ProcessMemory
{
    private static bool _psapiFailed;

    public static long WorkingSetBytes()
    {
        if (!_psapiFailed)
        {
            try
            {
                var counters = new ProcessMemoryCounters { cb = (uint)Marshal.SizeOf(typeof(ProcessMemoryCounters)) };
                if (K32GetProcessMemoryInfo(GetCurrentProcess(), ref counters, counters.cb))
                    return (long)counters.WorkingSetSize;
            }
            catch (Exception)
            {
                // Not Windows or Wine.
            }
            _psapiFailed = true;
        }
        return Profiler.GetTotalReservedMemoryLong();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessMemoryCounters
    {
        public uint cb;
        public uint PageFaultCount;
        public UIntPtr PeakWorkingSetSize;
        public UIntPtr WorkingSetSize;
        public UIntPtr QuotaPeakPagedPoolUsage;
        public UIntPtr QuotaPagedPoolUsage;
        public UIntPtr QuotaPeakNonPagedPoolUsage;
        public UIntPtr QuotaNonPagedPoolUsage;
        public UIntPtr PagefileUsage;
        public UIntPtr PeakPagefileUsage;
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool K32GetProcessMemoryInfo(IntPtr process, ref ProcessMemoryCounters counters, uint size);
}
