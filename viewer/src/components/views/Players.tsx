import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Maximize, Minus, Plus } from "lucide-react"
import * as Charts from "@/lib/charts"
import { int } from "@/lib/format"
import { drawMap, fitMap, map, mapSummary, mapTip, panMap, playerColor, zoomMap, type MapBackground } from "@/lib/map"
import { SLOTS } from "@/lib/charts"
import { playerRows, within, type Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable } from "../DataTable"
import { Section } from "../Section"

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent className="text-sm">{label}</TooltipContent>
    </Tooltip>
  )
}

function Check({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="disabled:opacity-100" />
      <Label htmlFor={id} className={`text-sm font-normal peer-disabled:opacity-100 ${disabled ? "text-muted-foreground" : ""}`}>{label}</Label>
    </div>
  )
}

export function Players({ M, R, bg, bgOn, onBgOn, mapNote, onForget }: {
  M: Model
  R: Range
  bg: MapBackground | null
  bgOn: boolean
  onBgOn: (on: boolean) => void
  mapNote: string
  onForget: () => void
}) {
  const { tracks, rows } = useMemo(() => playerRows(M, R), [M, R])
  const canvas = useRef<HTMLCanvasElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState(true)
  const [rings, setRings] = useState(true)
  // The slider goes back to the end whenever the range changes.
  const rangeKey = `${R[0]}|${R[1]}`
  const [scrub, setScrub] = useState({ key: "", v: 1000 })
  const times = tracks.flatMap((t) => t.pts.map((p) => p.t))
  const tMin = times.length ? Math.min(...times) : R[0]
  const tMax = times.length ? Math.max(...times) : R[1]
  const scrubbed = scrub.key === rangeKey
  const scrubT = scrubbed ? tMin + (tMax - tMin) * (scrub.v / 1000) : null
  const step = M.settings.positionSeconds * 1000

  // A new range, or the game map shown or hidden: refit unless the view's been moved by hand.
  const lastBg = useRef<MapBackground | null>(null)
  useLayoutEffect(() => {
    map.canvas = canvas.current
    Object.assign(map, { tracks, spikes: within(M.spikes, R), step, tMin, tMax, bg, bgOn })
    if (bg !== lastBg.current) { lastBg.current = bg; if (bg) map.userView = false }
    if (!map.userView || !map.view) fitMap()
    drawMap(canvas.current)
  }, [M, R, tracks, step, tMin, tMax, bg, bgOn])

  useLayoutEffect(() => {
    Object.assign(map, { paths, spikeRings: rings, scrubT })
    drawMap(canvas.current)
  }, [paths, rings, scrubT])

  // Hovering a timeline chart shows where everyone was at that moment.
  useEffect(() => {
    let frame = 0
    Charts.onCursor((ms) => {
      map.cursorT = ms
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => drawMap(map.canvas))
    })
    return () => { Charts.onCursor(() => {}); cancelAnimationFrame(frame); map.cursorT = null }
  }, [])

  // Scroll to zoom, drag to move (mouse only, so touch still scrolls the page), double-click to fit.
  useEffect(() => {
    const el = canvas.current!
    const pos = (e: MouseEvent) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
    let pan: readonly [number, number] | null = null
    const hideTip = () => { if (tip.current) tip.current.hidden = true }
    const wheel = (e: WheelEvent) => {
      if (!map.view) return
      e.preventDefault()
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1)
      zoomMap(el, Math.exp(dy * 0.002), ...pos(e))
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || !map.view) return
      pan = pos(e)
      el.setPointerCapture(e.pointerId)
      el.style.cursor = "grabbing"
      hideTip()
    }
    const move = (e: PointerEvent) => {
      if (!pan) return
      const [x, y] = pos(e)
      panMap(el, x - pan[0], y - pan[1])
      pan = [x, y]
    }
    const up = () => { pan = null; el.style.cursor = "" }
    const hover = (e: MouseEvent) => {
      if (pan || !tip.current) return
      const [x, y] = pos(e)
      const html = mapTip(x, y)
      if (!html) { hideTip(); return }
      tip.current.innerHTML = html
      tip.current.hidden = false
      tip.current.style.left = `${Math.max(0, Math.min(el.clientWidth - tip.current.offsetWidth, x + 12))}px`
      tip.current.style.top = `${y + 12}px`
    }
    const refit = () => { fitMap(); drawMap(el) }
    // Arrow keys move the view and + and - zoom, when the map has focus.
    const key = (e: KeyboardEvent) => {
      const s = el.clientWidth * 0.1
      const moves: Record<string, [number, number]> = { ArrowLeft: [s, 0], ArrowRight: [-s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }
      if (moves[e.key]) panMap(el, ...moves[e.key])
      else if (e.key === "+" || e.key === "=") zoomMap(el, 1 / 1.5)
      else if (e.key === "-") zoomMap(el, 1.5)
      else return
      e.preventDefault()
    }
    el.addEventListener("wheel", wheel, { passive: false })
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    el.addEventListener("dblclick", refit)
    el.addEventListener("mousemove", hover)
    el.addEventListener("mouseleave", hideTip)
    el.addEventListener("keydown", key)
    return () => {
      el.removeEventListener("wheel", wheel)
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
      el.removeEventListener("dblclick", refit)
      el.removeEventListener("mousemove", hover)
      el.removeEventListener("mouseleave", hideTip)
      el.removeEventListener("keydown", key)
    }
  }, [])

  const zoom = (f: number) => canvas.current && zoomMap(canvas.current, f)
  const fit = () => { fitMap(); drawMap(canvas.current) }
  const scrubLabel = `At ${Time.fmt(scrubT ?? tMax, "time")}`

  return (
    <Section id="players" title="Players"
      sub={tracks.length ? `${tracks.length} player(s), positions every ${M.settings.positionSeconds} s.` : "No players in this range."}>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <figure className="m-0 grid min-w-0 grid-cols-1 gap-3 rounded-lg border p-3 sm:p-4">
          <figcaption id="map-caption" className="text-sm text-muted-foreground">
            Top-down, x east and z north. Dots mark where each player was last seen (hollow if they'd left),
            or where they were at the time under the cursor. Red rings mark where players were during lag spikes.
            Scroll to zoom, drag to move, double-click to fit; with the map focused, arrow keys move and + and − zoom.
          </figcaption>
          <div className="relative">
            <canvas ref={canvas} tabIndex={0} aria-label="Map of player positions" aria-describedby="map-caption map-summary"
              className="block aspect-square w-full cursor-grab rounded-md border" />
            <div ref={tip} hidden className="chart-tip" aria-hidden />
            <p id="map-summary" className="sr-only">{mapSummary(tracks, scrubT, step)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Check id="map-spikes" label="Spikes" checked={rings} onChange={setRings} />
            <Check id="map-paths" label="Paths" checked={paths} onChange={setPaths} />
            <Check id="map-bg" label="Game map" checked={!!bg && bgOn} onChange={onBgOn} disabled={!bg} />
            <div className="flex gap-1.5">
              <IconButton label="Zoom out" onClick={() => zoom(1.5)}><Minus /></IconButton>
              <IconButton label="Zoom in" onClick={() => zoom(1 / 1.5)}><Plus /></IconButton>
              <Button variant="outline" onClick={fit}><Maximize data-icon="inline-start" />Fit</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span id="scrub-label" className="text-sm tabular-nums">{scrubLabel}</span>
            <Slider className="min-w-48 flex-1 py-2" min={0} max={1000} step={1} value={[scrubbed ? scrub.v : 1000]}
              onValueChange={([v]) => setScrub({ key: rangeKey, v })}
              thumbLabel="Time shown on the map" thumbValueText={scrubLabel} />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
            {tracks.slice(0, SLOTS).map(({ p }) => (
              <li key={p.order} className="flex items-center gap-1.5"><span className="swatch" style={{ background: playerColor(p) }} />{p.name}</li>
            ))}
            {tracks.length > SLOTS && (
              <li className="flex items-center gap-1.5"><span className="swatch" style={{ background: Charts.otherColor() }} />{tracks.length - SLOTS} more players</li>
            )}
            <li className="flex items-center gap-1.5">
              <span className="swatch border-2 border-status-critical" style={{ background: "transparent", borderRadius: "50%" }} />Lag spike
            </li>
          </ul>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{mapNote}</span>
            {bg && <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={onForget}>Forget map</Button>}
          </p>
        </figure>
        <DataTable label="Players" rows={rows} sortKey="online" empty="No players in this time range." cols={[
          { key: "name", label: "Player", render: (r) => (
            <span><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="swatch" style={{ background: playerColor(r.p) }} />{r.name}</span>{" "}
              <span className="text-muted-foreground">{r.id}</span></span>) },
          { key: "first", label: "First seen", render: (r) => Time.fmt(r.first, "time") },
          { key: "last", label: "Last seen", render: (r) => Time.fmt(r.last, "time") },
          { key: "online", label: "Online", num: true, render: (r) => Time.duration(r.online) },
          { key: "dist", label: "Distance (m)", num: true, render: (r) => int(r.dist) },
          { key: "chunks", label: "Chunks", num: true },
          { key: "top", label: "Most time in" },
          { key: "spikes", label: "Spikes", num: true },
        ]} />
      </div>
    </Section>
  )
}
