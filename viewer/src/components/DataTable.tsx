import { useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export interface Column<R> {
  key: string
  label: string
  num?: boolean
  render?: (row: R) => ReactNode
  sort?: (row: R) => number | string | null | undefined
}

type Dir = "ascending" | "descending"

// Sortable: each heading is a button; the same one again flips the order.
export function DataTable<R>({ cols, rows, sortKey, sortDir = "descending", limit = 500, caption, empty = "Nothing in this time range.", label }: {
  cols: Column<R>[]
  rows: R[]
  sortKey?: string
  sortDir?: Dir
  limit?: number
  caption?: ReactNode
  empty?: string
  label?: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: sortKey ?? cols[0].key, dir: sortDir })
  const col = cols.find((c) => c.key === sort.key) || cols[0]
  const val = (r: R) => (col.sort ? col.sort(r) : (r as Record<string, unknown>)[col.key]) as number | string | null | undefined
  const sorted = rows.slice().sort((a, b) => {
    const x = val(a), y = val(b)
    const c = x == null ? 1 : y == null ? -1 : typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)
    return sort.dir === "ascending" ? c : -c
  })
  const click = (key: string) => setSort({ key, dir: sort.key === key && sort.dir === "descending" ? "ascending" : "descending" })
  const footer = sorted.length > limit ? `First ${limit} of ${sorted.length}.` : !sorted.length ? empty : null
  return (
    <div className="rounded-lg border">
      <Table aria-label={label}>
        {caption && <TableCaption className="mt-0 border-b px-3 py-2 text-left">{caption}</TableCaption>}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {cols.map((c) => {
              const active = c.key === sort.key
              const Icon = !active ? ArrowUpDown : sort.dir === "ascending" ? ArrowUp : ArrowDown
              return (
                <TableHead key={c.key} scope="col" aria-sort={active ? sort.dir : undefined} className={cn("h-auto p-1", c.num && "text-right")}>
                  <button type="button" onClick={() => click(c.key)}
                    className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-muted", c.num && "flex-row-reverse")}>
                    {c.label}
                    <Icon aria-hidden className={cn("size-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
                  </button>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.slice(0, limit).map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c.key} className={cn("px-3 py-2 align-top", c.num ? "text-right tabular-nums" : "whitespace-normal")}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {footer && (
          <TableFooter className="bg-transparent font-normal">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={cols.length} className="px-3 py-2 whitespace-normal text-muted-foreground">{footer}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}

// Two columns of name and value, for the server's details.
export function KeyValueTable({ rows, label }: { rows: [string, ReactNode][]; label: string }) {
  return (
    <div className="rounded-lg border">
      <Table aria-label={label}>
        <TableBody>
          {rows.map(([k, v]) => (
            <TableRow key={k}>
              <TableHead scope="row" className="w-44 px-3 py-2 align-top font-normal whitespace-normal text-muted-foreground">{k}</TableHead>
              <TableCell className="px-3 py-2 break-all whitespace-normal">{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
