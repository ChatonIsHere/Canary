import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Clock, Download, FolderOpen, GitCompareArrows, Info, ZoomOut } from "lucide-react"
import * as Charts from "@/lib/charts"
import { build, readFile, unreadable } from "@/lib/load"
import { drawMap, map, type MapBackground, type MapMeta } from "@/lib/map"
import { isMapMeta, mapDb, splitMapFiles, store } from "@/lib/mapStore"
import { samplesCsv, type Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model, ParsedFile } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section } from "@/components/Section"
import { Timeline } from "@/components/Timeline"
import { Overview } from "@/components/views/Overview"
import { Modules, Phases, Spikes } from "@/components/views/Performance"
import { Players } from "@/components/views/Players"
import { Entities, Errors } from "@/components/views/Entities"
import { Files, Mods, Server } from "@/components/views/Server"
import { Raw } from "@/components/views/Raw"
import { Compare, runName } from "@/components/views/Compare"
import { Profiles } from "@/components/views/Profiles"

const SECTIONS = [
  ["overview", "Overview"], ["compare", "Compare"], ["server", "Server"], ["timeline", "Timeline"], ["phases", "Where the time goes"],
  ["spikes", "Lag spikes"], ["profile", "Profile"], ["players", "Players"], ["entities", "Entities"], ["errors", "Errors"],
  ["modules", "Update modules"], ["mods", "Mods"], ["files", "Files"], ["raw", "Raw"],
] as const

const savedMode = store.get("canary-tz")
Time.setMode(savedMode === "server" || savedMode === "utc" ? savedMode : "browser")

const MAP_HELP = "To draw the game's map underneath, open the map.png and map.json that Canary's tools/extract_map.py makes."

export default function App() {
  const [M, setM] = useState<Model | null>(null)
  // A second recording to compare with.
  const [B, setB] = useState<Model | null>(null)
  const compareInput = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState<ReactNode>(null)
  const [tz, setTz] = useState(Time.getMode())
  // range follows the zoom as it happens; viewRange catches up a moment later, for the views.
  const [range, setRange] = useState<Range>([0, 0])
  const [viewRange, setViewRange] = useState<Range>([0, 0])
  const [dragging, setDragging] = useState(false)
  const [active, setActive] = useState("overview")
  // One more each time files are opened, so the charts and raw list start afresh.
  const [loadId, setLoadId] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const modelRef = useRef<Model | null>(null)

  // Game map
  const [bg, setBg] = useState<MapBackground | null>(null)
  const [bgOn, setBgOn] = useState(true)
  const [mapSaved, setMapSaved] = useState(false)
  const [mapNote, setMapNote] = useState<string | null>(null)
  // The pair in use, or half of one waiting for the other.
  const pending = useRef<{ meta: MapMeta | null; blob: Blob | null; url: string | null }>({ meta: null, blob: null, url: null })

  const setMap = useCallback(async (meta: MapMeta, blob: Blob, save: boolean) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { URL.revokeObjectURL(url); return "Couldn't read the map image." }
    if (pending.current.url) URL.revokeObjectURL(pending.current.url)
    pending.current.url = url
    setBgOn(store.get("canary-map") !== "off")
    setMapSaved(save ? await mapDb.set({ meta, blob }) : true)
    setBg({ img, meta })
    return null
  }, [])

  useEffect(() => {
    let live = true
    mapDb.get().then((v) => {
      if (!live || !v || !isMapMeta(v.meta) || !(v.blob instanceof Blob) || pending.current.meta) return
      pending.current.meta = v.meta; pending.current.blob = v.blob
      setMap(v.meta, v.blob, false)
    })
    return () => { live = false }
  }, [setMap])

  const forgetMap = () => {
    mapDb.clear()
    if (pending.current.url) URL.revokeObjectURL(pending.current.url)
    pending.current = { meta: null, blob: null, url: null }
    setBg(null)
    setMapNote(null)
  }

  const toggleBg = (on: boolean) => {
    store.set("canary-map", on ? "on" : "off")
    setBgOn(on)
  }

  // Loading
  const show = useCallback((parsed: ParsedFile[]) => {
    const model = build(parsed)
    const list = parsed.filter((p) => p.notes.length).map((p) => <li key={p.name}><strong>{p.name}</strong>: {p.notes.join(" ")}</li>)
    const noteList = list.length ? <ul className="mt-1 list-disc pl-5">{list}</ul> : null
    if (!model) {
      setNotes(<>No Canary records in {parsed.map((p) => p.name).join(", ")}.{noteList}</>)
      return
    }
    setNotes(noteList)
    Time.setHeaders(model.headers)
    if (Time.getMode() === "server" && !Time.hasServerZone()) { Time.setMode("browser"); setTz("browser") }
    Charts.clearZoom()
    map.userView = false
    document.title = `${parsed.length === 1 ? parsed[0].name : `${parsed.length} files`} · Canary`
    modelRef.current = model
    setRange([model.tMin, model.tMax])
    setViewRange([model.tMin, model.tMax])
    setLoadId((n) => n + 1)
    setM(model)
  }, [])

  // Takes map.png and map.json out of a batch of files, and opens the rest.
  const open = useCallback(async (fileList: FileList | File[]) => {
    const { rest, meta, images } = await splitMapFiles([...fileList])
    let note: string | null = null
    if (meta || images.length) {
      const p = pending.current
      if (meta) p.meta = meta
      if (images.length) p.blob = images.find((f) => f.name === p.meta?.image) || images[0]
      if (p.meta && p.blob) note = await setMap(p.meta, p.blob, true) || `Map loaded: ${p.meta.name || "game map"}.`
      else note = p.meta ? "Got map.json; open map.png with it." : "Got a map image; open the map.json that says where it goes with it."
      setMapNote(note)
    }
    if (!rest.length) {
      if (note && !modelRef.current) setNotes(`${note} Now open a recording.`)
      return
    }
    show(await readAll(rest))
  }, [setMap, show])

  const openCompare = useCallback(async (fileList: FileList) => {
    const { rest } = await splitMapFiles([...fileList])
    const parsed = await readAll(rest)
    const model = build(parsed)
    if (!model) { setNotes(`No Canary records to compare in ${parsed.map((p) => p.name).join(", ")}.`); return }
    setB(model)
    setTimeout(() => document.getElementById("compare")?.scrollIntoView(), 0)
  }, [])

  // Drop files anywhere on the page.
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => { e.preventDefault(); depth++; setDragging(true) }
    const leave = () => { if (--depth <= 0) { depth = 0; setDragging(false) } }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragging(false); if (e.dataTransfer?.files.length) open(e.dataTransfer.files) }
    addEventListener("dragenter", enter)
    addEventListener("dragleave", leave)
    addEventListener("dragover", over)
    addEventListener("drop", drop)
    return () => {
      removeEventListener("dragenter", enter)
      removeEventListener("dragleave", leave)
      removeEventListener("dragover", over)
      removeEventListener("drop", drop)
    }
  }, [open])

  // Zooming any chart zooms the rest; the views follow once it settles.
  useEffect(() => {
    let timer = 0
    Charts.onZoom((min, max) => {
      const m = modelRef.current
      if (!m) return
      const r: Range = min <= m.tMin && max >= m.tMax ? [m.tMin, m.tMax] : [Math.max(m.tMin, min), Math.min(m.tMax, max)]
      setRange(r)
      clearTimeout(timer)
      timer = window.setTimeout(() => setViewRange(r), 150)
    })
    return () => { clearTimeout(timer); Charts.onZoom(() => {}) }
  }, [])

  // Charts and the map are canvases sized in pixels, so they follow the page's width.
  useEffect(() => {
    if (!M || !mainRef.current) return
    let timer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => { Charts.resize(); drawMap(map.canvas) }, 100)
    })
    ro.observe(mainRef.current)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [M])

  // Marks the link of the section in view.
  useEffect(() => {
    if (!M) return
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id)
    }, { rootMargin: "-40% 0px -55% 0px" })
    for (const [id] of SECTIONS) { const el = document.getElementById(id); if (el) spy.observe(el) }
    return () => spy.disconnect()
  }, [M])

  const changeTz = (v: string) => {
    const mode = v as Time.TimeMode
    Time.setMode(mode)
    store.set("canary-tz", mode)
    setTz(mode)
    // New arrays, so every view works its text out again in the new zone.
    setRange((r) => [r[0], r[1]])
    setViewRange((r) => [r[0], r[1]])
  }

  const exportCsv = () => {
    if (!M) return
    const blob = new Blob([samplesCsv(M, range)], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `canary-samples-${new Date(range[0]).toISOString().slice(0, 19).replace(/[:T]/g, "")}Z.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const mapStatus = useMemo(() => {
    if (!bg) return mapNote || MAP_HELP
    const { name, bottomLeft: [x0, z0], topRight: [x1, z1] } = bg.meta
    return `Map: ${name || "game map"}, x ${Math.round(x0)} to ${Math.round(x1)}, z ${Math.round(z0)} to ${Math.round(z1)}. `
      + (mapSaved ? "Kept in this browser for next time." : "This browser can't keep it, so it's gone when the page closes.")
  }, [bg, mapNote, mapSaved])

  const hasPhases = !!M?.phaseNames.work.length
  const shown = (id: string) => (id !== "phases" || hasPhases) && (id !== "compare" || !!B) && (id !== "profile" || !!M?.profiles.length)
  const zoomed = !!M && (range[0] !== M.tMin || range[1] !== M.tMax)
  const now = M?.tMax ?? 0
  const serverZone = !!M && Time.hasServerZone()
  const h = M ? Time.headerAt(now) : null

  return (
    <div className="min-h-svh">
      <input ref={fileInput} type="file" multiple accept=".jsonl,.gz,.zip,.json,.txt,.png" hidden
        onChange={(e) => { if (e.target.files) open(e.target.files); e.target.value = "" }} />
      <input ref={compareInput} type="file" multiple accept=".jsonl,.gz,.zip,.json,.txt" hidden
        onChange={(e) => { if (e.target.files) openCompare(e.target.files); e.target.value = "" }} />
      <h1 className="sr-only">Canary recording viewer</h1>
      {M && (
        <div className="mx-auto mt-4 flex max-w-[1400px] flex-wrap items-center gap-2 px-4 sm:px-6">
          <nav aria-label="Sections" className="min-w-0 flex-1">
            <ul className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {SECTIONS.filter(([id]) => shown(id)).map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} aria-current={active === id ? "location" : undefined}
                    className={cn(buttonVariants({ variant: "ghost" }), "h-8 px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                      active === id && "bg-background text-foreground shadow-sm hover:bg-background")}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <Label htmlFor="tz-select" className="sr-only">Times in</Label>
              <Select value={tz} onValueChange={changeTz}>
                <SelectTrigger id="tz-select" className="h-9 max-w-[min(22rem,calc(100vw-2rem))]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="browser">Your time: {Time.browserZone} ({Time.offsetText(Time.browserOffsetAt(now))})</SelectItem>
                  <SelectItem value="server" disabled={!serverZone}>
                    Server time: {serverZone && h ? `${h.timeZone} (${Time.offsetText(h.utcOffsetMin ?? 0)})` : "not in these files"}
                  </SelectItem>
                  <SelectItem value="utc">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="h-9" onClick={() => Charts.resetZoom()} disabled={!zoomed}><ZoomOut data-icon="inline-start" />Zoom out</Button>
            <Button variant="outline" className="h-9" onClick={exportCsv}><Download data-icon="inline-start" />Export CSV</Button>
            <Button variant="outline" className="h-9" onClick={() => compareInput.current?.click()}
              title={B ? `Comparing with ${runName(B)}` : "Open a second recording to compare with this one"}>
              <GitCompareArrows data-icon="inline-start" />{B ? "Compare with other files" : "Open to compare"}
            </Button>
            <Button className="h-9" onClick={() => fileInput.current?.click()}><FolderOpen data-icon="inline-start" />Open files</Button>
          </div>
        </div>
      )}

      <main ref={mainRef} className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pt-4 pb-10 sm:px-6">
        {M && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {zoomed ? "Zoomed" : "All"}: <strong className="font-semibold text-foreground">{Time.fmt(range[0])}</strong> to{" "}
            <strong className="font-semibold text-foreground">{Time.fmt(range[1])}</strong> ({Time.duration(range[1] - range[0])}), {Time.label(range[0])}
          </p>
        )}

        {!M && (
          <section aria-labelledby="welcome-title" className="grid min-h-[60vh] place-items-center">
            <Card className={cn("w-full max-w-xl border-2 text-base border-dashed border-input text-center ring-0 transition-colors", dragging && "border-ring bg-accent")}>
              <CardContent className="grid justify-items-center gap-4 px-6 py-8 sm:px-10">
                <h2 id="welcome-title" className="text-xl font-semibold">Open a recording</h2>
                <p className="text-muted-foreground">
                  Open recordings, saved buffers or reports from a server's <code>UserData/Canary</code> folder, or drop
                  them here. Several at once are merged into one timeline. Add <code>map.png</code> and <code>map.json</code>{" "}
                  to see players on the game's map.
                </p>
                <Button size="lg" className="h-10 px-4 text-base" onClick={() => fileInput.current?.click()}><FolderOpen data-icon="inline-start" />Open files</Button>
              </CardContent>
            </Card>
          </section>
        )}

        {M && <TzBanner M={M} />}
        {notes && (
          <Alert role="status" className="px-4 py-3">
            <Info aria-hidden />
            <AlertDescription className="text-sm text-foreground">{notes}</AlertDescription>
          </Alert>
        )}

        {M && (
          <div className="grid grid-cols-1 gap-4">
            <Overview M={M} R={viewRange} />
            {B && <Compare A={M} B={B} onClose={() => setB(null)} />}
            <Server M={M} />
            <Section id="timeline" title="Timeline" sub="Drag across a chart to zoom; double-click to zoom out. The rest of the page follows the zoom.">
              <Timeline key={`${loadId}-${tz}`} model={M} range={range} />
            </Section>
            {hasPhases && <Phases M={M} R={viewRange} />}
            <Spikes M={M} R={viewRange} />
            <Profiles M={M} R={viewRange} />
            <Players M={M} R={viewRange} bg={bg} bgOn={bgOn} onBgOn={toggleBg} mapNote={mapStatus} onForget={forgetMap} />
            <Entities M={M} R={viewRange} />
            <Errors M={M} R={viewRange} />
            <Modules M={M} R={viewRange} />
            <Mods M={M} R={viewRange} />
            <Files M={M} R={viewRange} />
            <Raw key={loadId} M={M} R={viewRange} />
          </div>
        )}
      </main>
    </div>
  )
}

function TzBanner({ M }: { M: Model }) {
  const at = M.tMax
  const lines: ReactNode[] = [<>Times are in <strong>{Time.label(at)}</strong>.</>]
  if (Time.hasServerZone()) {
    const offsets = [...new Set(M.headers.filter((h) => h.utcOffsetMin != null).map((h) => h.utcOffsetMin!))]
    const h = Time.headerAt(at)!
    const off = h.utcOffsetMin ?? 0
    const diff = off - Time.browserOffsetAt(at)
    const rel = diff === 0 ? "the same as yours" : `${Time.duration(Math.abs(diff) * 60000).replace(" 00 min", "")} ${diff > 0 ? "ahead of" : "behind"} yours`
    lines.push(<>The server was on <strong>{h.timeZone}</strong> ({Time.offsetText(off)}{h.daylightSaving ? ", daylight saving" : ""}), {rel}.</>)
    if (offsets.length > 1) lines.push(`Its offset changed during this data (${offsets.map(Time.offsetText).join(" → ")}).`)
    if (M.environment?.container) lines.push(<>It ran in {M.environment.container} on {M.environment.platform}; containers are on UTC unless <code>TZ</code> is set.</>)
    lines.push("File names are UTC; the server console prints server time.")
  } else {
    lines.push("These files predate time zone headers, so server time isn't available.")
  }
  return (
    <Alert role="status" className="px-4 py-3">
      <Clock aria-hidden />
      <AlertDescription className="text-sm text-foreground">{lines.map((l, i) => <div key={i}>{l}</div>)}</AlertDescription>
    </Alert>
  )
}

async function readAll(files: File[]) {
  const parsed: ParsedFile[] = []
  for (const f of files) {
    try { parsed.push(await readFile(f)) } catch (e) { parsed.push(unreadable(f, (e as Error).message)) }
  }
  return parsed
}
