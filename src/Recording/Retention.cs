using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Canary.Diagnostics;

namespace Canary.Recording;

// Keeps recordings and reports from filling the disk: gzips parts a crash left plain, deletes anything older
// than RetentionDays, then the oldest files until the folder is under MaxStorageMb. Runs on a worker thread
// when a recording starts or rotates. The file being written is never touched.
internal static class Retention
{
    private static readonly object Lock = new();

    public static void ApplyAsync(string keep) => Task.Run(() =>
    {
        try
        {
            Apply(keep);
        }
        catch (Exception e)
        {
            CanaryMod.Log.Warning($"Couldn't clean up old recordings: {e.Message}");
        }
    });

    private static void Apply(string keep)
    {
        lock (Lock)
        {
            // Parts a crash left uncompressed (the open part is the one to keep).
            if (CanaryConfig.Compress && Directory.Exists(RecordingFile.Directory))
                foreach (var plain in Directory.GetFiles(RecordingFile.Directory, "*.jsonl"))
                    if (!string.Equals(Path.GetFullPath(plain), Path.GetFullPath(keep), StringComparison.OrdinalIgnoreCase))
                        RecordingFile.Gzip(plain);

            var files = new[] { RecordingFile.Directory, ReportBundle.Directory }
                .Where(Directory.Exists)
                .SelectMany(d => new DirectoryInfo(d).GetFiles())
                .Where(f => !string.Equals(f.FullName, Path.GetFullPath(keep), StringComparison.OrdinalIgnoreCase))
                .OrderBy(f => f.LastWriteTimeUtc)
                .ToList();

            int deleted = 0;
            long freed = 0;
            void Delete(FileInfo f)
            {
                freed += f.Length;
                f.Delete();
                deleted++;
            }

            if (CanaryConfig.RetentionDays > 0)
            {
                var cutoff = DateTime.UtcNow.AddDays(-CanaryConfig.RetentionDays);
                foreach (var f in files.Where(f => f.LastWriteTimeUtc < cutoff).ToList())
                {
                    Delete(f);
                    files.Remove(f);
                }
            }

            if (CanaryConfig.MaxStorageMb > 0)
            {
                var limit = CanaryConfig.MaxStorageMb * 1048576L;
                var total = files.Sum(f => f.Length) + (File.Exists(keep) ? new FileInfo(keep).Length : 0);
                foreach (var f in files.ToList())
                {
                    if (total <= limit) break;
                    total -= f.Length;
                    Delete(f);
                }
            }

            if (deleted > 0)
                CanaryMod.Log.Msg($"Removed {deleted} old recording/report file(s), {freed / 1048576.0:F1} MB (RetentionDays {CanaryConfig.RetentionDays}, MaxStorageMb {CanaryConfig.MaxStorageMb}).");
        }
    }
}
