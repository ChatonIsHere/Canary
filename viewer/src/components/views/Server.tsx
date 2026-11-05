// What the server is, its mods, and the files that were opened.
import { useMemo } from "react"
import { int, num } from "@/lib/format"
import { mean, within, type Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { ManagedMod, Melon, Model } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { DataTable, KeyValueTable } from "../DataTable"
import { Section } from "../Section"

const muted = (s: unknown) => <span className="break-all text-muted-foreground">{String(s ?? "")}</span>

export function Server({ M }: { M: Model }) {
  const v = M.server, h = M.serverHeader
  if (!v || !h) return <Section id="server" title="Server" sub="These files don't say. Canary started recording server details in its next version." />
  const yes = (b: boolean | undefined) => (b == null ? null : b ? "yes" : "no")
  const rows = ([
    ["Name", v.name],
    ["Scene", v.scene],
    ["Game", h.game],
    ["MelonLoader", v.melonLoader],
    ["TavernLib", v.tavernLib ?? "not loaded"],
    ["TavernLauncher", v.launcher ?? "not used"],
    ["Canary", h.canary],
    ["Player limit", v.maxPlayers === 0 ? "game default" : v.maxPlayers],
    ["Password", yes(v.password)],
    ["Whitelist", yes(v.whitelist)],
    ["Community list", yes(v.communityListed)],
    ["Region", v.region],
    ["Forced GC", v.gcTimerSeconds != null ? `every ${int(v.gcTimerSeconds)} s` : null],
    ["Mods hash", v.modsHash],
    ["Couldn't read", v.errors?.join("; ")],
  ] as [string, unknown][]).filter((r) => r[1] != null && r[1] !== "").map(([k, val]) => [k, String(val)] as [string, string])
  return (
    <Section id="server" title="Server" sub={`As of ${Time.fmt(h.t)}. Settings come from TavernLib's server_settings.json.`}>
      <KeyValueTable label="Server" rows={rows} />
    </Section>
  )
}

export function Mods({ M, R }: { M: Model; R: Range }) {
  const reported = useMemo(() => {
    const samples = within(M.samples, R)
    const sections = Object.keys(M.cols.sections).map((k) => {
      const vals = samples.map((s) => s.sections?.[k] ?? 0)
      return { kind: "Section", name: k, avg: mean(vals), peak: Math.max(0, ...vals), last: null as number | null }
    })
    const metrics = Object.keys(M.cols.metrics).map((k) => {
      const vals = samples.map((s) => s.metrics?.[k]).filter((x): x is number => x != null)
      return { kind: "Metric", name: k, avg: mean(vals), peak: vals.length ? Math.max(...vals) : null, last: vals.length ? vals[vals.length - 1] : null }
    })
    return [...sections, ...metrics]
  }, [M, R])
  const melons = M.mods?.melons || M.server?.melons
  const folder = new Map((M.mods?.modsFolder || []).filter((m) => m.id).map((m) => [m.files?.find((f) => f.endsWith(".dll")), m]))
  const managed = M.server?.mods
  const untracked = (M.server?.untracked || []).map((u) => u.name)
  return (
    <Section id="mods" title="Mods" sub={"What mods reported through CanaryApi, and what was loaded." + (melons ? "" : " Open a report for the mod list.")}>
      <DataTable label="Sections and metrics from mods" rows={reported} sortKey="avg" empty="None reported." cols={[
        { key: "kind", label: "Kind" },
        { key: "name", label: "Name", render: (r) => <span className="break-all">{r.name}</span> },
        { key: "avg", label: "Average", num: true, render: (r) => (r.kind === "Section" ? `${num(r.avg)} ms/s` : num(r.avg)) },
        { key: "peak", label: "Peak", num: true, render: (r) => (r.kind === "Section" ? `${num(r.peak)} ms/s` : num(r.peak)) },
        { key: "last", label: "Last", num: true, render: (r) => (r.last == null ? "–" : num(r.last)) },
      ]} />
      {melons && (
        <DataTable<Melon> label="Loaded mods" rows={melons} sortKey="name" sortDir="ascending" caption="Loaded mods" cols={[
          { key: "name", label: "Loaded mod" },
          { key: "version", label: "Version" },
          { key: "author", label: "Author" },
          { key: "file", label: "File", render: (r) => muted(r.file) },
          ...(M.mods ? [{ key: "id", label: "Installed as", render: (r: Melon) => folder.get(r.file)?.id || "" }] : []),
        ]} />
      )}
      {managed && (
        <DataTable<ManagedMod> label="Installed by TavernLib's mod manager" rows={managed} sortKey="id" sortDir="ascending" empty="None installed."
          caption={`Installed by TavernLib's mod manager${untracked.length ? `; also loaded, but not installed by it: ${untracked.join(", ")}` : ""}`} cols={[
            { key: "id", label: "Mod" },
            { key: "version", label: "Version" },
            { key: "parity_required", label: "Clients need it", render: (r) => (r.parity_required == null ? "–" : r.parity_required ? "yes" : "no") },
            // TavernLib 1.4's records have client_side and server_side instead of targets
            { key: "targets", label: "Targets", render: (r) => (r.targets || [r.client_side && "client", r.server_side && "server"].filter(Boolean)).join(", ") },
            { key: "source_repo", label: "From", render: (r) => muted(r.source_repo) },
          ]} />
      )}
    </Section>
  )
}

export function Files({ M, R }: { M: Model; R: Range }) {
  const rows = M.files.map((f) => {
    const h = f.headers[0]
    const env = f.headers.map((x) => x.environment).find(Boolean)
    return {
      ranOn: env ? `${env.platform}${env.container ? `, ${env.container}` : ""}` : "–",
      name: f.name, kind: h?.kind ?? (f.container === "zip" ? "report" : "unknown"), part: h?.part ?? "", records: f.records.length,
      from: f.tMin, to: f.tMax, zone: h?.utcOffsetMin != null ? `${h.timeZone} (${Time.offsetText(h.utcOffsetMin)}${h.daylightSaving ? ", daylight saving" : ""})` : "not recorded",
      version: h ? `Canary ${h.canary}, game ${h.game}` : "Canary 0.1.0 (no header)", notes: f.notes.join(" "),
    }
  })
  return (
    <Section id="files" title="Files" sub="Times are stored as UTC. Server time comes from each file's header.">
      <DataTable label="Files" rows={rows} sortKey="from" sortDir="ascending" cols={[
        { key: "name", label: "File", render: (r) => <span className="whitespace-nowrap">{r.name}</span> },
        { key: "kind", label: "Kind", render: (r) => <span className="inline-flex flex-wrap items-center gap-1.5">{r.kind}{r.part !== "" && <Badge variant="outline" className="h-auto text-sm">part {r.part}</Badge>}</span> },
        { key: "records", label: "Records", num: true, render: (r) => int(r.records) },
        { key: "from", label: `From (${Time.label(R[0])})`, render: (r) => Time.fmt(r.from) },
        { key: "fromUtc", label: "From (UTC)", sort: (r) => r.from, render: (r) => (r.from ? new Date(r.from).toISOString().replace("T", " ").slice(0, 19) : "–") },
        { key: "to", label: "To", render: (r) => Time.fmt(r.to) },
        { key: "zone", label: "Server's time zone" },
        { key: "ranOn", label: "Ran on" },
        { key: "version", label: "Written by" },
        { key: "notes", label: "Notes", render: (r) => muted(r.notes) },
      ]} />
      {M.summaries.length > 0 && (
        <pre className="overflow-x-auto rounded-lg border p-3 text-sm whitespace-pre-wrap">{M.summaries.map((s) => `${s.name}\n${s.text}`).join("\n\n")}</pre>
      )}
    </Section>
  )
}
