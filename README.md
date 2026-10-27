# Canary

An early warning for A Township Tale servers. Canary records what a server is doing, all the time, so when
something goes wrong (lag, errors, a mod misbehaving) the evidence is already there.

Canary is a MelonLoader mod. It runs on dedicated servers; the client side (opt-in stats sent to the server)
comes in a later version, and until then a client with Canary installed does nothing.

## What it records

Canary keeps the last 10 minutes in memory, like an instant replay. Nothing is written to disk unless you ask.

| Record | How often | What's in it |
| --- | --- | --- |
| `sample` | every second | frame times (avg, p50, p95, max), garbage collections, heap and process memory, players, entities, error count, ms spent in each of the game's update modules, plus any sections and metrics from other mods |
| `spike` | when a frame takes longer than `SpikeMs` | how long, whether a garbage collection ran, players and entities at the time |
| `positions` | every 5 seconds | each player's id, name, position and chunk |
| `census` | every 60 seconds | every networked entity counted by type and by chunk, and how long counting took |
| `error` | the first time a new kind of error appears | which mod it came from, the logger, the message |
| `mark` | when you add one | your note |

Lag spikes during world loading aren't counted; spikes start counting 10 seconds after the server is up.

### Errors

Every warning and error, whether logged through the game's NLog, Unity or MelonLoader, is grouped by where it
came from. A thousand copies of the same error are one group with a count, tagged with the mod it came from
(found from the stack trace, the logger's class, or MelonLoader's log section), or `game`.

## Console commands

| Command | |
| --- | --- |
| `canary status` | what's being recorded, the last second's frame times, spike and error counts |
| `canary save [minutes]` | save the buffer (or its last N minutes) to a file |
| `canary record start [name]` / `canary record stop` | record to a file with no time limit |
| `canary mark <text>` | add a note to the timeline |
| `canary spikes [count]` | recent lag spikes |
| `canary errors [count]` | the most frequent error groups |
| `canary error <id>` | one error group in full, with its stack trace |
| `canary debug on [pattern] [minutes]` | turn on the game's Trace logging for loggers matching the pattern (default `*`) for a while (default 10, max 120 minutes) |
| `canary debug off [pattern]` | turn it off early |
| `canary report` | one zip for a bug report: summary, buffer, error groups, mod list and logs, with login tokens redacted |

Files go to `UserData/Canary/recordings` and `UserData/Canary/reports` in the game folder. Recordings are
JSON lines: one record per line, each with a `type` and a unix-milliseconds `t`.

## Settings

`UserData/MelonPreferences.cfg`, under `[Canary]`:

| Setting | Default | |
| --- | --- | --- |
| `BufferMinutes` | 10 | how much history the in-memory buffer keeps |
| `SpikeMs` | 200 | a frame longer than this is a lag spike |
| `PositionSeconds` | 5 | how often player positions are recorded |
| `CensusSeconds` | 60 | how often entities are counted |
| `RecordUpdateModules` | true | record the game's per-module update timings |

## For other mods

```csharp
using Canary;

using (CanaryApi.Section("MyMod.Pathfinding")) { ... }   // ms per second, under "sections"
CanaryApi.Metric("MyMod.QueueLength", queue.Count);      // latest value, under "metrics"
CanaryApi.Mark("MyMod: boss fight started");

CanaryEvents.LagSpike += spike => ...;                   // also Sample, NewError, Positions, Census, Mark
```

Every call is cheap, safe from any thread (except `Mark`, main thread only) and does nothing when Canary
isn't recording.

External tools can subscribe to the same records over the server's websocket console, like the game's own
events: `websocket subscribe CanaryLagSpike` (also `CanarySample`, `CanaryNewError`,
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
