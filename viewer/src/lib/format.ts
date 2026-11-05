// For the few tooltips built as HTML strings (drawn over canvases).
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

export function fmtNum(v: number | null | undefined, digits = 2) {
  if (v == null || !isFinite(v)) return "–"
  const a = Math.abs(v)
  if (a >= 1000) return Math.round(v).toLocaleString()
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(digits)
}

export const num = fmtNum
export const int = (v: number | null | undefined) => (v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString())
export const pct = (v: number | null | undefined) => (v == null || !isFinite(v) ? "–" : `${v.toFixed(v < 10 ? 1 : 0)}%`)
