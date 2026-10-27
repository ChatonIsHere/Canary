// uPlot charts sharing one zoom, crosshair and time zone. One y axis each.
"use strict";

const Charts = (() => {
  const all = [];
  let syncing = false;
  let onZoom = () => {};
  let onCursor = () => {};
  let full = [0, 1];
  let current = null;

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const slot = i => css(`--s${i + 1}`);
  const colors = () => ({ ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted-foreground"), grid: css("--grid"), axis: css("--axis"), surface: css("--surface") });

  function fmtNum(v, digits = 2) {
    if (v == null || !isFinite(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString();
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(digits);
  }

  // 24-hour ticks, with the date on the first and wherever the day changes.
  function timeTicks(u, splits, axisIdx, space, incr) {
    return splits.map((s, i) => {
      const ms = s * 1000;
      const time = Time.fmt(ms, incr < 60 ? "time" : "short");
      const day = Time.fmt(ms, "date");
      return i === 0 || day !== Time.fmt(splits[i - 1] * 1000, "date") ? `${time}
${day}` : time;
    });
  }

  function axes(unit, c, valueFmt) {
    return [
      {
        stroke: c.muted, grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.axis, width: 1 },
        font: "11px system-ui, sans-serif", values: timeTicks,
      },
      {
        stroke: c.muted, grid: { stroke: c.grid, width: 1 }, ticks: { show: false }, size: 56,
        font: "11px system-ui, sans-serif",
        values: (u, vals) => vals.map(v => valueFmt ? valueFmt(v) : fmtNum(v, 1)),
      },
    ];
  }

  function syncHooks() {
    return {
      setScale: [(u, key) => {
        if (key !== "x" || syncing) return;
        const { min, max } = u.scales.x;
        if (min == null || max == null) return;
        syncing = true;
        current = [min, max];
        for (const o of all) if (o !== u && o.scales.x.min !== min) o.setScale("x", { min, max });
        syncing = false;
        onZoom(min * 1000, max * 1000);
      }],
      setCursor: [u => {
        const idx = u.cursor.idx;
        const left = u.cursor.left;
        if (left == null || left < 0) { onCursor(null); return; }
        onCursor(u.posToVal(left, "x") * 1000, idx);
      }],
    };
  }

  function baseOpts(width, height, c) {
    return {
      width, height,
      tzDate: ts => Time.chartDate(ts),
      cursor: {
        sync: { key: "canary", setSeries: false },
        drag: { x: true, y: false, setScale: true },
        points: { size: 7, width: 2 },
        bind: { dblclick: () => () => { resetZoom(); return null; } },
      },
      scales: { x: { time: true } },
      legend: { live: true },
      hooks: syncHooks(),
    };
  }

  // series: [{ label, values, color, width, bars, dash, fmt }]
  function timeChart(container, cfg) {
    const c = colors();
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = `<div class="chart-head"><span class="chart-title"></span><span class="chart-unit"></span><span class="chart-note"></span></div><div class="chart-body"></div>`;
    wrap.querySelector(".chart-title").textContent = cfg.title;
    wrap.querySelector(".chart-unit").textContent = cfg.unit ? `(${cfg.unit})` : "";
    wrap.querySelector(".chart-note").textContent = cfg.note || "";
    container.appendChild(wrap);
    const body = wrap.querySelector(".chart-body");
    const width = Math.max(300, body.clientWidth || container.clientWidth || 800);
    const valFmt = cfg.fmt || (v => fmtNum(v));
    const opts = baseOpts(width, cfg.height || 170, c);
    opts.axes = axes(cfg.unit, c, cfg.axisFmt);
    if (cfg.log) {
      // Frames run from 10 ms to seconds.
      opts.scales.y = { distr: 3, log: 10 };
    } else {
      // yMin: null fits the data; otherwise the axis starts at zero.
      opts.scales.y = {
        range: (u, min, max) => {
          if (min == null || max == null) return [0, 1];
          if (cfg.yMin === null) {
            const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.01, 1);
            return [min - pad, max + pad];
          }
          return [Math.min(cfg.yMin ?? 0, min), max > 0 ? max * 1.08 : 1];
        },
      };
    }
    opts.series = [
      { label: "Time", value: (u, v) => v == null ? "–" : Time.fmt(v * 1000) },
      ...cfg.series.map(s => ({
        label: s.label,
        stroke: s.color,
        width: s.width ?? (s.bars ? 0 : 1.5),
        fill: s.bars ? s.color : undefined,
        dash: s.dash,
        paths: s.bars ? uPlot.paths.bars({ size: [0.9, 8], align: 1 }) : (s.step ? uPlot.paths.stepped({ align: 1 }) : undefined),
        points: { show: false },
        spanGaps: false,
        value: (u, v) => v == null ? "–" : `${(s.fmt || valFmt)(v)}${cfg.unitShort ? " " + cfg.unitShort : ""}`,
      })),
    ];
    if (cfg.threshold != null) {
      opts.hooks.draw = [u => {
        const y = u.valToPos(cfg.threshold, "y", true);
        if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
        const ctx = u.ctx;
        ctx.save();
        ctx.strokeStyle = css("--critical");
        ctx.lineWidth = 1 * devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y);
        ctx.stroke();
        ctx.fillStyle = c.ink2;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`;
        ctx.fillText(cfg.thresholdLabel || "", u.bbox.left + 6 * devicePixelRatio, y - 4 * devicePixelRatio);
        ctx.restore();
      }];
    }
    const data = [cfg.x, ...cfg.series.map(s => s.values)];
    const u = new uPlot(opts, data, body);
    u._canary = { body };
    register(u);
    return u;
  }

  // Spikes, GCs, new errors, marks, entity counts and gaps, on the shared time axis.
  function eventLane(container, lanes, tip) {
    const c = colors();
    const rowH = 22;
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = `<div class="chart-head"><span class="chart-title">Events</span><span class="chart-note">Hover a marker for details.</span></div><div class="chart-body"></div>`;
    container.appendChild(wrap);
    const body = wrap.querySelector(".chart-body");
    const width = Math.max(300, body.clientWidth || 800);
    const opts = baseOpts(width, lanes.length * rowH + 40, c);
    opts.legend = { show: false };
    opts.axes = [
      axes("", c)[0],
      { show: true, size: 110, stroke: c.ink2, grid: { show: false }, ticks: { show: false }, font: "11px system-ui, sans-serif",
        splits: () => lanes.map((_, i) => i + 0.5), values: (u, splits) => splits.map(s => lanes[lanes.length - 1 - Math.floor(s)].label) },
    ];
    // Rows count up from the bottom, so the first lane is the top one.
    opts.scales.y = { range: () => [0, lanes.length] };
    opts.series = [{}, { label: "", points: { show: false }, stroke: "transparent" }];
    const drawn = [];
    opts.hooks.draw = [u => {
      const ctx = u.ctx;
      const dpr = devicePixelRatio;
      const [xmin, xmax] = [u.scales.x.min, u.scales.x.max];
      drawn.length = 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
      ctx.clip();
      lanes.forEach((lane, idx) => {
        const row = lanes.length - 1 - idx;
        const yTop = u.valToPos(row + 1, "y", true), yBot = u.valToPos(row, "y", true);
        const mid = (yTop + yBot) / 2;
        ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(u.bbox.left, yBot); ctx.lineTo(u.bbox.left + u.bbox.width, yBot); ctx.stroke();
        for (const ev of lane.events) {
          const t1 = ev.t / 1000, t2 = (ev.t2 ?? ev.t) / 1000;
          if (t2 < xmin || t1 > xmax) continue;
          const x1 = u.valToPos(t1, "x", true), x2 = u.valToPos(t2, "x", true);
          ctx.fillStyle = ev.color || lane.color;
          if (ev.t2 != null) {
            ctx.globalAlpha = 0.35;
            ctx.fillRect(x1, yTop + 3 * dpr, Math.max(2 * dpr, x2 - x1), (yBot - yTop) - 6 * dpr);
            ctx.globalAlpha = 1;
          } else if (lane.shape === "tick") {
            ctx.fillRect(x1 - 0.5 * dpr, yTop + 5 * dpr, 1.5 * dpr, (yBot - yTop) - 10 * dpr);
          } else {
            const r = (ev.size || 4) * dpr;
            ctx.beginPath(); ctx.arc(x1, mid, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = c.surface; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
          }
          drawn.push({ x1: x1 / dpr, x2: x2 / dpr, idx, ev, lane });
        }
      });
      ctx.restore();
    }];
    opts.hooks.setCursor.push(u => {
      const left = u.cursor.left, top = u.cursor.top;
      if (left == null || left < 0) { tip.hidden = true; return; }
      const idx = lanes.length - 1 - Math.floor(u.posToVal(top, "y"));
      let best = null, bestD = 8;
      for (const d of drawn) {
        if (d.idx !== idx) continue;
        const dist = d.ev.t2 != null ? (left >= d.x1 && left <= d.x2 ? 0 : 99) : Math.abs(d.x1 - left);
        if (dist <= bestD) { best = d; bestD = dist; }
      }
      if (!best) { tip.hidden = true; return; }
      tip.innerHTML = best.lane.describe(best.ev);
      const rect = u.over.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${Math.min(window.innerWidth - 370, rect.left + left + 12)}px`;
      tip.style.top = `${rect.top + top + 14}px`;
    });
    const u = new uPlot(opts, [[full[0], full[1]], [null, null]], body);
    u.over.addEventListener("mouseleave", () => { tip.hidden = true; });
    register(u);
    return u;
  }

  function register(u) {
    all.push(u);
    const range = current || full;
    syncing = true;
    u.setScale("x", { min: range[0], max: range[1] });
    syncing = false;
  }

  function resetZoom() {
    current = null;
    syncing = true;
    for (const u of all) u.setScale("x", { min: full[0], max: full[1] });
    syncing = false;
    onZoom(full[0] * 1000, full[1] * 1000);
  }

  function setRange(minMs, maxMs) {
    current = [minMs / 1000, maxMs / 1000];
    syncing = true;
    for (const u of all) u.setScale("x", { min: current[0], max: current[1] });
    syncing = false;
    onZoom(minMs, maxMs);
  }

  function destroyAll() {
    while (all.length) all.pop().destroy();
  }

  function resize() {
    for (const u of all) {
      const body = u.root.parentElement;
      const w = Math.max(300, body.clientWidth);
      if (Math.abs(w - u.width) > 2) u.setSize({ width: w, height: u.height });
    }
  }

  return {
    timeChart, eventLane, resetZoom, setRange, destroyAll, resize, fmtNum, slot, css,
    setFull(minMs, maxMs) { full = [minMs / 1000, maxMs / 1000]; },
    keepZoom(minMs, maxMs) { current = [minMs / 1000, maxMs / 1000]; },
    clearZoom() { current = null; },
    set onZoom(f) { onZoom = f; },
    set onCursor(f) { onCursor = f; },
  };
})();
