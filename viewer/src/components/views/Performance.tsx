// Where the time goes, lag spikes and update modules.
import { useMemo } from "react"
import { idlePhase } from "@/lib/load"
import { int, num, pct } from "@/lib/format"
import { moduleStats, PHASE_NOTES, phaseStats, spikeRows, within, type Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Figure, HBars, VBars } from "../Bars"
import { DataTable } from "../DataTable"
import { Section } from "../Section"

const muted = "text-muted-foreground"

export function Phases({ M, R }: { M: Model; R: Range }) {
  const st = useMemo(() => phaseStats(within(M.samples, R), within(M.spikes, R)), [M, R])
  const idleAvg = st.rows.filter((r) => r.idle).reduce((t, r) => t + r.avg, 0)
  const blamed = st.rows.filter((r) => r.spikeTop).sort((a, b) => b.spikeTop - a.spikeTop)
  return (
    <Section id="phases" title="Where the time goes" sub={st.seconds
      ? `Of each second, the main thread spent ${num(st.workAvg, 0)} ms working and ${num(idleAvg, 0)} ms waiting for the next frame. Waiting is idle, so the bars and shares leave it out.`
      : "No phase timings in this range."}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Figure caption="Average ms of each second, by player-loop phase">
          <HBars wideLabels items={st.rows.filter((r) => !r.idle).slice(0, 10).map((r) => ({ label: r.name, value: r.avg }))} fmt={(v) => `${num(v)} ms/s`} />
        </Figure>
        <Figure caption={`Slowest phase in each lag spike${st.spikes ? ` (${st.spikes} with timings)` : ""}`}>
          <HBars wideLabels items={blamed.slice(0, 10).map((r) => ({ label: r.name, value: r.spikeTop }))} fmt={int} />
        </Figure>
      </div>
      <DataTable label="Player-loop phases" rows={st.rows} sortKey="avg" empty="No phase timings."
        caption="The spike columns use each spike's three slowest phases." cols={[
          { key: "name", label: "Phase", render: (r) => (
            <span className="break-all"><span className={r.idle ? muted : ""}>{r.name}</span>
              {PHASE_NOTES[r.name] && <><br /><span className={muted}>{PHASE_NOTES[r.name]}</span></>}</span>) },
          { key: "avg", label: "Average ms/s", num: true, render: (r) => num(r.avg) },
          { key: "share", label: "Share of work", num: true, sort: (r) => r.share ?? -1, render: (r) => (r.idle ? <span className={muted}>idle</span> : pct(r.share)) },
          { key: "peak", label: "Worst second (ms)", num: true, render: (r) => num(r.peak) },
          { key: "spikeTop", label: "Slowest in spikes", num: true, render: (r) => int(r.spikeTop) },
          { key: "spikeMs", label: "In spikes (ms)", num: true, render: (r) => int(r.spikeMs) },
        ]} />
    </Section>
  )
}

export function Spikes({ M, R }: { M: Model; R: Range }) {
  const { spikes, rows, buckets, hours } = useMemo(() => spikeRows(M, R), [M, R])
  // Canary 0.4.0 and later say which phases each spike frame spent its time in.
  const hasPhases = M.spikes.some((s) => s.phases)
  type Row = (typeof rows)[number]
  return (
    <Section id="spikes" title="Lag spikes"
      sub={spikes.length ? `${spikes.length} frame(s) over ${M.settings.spikeMs} ms.` : `No frames over ${M.settings.spikeMs} ms.`}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Figure caption="Duration"><HBars items={buckets} fmt={int} /></Figure>
        <Figure caption={`By hour of day, ${Time.label(R[0])}`}><VBars items={hours} label="Lag spikes by hour of day" /></Figure>
      </div>
      <DataTable<Row> label="Lag spikes" rows={rows} sortKey="t" cols={[
        { key: "t", label: `Time (${Time.label(R[0])})`, render: (r) => Time.fmt(r.t) },
        { key: "ms", label: "Took", num: true, render: (r) => `${num(r.ms, 0)} ms` },
        { key: "gc", label: "GC", render: (r) => (r.gc ? "yes" : "no"), sort: (r) => (r.gc ? 1 : 0) },
        { key: "players", label: "Players", num: true },
        { key: "entities", label: "Entities", num: true, render: (r) => int(r.entities) },
        { key: "errors", label: "Errors", num: true, render: (r) => (r.errors == null ? "–" : int(r.errors)) },
        ...(hasPhases ? [{
          key: "phases", label: "Slowest phases", sort: (r: Row) => r.phases?.[0]?.[1] ?? null,
          render: (r: Row) => r.phases ? r.phases.map(([n, ms]) => (
            <span key={n} className={`block whitespace-nowrap ${idlePhase(n) ? muted : ""}`}>{n} <span className={muted}>{num(ms, 1)} ms</span></span>)) : "–",
        }] : []),
        { key: "module", label: "Busiest module", render: (r) => <span className="whitespace-nowrap">{r.module}</span> },
      ]} />
    </Section>
  )
}

export function Modules({ M, R }: { M: Model; R: Range }) {
  const stats = useMemo(() => moduleStats(M, within(M.samples, R)), [M, R])
  return (
    <Section id="modules" title="Update modules" sub="Main-thread ms per second in each of the game's update modules.">
      <Figure caption="Average ms per second">
        <HBars items={stats.map((s) => ({ label: s.name, value: s.avg }))} fmt={(v) => `${num(v)} ms/s`} />
      </Figure>
      <DataTable label="Update modules" rows={stats} sortKey="avg" empty="No module timings." cols={[
        { key: "name", label: "Module" },
        { key: "avg", label: "Average ms/s", num: true, render: (r) => num(r.avg) },
        { key: "peak", label: "Worst second (ms)", num: true, render: (r) => num(r.peak) },
        { key: "share", label: "Share of module time", num: true, render: (r) => pct(r.share) },
      ]} />
    </Section>
  )
}
