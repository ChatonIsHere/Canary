import { useMemo } from "react"
import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react"
import { overview, type Range, type Severity } from "@/lib/stats"
import * as Time from "@/lib/time"
import type { Model } from "@/lib/types"
import { Section, SubHeading } from "../Section"

// Each level has its own icon and word; the colour only repeats them.
const SEVERITY: Record<Severity, { label: string; icon: LucideIcon; color: string }> = {
  critical: { label: "Critical", icon: OctagonAlert, color: "text-status-critical" },
  serious: { label: "Serious", icon: TriangleAlert, color: "text-status-serious" },
  warning: { label: "Warning", icon: TriangleAlert, color: "text-status-warning" },
  good: { label: "Fine", icon: CircleCheck, color: "text-status-good" },
  info: { label: "Note", icon: Info, color: "text-info" },
}

export function Overview({ M, R }: { M: Model; R: Range }) {
  const { tiles, findings } = useMemo(() => overview(M, R), [M, R])
  return (
    <Section id="overview" title="Overview" sub={`${Time.fmt(R[0])} to ${Time.fmt(R[1])}, ${Time.label(R[0])}.`}>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col rounded-lg border px-4 py-3">
            <dt className="text-sm text-muted-foreground">{t.label}</dt>
            <dd className="my-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{t.value}</dd>
            {t.detail && <dd className="text-sm text-muted-foreground">{t.detail}</dd>}
          </div>
        ))}
      </dl>
      <SubHeading>Worth a look</SubHeading>
      <ul className="grid gap-2">
        {findings.map((f, i) => {
          const s = SEVERITY[f.sev]
          return (
            <li key={i} className="flex flex-col gap-1 rounded-lg border px-4 py-2.5 sm:flex-row sm:gap-3">
              <span className="flex w-24 flex-none items-center gap-1.5 text-sm font-medium">
                <s.icon aria-hidden className={`size-4 ${s.color}`} />{s.label}
              </span>
              <span>{f.text}</span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
