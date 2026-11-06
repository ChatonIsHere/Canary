// Two recordings side by side, over the seconds with at least a given number of players: from the first
// such second to the last, so short dips don't break it up.
import { idlePhase } from "./load"
import { mean } from "./stats"
import type { Model, Sample } from "./types"

export type Better = "lower" | "higher" | null

export interface Metric {
  group: string
  label: string
  unit: string
  better: Better
  a: number | null
  b: number | null
  digits?: number
}

export interface Window {
  from: number
  to: number
  samples: Sample[]
}

export function window(M: Model, minPlayers: number): Window | null {
  const busy = M.samples.filter((s) => (s.players ?? 0) >= minPlayers)
  if (!busy.length) return null
  const from = busy[0].t, to = busy[busy.length - 1].t
  return { from, to, samples: M.samples.filter((s) => s.t >= from && s.t <= to) }
}

export const maxPlayers = (M: Model) => M.samples.reduce((m, s) => Math.max(m, s.players ?? 0), 0)

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const defined = <T>(v: T | null | undefined): v is T => v != null
const median = (a: number[]) => {
  if (!a.length) return null
  const s = a.slice().sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

function stats(M: Model, w: Window) {
  const { from, to, samples } = w
  const inW = <T extends { t: number }>(list: T[]) => list.filter((r) => r.t >= from && r.t <= to)
  const spikes = inW(M.spikes), res = inW(M.resources), census = inW(M.census)
  const hours = Math.max((to - from) / 3600000, 1 / 3600)
  const frames = sum(samples.map((s) => s.frames ?? 0))
  const fps = samples.length ? frames / samples.length : null
  const cores = mean(res.map((r) => r.cpuCores).filter(defined))
  const phase = (name: string) => samples.length ? sum(samples.map((s) => s.phases?.[name] ?? 0)) / samples.length : null
  const module = (name: string) => samples.length ? sum(samples.map((s) => s.modules?.[name] ?? 0)) / samples.length : null
  const steps = samples.map((s) => s.physicsSteps).filter(defined)
  const physicsMs = phase("FixedUpdate.PhysicsFixedUpdate")
  const pc = census.filter((c) => c.physics)
  const last = <T>(a: T[]) => (a.length ? a[a.length - 1] : null)
  return {
    hours, fps, cores, phase, module,
    v: {
      hours,
      players: mean(samples.map((s) => s.players ?? 0)),
      fps,
      frameMs: median(samples.map((s) => s.avgMs).filter(defined)),
      p95Ms: median(samples.map((s) => s.p95Ms).filter(defined)),
      spikesPerHour: spikes.length / hours,
      freezesPerHour: spikes.filter((s) => s.ms >= 1000).length / hours,
      longest: spikes.length ? Math.max(...spikes.map((s) => s.ms)) / 1000 : 0,
      hitchPct: (sum(spikes.map((s) => s.ms)) / Math.max(to - from, 1)) * 100,
      gcSpikes: spikes.filter((s) => s.gc).length / hours,
      heapAvg: mean(samples.map((s) => s.heapMb).filter(defined)),
      heapEnd: last(samples.filter((s) => s.heapMb != null))?.heapMb ?? null,
      memAvg: mean(samples.map((s) => s.memMb).filter(defined)),
      cores,
      containerCores: mean(res.map((r) => r.container?.cpuCores).filter(defined)),
      cpuPerFrame: cores != null && fps ? (cores * 1000) / fps : null,
      entities: mean(samples.map((s) => s.entities).filter(defined)),
      entitiesEnd: last(samples.filter((s) => s.entities != null))?.entities ?? null,
      chunks: mean(samples.map((s) => s.chunks).filter(defined)),
      steps: steps.length ? mean(steps) : null,
      msPerStep: physicsMs != null && steps.length && mean(steps) ? physicsMs / mean(steps)! : null,
      bodies: pc.length ? mean(pc.map((c) => c.physics!.bodies)) : null,
      awake: pc.length ? mean(pc.map((c) => c.physics!.awake)) : null,
      outKBps: mean(res.map((r) => r.gameOutKBps).filter(defined)),
    },
  }
}

// The busiest names across both, by their larger value.
function busiest(names: Set<string>, a: (n: string) => number | null, b: (n: string) => number | null, count: number) {
  return [...names].sort((x, y) => Math.max(b(y) ?? 0, a(y) ?? 0) - Math.max(b(x) ?? 0, a(x) ?? 0)).slice(0, count)
}

export function compare(A: Model, B: Model, minPlayers: number) {
  const wa = window(A, minPlayers), wb = window(B, minPlayers)
  if (!wa || !wb) return null
  const sa = stats(A, wa), sb = stats(B, wb)
  const rows: Metric[] = []
  const row = (group: string, label: string, unit: string, better: Better, key: keyof typeof sa.v, digits?: number) =>
    rows.push({ group, label, unit, better, a: sa.v[key], b: sb.v[key], digits })
  row("Compared", "Time compared", "h", null, "hours")
  row("Compared", "Players", "average", null, "players", 1)
  row("Frames", "Frames per second", "", "higher", "fps", 1)
  row("Frames", "Typical frame", "ms, median", "lower", "frameMs")
  row("Frames", "95th percentile frame", "ms, median", "lower", "p95Ms")
  row("Frames", "Lag spikes", "per hour", "lower", "spikesPerHour", 0)
  row("Frames", "Freezes of 1 s or more", "per hour", "lower", "freezesPerHour", 1)
  row("Frames", "Longest freeze", "s", "lower", "longest", 1)
  row("Frames", "Time spent in lag spikes", "%", "lower", "hitchPct", 1)
  row("Frames", "Spikes with GC", "per hour", "lower", "gcSpikes", 0)
  row("Memory", "Managed heap", "MB, average", "lower", "heapAvg", 0)
  row("Memory", "Managed heap at the end", "MB", "lower", "heapEnd", 0)
  row("Memory", "Process memory", "MB, average", "lower", "memAvg", 0)
  row("CPU", "Server CPU", "cores", "lower", "cores")
  row("CPU", "Container CPU", "cores", "lower", "containerCores")
  row("CPU", "CPU per frame", "ms", "lower", "cpuPerFrame", 1)
  row("CPU", "Game traffic out", "KB/s", null, "outKBps", 1)
  row("World", "Entities", "average", null, "entities", 0)
  row("World", "Entities at the end", "", null, "entitiesEnd", 0)
  row("World", "Loaded chunks", "average", null, "chunks", 0)
  row("Physics", "Physics steps", "per second", null, "steps", 1)
  row("Physics", "Physics time per step", "ms", "lower", "msPerStep")
  row("Physics", "Rigidbodies", "average", null, "bodies", 0)
  row("Physics", "Awake rigidbodies", "average", null, "awake", 0)
  const phaseNames = new Set([...A.phaseNames.work, ...B.phaseNames.work].filter((n) => !idlePhase(n)))
  for (const n of busiest(phaseNames, sa.phase, sb.phase, 10))
    rows.push({ group: "Where the time goes", label: n, unit: "ms/s", better: "lower", a: sa.phase(n), b: sb.phase(n) })
  const moduleNames = new Set([...Object.keys(A.cols.modules), ...Object.keys(B.cols.modules)])
  for (const n of busiest(moduleNames, sa.module, sb.module, 6))
    rows.push({ group: "Update modules", label: n, unit: "ms/s", better: "lower", a: sa.module(n), b: sb.module(n) })
  return { rows: rows.filter((r) => r.a != null || r.b != null), wa, wb, series: overlay(A, wa, B, wb) }
}

// Per-minute means since the start of each window, for charts with both on one axis.
export function overlay(A: Model, wa: Window, B: Model, wb: Window) {
  const minutes = Math.ceil(Math.max(wa.to - wa.from, wb.to - wb.from) / 60000) + 1
  const x = Array.from({ length: minutes }, (_, i) => i)
  const bin = <T extends { t: number }>(list: T[], w: Window, get: (r: T) => number | null | undefined) => {
    const sums = new Array<number>(minutes).fill(0), counts = new Array<number>(minutes).fill(0)
    for (const r of list) {
      if (r.t < w.from || r.t > w.to) continue
      const v = get(r)
      if (v == null) continue
      const i = Math.floor((r.t - w.from) / 60000)
      sums[i] += v; counts[i]++
    }
    return sums.map((s, i) => (counts[i] ? s / counts[i] : null))
  }
  const both = (get: (M: Model, w: Window) => (number | null)[]) => ({ a: get(A, wa), b: get(B, wb) })
  return {
    x,
    frameMs: both((M, w) => bin(M.samples, w, (s) => s.avgMs)),
    spikes: both((M, w) => {
      const counts = x.map((i) => (w.from + i * 60000 <= w.to ? 0 : null))
      for (const s of M.spikes) if (s.t >= w.from && s.t <= w.to) counts[Math.floor((s.t - w.from) / 60000)]!++
      return counts
    }),
    heap: both((M, w) => bin(M.samples, w, (s) => s.heapMb)),
    entities: both((M, w) => bin(M.samples, w, (s) => s.entities)),
    cpu: both((M, w) => bin(M.resources, w, (r) => r.cpuCores)),
  }
}

// "+12%" / "−8%", or null when there's nothing to divide by.
export function change(a: number | null, b: number | null) {
  if (a == null || b == null || a === 0) return null
  return ((b - a) / Math.abs(a)) * 100
}

export function verdict(m: Metric): "better" | "worse" | null {
  const c = change(m.a, m.b)
  // Small changes, and a fraction of a millisecond a second, are noise.
  if (c == null || !m.better || Math.abs(c) < 2 || (m.unit === "ms/s" && Math.abs(m.b! - m.a!) < 1)) return null
  return (c < 0) === (m.better === "lower") ? "better" : "worse"
}
