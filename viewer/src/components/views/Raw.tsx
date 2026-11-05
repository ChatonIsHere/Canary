import { useMemo, useState } from "react"
import { int } from "@/lib/format"
import type { Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section } from "../Section"

export function Raw({ M, R }: { M: Model; R: Range }) {
  const types = useMemo(() => ["all", ...new Set(M.all.map((r) => r.type))], [M])
  const [type, setType] = useState("all")
  const [filter, setFilter] = useState("")
  // Back to the first 200 whenever what's listed changes.
  const listKey = `${R[0]}|${R[1]}|${type}|${filter}|${Time.getMode()}`
  const [more, setMore] = useState({ key: "", n: 200 })
  const shown = more.key === listKey ? more.n : 200
  const { lines, matched } = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const lines: { t: number; json: string }[] = []
    let matched = 0
    for (const r of M.all) {
      if (!(type === "all" || r.type === type) || !(r.type === "header" || (r.t >= R[0] && r.t <= R[1]))) continue
      const json = JSON.stringify(r)
      if (f && !json.toLowerCase().includes(f)) continue
      matched++
      if (lines.length < shown) lines.push({ t: r.t, json })
    }
    return { lines, matched }
  }, [M, R, type, filter, shown])

  return (
    <Section id="raw" title="Raw records">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="raw-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="raw-type" className="min-w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="raw-filter">Contains</Label>
          <Input id="raw-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <p className="pb-1 text-sm text-muted-foreground" aria-live="polite">{int(matched)} record(s), {Time.label(R[0])}</p>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-lg border px-3 py-2 font-mono text-sm" tabIndex={0} aria-label="Raw records">
        {lines.length ? lines.map((l, i) => (
          <div key={i} className="border-b py-1 break-all whitespace-pre-wrap last:border-b-0">
            <span className="text-muted-foreground">{Time.fmt(l.t)}</span> {l.json}
          </div>
        )) : <div className="text-muted-foreground">No records match.</div>}
      </div>
      {matched > shown && (
        <div><Button variant="outline" onClick={() => setMore({ key: listKey, n: shown + 500 })}>Show more</Button></div>
      )}
    </Section>
  )
}
