using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using MelonLoader;
using MelonLoader.Utils;
using Newtonsoft.Json.Linq;

namespace Canary.Diagnostics;

// What the server is: its name and settings, the versions it runs, and its mods. TavernLib is optional and
// read through its files and reflection, so this works with any version of it, or none.
internal static class ServerInfo
{
    // Copied from server_settings.json by name; the file also holds the community listing token.
    private static readonly (string Key, string From)[] Settings =
    [
        ("maxPlayers", "max_players"), ("whitelist", "whitelist_enabled"), ("communityListed", "community_listed"),
        ("region", "region"), ("gcTimerSeconds", "garbage_collection_timer"),
    ];

    public static JObject Build()
    {
        var info = new JObject();
        Try(info, () =>
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TheModdingTavern", "server_settings.json");
            if (!File.Exists(path)) return;
            var settings = JObject.Parse(File.ReadAllText(path));
            info["name"] = settings["name"];
            info["password"] = !string.IsNullOrEmpty((string)settings["password_hash"]);
            foreach (var (key, from) in Settings)
                if (settings[from] != null) info[key] = settings[from];
        });

        var args = Environment.GetCommandLineArgs();
        bool HasArg(string arg) => args.Any(a => string.Equals(a, arg, StringComparison.OrdinalIgnoreCase));
        info["scene"] = HasArg("/tutorialScene") ? "tutorial" : HasArg("/questScene") ? "quest" : "normal";

        Try(info, () => info["melonLoader"] = MelonLoaderVersion());
        info["tavernLib"] = MelonBase.RegisteredMelons.FirstOrDefault(m => m.Info.Name == "TavernLib")?.Info.Version;
        // The launcher passes /launcherauth (and newer ones /tavernlauncher=<version>) when it starts the server.
        var launcher = args.FirstOrDefault(a => a.StartsWith("/tavernlauncher=", StringComparison.OrdinalIgnoreCase));
        if (launcher != null) info["launcher"] = launcher.Substring(launcher.IndexOf('=') + 1);
        else if (HasArg("/launcherauth")) info["launcher"] = "unknown version";

        Try(info, () => AddModManager(info));
        info["melons"] = new JArray(MelonBase.RegisteredMelons.Select(m => new JObject
        {
            ["name"] = m.Info.Name,
            ["version"] = m.Info.Version,
            ["author"] = m.Info.Author,
            ["file"] = m.MelonAssembly?.Location is { } location ? Path.GetFileName(location) : null,
        }));
        return info;
    }

    // TavernLib's mod manager, if it has one: the same mod list and hash it gives joining clients.
    private static void AddModManager(JObject info)
    {
        var handshake = AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetType("TavernLib.Backend.Mods.ModHandshake", false))
            .FirstOrDefault(t => t != null);
        var snapshot = handshake?.GetMethod("Snapshot", BindingFlags.Public | BindingFlags.Static, null, [typeof(string)], null)
            ?.Invoke(null, [MelonEnvironment.GameRootDirectory]);
        if (snapshot == null) return;
        object Item(int n) => snapshot.GetType().GetField("Item" + n)?.GetValue(snapshot);
        JArray List(int n) => Item(n) is System.Collections.IEnumerable list and not string ? JArray.FromObject(list) : null;
        info["modsHash"] = Item(1) as string;
        // (hash, mods, untracked); the first mod manager (TavernLib 1.4) returned (hash, count, mods).
        if (List(2) is { } mods)
        {
            info["mods"] = mods;
            if (List(3) is { } untracked) info["untracked"] = untracked;
        }
        else if (List(3) is { } oldMods) info["mods"] = oldMods;
    }

    private static string MelonLoaderVersion()
    {
        var assembly = typeof(MelonBase).Assembly;
        var buildInfo = assembly.GetType("MelonLoader.Properties.BuildInfo") ?? assembly.GetType("MelonLoader.BuildInfo");
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
        return (buildInfo?.GetField("Version", flags)?.GetValue(null) ?? buildInfo?.GetProperty("Version", flags)?.GetValue(null)) as string
            ?? assembly.GetName().Version.ToString(3);
    }

    private static void Try(JObject info, Action read)
    {
        try
        {
            read();
        }
        catch (Exception e)
        {
            var errors = info["errors"] as JArray ?? (JArray)(info["errors"] = new JArray());
            errors.Add(e.GetBaseException().Message);
        }
    }
}
