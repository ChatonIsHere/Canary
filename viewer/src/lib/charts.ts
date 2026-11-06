// uPlot charts sharing one zoom, crosshair and time zone. One y axis each.
import uPlot from "uplot"
import "uplot/dist/uPlot.min.css"
import * as Time from "./time"
import { esc, fmtNum } from "./format"

const all: uPlot[] = []
let syncing = false
let zoomHandler: (minMs: number, maxMs: number) => void = () => {}
let cursorHandler: (ms: number | null) => void = () => {}
let full: [number, number] = [0, 1]
let current: [number, number] | null = null

export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
// The categorical palette, in its validated order. Past eight, series fold into "Other".
export const SLOTS = 8
export const slot = (i: number) => css(`--chart-${i + 1}`)
// The theme has no neutral series colour for "Other", so it borrows the muted text colour.
export const otherColor = () => css("--muted-foreground")
const font = (px: number) => `${px}px ${getComputedStyle(document.documentElement).fontFamily || "system-ui, sans-serif"}`
const colors = () => ({
  ink: css("--foreground"), muted: css("--muted-foreground"), grid: css("--border"), surface: css("--card"),
})

// An opaque colour a share `a` of the way from `base` to `color` (both #rrggbb).
export function mix(color: string, base: string, a: number) {
  const rgb = (h: string) => { const m = /^#([0-9a-f]{6})/i.exec(h); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null }
  const x = rgb(color), y = rgb(base)
  if (!x || !y) return color
  return `rgb(${x.map((v, i) => Math.round(v * a + y[i] * (1 - a))).join(", ")})`
}

export type Values = (number | null)[]
export interface Series {
  label: string
  values: Values
  color: string
  width?: number
  bars?: boolean
  step?: boolean
  dash?: number[]
  fmt?: (v: number) => string
  raw?: Values
}

// Running totals from the last series up, so the first series is the top band. Null where every
// series is null (a gap).
function stack(series: Series[]) {
  let below: Values | null = null
  const out: Series[] = []
  for (let k = series.length - 1; k >= 0; k--) {
    const raw = series[k].values
    const b: Values | null = below
    const sum: Values = raw.map((v, i): number | null => v == null && (b == null || b[i] == null) ? null : (v || 0) + (b?.[i] || 0))
    out[k] = { ...series[k], values: sum, raw }
    below = sum
  }
  return out
}

// 24-hour ticks, with the date on the first and wherever the day changes.
function timeTicks(_u: uPlot, splits: number[], _axisIdx: number, _space: number, incr: number) {
  return splits.map((s, i) => {
    const ms = s * 1000
    const time = Time.fmt(ms, incr < 60 ? "time" : "short")
    const day = Time.fmt(ms, "date")
    return i === 0 || day !== Time.fmt(splits[i - 1] * 1000, "date") ? `${time}\n${day}` : time
  })
}

function timeAxis(c: ReturnType<typeof colors>): uPlot.Axis {
  return { stroke: c.muted, grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.grid, width: 1 }, font: font(12), size: 52, values: timeTicks }
}

function syncHooks(): uPlot.Hooks.Arrays {
  return {
    setScale: [(u, key) => {
      if (key !== "x" || syncing) return
      const { min, max } = u.scales.x
      if (min == null || max == null) return
      syncing = true
      current = [min, max]
      for (const o of all) if (o !== u && o.scales.x.min !== min) o.setScale("x", { min, max })
      syncing = false
      zoomHandler(min * 1000, max * 1000)
    }],
    setCursor: [(u) => {
      const left = u.cursor.left
      if (left == null || left < 0) { cursorHandler(null); return }
      cursorHandler(u.posToVal(left, "x") * 1000)
    }],
  }
}

function baseOpts(width: number, height: number): uPlot.Options {
  return {
    width, height,
    tzDate: (ts) => Time.chartDate(ts),
    cursor: {
      sync: { key: "canary", setSeries: false },
      drag: { x: true, y: false, setScale: true },
      points: { size: 7, width: 2 },
      bind: { dblclick: () => () => { resetZoom(); return null } },
    },
    scales: { x: { time: true } },
    legend: { live: true },
    hooks: syncHooks(),
    series: [],
  }
}

const widthOf = (el: HTMLElement) => Math.max(240, el.clientWidth || 800)

// A popover that follows the pointer inside a chart.
function placeTip(tip: HTMLElement, body: HTMLElement, over: HTMLElement, left: number, top: number) {
  tip.hidden = false
  const b = body.getBoundingClientRect(), o = over.getBoundingClientRect()
  const ox = o.left - b.left + left, oy = o.top - b.top + top
  const w = tip.offsetWidth, h = tip.offsetHeight
  let x = ox + 14
  if (x + w > b.width) x = Math.max(0, ox - w - 14)
  tip.style.left = `${x}px`
  tip.style.top = `${Math.max(0, oy - h - 10)}px`
}

function makeTip(body: HTMLElement) {
  const tip = document.createElement("div")
  tip.className = "chart-tip"
  tip.hidden = true
  tip.setAttribute("aria-hidden", "true")
  body.appendChild(tip)
  return tip
}

export interface TimeChartConfig {
  x: number[]
  series: Series[]
  height?: number
  unitShort?: string
  log?: boolean
  stacked?: boolean
  yMin?: number | null
  threshold?: number
  thresholdLabel?: string
  fmt?: (v: number) => string
}

// stacked: each series sits on the ones after it. uPlot draws in order, so each band fills down to
// zero over the bands before it, opaquely; the legend still shows each series' own value.
export function timeChart(body: HTMLElement, cfg: TimeChartConfig) {
  const c = colors()
  const valFmt = cfg.fmt || ((v: number) => fmtNum(v))
  const opts = baseOpts(widthOf(body), cfg.height || 170)
  opts.axes = [
    timeAxis(c),
    { stroke: c.muted, grid: { stroke: c.grid, width: 1 }, ticks: { show: false }, size: 60, font: font(12),
      values: (_u, vals) => vals.map((v) => fmtNum(v, 1)) },
  ]
  if (cfg.log) {
    // Frames run from 10 ms to seconds.
    opts.scales!.y = { distr: 3, log: 10 }
  } else {
    // yMin: null fits the data; otherwise the axis starts at zero.
    opts.scales!.y = {
      range: (_u, min, max) => {
        if (min == null || max == null) return [0, 1]
        if (cfg.yMin === null) {
          const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.01, 1)
          return [min - pad, max + pad]
        }
        return [Math.min(cfg.yMin ?? 0, min), max > 0 ? max * 1.08 : 1]
      },
    }
  }
  const series = cfg.stacked ? stack(cfg.series) : cfg.series
  const show = (s: Series, v: number | null | undefined, i: number | null) => {
    if (s.raw) v = i == null ? null : s.raw[i]
    return v == null ? "–" : `${(s.fmt || valFmt)(v)}${cfg.unitShort ? " " + cfg.unitShort : ""}`
  }
  opts.series = [
    { label: "Time", value: (_u, v) => v == null ? "–" : Time.fmt(v * 1000) },
    ...series.map((s): uPlot.Series => ({
      label: s.label,
      stroke: s.color,
      width: s.width ?? (s.bars ? 0 : cfg.stacked ? 1 : 1.5),
      fill: s.bars ? s.color : cfg.stacked ? mix(s.color, c.surface, 0.6) : undefined,
      dash: s.dash,
      paths: s.bars ? uPlot.paths.bars!({ size: [0.9, 8], align: 1 }) : (s.step ? uPlot.paths.stepped!({ align: 1 }) : undefined),
      points: { show: false },
      spanGaps: false,
      value: (_u, v, _si, i) => show(s, v, i),
    })),
  ]
  if (cfg.threshold != null) {
    opts.hooks!.draw = [(u) => {
      const y = u.valToPos(cfg.threshold!, "y", true)
      if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return
      const ctx = u.ctx, dpr = devicePixelRatio
      ctx.save()
      ctx.strokeStyle = css("--status-critical")
      ctx.lineWidth = dpr
      ctx.setLineDash([6 * dpr, 4 * dpr])
      ctx.beginPath()
      ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y)
      ctx.stroke()
      ctx.fillStyle = c.ink
      ctx.textAlign = "left"
      ctx.textBaseline = "alphabetic"
      ctx.font = font(12 * dpr)
      ctx.fillText(cfg.thresholdLabel || "", u.bbox.left + 6 * dpr, y - 5 * dpr)
      ctx.restore()
    }]
  }
  // The tooltip shows on the chart under the pointer only; the others just move their crosshair.
  const tip = makeTip(body)
  let hovered = false
  opts.hooks!.setCursor!.push((u) => {
    const { left, top, idx } = u.cursor
    if (!hovered || left == null || left < 0 || idx == null) { tip.hidden = true; return }
    const rows = series.map((s, k) => `<div class="row"><span class="swatch" style="background:${s.color}"></span><span>${esc(s.label)}</span><span class="val">${esc(show(s, u.data[k + 1][idx], idx))}</span></div>`)
    tip.innerHTML = `<div class="head">${esc(Time.fmt(u.data[0][idx] * 1000))}</div>${rows.join("")}`
    placeTip(tip, body, u.over, left, top ?? 0)
  })
  const data = [cfg.x, ...series.map((s) => s.values)] as uPlot.AlignedData
  const u = new uPlot(opts, data, body)
  u.over.addEventListener("mouseenter", () => { hovered = true })
  u.over.addEventListener("mouseleave", () => { hovered = false; tip.hidden = true })
  register(u)
  return u
}

// Two runs on one axis of minutes since each started; not part of the shared time zoom.
export function minutesChart(body: HTMLElement, cfg: { x: number[]; series: Series[]; height?: number; unitShort?: string; fmt?: (v: number) => string }) {
  const c = colors()
  const valFmt = cfg.fmt || ((v: number) => fmtNum(v))
  const show = (v: number | null | undefined) => (v == null ? "–" : `${valFmt(v)}${cfg.unitShort ? " " + cfg.unitShort : ""}`)
  const opts: uPlot.Options = {
    width: widthOf(body), height: cfg.height || 170,
    cursor: { drag: { x: true, y: false, setScale: true }, points: { size: 7, width: 2 } },
    scales: { x: { time: false }, y: { range: (_u, _min, max) => [0, max != null && max > 0 ? max * 1.08 : 1] } },
    legend: { live: true },
    axes: [
      { stroke: c.muted, grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.grid, width: 1 }, font: font(12), size: 40,
        values: (_u, vals) => vals.map((v) => `${v} min`) },
      { stroke: c.muted, grid: { stroke: c.grid, width: 1 }, ticks: { show: false }, size: 60, font: font(12), values: (_u, vals) => vals.map((v) => fmtNum(v, 1)) },
    ],
    series: [
      { label: "Minute", value: (_u, v) => (v == null ? "–" : `${v} min`) },
      ...cfg.series.map((s): uPlot.Series => ({ label: s.label, stroke: s.color, width: s.width ?? 2, dash: s.dash, points: { show: false }, spanGaps: false, value: (_u, v) => show(v) })),
    ],
  }
  const tip = makeTip(body)
  let hovered = false
  opts.hooks = { setCursor: [(u) => {
    const { left, top, idx } = u.cursor
    if (!hovered || left == null || left < 0 || idx == null) { tip.hidden = true; return }
    const rows = cfg.series.map((s, k) => `<div class="row"><span class="swatch" style="background:${s.color}"></span><span>${esc(s.label)}</span><span class="val">${esc(show(u.data[k + 1][idx]))}</span></div>`)
    tip.innerHTML = `<div class="head">Minute ${u.data[0][idx]}</div>${rows.join("")}`
    placeTip(tip, body, u.over, left, top ?? 0)
  }] }
  const u = new uPlot(opts, [cfg.x, ...cfg.series.map((s) => s.values)] as uPlot.AlignedData, body)
  u.over.addEventListener("mouseenter", () => { hovered = true })
  u.over.addEventListener("mouseleave", () => { hovered = false; tip.hidden = true })
  u.over.addEventListener("dblclick", () => u.setScale("x", { min: cfg.x[0], max: cfg.x[cfg.x.length - 1] }))
  return u
}

export interface LaneEvent<D = unknown> {
  t: number
  t2?: number
  size?: number
  color?: string
  d: D
}
export interface Lane {
  label: string
  color: string
  shape?: "tick"
  events: LaneEvent[]
  describe: (e: LaneEvent) => string
}

// Spikes, GCs, new errors, marks, entity counts and gaps, on the shared time axis.
export function eventLane(body: HTMLElement, lanes: Lane[]) {
  const c = colors()
  const rowH = 24
  const tip = makeTip(body)
  const opts = baseOpts(widthOf(body), lanes.length * rowH + 52)
  opts.legend = { show: false }
  opts.axes = [
    timeAxis(c),
    { show: true, size: 136, stroke: c.ink, grid: { show: false }, ticks: { show: false }, font: font(12),
      splits: () => lanes.map((_, i) => i + 0.5), values: (_u, splits) => splits.map((s) => lanes[lanes.length - 1 - Math.floor(s)].label) },
  ]
  // Rows count up from the bottom, so the first lane is the top one.
  opts.scales!.y = { range: () => [0, lanes.length] }
  opts.series = [{}, { label: "", points: { show: false }, stroke: "transparent" }]
  const drawn: { x1: number; x2: number; idx: number; ev: LaneEvent; lane: Lane }[] = []
  opts.hooks!.draw = [(u) => {
    const ctx = u.ctx
    const dpr = devicePixelRatio
    const xmin = u.scales.x.min!, xmax = u.scales.x.max!
    drawn.length = 0
    ctx.save()
    ctx.beginPath()
    ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height)
    ctx.clip()
    lanes.forEach((lane, idx) => {
      const row = lanes.length - 1 - idx
      const yTop = u.valToPos(row + 1, "y", true), yBot = u.valToPos(row, "y", true)
      const mid = (yTop + yBot) / 2
      ctx.strokeStyle = c.grid; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(u.bbox.left, yBot); ctx.lineTo(u.bbox.left + u.bbox.width, yBot); ctx.stroke()
      for (const ev of lane.events) {
        const t1 = ev.t / 1000, t2 = (ev.t2 ?? ev.t) / 1000
        if (t2 < xmin || t1 > xmax) continue
        const x1 = u.valToPos(t1, "x", true), x2 = u.valToPos(t2, "x", true)
        ctx.fillStyle = ev.color || lane.color
        if (ev.t2 != null) {
          ctx.globalAlpha = 0.35
          ctx.fillRect(x1, yTop + 3 * dpr, Math.max(2 * dpr, x2 - x1), (yBot - yTop) - 6 * dpr)
          ctx.globalAlpha = 1
        } else if (lane.shape === "tick") {
          ctx.fillRect(x1 - 0.5 * dpr, yTop + 5 * dpr, 1.5 * dpr, (yBot - yTop) - 10 * dpr)
        } else {
          const r = (ev.size || 4) * dpr
          ctx.beginPath(); ctx.arc(x1, mid, r, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = c.surface; ctx.lineWidth = 1.5 * dpr; ctx.stroke()
        }
        // In CSS pixels from the plot's left edge, as the cursor is.
        drawn.push({ x1: (x1 - u.bbox.left) / dpr, x2: (x2 - u.bbox.left) / dpr, idx, ev, lane })
      }
    })
    ctx.restore()
  }]
  opts.hooks!.setCursor!.push((u) => {
    const left = u.cursor.left, top = u.cursor.top
    if (left == null || left < 0 || top == null) { tip.hidden = true; return }
    const idx = lanes.length - 1 - Math.floor(u.posToVal(top, "y"))
    let best: (typeof drawn)[number] | null = null, bestD = 8
    for (const d of drawn) {
      if (d.idx !== idx) continue
      const dist = d.ev.t2 != null ? (left >= d.x1 && left <= d.x2 ? 0 : 99) : Math.abs(d.x1 - left)
      if (dist <= bestD) { best = d; bestD = dist }
    }
    if (!best) { tip.hidden = true; return }
    tip.innerHTML = best.lane.describe(best.ev)
    placeTip(tip, body, u.over, left, top)
  })
  const u = new uPlot(opts, [[full[0], full[1]], [null, null]] as uPlot.AlignedData, body)
  u.over.addEventListener("mouseleave", () => { tip.hidden = true })
  register(u)
  return u
}

function register(u: uPlot) {
  all.push(u)
  const range = current || full
  syncing = true
  u.setScale("x", { min: range[0], max: range[1] })
  syncing = false
}

export function unregister(u: uPlot) {
  const i = all.indexOf(u)
  if (i >= 0) all.splice(i, 1)
  u.destroy()
}

export function resetZoom() {
  current = null
  syncing = true
  for (const u of all) u.setScale("x", { min: full[0], max: full[1] })
  syncing = false
  zoomHandler(full[0] * 1000, full[1] * 1000)
}

export function resize() {
  for (const u of all) {
    const body = u.root.parentElement
    if (!body) continue
    const w = widthOf(body)
    if (Math.abs(w - u.width) > 2) u.setSize({ width: w, height: u.height })
  }
}

export const setFull = (minMs: number, maxMs: number) => { full = [minMs / 1000, maxMs / 1000] }
export const keepZoom = (minMs: number, maxMs: number) => { current = [minMs / 1000, maxMs / 1000] }
export const clearZoom = () => { current = null }
export const onZoom = (f: typeof zoomHandler) => { zoomHandler = f }
export const onCursor = (f: typeof cursorHandler) => { cursorHandler = f }
