import type { ReactNode } from "react"

export interface Bar { label: string; value: number; title?: string }

// Horizontal bars as a list, so each reads as "name, value".
export function HBars({ items, fmt, wideLabels }: { items: Bar[]; fmt: (v: number) => string; wideLabels?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing in this time range.</p>
  const max = Math.max(...items.map((i) => i.value), 0) || 1
  return (
    <ul className="grid gap-1.5">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${fmt(i.value)}`}
          className={`grid items-center gap-2 text-sm ${wideLabels ? "grid-cols-[minmax(7rem,52%)_1fr_auto]" : "grid-cols-[minmax(6rem,34%)_1fr_auto]"}`}>
          <span className="truncate text-muted-foreground">{i.label}</span>
          <span aria-hidden className="h-2.5">
            <span className="block h-full min-w-0.5 rounded-r bg-chart-1" style={{ width: `${(i.value / max * 100).toFixed(2)}%` }} />
          </span>
          <span className="tabular-nums">{fmt(i.value)}</span>
        </li>
      ))}
    </ul>
  )
}

// Columns, one per item (the hours of a day). Below 640px only every other label shows.
export function VBars({ items, label }: { items: Bar[]; label: string }) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1
  return (
    <div role="img" aria-label={`${label}. ${items.map((i) => `${i.title || i.label}: ${i.value}`).join(", ")}`}
      className="flex h-40 items-end gap-0.5 pt-1.5">
      {items.map((i, n) => (
        <div key={i.label} title={`${i.title || i.label}: ${i.value}`} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          <div className="w-full rounded-t bg-chart-1 group-hover:outline-2 group-hover:outline-foreground" style={{ height: `${(i.value / max * 100).toFixed(1)}%` }} />
          <span className={`mt-1 text-xs text-muted-foreground tabular-nums ${n % 2 ? "invisible sm:visible" : ""}`}>{i.label}</span>
        </div>
      ))}
    </div>
  )
}

// A captioned box for one chart.
export function Figure({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="m-0 min-w-0 rounded-lg border p-4">
      <figcaption className="mb-3 text-sm text-muted-foreground">{caption}</figcaption>
      {children}
    </figure>
  )
}
