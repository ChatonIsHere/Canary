// Reads recordings, saved buffers and report zips, and merges them into one model.
import { Gunzip, unzipSync } from "fflate"
import {
  RESOURCE_KEYS,
  type Census, type Col, type ErrorRec, type Gap, type Header, type Mark, type Model, type ParsedFile,
  type Player, type Positions, type Rec, type ResourceCols, type Resources, type Sample, type SampleCols, type Spike,
} from "./types"

const GZIP = [0x1f, 0x8b], ZIP = [0x50, 0x4b]

function concat(chunks: Uint8Array[]) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

// A file cut short still gives every line before the cut.
function gunzip(u8: Uint8Array) {
  const chunks: Uint8Array[] = []
  let truncated = false
  const stream = new Gunzip((data) => { chunks.push(data) })
  try {
    stream.push(u8, false)
    stream.push(new Uint8Array(0), true)
  } catch {
    truncated = true
  }
  return { text: new TextDecoder().decode(concat(chunks)), truncated }
}

function parseLines(text: string) {
  const records: Rec[] = []
  let bad = 0, cutLast = false
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    line = line.trim()
    if (!line) return
    try {
      const r = JSON.parse(line)
      if (r && typeof r.type === "string" && typeof r.t === "number") records.push(r)
      else bad++
    } catch {
      if (i >= lines.length - 2) cutLast = true
      else bad++
    }
  })
  return { records, bad, cutLast }
}

export async function readFile(file: File) {
  const u8 = new Uint8Array(await file.arrayBuffer())
  return parseBytes(file.name, u8)
}

// A file that couldn't be read at all.
export const unreadable = (file: File, message: string): ParsedFile =>
  ({ name: file.name, size: file.size, records: [], notes: [`Couldn't read: ${message}`], extras: {}, headers: [], tMin: null, tMax: null })

export function parseBytes(name: string, u8: Uint8Array): ParsedFile {
  const out: ParsedFile = { name, size: u8.length, records: [], notes: [], extras: {}, headers: [], tMin: null, tMax: null }
  const is = (sig: number[]) => sig.every((b, i) => u8[i] === b)
  if (is(ZIP)) {
    out.container = "zip"
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(u8, { filter: (f) => /(^|\/)(buffer\.jsonl|errors\.json|mods\.json|summary\.txt)$/.test(f.name) })
    } catch (e) {
      out.notes.push(`Couldn't open the zip: ${(e as Error).message}`)
      return out
    }
    const text = (n: string) => {
      const key = Object.keys(entries).find((k) => k === n || k.endsWith("/" + n))
      return key ? new TextDecoder().decode(entries[key]) : null
    }
    const buffer = text("buffer.jsonl")
    if (buffer != null) addLines(out, buffer)
    else out.notes.push("Not a Canary report (no buffer.jsonl).")
    try { const e = text("errors.json"); if (e) out.extras.errorGroups = JSON.parse(e) } catch { out.notes.push("errors.json couldn't be read.") }
    try { const m = text("mods.json"); if (m) out.extras.mods = JSON.parse(m) } catch { out.notes.push("mods.json couldn't be read.") }
    const s = text("summary.txt")
    if (s) out.extras.summary = s
    return out
  }
  if (is(GZIP)) {
    out.container = "gzip"
    const { text, truncated } = gunzip(u8)
    if (truncated) out.notes.push("Cut short; read up to the cut.")
    addLines(out, text)
    return out
  }
  out.container = "text"
  addLines(out, new TextDecoder().decode(u8))
  return out
}

function addLines(out: ParsedFile, text: string) {
  const { records, bad, cutLast } = parseLines(text)
  for (const r of records) out.records.push(r)
  if (bad) out.notes.push(`Skipped ${bad} line(s) that weren't records.`)
  if (cutLast) out.notes.push("Last line cut off.")
  if (!records.length) out.notes.push("No Canary records found.")
}

// Model

// null when the files hold no records with times.
export function build(files: ParsedFile[]): Model | null {
  const seen = new Set<string>()
  const all: Rec[] = []
  for (const f of files) {
    f.headers = f.records.filter((r) => r.type === "header") as Header[]
    let tMin = Infinity, tMax = -Infinity
    for (const r of f.records) if (r.type !== "header") { tMin = Math.min(tMin, r.t); tMax = Math.max(tMax, r.t) }
    f.tMin = tMin === Infinity ? null : tMin
    f.tMax = tMax === -Infinity ? null : tMax
    for (const r of f.records) {
      // Recordings start with a copy of the buffer, so dedupe.
      const key = r.type === "sample" || r.type === "resources"
        ? `${r.type}|${r.t}` : `${r.type}|${r.t}|${JSON.stringify(r).length}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push(r)
    }
  }
  all.sort((a, b) => a.t - b.t)

  const by = <T extends Rec>(type: string) => all.filter((r) => r.type === type) as T[]
  const headers = by<Header>("header")
  const samples = by<Sample>("sample")
  const data = all.filter((r) => r.type !== "header")
  if (!data.length) return null
  const resources = by<Resources>("resources")
  const environment = headers.map((h) => h.environment).filter(Boolean).pop() || null
  const serverHeader = headers.filter((h) => h.server).pop() || null
  const settings = Object.assign({ spikeMs: 200, positionSeconds: 5, censusSeconds: 60, resourceSeconds: 5 },
    ...headers.map((h) => h.settings || {}))
  const gaps = findGaps(samples.map((s) => s.t), 5000)
  const cols = sampleColumns(samples, gaps)
  const positions = by<Positions>("positions")
  // Canary 0.4.0 and later time each player-loop phase; older files have none.
  const phases = Object.keys(cols.phases)
  return {
    files, headers,
    samples, spikes: by<Spike>("spike"), errors: by<ErrorRec>("error"), positions,
    census: by<Census>("census"), resources, marks: by<Mark>("mark"),
    errorGroups: files.flatMap((f) => f.extras.errorGroups || []),
    mods: files.map((f) => f.extras.mods).find(Boolean) || null,
    summaries: files.filter((f) => f.extras.summary).map((f) => ({ name: f.name, text: f.extras.summary! })),
    tMin: data[0].t,
    tMax: data[data.length - 1].t,
    all,
    environment,
    serverHeader,
    server: serverHeader?.server || null,
    inContainer: !!environment?.container || resources.some((r) => r.container),
    settings,
    gaps,
    cols,
    res: resourceColumns(resources, settings.resourceSeconds),
    players: playerTracks(positions),
    phaseNames: { work: phases.filter((n) => !idlePhase(n)), idle: phases.filter(idlePhase) },
  }
}

function findGaps(times: number[], maxStep: number) {
  const gaps: Gap[] = []
  for (let i = 1; i < times.length; i++)
    if (times[i] - times[i - 1] > maxStep) gaps.push({ from: times[i - 1], to: times[i] })
  return gaps
}

// The phases where the main thread waits for its next frame: idle time, not work.
export const idlePhase = (name: string) => /WaitForLastPresentation/.test(name) || name === "(between frames)"

const MAPS = ["modules", "sections", "metrics", "phases"] as const

// Columns for uPlot. A null row in each gap breaks the line there.
function sampleColumns(samples: Sample[], gaps: Gap[]): SampleCols {
  const keys = { modules: new Set<string>(), sections: new Set<string>(), metrics: new Set<string>(), phases: new Set<string>() }
  for (const s of samples) for (const k of MAPS) { const m = s[k]; if (m) for (const n of Object.keys(m)) keys[k].add(n) }
  const c: SampleCols = {
    t: [], avg: [], p50: [], p95: [], max: [], heap: [], mem: [], players: [], entities: [], errors: [],
    gc: [], frames: [], chunks: [], modules: {}, sections: {}, metrics: {}, phases: {},
  }
  for (const k of MAPS) for (const n of keys[k]) c[k][n] = []
  const gapStarts = new Set(gaps.map((g) => g.from))
  const push = (s: Sample, isGap: boolean) => {
    c.t.push(isGap ? (s.t + 1000) / 1000 : s.t / 1000)
    const v = (x: number | undefined) => isGap ? null : (x ?? null)
    c.avg.push(v(s.avgMs)); c.p50.push(v(s.p50Ms)); c.p95.push(v(s.p95Ms)); c.max.push(v(s.maxMs))
    c.heap.push(v(s.heapMb)); c.mem.push(v(s.memMb || undefined)); c.players.push(v(s.players))
    c.entities.push(v(s.entities)); c.errors.push(v(s.errors)); c.frames.push(v(s.frames))
    c.gc.push(isGap ? null : (s.gc ? s.gc[0] : null)); c.chunks.push(v(s.chunks))
    // Modules that took no time are left out of a sample.
    for (const n of keys.modules) c.modules[n].push(isGap ? null : (s.modules ? (s.modules[n] ?? 0) : null))
    for (const n of keys.sections) c.sections[n].push(isGap ? null : (s.sections ? (s.sections[n] ?? 0) : 0))
    for (const n of keys.metrics) c.metrics[n].push(isGap ? null : (s.metrics?.[n] ?? null))
    // Phases under 0.5 ms are left out too.
    for (const n of keys.phases) c.phases[n].push(isGap ? null : (s.phases ? (s.phases[n] ?? 0) : null))
  }
  for (const s of samples) {
    push(s, false)
    if (gapStarts.has(s.t)) push(s, true)
  }
  return c
}

function resourceColumns(list: Resources[], intervalSeconds: number): ResourceCols {
  const c = { t: [], children: {}, hasContainer: list.some((r) => r.container) } as unknown as ResourceCols
  for (const k of RESOURCE_KEYS) c[k] = []
  const childNames = new Set<string>()
  for (const r of list) for (const ch of r.children || []) childNames.add(ch.name)
  for (const n of childNames) c.children[n] = { cpu: [], mem: [] }
  const maxStep = Math.max(3, intervalSeconds * 3) * 1000
  let last: Resources | null = null
  const push = (r: Resources, gap: boolean) => {
    const v = (x: number | undefined) => gap ? null : (x ?? null)
    const put = (k: (typeof RESOURCE_KEYS)[number], x: number | undefined) => (c[k] as Col).push(v(x))
    c.t.push(gap ? (last!.t + 1000) / 1000 : r.t / 1000)
    put("cpuPct", r.cpuPct); put("cpuCores", r.cpuCores); put("totalCpuPct", r.totalCpuPct)
    put("memMb", r.memMb); put("privateMb", r.privateMb); put("totalMemMb", r.totalMemMb)
    put("handles", r.handles); put("threads", r.threads)
    put("diskRead", r.diskReadKBps); put("diskWrite", r.diskWriteKBps)
    put("gameOut", r.gameOutKBps); put("pktOut", r.gamePacketsOut); put("pktIn", r.gamePacketsIn)
    const mc = r.machine || {}
    put("mCpu", mc.cpuPct); put("mMemUsed", mc.memUsedMb); put("mMemTotal", mc.memTotalMb)
    put("rx", mc.netRxKBps); put("tx", mc.netTxKBps); put("diskFree", mc.diskFreeGb)
    const ct = r.container || {}
    put("cCores", ct.cpuCores); put("cLimit", ct.cpuLimitCores); put("cThrottled", ct.throttledPct)
    put("cMem", ct.memMb); put("cMemLimit", ct.memLimitMb); put("cDiskRead", ct.diskReadKBps)
    put("cDiskWrite", ct.diskWriteKBps); put("cRx", ct.netRxKBps); put("cTx", ct.netTxKBps); put("cProcs", ct.processes)
    for (const n of childNames) {
      const ch = gap ? null : (r.children || []).find((x) => x.name === n)
      c.children[n].cpu.push(ch ? (ch.cpuPct ?? null) : null)
      c.children[n].mem.push(ch ? (ch.memMb ?? null) : null)
    }
  }
  for (const r of list) {
    if (last && r.t - last.t > maxStep) push(last, true)
    push(r, false)
    last = r
  }
  return c
}

function playerTracks(positions: Positions[]) {
  const players = new Map<number | string, Player>()
  for (const rec of positions) for (const p of rec.players || []) {
    const key = p.id || p.name || ""
    if (!players.has(key)) players.set(key, { id: p.id, name: p.name || `Player ${p.id}`, points: [], order: players.size })
    players.get(key)!.points.push({ t: rec.t, x: p.x, y: p.y, z: p.z, chunk: p.chunk })
  }
  return [...players.values()]
}
