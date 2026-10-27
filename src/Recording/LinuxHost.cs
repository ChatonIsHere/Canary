using System;
using System.IO;
using System.Linq;

namespace Canary.Recording;

// Under Wine (the Docker, AMP and Pterodactyl images) some Windows calls are wrong: process disk I/O is
// zero and "the machine" is the host. This reads /proc and the container's cgroup through Z: instead.
internal static class LinuxHost
{
    public static string WineVersion { get; } = Native.WineVersion();
    private static readonly string Root = FindRoot();

    public static bool Available => Root != null;
    public static string Container { get; } = Available ? DetectContainer() : null;
    public static string Kernel { get; } = Available ? Read("/proc/sys/kernel/osrelease")?.Trim() : null;

    private static readonly Cgroup Group = Available ? Cgroup.Find() : null;
    public static bool HasCgroup => Group != null;

    public static string Read(string linuxPath)
    {
        try
        {
            return File.ReadAllText(Root + linuxPath.TrimStart('/').Replace('/', '\\'));
        }
        catch
        {
            return null;
        }
    }

    private static bool Exists(string linuxPath) => Root != null && File.Exists(Root + linuxPath.TrimStart('/').Replace('/', '\\'));

    private static string FindRoot()
    {
        if (WineVersion == null) return null;
        try
        {
            return File.Exists(@"Z:\proc\self\status") ? @"Z:\" : null;
        }
        catch
        {
            return null;
        }
    }

    private static string DetectContainer()
    {
        if (Exists("/.dockerenv")) return "Docker";
        if (Exists("/run/.containerenv")) return "Podman";
        var cgroup = Read("/proc/1/cgroup") ?? "";
        if (cgroup.Contains("kubepods")) return "Kubernetes";
        if (cgroup.Contains("docker")) return "Docker";
        if (cgroup.Contains("lxc")) return "LXC";
        return null;
    }

    public static (ulong Read, ulong Write)? ProcessIo()
    {
        var text = Read("/proc/self/io");
        if (text == null) return null;
        return (Field(text, "read_bytes:"), Field(text, "write_bytes:"));
    }

    // Loopback excluded. In a container this is its own network namespace.
    public static (long Rx, long Tx)? NetworkTotals()
    {
        var text = Read("/proc/net/dev");
        if (text == null) return null;
        long rx = 0, tx = 0;
        foreach (var line in text.Split('\n').Skip(2))
        {
            var colon = line.IndexOf(':');
            if (colon < 0 || line.Substring(0, colon).Trim() == "lo") continue;
            var f = line.Substring(colon + 1).Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (f.Length < 9) continue;
            rx += long.Parse(f[0]);
            tx += long.Parse(f[8]);
        }
        return (rx, tx);
    }

    public static CgroupReading ReadCgroup() => Group?.Read();

    private static ulong Field(string text, string name)
    {
        foreach (var line in text.Split('\n'))
            if (line.StartsWith(name, StringComparison.Ordinal) && ulong.TryParse(line.Substring(name.Length).Trim(), out var v))
                return v;
        return 0;
    }

    internal sealed class CgroupReading
    {
        public double CpuUsec;
        public double ThrottledUsec;
        public long Throttles;
        public double? LimitCores;
        public long? MemBytes;
        public long? MemLimitBytes;
        public ulong IoRead, IoWrite;
        public int? Processes;
    }

    // cgroup v2, or v1 on older hosts.
    private sealed class Cgroup
    {
        private string _v2;
        private bool _v1;

        public static Cgroup Find()
        {
            var self = LinuxHost.Read("/proc/self/cgroup") ?? "";
            var v2Line = self.Split('\n').FirstOrDefault(l => l.StartsWith("0::", StringComparison.Ordinal));
            if (v2Line != null)
            {
                // With its own cgroup namespace (Docker's v2 default) the group is the root.
                var path = v2Line.Substring(3).Trim();
                foreach (var dir in new[] { "/sys/fs/cgroup" + (path == "/" ? "" : path), "/sys/fs/cgroup" })
                    if (Exists(dir + "/memory.current")) return new Cgroup { _v2 = dir };
                return null;
            }
            return Exists("/sys/fs/cgroup/memory/memory.usage_in_bytes") ? new Cgroup { _v1 = true } : null;
        }

        public CgroupReading Read() => _v2 != null ? ReadV2() : _v1 ? ReadV1() : null;

        private CgroupReading ReadV2()
        {
            var r = new CgroupReading();
            var cpu = LinuxHost.Read(_v2 + "/cpu.stat") ?? "";
            r.CpuUsec = Field(cpu, "usage_usec ");
            r.ThrottledUsec = Field(cpu, "throttled_usec ");
            r.Throttles = (long)Field(cpu, "nr_throttled ");
            var max = LinuxHost.Read(_v2 + "/cpu.max")?.Trim().Split(' ');
            if (max is { Length: 2 } && max[0] != "max" && double.TryParse(max[0], out var quota) && double.TryParse(max[1], out var period) && period > 0)
                r.LimitCores = quota / period;
            // Minus reclaimable file cache, as docker stats counts it.
            r.MemBytes = Long(LinuxHost.Read(_v2 + "/memory.current")) - (long)Field(LinuxHost.Read(_v2 + "/memory.stat") ?? "", "inactive_file ");
            r.MemLimitBytes = Long(LinuxHost.Read(_v2 + "/memory.max")); // "max" (no limit) parses as null
            foreach (var line in (LinuxHost.Read(_v2 + "/io.stat") ?? "").Split('\n'))
                foreach (var part in line.Split(' '))
                {
                    if (part.StartsWith("rbytes=", StringComparison.Ordinal)) r.IoRead += ulong.Parse(part.Substring(7));
                    else if (part.StartsWith("wbytes=", StringComparison.Ordinal)) r.IoWrite += ulong.Parse(part.Substring(7));
                }
            r.Processes = CountLines(LinuxHost.Read(_v2 + "/cgroup.procs")); // pids.current counts threads
            return r;
        }

        private static CgroupReading ReadV1()
        {
            var r = new CgroupReading();
            var usage = Long(LinuxHost.Read("/sys/fs/cgroup/cpuacct/cpuacct.usage")) ?? Long(LinuxHost.Read("/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage"));
            r.CpuUsec = (usage ?? 0) / 1000.0;
            var cpuDir = Exists("/sys/fs/cgroup/cpu/cpu.stat") ? "/sys/fs/cgroup/cpu" : "/sys/fs/cgroup/cpu,cpuacct";
            var stat = LinuxHost.Read(cpuDir + "/cpu.stat") ?? "";
            r.ThrottledUsec = Field(stat, "throttled_time ") / 1000.0;
            r.Throttles = (long)Field(stat, "nr_throttled ");
            var quota = Long(LinuxHost.Read(cpuDir + "/cpu.cfs_quota_us"));
            var period = Long(LinuxHost.Read(cpuDir + "/cpu.cfs_period_us"));
            if (quota > 0 && period > 0) r.LimitCores = (double)quota / period;
            r.MemBytes = Long(LinuxHost.Read("/sys/fs/cgroup/memory/memory.usage_in_bytes"))
                         - (long)Field(LinuxHost.Read("/sys/fs/cgroup/memory/memory.stat") ?? "", "total_inactive_file ");
            var limit = Long(LinuxHost.Read("/sys/fs/cgroup/memory/memory.limit_in_bytes"));
            r.MemLimitBytes = limit is > 0 and < long.MaxValue / 2 ? limit : null; // "no limit" is a huge number
            foreach (var line in (LinuxHost.Read("/sys/fs/cgroup/blkio/blkio.throttle.io_service_bytes") ?? "").Split('\n'))
            {
                var f = line.Split(' ');
                if (f.Length != 3 || !ulong.TryParse(f[2], out var v)) continue;
                if (f[1] == "Read") r.IoRead += v;
                else if (f[1] == "Write") r.IoWrite += v;
            }
            r.Processes = CountLines(LinuxHost.Read("/sys/fs/cgroup/memory/cgroup.procs"));
            return r;
        }

        private static long? Long(string text) => long.TryParse(text?.Trim(), out var v) ? v : null;

        private static int? CountLines(string text) => text == null ? null : text.Split('\n').Count(l => l.Trim().Length > 0);
    }
}
