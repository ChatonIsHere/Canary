// Two recordings side by side: a table of the main figures and per-minute charts on one axis.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type uPlot from "uplot"
import { X } from "lucide-react"
import * as Charts from "@/lib/charts"
import { change, compare, maxPlayers, verdict, type Metric } from "@/lib/compare"
import { fmtNum, int } from "@/lib/format"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Section, SubHeading } from "../Section"

export const runName = (M: Model) => (M.files.length === 1 ? M.files[0].name : `${M.files[0].name} and ${M.files.length - 1} more`)

const show = (m: Metric, v: number | null) => (v == null ? "–" : fmtNum(v, m.digits ?? 2))

export function Compare({ A, B, onClose }: { A: Model; B: Model; onClose: () => void }) {
  const [minPlayers, setMinPlayers] = useState(() => Math.min(maxPlayers(A), maxPlayers(B)))
  const result = useMemo(() => compare(A, B, minPlayers), [A, B, minPlayers])
  const nameA = runName(A), nameB = runName(B)
  const groups = useMemo(() => {
    const out: { group: string; rows: Metric[] }[] = []
    for (const r of result?.rows || []) {
      const last = out[out.length - 1]
      if (last?.group === r.group) last.rows.push(r)
      else out.push({ group: r.group, rows: [r] })
    }
    return out
  }, [result])

  return (
    <Section id="compare" title="Compare" sub={<>
      <strong className="font-semibold text-foreground">A</strong> is {nameA}; <strong className="font-semibold text-foreground">B</strong> is {nameB}.
      Each is compared from its first second with at least the players below to its last.
    </>}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="compare-players">At least this many players</Label>
          <Input id="compare-players" type="number" min={0} className="h-9 w-28" value={minPlayers}
            onChange={(e) => setMinPlayers(Math.max(0, Number(e.target.value) || 0))} />
        </div>
        <Button variant="outline" className="h-9" onClick={onClose}><X data-icon="inline-start" />Stop comparing</Button>
      </div>
      {!result ? (
        <p className="text-sm text-muted-foreground">One of them never had {minPlayers} players on. Lower the number.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            A: {Time.fmt(result.wa.from)} to {Time.fmt(result.wa.to)}. B: {Time.fmt(result.wb.from)} to {Time.fmt(result.wb.to)}. {Time.label(result.wa.from)}.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table aria-label="A and B compared">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Measure</TableHead>
                  <TableHead scope="col" className="text-right">A</TableHead>
                  <TableHead scope="col" className="text-right">B</TableHead>
                  <TableHead scope="col" className="text-right">B against A</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => [
                  <TableRow key={g.group} className="hover:bg-transparent">
                    <TableHead scope="colgroup" colSpan={4} className="bg-muted/50 font-semibold text-foreground">{g.group}</TableHead>
                  </TableRow>,
                  ...g.rows.map((m) => {
                    const c = change(m.a, m.b), v = verdict(m)
                    return (
                      <TableRow key={g.group + m.label}>
                        <TableHead scope="row" className="font-normal whitespace-normal">
                          <span className="break-all">{m.label}</span>{m.unit && <span className="text-muted-foreground"> ({m.unit})</span>}
                        </TableHead>
                        <TableCell className="text-right tabular-nums">{show(m, m.a)}</TableCell>
                        <TableCell className="text-right tabular-nums">{show(m, m.b)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c == null ? "–" : Math.round(c) === 0 ? "0%" : `${c > 0 ? "+" : "−"}${int(Math.abs(c))}%`}
                          {v && <span className="ml-1.5 text-muted-foreground">{v}</span>}
                        </TableCell>
                      </TableRow>
                    )
                  }),
                ])}
              </TableBody>
            </Table>
          </div>
          <SubHeading>Minute by minute</SubHeading>
          <p className="text-sm text-muted-foreground">Per-minute averages from the start of each, on one axis: A solid, B dashed. Drag across a chart to zoom; double-click to zoom out.</p>
          <Overlays series={result.series} />
        </>
      )}
    </Section>
  )
}

type Series = NonNullable<ReturnType<typeof compare>>["series"]

const CHARTS: { key: keyof Omit<Series, "x">; title: string; unit: string; fmt?: (v: number) => string }[] = [
  { key: "frameMs", title: "Average frame", unit: "ms" },
  { key: "spikes", title: "Lag spikes", unit: "per minute", fmt: (v) => fmtNum(v, 0) },
  { key: "heap", title: "Managed heap", unit: "MB", fmt: (v) => fmtNum(v, 0) },
  { key: "entities", title: "Entities", unit: "", fmt: (v) => Math.round(v).toLocaleString() },
  { key: "cpu", title: "Server CPU", unit: "cores" },
]

function Overlays({ series }: { series: Series }) {
  const bodies = useRef<(HTMLDivElement | null)[]>([])
  const made = useRef<uPlot[]>([])
  useLayoutEffect(() => {
    const charts: uPlot[] = []
    CHARTS.forEach((c, i) => {
      const body = bodies.current[i]
      const s = series[c.key]
      if (!body || (!s.a.some((v) => v != null) && !s.b.some((v) => v != null))) return
      charts.push(Charts.minutesChart(body, {
        x: series.x, height: 160, unitShort: c.unit === "ms" || c.unit === "MB" ? c.unit : undefined, fmt: c.fmt,
        series: [{ label: "A", values: s.a, color: Charts.slot(0) }, { label: "B", values: s.b, color: Charts.slot(1), dash: [6, 3] }],
      }))
    })
    made.current = charts
    const els = bodies.current
    return () => {
      for (const u of charts) u.destroy()
      for (const body of els) body?.querySelectorAll(".chart-tip").forEach((t) => t.remove())
    }
  }, [series])
  useEffect(() => {
    const first = bodies.current.find(Boolean)
    if (!first) return
    let timer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        for (const u of made.current) {
          const w = Math.max(240, u.root.parentElement?.clientWidth || 800)
          if (Math.abs(w - u.width) > 2) u.setSize({ width: w, height: u.height })
        }
      }, 100)
    })
    ro.observe(first)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [])
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      {CHARTS.map((c, i) => (
        <figure key={c.key} className="m-0 min-w-0" aria-labelledby={`cmp-${c.key}`}>
          <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-2">
            <h4 id={`cmp-${c.key}`} className="font-sans text-base font-semibold">{c.title}</h4>
            {c.unit && <span className="text-sm text-muted-foreground">({c.unit})</span>}
          </figcaption>
          <div ref={(el) => { bodies.current[i] = el }} className="relative min-w-0" />
        </figure>
      ))}
    </div>
  )
}
