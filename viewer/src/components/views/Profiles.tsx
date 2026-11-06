// 'canary profile' results: scripts and mod patches, slowest first.
import { useMemo, useState } from "react"
import { int, num } from "@/lib/format"
import { within, type Range } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Figure, HBars } from "../Bars"
import { DataTable } from "../DataTable"
import { Section } from "../Section"

const KINDS: Record<string, string> = {
  update: "Update", fixedUpdate: "FixedUpdate", lateUpdate: "LateUpdate", collision: "Collision callback",
  trigger: "Trigger callback", method: "Method", prefix: "Mod prefix", postfix: "Mod postfix", finalizer: "Mod finalizer", transpiled: "Transpiled by a mod",
}

export function Profiles({ M, R }: { M: Model; R: Range }) {
  const profiles = useMemo(() => within(M.profiles, R).slice().reverse(), [M, R])
  const [pick, setPick] = useState(0)
  const p = profiles[Math.min(pick, profiles.length - 1)]
  const rows = useMemo(() => {
    if (!p) return []
    const s = Math.max(1, p.seconds)
    return (p.entries || []).map((e) => ({
      ...e, kindLabel: KINDS[e.kind] || e.kind, perSecond: e.ms / s, mainPerSecond: e.mainMs == null ? null : e.mainMs / s, perFrame: p.frames ? e.ms / p.frames : null,
      callsPerSecond: e.calls / s, usPerCall: e.calls ? (e.ms * 1000) / e.calls : null,
    }))
  }, [p])
  if (!p) return null
  const s = Math.max(1, p.seconds)
  const mods = Object.entries(p.byMod || {}).filter(([m]) => m !== "game").sort((a, b) => b[1] - a[1]).map(([label, ms]) => ({ label, value: ms / s }))
  const byKind = Object.entries(rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kindLabel]: (acc[r.kindLabel] || 0) + r.perSecond }), {}))
    .sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  return (
    <Section id="profile" title="Profile" sub={<>
      From <code>canary profile start</code>: each script's updates and physics callbacks, and each mod's patches, timed for{" "}
      {Time.duration(p.seconds * 1000)} ({int(p.frames)} frames, {int(p.methods)} methods{p.pattern ? <> matching <code>{p.pattern}</code></> : null}).
      Times include anything a method calls, so a game method's time includes mod patches on it
      {p.overheadUs ? `; the profiler's own ${num(p.overheadUs)} µs per call is already taken off` : ""}.
    </>}>
      {profiles.length > 1 && (
        <div className="grid max-w-md gap-1.5">
          <Label htmlFor="profile-pick">Profile</Label>
          <Select value={String(pick)} onValueChange={(v) => setPick(Number(v))}>
            <SelectTrigger id="profile-pick"><SelectValue /></SelectTrigger>
            <SelectContent>
              {profiles.map((x, i) => <SelectItem key={x.t} value={String(i)}>Ended {Time.fmt(x.t)} ({Time.duration(x.seconds * 1000)})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Figure caption="By kind, ms per second"><HBars items={byKind} fmt={(v) => num(v)} /></Figure>
        <Figure caption="Mod patches and scripts, by mod, ms per second"><HBars items={mods} fmt={(v) => num(v)} /></Figure>
      </div>
      <DataTable label="Profiled methods" rows={rows} sortKey="perSecond" caption={`The ${rows.length} slowest methods.`} cols={[
        { key: "name", label: "Method", render: (r) => <span className="break-all">{r.name}</span> },
        { key: "kindLabel", label: "Kind" },
        { key: "mod", label: "From" },
        { key: "perSecond", label: "ms/s", num: true, render: (r) => num(r.perSecond) },
        { key: "mainPerSecond", label: "Main thread ms/s", num: true, render: (r) => num(r.mainPerSecond) },
        { key: "perFrame", label: "ms/frame", num: true, render: (r) => num(r.perFrame, 3) },
        { key: "callsPerSecond", label: "Calls/s", num: true, render: (r) => (r.callsPerSecond < 10 ? num(r.callsPerSecond, 1) : int(r.callsPerSecond)) },
        { key: "usPerCall", label: "µs/call", num: true, render: (r) => num(r.usPerCall, 1) },
      ]} />
    </Section>
  )
}
