# Canary

An early warning for A Township Tale servers. Canary records what a server is doing all the time, so when
something goes wrong (lag, errors, a mod misbehaving, the machine running out of something) the evidence is
already there.

Canary is a MelonLoader mod for dedicated servers. A client with it installed does nothing yet; an opt-in
client side (players' frame rates and errors sent to the server) comes in a later version.

**[Canary Viewer](https://chatonishere.github.io/Canary/)** opens Canary's files in your browser: a
timeline, lag spikes, a map of where players were, entity buildup, errors by mod, resource use and more.
Nothing is uploaded; the files stay on your machine. It has demo data if you want to look first.

## What it records

The last 10 minutes are always kept in memory, like an instant replay. Nothing is written to disk unless
you ask (`canary save`, `canary record start`, `canary report`) or turn on `RecordOnBoot`.

| Record | How often | What's in it |
| --- | --- | --- |
| `sample` | every second | frame times (average, p50, p95, slowest), garbage collections, heap and process memory, players, entities, error count, ms spent in each of the game's update modules, and sections and metrics from other mods |
| `resources` | every 5 seconds | CPU, memory, private memory, handles, threads and disk I/O of the server process; the same for any process it started (crash handler, anything a mod launched); the game's own network traffic; the machine's CPU, memory, network and free disk space |
| `spike` | when a frame takes longer than `SpikeMs` | how long, whether a garbage collection ran, players and entities at the time |
| `positions` | every 5 seconds | each player's id, name, position and chunk |
| `census` | every 60 seconds | every networked entity counted by type and by chunk, and how long counting took |
| `error` | the first time a new kind of error appears | which mod it came from, the logger, the message |
| `mark` | when you add one | your note |
| `header` | first line of every file | Canary and game versions, the server's clock and time zone, and the settings that shaped the data |

Lag spikes while the world is loading aren't counted; spikes start counting 10 seconds after the server is up.
Resource readings are taken on a background thread, so they cost the server no frame time. They use Windows
calls that Wine also implements, so they work on a Linux host running the server through Wine; any reading
that isn't available is left out and logged once.

### On Linux, in containers

Canary works the same on a server run through Wine, as the Docker, AMP and Pterodactyl images do. Wine
answers some of the Windows calls wrongly there, so Canary reads Linux's own figures instead (Wine shows the
Linux filesystem as the `Z:` drive):

- **The container itself**, from its cgroup: CPU against its CPU limit and how much of the time that limit
  made it wait (throttling, a direct cause of lag), memory against its memory limit, disk I/O, process count
  and its own network traffic. These go in a `container` section of each `resources` record.
- **The server process's disk I/O** from `/proc/self/io`. Some kernels, Docker Desktop's WSL2 one included,
  don't keep per-process I/O counts; it's left out there.
- **"Machine" means the host.** CPU, memory and free disk outside the container describe the whole machine the
  container runs on; the viewer labels them that way.

A container's clock is UTC unless its `TZ` is set. Either way, the header of every file records which zone the
server was in.

### Errors

Every warning and error, whether it goes through the game's NLog logging, Unity or MelonLoader, is grouped by
where it came from. A thousand copies of the same error are one group with a count, tagged with the mod it came
from (found from the stack trace, the logger's class, or MelonLoader's log section), or `game`.

### Time zones

Every time in Canary's files is UTC. Each file's header also records what the server's clock read and which
zone it was in (with its UTC offset and whether daylight saving was on), and a recording that crosses a daylight
saving change gets a new header in each part. File names use UTC too, marked with a `Z`
(`recording-20261027T120000Z-part001.jsonl.gz`). The console prints server time and says which zone that is.
The viewer can show everything in your time, the server's time or UTC, and always says which it's using.

## Recording to disk

`canary record start [name]` records until `canary record stop`, starting with whatever is already in the
10-minute buffer (so you get the run-up to whatever made you start it). With `RecordOnBoot` on, every boot
starts a recording on its own.

- A recording is split into parts, a new one every `RotateMinutes` (60). Each part is written as plain text
  that's flushed every 5 seconds, then gzipped once it's finished, so a crash loses at most a few seconds and
  the part it was writing is gzipped on the next boot.
- Gzipped, an empty server takes about 4 KB a minute (about 6 MB a day); a busy one more, depending on players
  and mods.
- Old files are deleted after `RetentionDays` (14), and the oldest go first once recordings and reports pass
  `MaxStorageMb` (1024 MB).

## Console commands

| Command | |
| --- | --- |
| `canary status` | what's being recorded, the last second's frame times, the latest resource use, spike and error counts |
| `canary save [minutes]` | save the buffer (or its last N minutes) to a file |
| `canary record start [name]` / `canary record stop` | record to disk with no time limit |
| `canary mark <text>` | add a note to the timeline |
| `canary spikes [count]` | recent lag spikes |
| `canary errors [count]` | the most frequent error groups |
| `canary error <id>` | one error group in full, with its stack trace |
| `canary debug on [pattern] [minutes]` | turn on the game's Trace logging for loggers matching the pattern (default `*`) for a while (default 10, max 120 minutes) |
| `canary debug off [pattern]` | turn it off early |
| `canary report` | one zip for a bug report: summary, buffer, error groups, mod list and logs, with login tokens redacted |

Files go to `UserData/Canary/recordings` and `UserData/Canary/reports` in the game folder. Recordings are
JSON lines: one record per line, each with a `type` and a unix-milliseconds UTC `t`.

## Settings

`UserData/MelonPreferences.cfg`, under `[Canary]`. Canary writes its section the first time it starts.

| Setting | Default | |
| --- | --- | --- |
| `BufferMinutes` | 10 | how much history the in-memory buffer keeps |
| `SpikeMs` | 200 | a frame longer than this is a lag spike |
| `PositionSeconds` | 5 | how often player positions are recorded |
| `CensusSeconds` | 60 | how often entities are counted |
| `ResourceSeconds` | 5 | how often CPU, memory, disk and network use are recorded |
| `RecordUpdateModules` | true | record the game's per-module update timings |
| `RecordOnBoot` | false | start recording to disk on every boot |
| `Compress` | true | gzip recordings and saved buffers |
| `RotateMinutes` | 60 | start a new part of a recording this often |
| `RetentionDays` | 14 | delete recordings and reports older than this (0 keeps them) |
| `MaxStorageMb` | 1024 | delete the oldest recordings and reports past this size (0 for no limit) |

## For other mods

```csharp
using Canary;

using (CanaryApi.Section("MyMod.Pathfinding")) { ... }   // ms per second, under "sections"
CanaryApi.Metric("MyMod.QueueLength", queue.Count);      // latest value, under "metrics"
CanaryApi.Mark("MyMod: boss fight started");

CanaryEvents.LagSpike += spike => ...;  // also Sample, Resources, NewError, Positions, Census, Mark
```

Every call is cheap, safe from any thread (except `Mark`, main thread only) and does nothing when Canary
isn't recording.

External tools can subscribe to the same records over the server's websocket console, like the game's own
events: `websocket subscribe CanaryLagSpike` (also `CanarySample`, `CanaryResources`, `CanaryNewError`,
`CanaryPlayerPositions`, `CanaryEntityCensus`, `CanaryMark`).

## Building

Needs the .NET SDK and a game install with MelonLoader to compile against. Point `GameDir` at it, either in a
`Local.props` next to `Canary.csproj` (gitignored):

```xml
<Project>
  <PropertyGroup>
    <GameDir>E:\Games\Server</GameDir>
  </PropertyGroup>
</Project>
```

or on the command line: `dotnet build -c Release -p:GameDir=...`. The output is `bin/Release/Canary.dll`.

The viewer is the static site in `docs/` (GitHub Pages serves it from there). To try it locally, serve that
folder, for example `python -m http.server --directory docs`, and open http://localhost:8000. It uses
[uPlot](https://github.com/leeoniya/uPlot) and [fflate](https://github.com/101arrowz/fflate), both MIT
licensed and kept in `docs/vendor`.
