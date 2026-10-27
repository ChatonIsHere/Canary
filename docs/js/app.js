"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  };
  const TOP = 7; // series per chart; the rest fold into "Other"

  let M = null;
  let range = [0, 0];

  // Theme
  const themes = ["system", "light", "dark"];
  let theme = store.get("canary-theme") || "system";
  function applyTheme() {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $("theme-btn").textContent = `Theme: ${theme}`;
  }
  applyTheme();
  $("theme-btn").addEventListener("click", () => {
    theme = themes[(themes.indexOf(theme) + 1) % themes.length];
    store.set("canary-theme", theme);
    applyTheme();
    if (M) rebuild();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (M && theme === "system") rebuild(); });

  // Time zone
  function tzOptions() {
    const now = M?.tMax ?? Date.now();
    const sel = $("tz-select");
    const server = M && Time.hasServerZone();
    const h = M ? Time.headerAt(now) : null;
    sel.innerHTML = [
      `<option value="browser">Your time: ${esc(Time.browserZone)} (${Time.offsetText(Time.browserOffsetAt(now))})</option>`,
      `<option value="server" ${server ? "" : "disabled"}>Server time: ${server ? `${esc(h.timeZone)} (${Time.offsetText(h.utcOffsetMin)})` : "not in these files"}</option>`,
      `<option value="utc">UTC</option>`,
    ].join("");
    if (Time.mode === "server" && !server) Time.mode = "browser";
    sel.value = Time.mode;
  }
  Time.mode = store.get("canary-tz") || "browser";
  tzOptions();
  $("tz-select").addEventListener("change", e => {
    Time.mode = e.target.value;
    store.set("canary-tz", Time.mode);
    if (M) rebuild();
  });

  function tzBanner() {
    const el = $("tz-banner");
    const at = M.tMax;
    const lines = [`Times are in <strong>${esc(Time.label(at))}</strong>.`];
    if (Time.hasServerZone()) {
      const offsets = [...new Set(M.headers.filter(h => h.utcOffsetMin != null).map(h => h.utcOffsetMin))];
      const h = Time.headerAt(at);
      const diff = h.utcOffsetMin - Time.browserOffsetAt(at);
      const rel = diff === 0 ? "the same as yours" : `${Time.duration(Math.abs(diff) * 60000).replace(" 00 min", "")} ${diff > 0 ? "ahead of" : "behind"} yours`;
      lines.push(`The server was on <strong>${esc(h.timeZone)}</strong> (${Time.offsetText(h.utcOffsetMin)}${h.daylightSaving ? ", daylight saving" : ""}), ${rel}.`);
      if (offsets.length > 1) lines.push(`Its offset changed during this data (${offsets.map(Time.offsetText).join(" → ")}).`);
      if (M.environment?.container) lines.push(`It ran in ${esc(M.environment.container)} on ${esc(M.environment.platform)}; containers are on UTC unless <code>TZ</code> is set.`);
      lines.push(`File names are UTC; the server console prints server time.`);
    } else {
      lines.push("These files predate time zone headers, so server time isn't available.");
    }
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join("");
    el.hidden = false;
  }

  // Loading
  async function open(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const parsed = [];
    for (const f of files) {
      try { parsed.push(await Load.readFile(f)); }
      catch (e) { parsed.push({ name: f.name, size: f.size, records: [], notes: [`Couldn't read: ${e.message}`], extras: {} }); }
    }
    show(parsed);
  }

  function show(parsed) {
    const model = Load.build(parsed);
    const notes = parsed.filter(p => p.notes.length).map(p => `<li><strong>${esc(p.name)}</strong>: ${esc(p.notes.join(" "))}</li>`);
    $("load-notes").innerHTML = notes.length ? `<ul>${notes.join("")}</ul>` : "";
    $("load-notes").hidden = !notes.length;
    if (model.tMin == null) {
      $("load-notes").hidden = false;
      $("load-notes").innerHTML = `No Canary records in ${parsed.map(p => esc(p.name)).join(", ")}.${notes.length ? `<ul>${notes.join("")}</ul>` : ""}`;
      return;
    }
    M = model;
    Time.setHeaders(M.headers);
    Views.model = M;
    range = [M.tMin, M.tMax];
    Charts.clearZoom();
    document.title = `${parsed.length === 1 ? parsed[0].name : `${parsed.length} files`} · Canary Viewer`;
    $("welcome").hidden = true;
    for (const id of ["overview", "timeline", "spikes", "players", "entities", "errors", "modules", "mods", "files", "raw", "nav", "range-row"]) $(id).hidden = false;
    Views.initRaw();
    rebuild();
  }

  $("file-input").addEventListener("change", e => { open(e.target.files); e.target.value = ""; });
  let dragDepth = 0;
  addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
  addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging"); open(e.dataTransfer.files); });

  // Timeline
  function rebuild() {
    tzOptions();
    tzBanner();
    const zoomed = range[0] !== M.tMin || range[1] !== M.tMax;
    Charts.destroyAll();
    Charts.setFull(M.tMin, M.tMax);
    if (zoomed) Charts.keepZoom(range[0], range[1]);
    $("charts").innerHTML = "";
    buildCharts();
    Views.setRange(range[0], range[1]);
    Views.renderAll();
    rangeText();
  }

  function topSeries(map, unitFmt) {
    const names = Object.keys(map);
    const total = n => map[n].reduce((s, v) => s + (v || 0), 0);
    names.sort((a, b) => total(b) - total(a));
    const keep = names.slice(0, TOP), rest = names.slice(TOP);
    const series = keep.map((n, i) => ({ label: n, values: map[n], color: Charts.slot(i), fmt: unitFmt }));
    if (rest.length) {
      const len = map[rest[0]].length;
      const other = Array.from({ length: len }, (_, i) => rest.some(n => map[n][i] != null) ? rest.reduce((s, n) => s + (map[n][i] || 0), 0) : null);
      series.push({ label: `Other (${rest.length})`, values: other, color: Charts.css("--other"), fmt: unitFmt });
    }
    return series;
  }

  function group(title, note) {
    const h = document.createElement("h3");
    h.textContent = title;
    $("charts").appendChild(h);
    if (note) {
      const p = document.createElement("p");
      p.className = "panel-sub"; p.textContent = note;
      $("charts").appendChild(p);
    }
    return $("charts");
  }

  function buildCharts() {
    const c = M.cols, r = M.res, s = Charts.slot, el = $("charts");
    const critical = Charts.css("--critical"), serious = Charts.css("--serious"), warning = Charts.css("--warning"), muted = Charts.css("--muted-foreground");

    Charts.eventLane(el, [
      { label: "Lag spikes", color: critical, events: M.spikes.map(x => ({ t: x.t, size: 3 + Math.min(6, x.ms / 300), d: x })),
        describe: e => `<strong>Lag spike: ${Charts.fmtNum(e.d.ms, 0)} ms</strong><br>${esc(Time.fmt(e.t))}<br>${e.d.gc ? "GC ran. " : ""}${e.d.players} player(s), ${e.d.entities.toLocaleString()} entities` },
      { label: "Garbage collection", color: warning, shape: "tick", events: M.samples.filter(x => x.gc && x.gc[0] > 0).map(x => ({ t: x.t, d: x })),
        describe: e => `<strong>Garbage collection</strong><br>${esc(Time.fmt(e.t))}<br>slowest frame ${Charts.fmtNum(e.d.maxMs)} ms, heap ${Charts.fmtNum(e.d.heapMb, 0)} MB after` },
      { label: "New errors", color: serious, events: M.errors.map(x => ({ t: x.t, d: x })),
        describe: e => `<strong>${esc(e.d.level)} from ${esc(e.d.mod)}</strong><br>${esc(Time.fmt(e.t))}<br>${esc(String(e.d.message).split("\n")[0].slice(0, 200))}` },
      { label: "Marks", color: s(0), events: M.marks.map(x => ({ t: x.t, d: x })),
        describe: e => `<strong>Mark</strong><br>${esc(Time.fmt(e.t))}<br>${esc(e.d.text)}` },
      { label: "Entity counts", color: muted, shape: "tick", events: M.census.map(x => ({ t: x.t, d: x })),
        describe: e => `<strong>Entity count: ${e.d.total.toLocaleString()}</strong><br>${esc(Time.fmt(e.t))}<br>took ${Charts.fmtNum(e.d.durationMs)} ms` },
      { label: "No data", color: muted, events: M.gaps.map(g => ({ t: g.from, t2: g.to, d: g })),
        describe: e => `<strong>No data for ${esc(Time.duration(e.d.to - e.d.from))}</strong><br>${esc(Time.fmt(e.d.from))} to ${esc(Time.fmt(e.d.to))}<br>Server down, or no file covers it.` },
    ], $("lane-tip"));

    if (c.t.length) {
      group("Performance");
      Charts.timeChart(el, {
        title: "Frame time", unit: "ms, log scale", unitShort: "ms", note: "Per second: average, p95 and slowest frame.",
        x: c.t, threshold: M.settings.spikeMs, thresholdLabel: `spike ${M.settings.spikeMs} ms`, height: 210, log: true,
        // Slowest first, so the average draws on top.
        series: [
          { label: "Slowest", values: c.max, color: s(2) },
          { label: "95th percentile", values: c.p95, color: s(1) },
          { label: "Average", values: c.avg, color: s(0) },
        ],
      });
      Charts.timeChart(el, { title: "Frames per second", x: c.t, series: [{ label: "Frames", values: c.frames, color: s(0) }], height: 140, fmt: v => Charts.fmtNum(v, 0) });
      if (Object.keys(c.modules).length)
        Charts.timeChart(el, { title: "Update modules", unit: "ms per second", unitShort: "ms/s", x: c.t, series: topSeries(c.modules), height: 200 });

      group("Memory");
      Charts.timeChart(el, {
        title: "Memory", unit: "MB", unitShort: "MB", note: "Low points that keep rising mean something's holding on to memory.",
        x: c.t, series: [{ label: "Managed heap", values: c.heap, color: s(0) }, ...(c.mem.some(v => v) ? [{ label: "Process (working set)", values: c.mem, color: s(1) }] : [])],
      });
      Charts.timeChart(el, { title: "Garbage collections", unit: "per second", x: c.t, series: [{ label: "Collections", values: c.gc, color: s(0), bars: true }], height: 110, fmt: v => Charts.fmtNum(v, 0) });

      group("World");
      Charts.timeChart(el, { title: "Players online", x: c.t, series: [{ label: "Players", values: c.players, color: s(0), step: true }], height: 120, fmt: v => Charts.fmtNum(v, 0) });
      Charts.timeChart(el, { title: "Entities", x: c.t, series: [{ label: "Entities", values: c.entities, color: s(0) }], height: 140, fmt: v => Math.round(v).toLocaleString(), yMin: null });
      if (M.census.length > 1) {
        const ct = M.census.map(x => x.t / 1000);
        const map = {};
        for (const rec of M.census) for (const k of Object.keys(rec.byPrefab || {})) if (!k.startsWith("(")) map[k] = [];
        for (const rec of M.census) for (const k of Object.keys(map)) map[k].push(rec.byPrefab?.[k] ?? 0);
        if (Object.keys(map).length)
          Charts.timeChart(el, { title: "Spawned entities by type", note: "Scene-placed objects left out.", x: ct, series: topSeries(map, v => Math.round(v).toLocaleString()), height: 200 });
      }
      Charts.timeChart(el, { title: "Errors and warnings", unit: "per second", x: c.t, series: [{ label: "Errors", values: c.errors, color: s(0), bars: true }], height: 110, fmt: v => Charts.fmtNum(v, 0) });
    }

    if (r.t.length) {
      const host = M.inContainer ? "host" : "machine";
      group("Resources", `Every ${M.settings.resourceSeconds} s. CPU % is of the whole ${host}.` + (M.inContainer ? ` "Host" is the machine the container runs on.` : ""));
      if (r.hasContainer) {
        const limit = r.cLimit.find(v => v != null);
        const memLimit = r.cMemLimit.find(v => v != null);
        Charts.timeChart(el, {
          title: "Container CPU", unit: "cores busy", x: r.t, height: 160,
          note: limit ? "" : "No CPU limit set.",
          threshold: limit ?? undefined, thresholdLabel: limit ? `limit ${Charts.fmtNum(limit)} cores` : "",
          series: [{ label: "Container", values: r.cCores, color: s(0) }, { label: "Server process", values: r.cpuCores, color: s(1) }],
        });
        if (limit) Charts.timeChart(el, {
          title: "CPU throttling", unit: "% of the time held back by the limit", unitShort: "%", x: r.t, height: 120,
          series: [{ label: "Throttled", values: r.cThrottled, color: s(0) }],
        });
        Charts.timeChart(el, {
          title: "Container memory", unit: "MB", unitShort: "MB", x: r.t, height: 140,
          note: memLimit ? "Past the limit, Linux kills the server." : "No memory limit set.",
          threshold: memLimit ?? undefined, thresholdLabel: memLimit ? "limit" : "",
          series: [{ label: "Container", values: r.cMem, color: s(0) }, { label: "Server process", values: r.memMb, color: s(1) }],
        });
        Charts.timeChart(el, { title: "Container disk I/O", unit: "KB/s", unitShort: "KB/s", x: r.t, height: 130,
          series: [{ label: "Read", values: r.cDiskRead, color: s(0) }, { label: "Write", values: r.cDiskWrite, color: s(1) }] });
      }
      Charts.timeChart(el, {
        title: "CPU", unit: `% of the ${host}`, unitShort: "%", x: r.t, height: 170,
        series: [
          { label: "Server", values: r.cpuPct, color: s(0) },
          { label: "With child processes", values: r.totalCpuPct, color: s(1) },
          { label: `Whole ${host}`, values: r.mCpu, color: s(2) },
        ],
      });
      Charts.timeChart(el, {
        title: "Server memory", unit: "MB", unitShort: "MB", x: r.t,
        series: [
          { label: "Working set", values: r.memMb, color: s(0) },
          { label: "Private", values: r.privateMb, color: s(1) },
          { label: "With child processes", values: r.totalMemMb, color: s(2) },
        ],
      });
      if (r.mMemUsed.some(v => v != null))
        Charts.timeChart(el, { title: M.inContainer ? "Host memory" : "Machine memory", unit: "MB", unitShort: "MB", x: r.t, height: 140,
          series: [{ label: "Used", values: r.mMemUsed, color: s(0) }, { label: "Installed", values: r.mMemTotal, color: s(1) }] });
      Charts.timeChart(el, { title: "Server disk I/O", unit: "KB/s", unitShort: "KB/s", x: r.t, height: 140,
        series: [{ label: "Read", values: r.diskRead, color: s(0) }, { label: "Write", values: r.diskWrite, color: s(1) }] });
      const net = r.hasContainer ? { rx: r.cRx, tx: r.cTx, who: "Container" } : { rx: r.rx, tx: r.tx, who: "Machine" };
      Charts.timeChart(el, { title: "Network", unit: "KB/s", unitShort: "KB/s", height: 160,
        note: "The game only counts what it sends.",
        x: r.t, series: [
          { label: "Game, sent", values: r.gameOut, color: s(0) },
          { label: `${net.who}, received`, values: net.rx, color: s(1) },
          { label: `${net.who}, sent`, values: net.tx, color: s(2) },
        ] });
      Charts.timeChart(el, { title: "Game packets", unit: "per second", x: r.t, height: 130,
        series: [{ label: "Sent", values: r.pktOut, color: s(0) }, { label: "Received", values: r.pktIn, color: s(1) }] });
      Charts.timeChart(el, { title: "Open handles", x: r.t, height: 120, series: [{ label: "Handles", values: r.handles, color: s(0) }], fmt: v => Math.round(v).toLocaleString(), yMin: null });
      Charts.timeChart(el, { title: "Threads", x: r.t, height: 110, series: [{ label: "Threads", values: r.threads, color: s(0) }], fmt: v => Charts.fmtNum(v, 0), yMin: null });
      if (r.diskFree.some(v => v != null))
        Charts.timeChart(el, { title: "Free disk space", unit: "GB, game drive", unitShort: "GB", x: r.t, height: 110, series: [{ label: "Free", values: r.diskFree, color: s(0) }] });
      const kids = Object.keys(r.children);
      if (kids.length)
        Charts.timeChart(el, { title: "Child processes: memory", unit: "MB", unitShort: "MB", x: r.t, height: 130,
          series: topSeries(Object.fromEntries(kids.map(k => [k, r.children[k].mem]))) });
    }

    if (Object.keys(c.sections).length || Object.keys(c.metrics).length) {
      group("From mods");
      if (Object.keys(c.sections).length)
        Charts.timeChart(el, { title: "Mod sections", unit: "ms/s", unitShort: "ms/s", x: c.t, series: topSeries(c.sections), height: 170 });
      const metrics = Object.keys(c.metrics).slice(0, 12);
      for (const k of metrics) Charts.timeChart(el, { title: k, unit: "metric", x: c.t, height: 110, series: [{ label: k, values: c.metrics[k], color: s(0) }], yMin: null });
      if (Object.keys(c.metrics).length > 12) {
        const p = document.createElement("p"); p.className = "muted";
        p.textContent = `${Object.keys(c.metrics).length - 12} more in the Mods table.`;
        el.appendChild(p);
      }
    }
  }

  // Range, cursor, map
  function rangeText() {
    const all = range[0] === M.tMin && range[1] === M.tMax;
    $("range-text").innerHTML = `${all ? "All" : "Zoomed"}: <strong>${esc(Time.fmt(range[0]))}</strong> to <strong>${esc(Time.fmt(range[1]))}</strong> (${esc(Time.duration(range[1] - range[0]))}), ${esc(Time.label(range[0]))}`;
    $("reset-zoom").disabled = all;
  }

  let zoomTimer = null;
  Charts.onZoom = (min, max) => {
    if (!M) return;
    range = [Math.max(M.tMin, min), Math.min(M.tMax, max)];
    if (min <= M.tMin && max >= M.tMax) range = [M.tMin, M.tMax];
    rangeText();
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => { Views.setRange(range[0], range[1]); Views.renderAll(); }, 150);
  };

  let cursorFrame = 0;
  Charts.onCursor = ms => {
    Views.map.cursorT = ms;
    cancelAnimationFrame(cursorFrame);
    cursorFrame = requestAnimationFrame(() => Views.drawMap());
  };

  $("reset-zoom").addEventListener("click", () => Charts.resetZoom());
  $("map-scrub").addEventListener("input", e => {
    const m = Views.map;
    m.scrubT = m.tMin + (m.tMax - m.tMin) * (+e.target.value / 1000);
    Views.updateScrubLabel();
    Views.drawMap();
  });
  $("map-spikes").addEventListener("change", () => Views.drawMap());
  $("map-paths").addEventListener("change", () => Views.drawMap());
  $("map").addEventListener("mousemove", e => Views.mapHover(e));
  $("map").addEventListener("mouseleave", () => { $("map-tip").hidden = true; });
  $("raw-type").addEventListener("change", () => Views.rawView(true));
  $("raw-filter").addEventListener("input", () => Views.rawView(true));
  $("raw-more").addEventListener("click", () => Views.moreRaw());

  const tabs = [...document.querySelectorAll("#nav a")];
  const spy = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting)
      tabs.forEach(a => a.classList.toggle("active", a.hash === "#" + e.target.id));
  }, { rootMargin: "-40% 0px -55% 0px" });
  tabs.forEach(a => spy.observe(document.querySelector(a.hash)));

  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (M) { Charts.resize(); Views.drawMap(); } }, 100);
  }).observe($("main"));

  // CSV export
  $("csv-btn").addEventListener("click", () => {
    const samples = M.samples.filter(s => s.t >= range[0] && s.t <= range[1]);
    const modules = Object.keys(M.cols.modules);
    const head = ["utc", `time (${Time.label(range[0])})`, "frames", "avgMs", "p50Ms", "p95Ms", "maxMs", "gc", "heapMb", "memMb", "players", "entities", "errors", ...modules.map(m => `module: ${m}`)];
    const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const lines = [head.map(q).join(",")];
    for (const s of samples) lines.push([new Date(s.t).toISOString(), Time.fmt(s.t), s.frames, s.avgMs, s.p50Ms, s.p95Ms, s.maxMs, s.gc?.[0] ?? "", s.heapMb, s.memMb ?? "", s.players, s.entities, s.errors, ...modules.map(m => s.modules?.[m] ?? 0)].map(q).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `canary-samples-${new Date(range[0]).toISOString().slice(0, 19).replace(/[:T]/g, "")}Z.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
