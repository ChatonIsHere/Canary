// Time zones. Canary stores every time as UTC milliseconds; each file's header records the server's UTC
// offset and zone when it was written. The page can show times in three zones, and every time it shows is
// formatted through here so the chosen zone is applied (and named) consistently.
"use strict";

const Time = (() => {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "your browser's zone";
  let mode = "browser"; // "browser" | "server" | "utc"
  let headers = [];     // header records, sorted by t

  const pad = (n, w = 2) => String(n).padStart(w, "0");

  function offsetText(minutes) {
    const sign = minutes < 0 ? "-" : "+";
    const m = Math.abs(minutes);
    return `UTC${sign}${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }

  const browserOffsetAt = ms => -new Date(ms).getTimezoneOffset();

  // The header in force at a moment: the latest one written at or before it (a recording that crosses a
  // daylight saving change has a new header in each part), else the earliest.
  function headerAt(ms) {
    if (!headers.length) return null;
    let found = headers[0];
    for (const h of headers) { if (h.t <= ms) found = h; else break; }
    return found;
  }

  const hasServerZone = () => headers.some(h => typeof h.utcOffsetMin === "number");
  const serverOffsetAt = ms => headerAt(ms)?.utcOffsetMin ?? 0;

  function offsetAt(ms) {
    if (mode === "utc") return 0;
    if (mode === "server") return serverOffsetAt(ms);
    return browserOffsetAt(ms);
  }

  // Calendar fields of a moment in the chosen zone.
  function parts(ms) {
    const d = new Date(ms + offsetAt(ms) * 60000);
    return {
      Y: d.getUTCFullYear(), M: d.getUTCMonth(), D: d.getUTCDate(),
      h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(),
    };
  }

  function fmt(ms, style = "datetime") {
    if (ms == null || !isFinite(ms)) return "–";
    const p = parts(ms);
    const date = `${p.Y}-${pad(p.M + 1)}-${pad(p.D)}`;
    const time = `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}`;
    if (style === "time") return time;
    if (style === "short") return `${pad(p.h)}:${pad(p.m)}`;
    if (style === "date") return date;
    return `${date} ${time}`;
  }

  // "your time (Europe/London, UTC+00:00)"
  function label(ms = Date.now()) {
    if (mode === "utc") return "UTC";
    if (mode === "server") {
      const h = headerAt(ms);
      return `server time (${h?.timeZone ?? "unknown zone"}, ${offsetText(serverOffsetAt(ms))})`;
    }
    return `your time (${browserZone}, ${offsetText(browserOffsetAt(ms))})`;
  }

  // For uPlot: a Date whose local fields read as the chosen zone.
  function chartDate(seconds) {
    const p = parts(seconds * 1000);
    return new Date(p.Y, p.M, p.D, p.h, p.m, p.s, p.ms);
  }

  function duration(ms) {
    if (!isFinite(ms)) return "–";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${pad(s % 60)} s`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h ${pad(m % 60)} min`;
    return `${Math.floor(h / 24)} days ${h % 24} h`;
  }

  return {
    browserZone, offsetText, browserOffsetAt, serverOffsetAt, headerAt, hasServerZone,
    fmt, label, chartDate, duration, parts,
    get mode() { return mode; },
    set mode(m) { mode = m; },
    setHeaders(list) { headers = list.slice().sort((a, b) => a.t - b.t); },
  };
})();
