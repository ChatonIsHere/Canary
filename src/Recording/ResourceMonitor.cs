using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.NetworkInformation;
using System.Threading;
using Alta.Networking;

namespace Canary.Recording;

// Resource readings on a timer thread, handed to the main thread to record.
internal static class ResourceMonitor
{
    private static readonly ConcurrentQueue<ResourceRecord> Ready = new();
    private static readonly Stopwatch Wall = Stopwatch.StartNew();
    private static readonly Dictionary<uint, Child> Children = new();
    private static System.Threading.Timer _timer;
    private static int _busy;
    private static string _diskPath;
    private static bool _primed;

    private static double _lastWall;
    private static long _lastCpu;
    private static ulong _lastRead, _lastWrite;
    private static long _lastIdle, _lastSysTotal;
    private static int _lastOutBytes, _lastOutPackets, _lastInPackets;
    private static bool _haveGameNet;
    private static long _lastRx, _lastTx;
    private static bool _haveInterfaces;
    private static LinuxHost.CgroupReading _lastGroup;

    private sealed class Child
    {
        public IntPtr Handle;
        public long LastCpu;
        public bool Seen;
    }

    // Main thread (Unity API).
    public static void Start()
    {
        _diskPath = UnityEngine.Application.dataPath;
        var period = TimeSpan.FromSeconds(CanaryConfig.ResourceSeconds);
        _timer = new System.Threading.Timer(_ => Sample(), null, TimeSpan.Zero, period);
    }

    public static bool TryTake(out ResourceRecord record) => Ready.TryDequeue(out record);

    private static void Sample()
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1) return;
        try
        {
            var now = Wall.Elapsed.TotalSeconds;
            var seconds = now - _lastWall;
            _lastWall = now;
            var record = new ResourceRecord();
            var machine = new MachineResources { Cores = Environment.ProcessorCount };

            Try(() => ReadProcess(record, seconds));
            Try(() => ReadChildren(record, seconds));
            Try(() => ReadGameNetwork(record, seconds));
            Try(() => ReadMachineCpu(machine));
            Try(() => ReadMachineMemory(machine));
            Try(() => ReadDisk(machine));
            if (LinuxHost.HasCgroup && LinuxHost.Container != null)
            {
                // The network namespace is the container's own.
                record.Container = new ContainerResources { Kind = LinuxHost.Container };
                Try(() => ReadContainer(record.Container, seconds));
                Try(() => ReadLinuxNetwork(seconds, (rx, tx) => (record.Container.NetRxKBps, record.Container.NetTxKBps) = (rx, tx)));
            }
            else if (LinuxHost.Available)
                Try(() => ReadLinuxNetwork(seconds, (rx, tx) => (machine.NetRxKBps, machine.NetTxKBps) = (rx, tx)));
            else
                Try(() => ReadInterfaces(machine, seconds));
            record.Machine = machine;
            record.TotalCpuPct = Round((record.CpuPct ?? 0) + (record.Children?.Sum(c => c.CpuPct ?? 0) ?? 0));
            record.TotalMemMb = Round((record.MemMb ?? 0) + (record.Children?.Sum(c => c.MemMb ?? 0) ?? 0));

            // The first pass only primes the deltas.
            if (_primed) Ready.Enqueue(record);
            _primed = true;
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    private static void ReadProcess(ResourceRecord record, double seconds)
    {
        var self = Native.GetCurrentProcess();
        if (Native.GetProcessTimes(self, out _, out _, out var kernel, out var user))
        {
            var cpu = kernel + user;
            if (_primed) (record.CpuPct, record.CpuCores) = CpuShare(cpu - _lastCpu, seconds);
            _lastCpu = cpu;
        }
        if (Native.MemoryInfo(self, out var memory))
        {
            record.MemMb = Mb(memory.WorkingSetSize);
            // Wine leaves this at zero.
            if (!LinuxHost.Available || memory.PrivateUsage != UIntPtr.Zero) record.PrivateMb = Mb(memory.PrivateUsage);
        }
        if (Native.GetProcessHandleCount(self, out var handles) && (handles > 0 || !LinuxHost.Available)) record.Handles = (int)handles;
        // Wine returns zeros here.
        ulong? read = null, write = null;
        if (LinuxHost.Available)
        {
            if (LinuxHost.ProcessIo() is { } linux) (read, write) = (linux.Read, linux.Write);
        }
        else if (Native.GetProcessIoCounters(self, out var io)) (read, write) = (io.ReadTransferCount, io.WriteTransferCount);
        if (read is { } r && write is { } w)
        {
            if (_primed)
            {
                record.DiskReadKBps = Round((r - _lastRead) / 1024.0 / seconds);
                record.DiskWriteKBps = Round((w - _lastWrite) / 1024.0 / seconds);
            }
            (_lastRead, _lastWrite) = (r, w);
        }
    }

    private static void ReadContainer(ContainerResources container, double seconds)
    {
        var now = LinuxHost.ReadCgroup();
        if (now == null) return;
        var last = _lastGroup;
        _lastGroup = now;
        container.CpuLimitCores = now.LimitCores.HasValue ? Round(now.LimitCores.Value) : null;
        if (now.MemBytes is { } mem) container.MemMb = Round(mem / 1048576.0);
        if (now.MemLimitBytes is { } limit) container.MemLimitMb = Round(limit / 1048576.0);
        container.Processes = now.Processes;
        if (last == null || seconds <= 0) return;
        var cores = (now.CpuUsec - last.CpuUsec) / 1e6 / seconds;
        container.CpuCores = Round(cores);
        container.CpuPct = Round(100.0 * cores / (now.LimitCores ?? Environment.ProcessorCount));
        container.ThrottledPct = Round(Math.Min(100, 100.0 * (now.ThrottledUsec - last.ThrottledUsec) / 1e6 / seconds));
        container.Throttles = now.Throttles - last.Throttles;
        if (now.IoRead >= last.IoRead) container.DiskReadKBps = Round((now.IoRead - last.IoRead) / 1024.0 / seconds);
        if (now.IoWrite >= last.IoWrite) container.DiskWriteKBps = Round((now.IoWrite - last.IoWrite) / 1024.0 / seconds);
    }

    private static void ReadLinuxNetwork(double seconds, Action<double?, double?> set)
    {
        if (LinuxHost.NetworkTotals() is not { } totals) return;
        if (_haveInterfaces && totals.Rx >= _lastRx && totals.Tx >= _lastTx)
            set(Round((totals.Rx - _lastRx) / 1024.0 / seconds), Round((totals.Tx - _lastTx) / 1024.0 / seconds));
        (_lastRx, _lastTx, _haveInterfaces) = (totals.Rx, totals.Tx, true);
    }

    // Crash handlers, anything a mod launched.
    private static void ReadChildren(ResourceRecord record, double seconds)
    {
        var processes = Native.Processes();
        var selfPid = Native.GetCurrentProcessId();
        record.Threads = (int?)processes.FirstOrDefault(p => p.Pid == selfPid).Threads;

        var byParent = processes.Where(p => p.Pid != p.Parent).ToLookup(p => p.Parent);
        var descendants = new List<Native.ProcessInfo>();
        var queue = new Queue<uint>();
        queue.Enqueue(selfPid);
        while (queue.Count > 0 && descendants.Count < 64)
            foreach (var child in byParent[queue.Dequeue()])
            {
                descendants.Add(child);
                queue.Enqueue(child.Pid);
            }

        foreach (var c in Children.Values) c.Seen = false;
        var list = new List<ChildProcess>();
        foreach (var p in descendants)
        {
            if (!Children.TryGetValue(p.Pid, out var child))
            {
                var handle = Native.OpenProcess(Native.ProcessQueryLimitedInformation, false, p.Pid);
                if (handle == IntPtr.Zero) continue;
                Children[p.Pid] = child = new Child { Handle = handle, LastCpu = -1 };
            }
            child.Seen = true;
            var entry = new ChildProcess { Pid = (int)p.Pid, Name = p.Name, Threads = (int)p.Threads };
            // Wine returns our own times for other processes.
            if (!LinuxHost.Available && Native.GetProcessTimes(child.Handle, out _, out _, out var kernel, out var user))
            {
                var cpu = kernel + user;
                if (child.LastCpu >= 0) entry.CpuPct = CpuShare(cpu - child.LastCpu, seconds).Pct;
                child.LastCpu = cpu;
            }
            if (Native.MemoryInfo(child.Handle, out var memory)) entry.MemMb = Mb(memory.WorkingSetSize);
            list.Add(entry);
        }
        foreach (var gone in Children.Where(kv => !kv.Value.Seen).ToList())
        {
            Native.CloseHandle(gone.Value.Handle);
            Children.Remove(gone.Key);
        }
        if (list.Count > 0) record.Children = list;
    }

    // The game doesn't count bytes received.
    private static void ReadGameNetwork(ResourceRecord record, double seconds)
    {
        var transport = Socket.Current?.TransportSocket;
        if (transport == null) return;
        int outBytes = transport.OutgoingBytesTotal, outPackets = transport.OutgoingPacketsTotal, inPackets = transport.IncomingPacketsTotal;
        if (_haveGameNet)
        {
            // The counters are ints and wrap.
            record.GameOutKBps = Round(unchecked((uint)(outBytes - _lastOutBytes)) / 1024.0 / seconds);
            record.GamePacketsOutPerSec = Round(unchecked((uint)(outPackets - _lastOutPackets)) / seconds);
            record.GamePacketsInPerSec = Round(unchecked((uint)(inPackets - _lastInPackets)) / seconds);
        }
        (_lastOutBytes, _lastOutPackets, _lastInPackets, _haveGameNet) = (outBytes, outPackets, inPackets, true);
    }

    private static void ReadMachineCpu(MachineResources machine)
    {
        if (!Native.GetSystemTimes(out var idle, out var kernel, out var user)) return;
        var total = kernel + user; // kernel time includes idle time
        if (_primed && total > _lastSysTotal)
            machine.CpuPct = Round(100.0 * (1 - (double)(idle - _lastIdle) / (total - _lastSysTotal)));
        (_lastIdle, _lastSysTotal) = (idle, total);
    }

    private static void ReadMachineMemory(MachineResources machine)
    {
        var status = new Native.MemoryStatusEx { dwLength = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.MemoryStatusEx)) };
        if (!Native.GlobalMemoryStatusEx(ref status)) return;
        machine.MemTotalMb = Round(status.ullTotalPhys / 1048576.0);
        machine.MemUsedMb = Round((status.ullTotalPhys - status.ullAvailPhys) / 1048576.0);
    }

    // The whole machine, loopback excluded.
    private static void ReadInterfaces(MachineResources machine, double seconds)
    {
        long rx = 0, tx = 0;
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            var stats = nic.GetIPv4Statistics();
            rx += stats.BytesReceived;
            tx += stats.BytesSent;
        }
        if (_haveInterfaces && rx >= _lastRx && tx >= _lastTx)
        {
            machine.NetRxKBps = Round((rx - _lastRx) / 1024.0 / seconds);
            machine.NetTxKBps = Round((tx - _lastTx) / 1024.0 / seconds);
        }
        (_lastRx, _lastTx, _haveInterfaces) = (rx, tx, true);
    }

    private static void ReadDisk(MachineResources machine)
    {
        if (!Native.GetDiskFreeSpaceEx(_diskPath, out var free, out var total, out _)) return;
        machine.DiskFreeGb = Round(free / 1073741824.0);
        machine.DiskTotalGb = Round(total / 1073741824.0);
    }

    // 100 ns ticks -> % of the machine, and cores busy.
    private static (double? Pct, double? Cores) CpuShare(long ticks, double seconds)
    {
        if (seconds <= 0) return (null, null);
        var cores = ticks / 1e7 / seconds;
        return (Round(100.0 * cores / Environment.ProcessorCount), Round(cores));
    }

    private static double Mb(UIntPtr bytes) => Round(bytes.ToUInt64() / 1048576.0);
    private static double Round(double value) => Math.Round(value, 2);

    private static readonly HashSet<string> Failed = new();

    // A missing reading mustn't stop the rest. Each failure is logged once.
    private static void Try(Action read)
    {
        try
        {
            read();
        }
        catch (Exception e)
        {
            var key = read.Method.Name + e.GetType().Name;
            if (Failed.Add(key)) CanaryMod.Log.Warning($"Resource reading {read.Method.Name} isn't available here: {e.Message}");
        }
    }
}
