using System;
using System.Linq;
using System.Reflection;
using Canary.Diagnostics;
using Canary.Recording;
using MelonLoader;

[assembly: MelonInfo(typeof(Canary.CanaryMod), "Canary", Canary.CanaryMod.Version, "ChatonIsHere", "https://github.com/ChatonIsHere/Canary")]

namespace Canary;

public class CanaryMod : MelonMod
{
    public const string Version = "0.2.0";

    internal static MelonLogger.Instance Log { get; private set; }

    // A dedicated server is the game started with /start_server; everything else is a player's client.
    public static bool IsServer { get; } =
        Environment.GetCommandLineArgs().Any(a => string.Equals(a, "/start_server", StringComparison.OrdinalIgnoreCase));

    public override void OnInitializeMelon()
    {
        Log = LoggerInstance;
        CanaryConfig.Init();

        if (!IsServer)
        {
            // The client addon (opt-in stats for the server) arrives in a later version; until then a client does nothing.
            Log.Msg("Client detected; Canary only records on a server for now.");
            return;
        }

        ErrorGroups.HookMelonLoader();
        // NLog's configuration is only loaded once the game itself starts, after mods initialize.
        MelonEvents.OnApplicationLateStart.Subscribe(ErrorGroups.Install);
        Recorder.Start();
        ResourceMonitor.Start();
        CanaryEvents.RegisterConsoleEvents();
        Alta.Console.CommandService.CommandCollection.Collect(Assembly.GetExecutingAssembly());
        Log.Msg($"Recording the last {CanaryConfig.BufferMinutes} minutes; 'canary status' for details.");
    }

    public override void OnUpdate()
    {
        if (!IsServer) return;
        Recorder.Tick();
        DebugLogging.Tick();
    }

    public override void OnApplicationQuit()
    {
        if (!IsServer) return;
        Recorder.StopRecording();
    }
}
