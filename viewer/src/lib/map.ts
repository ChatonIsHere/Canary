// The players map: a top-down canvas of where each player went, optionally over the game's own map.
import { css, otherColor, slot, SLOTS } from "./charts"
import { esc, num } from "./format"
import * as Time from "./time"
import type { Player, Spike, TrackPoint } from "./types"
import type { Track } from "./stats"

export interface MapMeta {
  name?: string
  image?: string
  bottomLeft: [number, number]
  topRight: [number, number]
}
export interface MapBackground { img: HTMLImageElement; meta: MapMeta }

interface Hit { x: number; y: number; p: Player; pt: TrackPoint; spike?: Spike }

// view: the square of the world on the canvas; userView once it's been zoomed or moved by hand.
export const map = {
  canvas: null as HTMLCanvasElement | null,
  view: null as { minX: number; minZ: number; span: number } | null,
  userView: false,
  bg: null as MapBackground | null,
  bgOn: true,
  paths: true,
  spikeRings: true,
  tracks: [] as Track[],
  spikes: [] as Spike[],
  step: 5000,
  tMin: 0,
  tMax: 0,
  cursorT: null as number | null,
  scrubT: null as number | null,
  points: [] as Hit[],
}

// Players keep one colour each, by first appearance; past eight they're "Other".
export const playerColor = (p: Player) => (p.order < SLOTS ? slot(p.order) : otherColor())
const bgShown = () => !!map.bg && map.bgOn

// Fits the trails, and the game map when it's shown, so trails off the map's edge still show.
export function fitMap() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  const add = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
  for (const t of map.tracks) for (const p of t.pts) add(p.x, p.z)
  const bg = bgShown()
  if (bg) { add(...map.bg!.meta.bottomLeft); add(...map.bg!.meta.topRight) }
  map.userView = false
  if (minX === Infinity) { map.view = null; return }
  const span = Math.max(maxX - minX, maxZ - minZ, 40) * (bg ? 1.04 : 1.15)
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  map.view = { minX: cx - span / 2, minZ: cz - span / 2, span }
}

// factor > 1 zooms out, around a point on the canvas (its middle by default).
export function zoomMap(canvas: HTMLCanvasElement, factor: number, cx?: number, cy?: number) {
  const v = map.view, size = canvas.clientWidth
  if (!v || !size) return
  cx ??= size / 2; cy ??= size / 2
  const wx = v.minX + cx / size * v.span, wz = v.minZ + (size - cy) / size * v.span
  const span = Math.min(Math.max(v.span * factor, 10), 50000)
  map.view = { minX: wx - cx / size * span, minZ: wz - (size - cy) / size * span, span }
  map.userView = true
  drawMap(canvas)
}

export function panMap(canvas: HTMLCanvasElement, dx: number, dy: number) {
  const v = map.view, size = canvas.clientWidth
  if (!v || !size) return
  map.view = { ...v, minX: v.minX - dx / size * v.span, minZ: v.minZ + dy / size * v.span }
  map.userView = true
  drawMap(canvas)
}

export function nearest(pts: TrackPoint[], t: number, maxDist: number) {
  let lo = 0, hi = pts.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].t < t) lo = mid + 1; else hi = mid }
  let best: TrackPoint | null = null
  for (const i of [lo - 1, lo]) {
    const pt = pts[i]
    if (pt && Math.abs(pt.t - t) <= maxDist && (!best || Math.abs(pt.t - t) < Math.abs(best.t - t))) best = pt
  }
  return best
}

const font = (px: number) => `${px}px ${getComputedStyle(document.documentElement).fontFamily || "system-ui, sans-serif"}`

export function drawMap(canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  const dpr = devicePixelRatio || 1
  const size = canvas.clientWidth
  if (!size) return
  canvas.width = size * dpr; canvas.height = size * dpr
  const ctx = canvas.getContext("2d")!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)
  const muted = css("--muted-foreground"), grid = css("--border"), surface = css("--card"), ink = css("--foreground"), critical = css("--status-critical")
  map.points = []
  if (!map.view) {
    ctx.fillStyle = muted; ctx.font = font(14); ctx.textAlign = "center"
    ctx.fillText("No positions in this time range", size / 2, size / 2)
    return
  }
  const v = map.view
  const px = (x: number) => (x - v.minX) / v.span * size
  const pz = (z: number) => size - (z - v.minZ) / v.span * size // north up
  const bg = bgShown()
  // Over the map image, text gets a halo in the card colour.
  const text = (s: string, x: number, y: number) => {
    if (bg) { ctx.strokeStyle = surface; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeText(s, x, y) }
    ctx.fillText(s, x, y)
  }
  if (bg) {
    // The image spans bottomLeft to topRight exactly; its top edge is the largest z.
    const { bottomLeft: [x0, z0], topRight: [x1, z1] } = map.bg!.meta
    const l = px(x0), t = pz(z1), w = px(x1) - l, h = pz(z0) - t
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(map.bg!.img, l, t, w, h)
    // A wash of the card colour keeps trails readable on the artwork.
    ctx.globalAlpha = 0.3; ctx.fillStyle = surface; ctx.fillRect(l, t, w, h); ctx.globalAlpha = 1
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.strokeRect(l, t, w, h)
  }
  // Grid every "nice" number of metres.
  const raw = v.span / 6, mag = 10 ** Math.floor(Math.log10(raw))
  const stepM = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw
  const xs: number[] = [], zs: number[] = []
  for (let x = Math.ceil(v.minX / stepM) * stepM; x <= v.minX + v.span; x += stepM) xs.push(x)
  for (let z = Math.ceil(v.minZ / stepM) * stepM; z <= v.minZ + v.span; z += stepM) zs.push(z)
  ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.globalAlpha = bg ? 0.5 : 1
  for (const x of xs) { ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), size); ctx.stroke() }
  for (const z of zs) { ctx.beginPath(); ctx.moveTo(0, pz(z)); ctx.lineTo(size, pz(z)); ctx.stroke() }
  ctx.globalAlpha = 1
  ctx.fillStyle = muted; ctx.font = font(12)
  for (const x of xs) text(`x ${Math.round(x)}`, px(x) + 3, size - 5)
  for (const z of zs) text(`z ${Math.round(z)}`, 3, pz(z) - 4)
  ctx.textAlign = "right"; text("N ↑", size - 6, 16); ctx.textAlign = "left"
  if (!map.tracks.length) {
    ctx.fillStyle = muted; ctx.font = font(14); ctx.textAlign = "center"
    text("No positions in this time range", size / 2, size / 2)
    ctx.textAlign = "left"
    return
  }

  const step = map.step
  if (map.paths) for (const { p, pts } of map.tracks) {
    ctx.lineJoin = "round"
    ctx.beginPath()
    pts.forEach((pt, i) => {
      const brk = i === 0 || pt.t - pts[i - 1].t > step * 3
      if (brk) ctx.moveTo(px(pt.x), pz(pt.z)); else ctx.lineTo(px(pt.x), pz(pt.z))
    })
    if (bg) { ctx.strokeStyle = surface; ctx.lineWidth = 4.5; ctx.globalAlpha = 0.8; ctx.stroke() }
    ctx.strokeStyle = playerColor(p); ctx.lineWidth = 2; ctx.globalAlpha = bg ? 1 : 0.7
    ctx.stroke()
    ctx.globalAlpha = 1
    for (const pt of pts) map.points.push({ x: px(pt.x), y: pz(pt.z), p, pt })
  }
  if (map.spikeRings) {
    ctx.strokeStyle = critical; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8
    for (const s of map.spikes) for (const { p, pts } of map.tracks) {
      const pt = nearest(pts, s.t, step * 1.5)
      if (!pt) continue
      const r = 4 + Math.min(6, s.ms / 300)
      ctx.beginPath(); ctx.arc(px(pt.x), pz(pt.z), r, 0, Math.PI * 2)
      if (bg) { ctx.strokeStyle = surface; ctx.lineWidth = 3.5; ctx.stroke(); ctx.strokeStyle = critical; ctx.lineWidth = 1.5 }
      ctx.stroke()
      map.points.push({ x: px(pt.x), y: pz(pt.z), p, pt, spike: s })
    }
    ctx.globalAlpha = 1
  }
  // Everyone's position at the timeline cursor or the slider; otherwise where each was last seen,
  // hollow for anyone who'd left by the end.
  const at = map.cursorT ?? map.scrubT
  for (const { p, pts } of map.tracks) {
    const pt = at != null ? nearest(pts, at, step * 1.5) : pts[pts.length - 1]
    if (!pt) continue
    const left = at == null && map.tMax - pt.t > step * 1.5
    ctx.beginPath(); ctx.arc(px(pt.x), pz(pt.z), 6, 0, Math.PI * 2)
    if (left) {
      ctx.fillStyle = surface; ctx.fill()
      ctx.strokeStyle = playerColor(p); ctx.lineWidth = 2.5; ctx.stroke()
    } else {
      ctx.fillStyle = playerColor(p); ctx.strokeStyle = surface; ctx.lineWidth = 2
      ctx.fill(); ctx.stroke()
    }
    ctx.fillStyle = ink; ctx.font = font(13)
    text(p.name, px(pt.x) + 9, pz(pt.z) - 7)
    map.points.push({ x: px(pt.x), y: pz(pt.z), p, pt })
  }
}

// The tooltip for the point under (x, y) on the canvas, or null.
export function mapTip(x: number, y: number) {
  let best: Hit | null = null, bd = 12
  for (const pnt of map.points) { const d = Math.hypot(pnt.x - x, pnt.y - y); if (d < bd) { bd = d; best = pnt } }
  if (!best) return null
  const pt = best.pt
  return `<strong>${esc(best.p.name)}</strong> at ${esc(Time.fmt(pt.t))}<br>x ${num(pt.x, 1)}, y ${num(pt.y, 1)}, z ${num(pt.z, 1)}${pt.chunk ? `<br>${esc(pt.chunk)}` : ""}${best.spike ? `<br>During a ${num(best.spike.ms, 0)} ms lag spike` : ""}`
}

// A sentence per player for screen readers: where each one is on the map right now.
export function mapSummary(tracks: Track[], at: number | null, step: number) {
  if (!tracks.length) return "No positions in this time range."
  return tracks.map(({ p, pts }) => {
    const pt = at != null ? nearest(pts, at, step * 1.5) : pts[pts.length - 1]
    return pt ? `${p.name} at x ${Math.round(pt.x)}, z ${Math.round(pt.z)}` : `${p.name} not on`
  }).join("; ") + "."
}
