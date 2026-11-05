import { useLayoutEffect, useMemo, useRef } from "react"
import type uPlot from "uplot"
import * as Charts from "@/lib/charts"
import { timelineItems } from "@/lib/timelineSpecs"
import type { Range } from "@/lib/stats"
import type { Model } from "@/lib/types"
import { SubHeading } from "./Section"

// Every chart, built once per model and time zone. Zoom and the crosshair are shared through lib/charts,
// outside React, so dragging doesn't re-render the page.
export function Timeline({ model, range }: { model: Model; range: Range }) {
  const items = useMemo(() => timelineItems(model), [model])
  const bodies = useRef<(HTMLDivElement | null)[]>([])
  // The zoom at the time of building; later zooms reach the charts directly.
  const startRange = useRef(range)

  useLayoutEffect(() => {
    const [a, b] = startRange.current
    Charts.setFull(model.tMin, model.tMax)
    if (a !== model.tMin || b !== model.tMax) Charts.keepZoom(a, b)
    else Charts.clearZoom()
    const made: uPlot[] = []
    const els = bodies.current
    items.forEach((it, i) => {
      const body = els[i]
      if (!body) return
      if (it.kind === "lane") made.push(Charts.eventLane(body, it.lanes))
      else if (it.kind === "chart") made.push(Charts.timeChart(body, it.cfg))
    })
    return () => {
      for (const u of made) Charts.unregister(u)
      for (const body of els) body?.querySelectorAll(".chart-tip").forEach((t) => t.remove())
    }
  }, [items, model])

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      {items.map((it, i) => {
        if (it.kind === "group")
          return (
            <div key={i} className="-mb-2">
              <SubHeading>{it.title}</SubHeading>
              {it.note && <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{it.note}</p>}
            </div>
          )
        if (it.kind === "text") return <p key={i} className="text-sm text-muted-foreground">{it.text}</p>
        const title = it.kind === "lane" ? "Events" : it.title
        const note = it.kind === "lane" ? "Hover a marker for details." : it.note
        return (
          <figure key={i} className="m-0 min-w-0" aria-labelledby={`chart-${i}`}>
            <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-2">
              <h4 id={`chart-${i}`} className="font-sans text-base font-semibold">{title}</h4>
              {it.kind === "chart" && it.unit && <span className="text-sm text-muted-foreground">({it.unit})</span>}
              {note && <span className="text-sm text-muted-foreground">{note}</span>}
            </figcaption>
            <div ref={(el) => { bodies.current[i] = el }} className="relative min-w-0" />
          </figure>
        )
      })}
    </div>
  )
}
