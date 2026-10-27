using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Canary.Recording;

// Windows calls for ResourceMonitor. Wine implements them too; a missing one throws.
internal static class Native
{
    public const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint SnapProcess = 0x2;

    [StructLayout(LayoutKind.Sequential)]
    public struct MemoryCounters
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
        public UIntPtr PrivateUsage;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    public readonly struct ProcessInfo(uint pid, uint parent, uint threads, string name)
    {
        public uint Pid { get; } = pid;
        public uint Parent { get; } = parent;
        public uint Threads { get; } = threads;
        public string Name { get; } = name;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr WineGetVersion();

    // Only Wine's ntdll exports this.
    public static string WineVersion()
    {
        try
        {
            var ntdll = GetModuleHandle("ntdll.dll");
            var proc = ntdll == IntPtr.Zero ? IntPtr.Zero : GetProcAddress(ntdll, "wine_get_version");
            if (proc == IntPtr.Zero) return null;
            var get = (WineGetVersion)Marshal.GetDelegateForFunctionPointer(proc, typeof(WineGetVersion));
            return Marshal.PtrToStringAnsi(get());
        }
        catch
        {
            return null;
        }
    }

    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetProcessIoCounters(IntPtr process, out IoCounters counters);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetProcessHandleCount(IntPtr process, out uint count);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool K32GetProcessMemoryInfo(IntPtr process, ref MemoryCounters counters, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx status);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool GetDiskFreeSpaceEx(string directory, out ulong freeToCaller, out ulong total, out ulong totalFree);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry32 entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry32 entry);

    public static bool MemoryInfo(IntPtr process, out MemoryCounters counters)
    {
        counters = new MemoryCounters { cb = (uint)Marshal.SizeOf(typeof(MemoryCounters)) };
        return K32GetProcessMemoryInfo(process, ref counters, counters.cb);
    }

    public static List<ProcessInfo> Processes()
    {
        var list = new List<ProcessInfo>();
        var snapshot = CreateToolhelp32Snapshot(SnapProcess, 0);
        if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return list;
        try
        {
            var entry = new ProcessEntry32 { dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry32)) };
            for (var ok = Process32FirstW(snapshot, ref entry); ok; ok = Process32NextW(snapshot, ref entry))
                list.Add(new ProcessInfo(entry.th32ProcessID, entry.th32ParentProcessID, entry.cntThreads, entry.szExeFile));
        }
        finally
        {
            CloseHandle(snapshot);
        }
        return list;
    }
}
