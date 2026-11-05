// What each view shows, worked out from the model. Each view only covers the zoomed range.
import { idlePhase } from "./load"
import * as Time from "./time"
import { int, num, pct } from "./format"
import type { Census, Model, Player, Resources, Sample, Spike, TrackPoint } from "./types"

export type Range = [number, number]

const inRange = (R: Range) => (t: number) => t >= R[0] && t <= R[1]
export const within = <T extends { t: number }>(list: T[], R: Range) => list.filter((r) => r.t >= R[0] && r.t <= R[1])
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const quantile = (a: number[], q: number) => {
  if (!a.length) return null
  const s = a.slice().sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const maxOf = (a: number[], start = -Infinity) => a.reduce((m, v) => (v > m ? v : m), start)
const defined = <T>(v: T | null | undefined): v is T => v != null

// Least-squares slope, per hour.
function slopePerHour(points: [number, number][]) {
  if (points.length < 3) return null
  const xs = points.map((p) => p[0] / 3600000), ys = points.map((p) => p[1])
  const mx = mean(xs)!, my = mean(ys)!
  let n = 0, d = 0
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); d += (xs[i] - mx) ** 2 }
  return d ? n / d : null
}

// Overview

export interface Tile { label: string; value: string; detail: string }
export type Severity = "critical" | "serious" | "warning" | "good" | "info"
export interface Finding { sev: Severity; text: string }

export function overview(M: Model, R: Range) {
  const samples = within(M.samples, R), spikes = within(M.spikes, R), res = within(M.resources, R), census = within(M.census, R)
  const inR = inRange(R)
  const tiles: Tile[] = []
  const tile = (label: string, value: string, detail = "") => tiles.push({ label, value, detail })
  const span = R[1] - R[0]
  const gaps = M.gaps.filter((g) => g.to >= R[0] && g.from <= R[1])
  tile("Time covered", Time.duration(span), gaps.length ? `${gaps.length} gap(s)` : "no gaps")
  const avgs = samples.map((s) => s.avgMs).filter(defined)
  const p95s = samples.map((s) => s.p95Ms).filter(defined)
  const typical = quantile(avgs, 0.5)
  tile("Typical frame", typical != null ? `${num(typical)} ms` : "–", typical ? `${num(1000 / typical, 0)} fps, p95 ${num(quantile(p95s, 0.5))} ms` : "")
  const worst = spikes.reduce((m, s) => Math.max(m, s.ms), 0)
  const hours = span / 3600000
  tile("Lag spikes", int(spikes.length), spikes.length ? `worst ${num(worst, 0)} ms, ${num(spikes.length / Math.max(hours, 1 / 60), 1)}/hour` : `none over ${M.settings.spikeMs} ms`)
  if (spikes.length) tile("Spikes with GC", pct(100 * spikes.filter((s) => s.gc).length / spikes.length), "GC ran in the same frame")
  const heap = samples.filter((s) => s.heapMb != null)
  if (heap.length) {
    const slope = slopePerHour(heap.map((s) => [s.t, s.heapMb!]))
    tile("Managed heap", `${num(heap[heap.length - 1].heapMb, 0)} MB`, `peak ${num(maxOf(heap.map((s) => s.heapMb!)), 0)} MB${slope != null && hours >= 0.25 ? `, ${slope >= 0 ? "+" : ""}${num(slope, 0)} MB/hour` : ""}`)
  }
  if (res.length) {
    const cores = res.map((r) => r.cpuCores).filter(defined)
    const machine = res.map((r) => r.machine?.cpuPct).filter(defined)
    tile("Server CPU", cores.length ? `${num(mean(cores))} cores` : "–", `peak ${num(maxOf(cores, 0))}${machine.length ? `, ${M.inContainer ? "host" : "machine"} ${pct(mean(machine))}` : ""}`)
    const mem = res.map((r) => r.totalMemMb).filter(defined)
    tile("Server memory", mem.length ? `${num(mem[mem.length - 1], 0)} MB` : "–", `peak ${num(maxOf(mem, 0), 0)} MB`)
    const out = res.map((r) => r.gameOutKBps).filter(defined)
    if (out.length) tile("Game traffic out", `${num(mean(out))} KB/s`, `peak ${num(maxOf(out))} KB/s`)
    const free = res.map((r) => r.machine?.diskFreeGb).filter(defined)
    if (free.length) tile("Free disk", `${num(free[free.length - 1], 0)} GB`, "game drive")
    const ct = res.filter((r) => r.container)
    if (ct.length) {
      const last = ct[ct.length - 1].container!
      const cc = ct.map((r) => r.container!.cpuCores).filter(defined)
      tile(`${last.kind || "Container"} CPU`, cc.length ? `${num(mean(cc))} cores` : "–",
        `${last.cpuLimitCores ? `limit ${num(last.cpuLimitCores)} cores` : "no CPU limit"}; ${last.processes ?? "?"} processes`)
      tile(`${last.kind || "Container"} memory`, last.memMb != null ? `${num(last.memMb, 0)} MB` : "–", last.memLimitMb ? `of a ${num(last.memLimitMb, 0)} MB limit` : "no memory limit")
    }
  }
  const players = M.players.filter((p) => p.points.some((pt) => inR(pt.t)))
  const peakPlayers = samples.reduce((m, s) => Math.max(m, s.players ?? 0), 0)
  tile("Players", int(peakPlayers), `at once; ${players.length} in all`)
  const ent = samples.filter((s) => s.entities != null)
  if (ent.length) tile("Entities", int(ent[ent.length - 1].entities), `${int(ent[0].entities)} at the start`)
  const occurrences = samples.reduce((n, s) => n + (s.errors || 0), 0)
  tile("Errors and warnings", int(occurrences), `${within(M.errors, R).length} new kind(s)`)
  return { tiles, findings: findings(M, R, samples, spikes, res, census, gaps.length ? gaps : [], hours) }
}

function findings(M: Model, R: Range, samples: Sample[], spikes: Spike[], res: Resources[], census: Census[], gaps: Model["gaps"], hours: number) {
  const out: Finding[] = []
  const add = (sev: Severity, text: string) => out.push({ sev, text })
  if (spikes.length) {
    const gcShare = spikes.filter((s) => s.gc).length / spikes.length
    const worst = spikes.reduce((a, b) => (b.ms > a.ms ? b : a))
    add(worst.ms >= 1000 ? "critical" : "serious", `${spikes.length} lag spike(s). The worst was ${num(worst.ms, 0)} ms, at ${Time.fmt(worst.t)}.`)
    if (gcShare >= 0.5) add("serious", `${pct(gcShare * 100)} of spikes had a GC in the same frame. Memory churn is the likely cause.`)
    const timer = M.server?.gcTimerSeconds
    const gcTimes = spikes.filter((s) => s.gc).map((s) => s.t)
    if (timer && gcTimes.length >= 4) {
      const steps = gcTimes.slice(1).map((t, i) => (t - gcTimes[i]) / 1000)
      const typical = quantile(steps, 0.5)!
      if (Math.abs(typical - timer) <= timer * 0.15)
        add("info", `The GC spikes come every ${int(typical)} s: the game forces a GC that often (garbage_collection_timer in server_settings.json).`)
    }
    const withPlayers = spikes.filter((s) => s.players > 0).length
    if (withPlayers && withPlayers < spikes.length) add("info", `${withPlayers} spikes happened with players on; the map shows where.`)
  } else if (samples.length) add("good", `No frame took longer than ${M.settings.spikeMs} ms.`)

  const heap = samples.filter((s) => s.heapMb != null)
  if (heap.length > 60 && hours >= 0.5) {
    // Low points (just after GCs), not the sawtooth peaks.
    const lows: [number, number][] = []
    const bucket = 5 * 60000
    for (let t = heap[0].t; t < heap[heap.length - 1].t; t += bucket) {
      const b = heap.filter((s) => s.t >= t && s.t < t + bucket)
      if (b.length) lows.push([t, Math.min(...b.map((s) => s.heapMb!))])
    }
    const slope = slopePerHour(lows)
    if (slope != null && slope > 30) add("warning", `Memory grows about ${num(slope, 0)} MB an hour even after GCs. Something's holding on to it.`)
  }

  if (census.length >= 3) {
    const first = census[0], last = census[census.length - 1]
    const h = (last.t - first.t) / 3600000
    const growth = Object.keys(last.byPrefab || {}).filter((k) => !k.startsWith("(")).map((k) => ({ k, d: (last.byPrefab![k] || 0) - (first.byPrefab?.[k] || 0) }))
      .filter((g) => g.d > 0).sort((a, b) => b.d - a.d)
    // Short windows and slow regrowth are noise.
    if (h >= 0.5 && growth.length && growth[0].d >= 100 && growth[0].d / h >= 50)
      add("warning", `"${growth[0].k}" went from ${int(first.byPrefab?.[growth[0].k] || 0)} to ${int(last.byPrefab![growth[0].k])} (about ${int(growth[0].d / h)} an hour).`)
    const slow = census.filter((c) => c.durationMs > 50)
    if (slow.length) add("warning", `Counting entities took over 50 ms ${slow.length} time(s). Raise CensusSeconds.`)
  }

  if (M.phaseNames.work.length) {
    const ps = phaseStats(samples, spikes)
    const top = ps.rows.find((r) => !r.idle)
    if (top && top.avg > 100) add("warning", `"${top.name}" takes ${num(top.avg, 0)} ms of every second, the most of any player-loop phase.`)
    const blamed = ps.rows.filter((r) => r.spikeTop).sort((a, b) => b.spikeTop - a.spikeTop)[0]
    const note = blamed && PHASE_NOTES[blamed.name]
    if (blamed && ps.spikes >= 3 && blamed.spikeTop / ps.spikes >= 0.5)
      add("serious", `${blamed.spikeTop} of ${ps.spikes} lag spikes spent most of their time in "${blamed.name}"${note ? ` (${note[0].toLowerCase()}${note.slice(1)})` : ""}.`)
  }

  const modules = moduleStats(M, samples)
  if (modules.length && modules[0].avg > 100) add("warning", `"${modules[0].name}" averages ${num(modules[0].avg, 0)} ms of every second.`)

  if (res.length) {
    const step = M.settings.resourceSeconds * 1000
    const busy = res.filter((r) => (r.machine?.cpuPct ?? 0) > 85)
    if (busy.length) add("serious", `${M.inContainer ? "Host" : "Machine"} CPU was over 85% for ${Time.duration(busy.length * step)}, from ${Time.fmt(busy[0].t)}. Something else may be competing.`)
    const ct = res.filter((r) => r.container)
    const nearLimit = ct.filter((r) => r.container!.memLimitMb && r.container!.memMb! / r.container!.memLimitMb > 0.9)
    if (nearLimit.length) add("critical", `The container was over 90% of its ${num(nearLimit[0].container!.memLimitMb, 0)} MB memory limit for ${Time.duration(nearLimit.length * step)}. At the limit, Linux kills the server.`)
    const throttled = ct.filter((r) => (r.container!.throttledPct ?? 0) > 10)
    if (throttled.length) {
      const during = spikes.filter((s) => throttled.some((r) => Math.abs(r.t - s.t) <= step)).length
      add("serious", `The container's CPU limit held it back for ${Time.duration(throttled.length * step)}${during ? `, during ${during} of the spikes` : ""}.`)
    }
    const mem = res.filter((r) => r.machine?.memUsedMb && r.machine?.memTotalMb && r.machine.memUsedMb / r.machine.memTotalMb > 0.9)
    if (mem.length) add("serious", `${M.inContainer ? "Host" : "Machine"} memory was over 90% full for ${Time.duration(mem.length * step)}.`)
    const free = res.map((r) => r.machine?.diskFreeGb).filter(defined)
    if (free.length && free[free.length - 1] < 5) add("critical", `Only ${num(free[free.length - 1])} GB free on the game's drive.`)
    const handles = res.filter((r) => r.handles != null)
    if (handles.length > 20 && hours >= 0.5) {
      const s = slopePerHour(handles.map((r) => [r.t, r.handles!]))
      if (s != null && s > 200) add("warning", `Open handles grow by about ${int(s)} an hour; something isn't closing files or sockets.`)
    }
  }

  const groups = M.errorGroups.filter((g) => g.Count)
  if (groups.length) {
    const top = groups.slice().sort((a, b) => b.Count! - a.Count!)[0]
    add(top.Level === "Error" ? "serious" : "warning", `The most repeated problem (${int(top.Count)} times, from ${top.Mod}): ${String(top.Message).split("\n")[0].slice(0, 160)}`)
  } else {
    const mods: Record<string, number> = {}
    for (const e of within(M.errors, R)) if (e.mod && e.mod !== "game") mods[e.mod] = (mods[e.mod] || 0) + 1
    const worst = Object.entries(mods).sort((a, b) => b[1] - a[1])[0]
    if (worst) add("warning", `${worst[0]} logged ${worst[1]} new kind(s) of error.`)
  }
  if (gaps.length) {
    const longest = gaps.reduce((a, b) => ((b.to - b.from) > (a.to - a.from) ? b : a))
    add("info", `${gaps.length} gap(s) in the data, the longest ${Time.duration(longest.to - longest.from)} from ${Time.fmt(longest.from)}.`)
  }
  if (!out.length) add("good", "Nothing stands out.")
  return out
}

// Lag spikes

export const spikePhases = (phases: Record<string, number>) => Object.entries(phases).sort((a, b) => b[1] - a[1])

export function spikeRows(M: Model, R: Range) {
  const spikes = within(M.spikes, R)
  const sampleAt = (t: number) => { // the per-second sample covering a spike
    let lo = 0, hi = M.samples.length - 1, best: Sample | null = null
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (M.samples[mid].t >= t) { best = M.samples[mid]; hi = mid - 1 } else lo = mid + 1 }
    return best && best.t - t <= 2000 ? best : null
  }
  const rows = spikes.map((s) => {
    const sample = sampleAt(s.t)
    const top = sample?.modules ? Object.entries(sample.modules).sort((a, b) => b[1] - a[1])[0] : null
    return { t: s.t, ms: s.ms, gc: !!s.gc, players: s.players, entities: s.entities, errors: sample?.errors ?? null, module: top ? `${top[0]} (${num(top[1])} ms)` : "–",
      phases: s.phases ? spikePhases(s.phases) : null }
  })
  const buckets = [[200, 300], [300, 500], [500, 1000], [1000, 2000], [2000, Infinity]].map(([a, b]) => ({
    label: b === Infinity ? `${a / 1000} s or more` : a >= 1000 ? `${a / 1000}–${b / 1000} s` : `${a}–${b} ms`,
    value: spikes.filter((s) => s.ms >= a && s.ms < b).length,
  }))
  const p2 = (h: number) => String(h).padStart(2, "0")
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: p2(h), title: `${p2(h)}:00–${p2(h)}:59`, value: 0 }))
  for (const s of spikes) hours[Time.parts(s.t).h].value++
  return { spikes, rows, buckets, hours }
}

// Where the time goes

// What the busier player-loop phases do, where that's clear.
export const PHASE_NOTES: Record<string, string> = {
  "TimeUpdate.WaitForLastPresentationAndUpdateTime": "Waiting for the next frame; idle, not work",
  "(between frames)": "After the frame's last phase; idle, not work",
  "FixedUpdate.PhysicsFixedUpdate": "Physics",
  "FixedUpdate.ScriptRunBehaviourFixedUpdate": "Scripts' FixedUpdate",
  "Update.ScriptRunBehaviourUpdate": "Scripts' Update",
  "PreLateUpdate.ScriptRunBehaviourLateUpdate": "Scripts' LateUpdate",
  "Update.ScriptRunDelayedDynamicFrameRate": "Coroutines and async continuations; GC often lands here",
  "FixedUpdate.ScriptRunDelayedFixedFrameRate": "Coroutines waiting for FixedUpdate",
  "Update.ScriptRunDelayedTasks": "Delayed tasks",
  "Update.DirectorUpdate": "Animators and timelines",
  "FixedUpdate.DirectorFixedUpdate": "Animators and timelines, at the physics rate",
  "PreLateUpdate.DirectorUpdateAnimationBegin": "Animation",
  "PreLateUpdate.DirectorUpdateAnimationEnd": "Animation",
  "PreLateUpdate.ParticleSystemBeginUpdateAll": "Particle systems",
  "PostLateUpdate.UpdateAllRenderers": "Renderers",
  "PostLateUpdate.PlayerUpdateCanvases": "UI canvases",
  "PostLateUpdate.PlayerEmitCanvasGeometry": "UI canvases",
  "PostLateUpdate.PlayerSendFrameComplete": "End of frame (WaitForEndOfFrame)",
}

export interface PhaseRow { name: string; idle: boolean; avg: number; peak: number; share: number | null; spikeMs: number; spikeTop: number }

// Per phase: average and worst ms per second, share of the work (idle phases have none), and in how
// many spikes it was the slowest phase. Phases under 0.5 ms in a second count as 0 for it.
export function phaseStats(samples: Sample[], spikes: Spike[]) {
  const sums: Record<string, number> = {}, peaks: Record<string, number> = {}, inSpikes: Record<string, number> = {}, topIn: Record<string, number> = {}
  let seconds = 0, timed = 0
  for (const s of samples) if (s.phases) {
    seconds++
    for (const [k, v] of Object.entries(s.phases)) { sums[k] = (sums[k] || 0) + v; peaks[k] = Math.max(peaks[k] || 0, v) }
  }
  for (const s of spikes) if (s.phases) {
    const list = spikePhases(s.phases)
    if (!list.length) continue
    timed++
    for (const [k, v] of list) inSpikes[k] = (inSpikes[k] || 0) + v
    topIn[list[0][0]] = (topIn[list[0][0]] || 0) + 1
  }
  const names = [...new Set([...Object.keys(sums), ...Object.keys(inSpikes)])]
  const work = names.filter((k) => !idlePhase(k)).reduce((t, k) => t + (sums[k] || 0), 0)
  const rows: PhaseRow[] = names.map((k) => {
    const idle = idlePhase(k)
    return { name: k, idle, avg: seconds ? (sums[k] || 0) / seconds : 0, peak: peaks[k] || 0,
      share: idle || !work ? null : 100 * (sums[k] || 0) / work, spikeMs: inSpikes[k] || 0, spikeTop: topIn[k] || 0 }
  }).sort((a, b) => b.avg - a.avg || b.spikeMs - a.spikeMs)
  return { rows, seconds, spikes: timed, workAvg: seconds ? work / seconds : 0 }
}

// Update modules

export function moduleStats(M: Model, samples: Sample[]) {
  const sums: Record<string, number> = {}, peaks: Record<string, number> = {}
  for (const s of samples) if (s.modules) for (const [k, v] of Object.entries(s.modules)) {
    sums[k] = (sums[k] || 0) + v; peaks[k] = Math.max(peaks[k] || 0, v)
  }
  const n = samples.filter((s) => s.modules).length || 1
  const all = Object.keys(M.cols.modules)
  const total = all.reduce((t, k) => t + (sums[k] || 0), 0) || 1
  return all.map((k) => ({ name: k, avg: (sums[k] || 0) / n, peak: peaks[k] || 0, share: 100 * (sums[k] || 0) / total })).sort((a, b) => b.avg - a.avg)
}

// Players

export interface Track { p: Player; pts: TrackPoint[] }

export function playerRows(M: Model, R: Range) {
  const inR = inRange(R)
  const tracks: Track[] = M.players.map((p) => ({ p, pts: p.points.filter((pt) => inR(pt.t)) })).filter((x) => x.pts.length)
  const step = M.settings.positionSeconds * 1000
  const spikes = within(M.spikes, R)
  const rows = tracks.map(({ p, pts }) => {
    let online = 0, dist = 0
    const chunks = new Map<string, number>()
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i]
      if (cur.t - prev.t <= step * 3) {
        online += cur.t - prev.t
        dist += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z)
        if (cur.chunk) chunks.set(cur.chunk, (chunks.get(cur.chunk) || 0) + (cur.t - prev.t))
      }
    }
    const topChunk = [...chunks.entries()].sort((a, b) => b[1] - a[1])[0]
    const first = pts[0].t, last = pts[pts.length - 1].t
    return { p, name: p.name, id: p.id, first, last, online, dist, chunks: chunks.size, top: topChunk ? topChunk[0] : "–",
      spikes: spikes.filter((s) => s.t >= first && s.t <= last).length }
  })
  return { tracks, rows }
}

// Entities

export function entityRows(M: Model, R: Range) {
  const census = within(M.census, R)
  if (!census.length) return null
  const first = census[0], last = census[census.length - 1]
  const h = Math.max((last.t - first.t) / 3600000, 1e-9)
  const names = new Set(census.flatMap((c) => Object.keys(c.byPrefab || {})))
  const types = [...names].map((n) => {
    const series = census.map((c) => c.byPrefab?.[n] ?? 0)
    const a = series[0], b = series[series.length - 1]
    return { name: n, first: a, last: b, change: b - a, perHour: census.length > 1 ? (b - a) / h : null, peak: maxOf(series) }
  })
  const chunkNames = new Set(census.flatMap((c) => Object.keys(c.byChunk || {})))
  const chunks = [...chunkNames].map((n) => ({ name: n, first: first.byChunk?.[n] ?? 0, last: last.byChunk?.[n] ?? 0 })).map((r) => ({ ...r, change: r.last - r.first }))
  return { census, avgMs: mean(census.map((c) => c.durationMs)), types, chunks }
}

// CSV of the per-second samples in the range.
export function samplesCsv(M: Model, R: Range) {
  const samples = within(M.samples, R)
  const modules = Object.keys(M.cols.modules), phases = Object.keys(M.cols.phases)
  const head = ["utc", `time (${Time.label(R[0])})`, "frames", "avgMs", "p50Ms", "p95Ms", "maxMs", "gc", "heapMb", "memMb", "players", "entities", "chunks", "errors",
    ...modules.map((m) => `module: ${m}`), ...phases.map((p) => `phase: ${p}`)]
  const q = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""))
  const lines = [head.map(q).join(",")]
  for (const s of samples) lines.push([new Date(s.t).toISOString(), Time.fmt(s.t), s.frames, s.avgMs, s.p50Ms, s.p95Ms, s.maxMs, s.gc?.[0] ?? "", s.heapMb, s.memMb ?? "", s.players, s.entities, s.chunks ?? "", s.errors,
    ...modules.map((m) => s.modules?.[m] ?? 0), ...phases.map((p) => (s.phases ? s.phases[p] ?? 0 : ""))].map(q).join(","))
  return lines.join("\n")
}
