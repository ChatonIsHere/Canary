// What the timeline charts, in order. Each chart gets its series colours in palette order.
import { css, otherColor, slot, SLOTS, type Lane, type Series, type TimeChartConfig, type Values } from "./charts"
import { esc, fmtNum, int } from "./format"
import { spikePhases } from "./stats"
import * as Time from "./time"
import type { Census, ErrorRec, Gap, Mark, Model, Sample, Spike } from "./types"

export type TimelineItem =
  | { kind: "group"; title: string; note?: string }
  | { kind: "chart"; title: string; unit?: string; note?: string; cfg: TimeChartConfig }
  | { kind: "lane"; lanes: Lane[] }
  | { kind: "text"; text: string }

// The busiest series keep their own colour; past eight, the rest fold into "Other".
function topSeries(map: Record<string, Values>, fmt?: (v: number) => string): Series[] {
  const names = Object.keys(map)
  const total = (n: string) => map[n].reduce<number>((s, v) => s + (v || 0), 0)
  names.sort((a, b) => total(b) - total(a))
  const fold = names.length > SLOTS
  const keep = fold ? names.slice(0, SLOTS - 1) : names, rest = fold ? names.slice(SLOTS - 1) : []
  const series: Series[] = keep.map((n, i) => ({ label: n, values: map[n], color: slot(i), fmt }))
  if (rest.length) {
    const len = map[rest[0]].length
    const other = Array.from({ length: len }, (_, i) => rest.some((n) => map[n][i] != null) ? rest.reduce((s, n) => s + (map[n][i] || 0), 0) : null)
    series.push({ label: `Other (${rest.length})`, values: other, color: otherColor(), fmt })
  }
  return series
}

export function timelineItems(M: Model): TimelineItem[] {
  const c = M.cols, r = M.res, s = slot
  const out: TimelineItem[] = []
  const group = (title: string, note?: string) => out.push({ kind: "group", title, note })
  const chart = (title: string, cfg: TimeChartConfig & { unit?: string; note?: string }) => out.push({ kind: "chart", title, unit: cfg.unit, note: cfg.note, cfg })
  const critical = css("--status-critical"), serious = css("--status-serious"), warning = css("--status-warning"), muted = css("--muted-foreground")
  const n0 = (v: number) => fmtNum(v, 0)
  const whole = (v: number) => Math.round(v).toLocaleString()

  out.push({ kind: "lane", lanes: [
    { label: "Lag spikes", color: critical, events: M.spikes.map((x) => ({ t: x.t, size: 3 + Math.min(6, x.ms / 300), d: x })),
      describe: (e) => { const d = e.d as Spike; return `<strong>Lag spike: ${fmtNum(d.ms, 0)} ms</strong><br>${esc(Time.fmt(e.t))}<br>${d.gc ? "GC ran. " : ""}${d.players} player(s), ${d.entities.toLocaleString()} entities`
        + (d.phases ? spikePhases(d.phases).slice(0, 1).map(([n, ms]) => `<br>Slowest: ${esc(n)}, ${fmtNum(ms, 0)} ms`).join("") : "") } },
    { label: "Garbage collection", color: warning, shape: "tick", events: M.samples.filter((x) => x.gc && x.gc[0] > 0).map((x) => ({ t: x.t, d: x })),
      describe: (e) => { const d = e.d as Sample; return `<strong>Garbage collection</strong><br>${esc(Time.fmt(e.t))}<br>slowest frame ${fmtNum(d.maxMs)} ms, heap ${fmtNum(d.heapMb, 0)} MB after` } },
    { label: "New errors", color: serious, events: M.errors.map((x) => ({ t: x.t, d: x })),
      describe: (e) => { const d = e.d as ErrorRec; return `<strong>${esc(d.level)} from ${esc(d.mod)}</strong><br>${esc(Time.fmt(e.t))}<br>${esc(String(d.message).split("\n")[0].slice(0, 200))}` } },
    { label: "Marks", color: s(0), events: M.marks.map((x) => ({ t: x.t, d: x })),
      describe: (e) => `<strong>Mark</strong><br>${esc(Time.fmt(e.t))}<br>${esc((e.d as Mark).text)}` },
    { label: "Entity counts", color: muted, shape: "tick", events: M.census.map((x) => ({ t: x.t, d: x })),
      describe: (e) => { const d = e.d as Census; return `<strong>Entity count: ${d.total.toLocaleString()}</strong><br>${esc(Time.fmt(e.t))}<br>took ${fmtNum(d.durationMs)} ms` } },
    { label: "No data", color: muted, events: M.gaps.map((g) => ({ t: g.from, t2: g.to, d: g })),
      describe: (e) => { const d = e.d as Gap; return `<strong>No data for ${esc(Time.duration(d.to - d.from))}</strong><br>${esc(Time.fmt(d.from))} to ${esc(Time.fmt(d.to))}<br>Server down, or no file covers it.` } },
  ] })

  if (c.t.length) {
    group("Performance")
    chart("Frame time", {
      unit: "ms, log scale", unitShort: "ms", note: "Per second: average, p95 and slowest frame.",
      x: c.t, threshold: M.settings.spikeMs, thresholdLabel: `spike ${M.settings.spikeMs} ms`, height: 210, log: true,
      // Slowest first, so the average draws on top.
      series: [
        { label: "Slowest", values: c.max, color: s(2) },
        { label: "95th percentile", values: c.p95, color: s(1) },
        { label: "Average", values: c.avg, color: s(0) },
      ],
    })
    chart("Frames per second", { x: c.t, series: [{ label: "Frames", values: c.frames, color: s(0) }], height: 140, fmt: n0 })
    if (Object.keys(c.modules).length)
      chart("Update modules", { unit: "ms per second", unitShort: "ms/s", x: c.t, series: topSeries(c.modules), height: 200 })
    const ph = M.phaseNames
    if (ph.work.length)
      chart("Where the time goes", {
        unit: "ms per second, stacked", unitShort: "ms/s", stacked: true, height: 220,
        note: "Main-thread work by player-loop phase. Waiting for the next frame is left out.",
        x: c.t, series: topSeries(Object.fromEntries(ph.work.map((n) => [n, c.phases[n]]))),
      })
    if (ph.idle.length) {
      const idle = c.t.map((_, i) => ph.idle.some((n) => c.phases[n][i] != null) ? ph.idle.reduce((sum, n) => sum + (c.phases[n][i] || 0), 0) : null)
      chart("Waiting for the next frame", {
        unit: "ms per second", unitShort: "ms/s", height: 110,
        note: "Idle, not work. Near zero, the server can't keep up.", x: c.t, series: [{ label: "Waiting", values: idle, color: s(0) }],
      })
    }

    group("Memory")
    chart("Memory", {
      unit: "MB", unitShort: "MB", note: "Low points that keep rising mean something's holding on to memory.",
      x: c.t, series: [{ label: "Managed heap", values: c.heap, color: s(0) }, ...(c.mem.some((v) => v) ? [{ label: "Process (working set)", values: c.mem, color: s(1) }] : [])],
    })
    chart("Garbage collections", { unit: "per second", x: c.t, series: [{ label: "Collections", values: c.gc, color: s(0), bars: true }], height: 110, fmt: n0 })

    group("World")
    chart("Players online", { x: c.t, series: [{ label: "Players", values: c.players, color: s(0), step: true }], height: 120, fmt: n0 })
    if (c.chunks.some((v) => v != null))
      chart("Loaded chunks", { x: c.t, series: [{ label: "Chunks", values: c.chunks, color: s(0), step: true }], height: 120, fmt: n0 })
    chart("Entities", { x: c.t, series: [{ label: "Entities", values: c.entities, color: s(0) }], height: 140, fmt: whole, yMin: null })
    if (M.census.length > 1) {
      const ct = M.census.map((x) => x.t / 1000)
      const map: Record<string, Values> = {}
      for (const rec of M.census) for (const k of Object.keys(rec.byPrefab || {})) if (!k.startsWith("(")) map[k] = []
      for (const rec of M.census) for (const k of Object.keys(map)) map[k].push(rec.byPrefab?.[k] ?? 0)
      if (Object.keys(map).length)
        chart("Spawned entities by type", { note: "Scene-placed objects left out.", x: ct, series: topSeries(map, whole), height: 200 })
    }
    chart("Errors and warnings", { unit: "per second", x: c.t, series: [{ label: "Errors", values: c.errors, color: s(0), bars: true }], height: 110, fmt: n0 })
  }

  if (r.t.length) {
    const host = M.inContainer ? "host" : "machine"
    group("Resources", `Every ${M.settings.resourceSeconds} s. CPU % is of the whole ${host}.` + (M.inContainer ? ` "Host" is the machine the container runs on.` : ""))
    if (r.hasContainer) {
      const limit = r.cLimit.find((v) => v != null)
      const memLimit = r.cMemLimit.find((v) => v != null)
      chart("Container CPU", {
        unit: "cores busy", x: r.t, height: 160,
        note: limit ? "" : "No CPU limit set.",
        threshold: limit ?? undefined, thresholdLabel: limit ? `limit ${fmtNum(limit)} cores` : "",
        series: [{ label: "Container", values: r.cCores, color: s(0) }, { label: "Server process", values: r.cpuCores, color: s(1) }],
      })
      if (limit) chart("CPU throttling", {
        unit: "% of the time held back by the limit", unitShort: "%", x: r.t, height: 120,
        series: [{ label: "Throttled", values: r.cThrottled, color: s(0) }],
      })
      chart("Container memory", {
        unit: "MB", unitShort: "MB", x: r.t, height: 140,
        note: memLimit ? "Past the limit, Linux kills the server." : "No memory limit set.",
        threshold: memLimit ?? undefined, thresholdLabel: memLimit ? "limit" : "",
        series: [{ label: "Container", values: r.cMem, color: s(0) }, { label: "Server process", values: r.memMb, color: s(1) }],
      })
      chart("Container disk I/O", { unit: "KB/s", unitShort: "KB/s", x: r.t, height: 130,
        series: [{ label: "Read", values: r.cDiskRead, color: s(0) }, { label: "Write", values: r.cDiskWrite, color: s(1) }] })
    }
    chart("CPU", {
      unit: `% of the ${host}`, unitShort: "%", x: r.t, height: 170,
      series: [
        { label: "Server", values: r.cpuPct, color: s(0) },
        { label: "With child processes", values: r.totalCpuPct, color: s(1) },
        { label: `Whole ${host}`, values: r.mCpu, color: s(2) },
      ],
    })
    chart("Server memory", {
      unit: "MB", unitShort: "MB", x: r.t,
      series: [
        { label: "Working set", values: r.memMb, color: s(0) },
        { label: "Private", values: r.privateMb, color: s(1) },
        { label: "With child processes", values: r.totalMemMb, color: s(2) },
      ],
    })
    if (r.mMemUsed.some((v) => v != null))
      chart(M.inContainer ? "Host memory" : "Machine memory", { unit: "MB", unitShort: "MB", x: r.t, height: 140,
        series: [{ label: "Used", values: r.mMemUsed, color: s(0) }, { label: "Installed", values: r.mMemTotal, color: s(1) }] })
    chart("Server disk I/O", { unit: "KB/s", unitShort: "KB/s", x: r.t, height: 140,
      series: [{ label: "Read", values: r.diskRead, color: s(0) }, { label: "Write", values: r.diskWrite, color: s(1) }] })
    const net = r.hasContainer ? { rx: r.cRx, tx: r.cTx, who: "Container" } : { rx: r.rx, tx: r.tx, who: "Machine" }
    chart("Network", { unit: "KB/s", unitShort: "KB/s", height: 160,
      note: "The game only counts what it sends.",
      x: r.t, series: [
        { label: "Game, sent", values: r.gameOut, color: s(0) },
        { label: `${net.who}, received`, values: net.rx, color: s(1) },
        { label: `${net.who}, sent`, values: net.tx, color: s(2) },
      ] })
    chart("Game packets", { unit: "per second", x: r.t, height: 130,
      series: [{ label: "Sent", values: r.pktOut, color: s(0) }, { label: "Received", values: r.pktIn, color: s(1) }] })
    chart("Open handles", { x: r.t, height: 120, series: [{ label: "Handles", values: r.handles, color: s(0) }], fmt: whole, yMin: null })
    chart("Threads", { x: r.t, height: 110, series: [{ label: "Threads", values: r.threads, color: s(0) }], fmt: n0, yMin: null })
    if (r.diskFree.some((v) => v != null))
      chart("Free disk space", { unit: "GB, game drive", unitShort: "GB", x: r.t, height: 110, series: [{ label: "Free", values: r.diskFree, color: s(0) }] })
    const kids = Object.keys(r.children)
    if (kids.length)
      chart("Child processes: memory", { unit: "MB", unitShort: "MB", x: r.t, height: 130,
        series: topSeries(Object.fromEntries(kids.map((k) => [k, r.children[k].mem]))) })
  }

  if (Object.keys(c.sections).length || Object.keys(c.metrics).length) {
    group("From mods")
    if (Object.keys(c.sections).length)
      chart("Mod sections", { unit: "ms/s", unitShort: "ms/s", x: c.t, series: topSeries(c.sections), height: 170 })
    const metrics = Object.keys(c.metrics)
    for (const k of metrics.slice(0, 12)) chart(k, { unit: "metric", x: c.t, height: 110, series: [{ label: k, values: c.metrics[k], color: s(0) }], yMin: null })
    if (metrics.length > 12) out.push({ kind: "text", text: `${int(metrics.length - 12)} more in the Mods table.` })
  }
  return out
}
