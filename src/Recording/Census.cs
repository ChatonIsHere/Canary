using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using Alta.Chunks;
using Alta.Networking;
using Alta.Networking.Internal;
using HarmonyLib;

namespace Canary.Recording;

// Entities by prefab and chunk, to catch buildup. It walks every entity on the main thread, so it
// records its own cost.
internal static class Census
{
    private const int TopChunks = 25;

    private static readonly FieldInfo EntityManagerField = AccessTools.Field(typeof(NetworkScene), "entityManager");
    private static readonly Dictionary<uint, string> PrefabNames = new();
    private static readonly Dictionary<Chunk, string> ChunkNames = new();
    private static bool _warned;

    public static void Take(Action<Record> add)
    {
        if (NetworkSceneManager.Current is not NetworkScene scene || EntityManagerField?.GetValue(scene) is not EntityManager manager)
            return;

        var stopwatch = Stopwatch.StartNew();
        var byPrefab = new Dictionary<string, int>();
        var byChunk = new Dictionary<string, int>();
        var total = 0;
        try
        {
            foreach (var entity in manager.IterateEntities())
            {
                if (entity == null) continue;
                total++;
                Increment(byPrefab, PrefabName(entity));
                var chunk = entity.Chunk;
                if (chunk != null) Increment(byChunk, ChunkName(chunk));
            }
        }
        catch (Exception e)
        {
            if (!_warned) CanaryMod.Log.Warning($"Entity census failed: {e}");
            _warned = true;
            return;
        }
        stopwatch.Stop();

        add(new CensusRecord
        {
            Total = total,
            DurationMs = (float)Math.Round(stopwatch.Elapsed.TotalMilliseconds, 2),
            ByPrefab = byPrefab.OrderByDescending(kv => kv.Value).ToDictionary(kv => kv.Key, kv => kv.Value),
            ByChunk = byChunk.OrderByDescending(kv => kv.Value).Take(TopChunks).ToDictionary(kv => kv.Key, kv => kv.Value),
        });
    }

    // Unity's name getters allocate, so names are cached by prefab hash. Scene-placed entities have no
    // prefab and never pile up, so they're one line.
    private const string SceneEntities = "(placed in the scene)";

    private static string PrefabName(NetworkEntity entity)
    {
        var prefab = entity.Prefab;
        if (prefab == null) return SceneEntities;
        if (!PrefabNames.TryGetValue(prefab.Hash, out var name))
            PrefabNames[prefab.Hash] = name = CleanName(prefab.name);
        return name;
    }

    // "4868 - Shield(Clone)" -> "Shield"
    private static string CleanName(string name)
    {
        var dash = name.IndexOf(" - ", StringComparison.Ordinal);
        if (dash > 0 && name.Substring(0, dash).All(char.IsDigit)) name = name.Substring(dash + 3);
        if (name.EndsWith("(Clone)", StringComparison.Ordinal)) name = name.Substring(0, name.Length - 7);
        return name.Trim();
    }

    private static string ChunkName(Chunk chunk)
    {
        if (!ChunkNames.TryGetValue(chunk, out var name))
            ChunkNames[chunk] = name = chunk.ChunkIdentifier;
        return name;
    }

    private static void Increment(Dictionary<string, int> counts, string key)
    {
        counts.TryGetValue(key, out var n);
        counts[key] = n + 1;
    }
}
