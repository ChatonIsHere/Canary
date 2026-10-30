# Canary

A MelonLoader mod that records what an A Township Tale server is doing, so when it lags, errors or
falls over there's something to look at. Server only for now.

Open recordings in the **[viewer](https://chatonishere.github.io/Canary/)**. Files stay in your
browser.

## What it records

The last 10 minutes are kept in memory. Every second: frame times, GC, memory, players, entities, errors
and the game's update module times. Every 5 seconds: player positions, and CPU, memory, disk and network
for the server, its child processes, the machine and (under Wine) its container. Every minute: entities
by type and chunk. Plus every lag spike, and the first of each new error, tagged with the mod it came
from.

All times are UTC. Each file's header records the server's time zone, and what the server is: its name and
settings, the versions of the game, MelonLoader, TavernLib and TavernLauncher (when it started the server),
and its mods, including what TavernLib's mod manager installed. Without TavernLib, or with an older one,
it records what it can.

## Viewer

The [viewer](https://chatonishere.github.io/Canary/) charts it all, lists spikes, errors and entities, and
plots where players went. Recordings from Canary 0.4.0 also show where each second's time goes, by Unity
player-loop phase, which phases each lag spike was stuck in, and how many chunks were loaded.

To see players on the game's map, extract it from your own install (it's the game's artwork, so Canary
doesn't ship it), then open the `map.png` and `map.json` it writes along with a recording. The viewer
keeps it for next time.

```
pip install UnityPy
python tools/extract_map.py "<game folder>" <out>
```

## Commands

| | |
| --- | --- |
| `canary status` | What's being recorded and how the server's doing |
| `canary save [minutes]` | Save the buffer |
| `canary record start [name]` / `stop` | Record to disk until stopped |
| `canary mark <text>` | Note on the timeline |
| `canary spikes` / `errors` / `error <id>` | Recent spikes, top errors, one error in full |
| `canary debug on [pattern] [minutes]` / `off` | Temporary Trace logging |
| `canary report` | Zip of the buffer, errors, mods and logs |

Files go in `UserData/Canary`. Settings are under `[Canary]` in `UserData/MelonPreferences.cfg`.

## For mods

```csharp
using (CanaryApi.Section("MyMod.Pathfinding")) { ... }
CanaryApi.Metric("MyMod.QueueLength", queue.Count);
CanaryEvents.LagSpike += spike => { ... };
```

Console tools can `websocket subscribe CanaryLagSpike` (and `CanarySample`, `CanaryResources`, ...).

## Building

`dotnet build -c Release -p:GameDir=<game install with MelonLoader>`, or set `GameDir` in a
`Local.props`. Without the game, use [att-stubs](https://github.com/ChatonIsHere/att-stubs) as
`GameDir`, as CI does. A push to main with a new `<Version>` in `Canary.csproj` releases it.
The viewer is the static site in `docs/`.
