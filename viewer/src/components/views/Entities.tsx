// Entities and errors.
import { useMemo } from "react"
import { int, num } from "@/lib/format"
import { entityRows, within, type Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Figure, HBars } from "../Bars"
import { DataTable } from "../DataTable"
import { Section, SubHeading } from "../Section"

const signed = (v: number) => (v > 0 ? "+" : "") + int(v)

export function Entities({ M, R }: { M: Model; R: Range }) {
  const e = useMemo(() => entityRows(M, R), [M, R])
  if (!e) return <Section id="entities" title="Entities" sub="No entity counts in this range." />
  return (
    <Section id="entities" title="Entities" sub={`${e.census.length} count(s), ${num(e.avgMs)} ms each on average.`}>
      <SubHeading>By type</SubHeading>
      <DataTable label="Entities by type" rows={e.types} sortKey="change" cols={[
        { key: "name", label: "Type", render: (r) => <span className="break-all">{r.name}</span> },
        { key: "first", label: "At start", num: true, render: (r) => int(r.first) },
        { key: "last", label: "At end", num: true, render: (r) => int(r.last) },
        { key: "change", label: "Change", num: true, render: (r) => signed(r.change) },
        { key: "perHour", label: "Per hour", num: true, render: (r) => (r.perHour == null ? "–" : signed(r.perHour)) },
        { key: "peak", label: "Peak", num: true, render: (r) => int(r.peak) },
      ]} />
      <SubHeading>By chunk</SubHeading>
      <DataTable label="Entities by chunk" rows={e.chunks} sortKey="last" caption="The 25 busiest chunks." cols={[
        { key: "name", label: "Chunk" },
        { key: "first", label: "At start", num: true, render: (r) => int(r.first) },
        { key: "last", label: "At end", num: true, render: (r) => int(r.last) },
        { key: "change", label: "Change", num: true, render: (r) => signed(r.change) },
      ]} />
    </Section>
  )
}

export function Errors({ M, R }: { M: Model; R: Range }) {
  const { errors, total, byMod, rows } = useMemo(() => {
    const errors = within(M.errors, R)
    const groups = new Map(M.errorGroups.map((g) => [g.Id, g]))
    const byMod: Record<string, number> = {}
    for (const e of errors) byMod[e.mod || "unknown"] = (byMod[e.mod || "unknown"] || 0) + 1
    return {
      errors, groups,
      total: within(M.samples, R).reduce((n, s) => n + (s.errors || 0), 0),
      byMod: Object.entries(byMod).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
      rows: errors.map((e) => ({ ...e, g: groups.get(e.id) })),
    }
  }, [M, R])
  return (
    <Section id="errors" title="Errors" sub={`${errors.length} new kind(s), ${int(total)} in all.`
      + (M.errorGroups.length ? " Counts cover the whole report." : " Open a report for counts and stack traces.")}>
      <Figure caption="New kinds of error, by source"><HBars items={byMod} fmt={int} /></Figure>
      <DataTable label="Errors" rows={rows} sortKey="t" cols={[
        { key: "t", label: `First seen (${Time.label(R[0])})`, render: (r) => Time.fmt(r.t) },
        { key: "level", label: "Level" },
        { key: "mod", label: "From" },
        { key: "logger", label: "Logger", render: (r) => <span className="text-muted-foreground">{r.logger}</span> },
        { key: "count", label: "Times", num: true, sort: (r) => r.g?.Count ?? -1, render: (r) => (r.g ? int(r.g.Count) : "–") },
        { key: "message", label: "Message", render: (r) => {
          const first = String(r.message).split("\n")[0]
          return r.g?.Stack ? (
            <details>
              <summary className="cursor-pointer rounded-sm">{first}</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-2.5 text-sm whitespace-pre-wrap">{r.g.Stack}</pre>
            </details>
          ) : <span className="break-words">{first}</span>
        } },
      ]} />
    </Section>
  )
}
