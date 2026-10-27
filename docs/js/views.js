// Everything below the timeline. Each view reads the model and the selected time range, so zooming the
// timeline narrows every table, tile and the map to the same stretch of time.
"use strict";

const Views = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = Charts.fmtNum;
  const int = v => v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString();
  const pct = v => v == null || !isFinite(v) ? "–" : `${v.toFixed(v < 10 ? 1 : 0)}%`;
  const MAX_IDENTITY = 8;

  let M = null, R = [0, 0];
  const inR = t => t >= R[0] && t <= R[1];
  const within = list => list.filter(r => inR(r.t));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const quantile = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  // Least-squares slope, per hour.
  function slopePerHour(points) {
    if (points.length < 3) return null;
    const xs = points.map(p => p[0] / 3600000), ys = points.map(p => p[1]);
    const mx = mean(xs), my = mean(ys);
    let n = 0, d = 0;
    for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); d += (xs[i] - mx) ** 2; }
    return d ? n / d : null;
  }

  // ---- Sortable tables ----------------------------------------------------------------------------------
  // cols: [{ key, label, num, render(row), sort(row) }]
  function table(el, cols, rows, opts = {}) {
    const state = el._sort || { key: opts.sortKey ?? cols[0].key, dir: opts.sortDir ?? "descending" };
    el._sort = state;
    const col = cols.find(c => c.key === state.key) || cols[0];
    const val = r => col.sort ? col.sort(r) : r[col.key];
    const sorted = rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x == null ? 1 : y == null ? -1 : (typeof x === "string" ? x.localeCompare(y) : x - y);
      return state.dir === "ascending" ? c : -c;
    });
    const limit = opts.limit || 500;
    el.innerHTML = `${opts.caption ? `<caption>${opts.caption}</caption>` : ""}<thead><tr>${cols.map(c =>
      `<th scope="col" data-key="${c.key}" class="${c.num ? "num" : ""}" ${c.key === state.key ? `aria-sort="${state.dir}"` : ""}>${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${sorted.slice(0, limit).map(r => `<tr>${cols.map(c => `<td class="${c.num ? "num" : ""}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody>
      ${sorted.length > limit ? `<tfoot><tr><td colspan="${cols.length}" class="muted">Showing ${limit} of ${sorted.length}. Zoom the timeline to narrow it down.</td></tr></tfoot>` : ""}
      ${!sorted.length ? `<tfoot><tr><td colspan="${cols.length}" class="muted">${esc(opts.empty || "Nothing in this time range.")}</td></tr></tfoot>` : ""}`;
    el.querySelectorAll("th").forEach(th => th.addEventListener("click", () => {
      const key = th.dataset.key;
      el._sort = { key, dir: state.key === key && state.dir === "descending" ? "ascending" : "descending" };
      table(el, cols, rows, opts);
    }));
  }

  function hbars(el, items, fmt = num, color) {
    const max = Math.max(...items.map(i => i.value), 0) || 1;
    el.innerHTML = items.length ? `<div class="hbars">${items.map(i => `<div class="hbar" title="${esc(i.label)}: ${esc(fmt(i.value))}">
      <span class="name">${esc(i.label)}</span><span class="track"><span class="fill" style="display:block;width:${(i.value / max * 100).toFixed(2)}%;${color ? `background:${color}` : ""}"></span></span>
      <span class="num">${esc(fmt(i.value))}</span></div>`).join("")}</div>` : `<p class="muted">Nothing in this time range.</p>`;
  }

  function vbars(el, items) {
    const max = Math.max(...items.map(i => i.value), 0) || 1;
    el.innerHTML = `<div class="vbars" role="img" aria-label="${esc(items.map(i => `${i.label}: ${i.value}`).join(", "))}">${items.map(i =>
      `<div class="vbar" title="${esc(i.title || i.label)}: ${i.value}"><div class="fill" style="height:${(i.value / max * 100).toFixed(1)}%"></div><span class="lab">${esc(i.label)}</span></div>`).join("")}</div>`;
  }

  // ---- Identity colours for players: first eight by first appearance, then grey ------------------------
  const playerColor = p => p.order < MAX_IDENTITY ? Charts.slot(p.order) : Charts.css("--other");

  // ---- Overview ---------------------------------------------------------------------------------------
  function overview() {
    const samples = within(M.samples), spikes = within(M.spikes), res = within(M.resources), census = within(M.census);
    const tiles = [];
    const tile = (label, value, detail) => tiles.push(`<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="detail">${esc(detail || "")}</div></div>`);
    const span = R[1] - R[0];
    const gaps = M.gaps.filter(g => g.to >= R[0] && g.from <= R[1]);
    tile("Time covered", Time.duration(span), gaps.length ? `${gaps.length} gap(s) with no data` : "no gaps");
    const avgs = samples.map(s => s.avgMs).filter(v => v != null);
    const p95s = samples.map(s => s.p95Ms).filter(v => v != null);
    const typical = quantile(avgs, 0.5);
    tile("Typical frame", typical != null ? `${num(typical)} ms` : "–", typical ? `≈ ${num(1000 / typical, 0)} frames a second; p95 ${num(quantile(p95s, 0.5))} ms` : "");
    const worst = spikes.reduce((m, s) => Math.max(m, s.ms), 0);
    const hours = span / 3600000;
    tile("Lag spikes", int(spikes.length), spikes.length ? `worst ${num(worst, 0)} ms; ${num(spikes.length / Math.max(hours, 1 / 60), 1)} an hour` : `none over ${M.settings.spikeMs} ms`);
    if (spikes.length) tile("Spikes during garbage collection", pct(100 * spikes.filter(s => s.gc).length / spikes.length), "a collection ran in the same frame");
    const heap = samples.filter(s => s.heapMb != null);
    if (heap.length) {
      const slope = slopePerHour(heap.map(s => [s.t, s.heapMb]));
      tile("Managed heap", `${num(heap[heap.length - 1].heapMb, 0)} MB`, `peak ${num(Math.max(...heap.map(s => s.heapMb)), 0)} MB${slope != null && hours >= 0.25 ? `; trend ${slope >= 0 ? "+" : ""}${num(slope, 0)} MB/hour` : ""}`);
    }
    if (res.length) {
      const cores = res.map(r => r.cpuCores).filter(v => v != null);
      const machine = res.map(r => r.machine?.cpuPct).filter(v => v != null);
      tile("Server CPU", cores.length ? `${num(mean(cores))} cores` : "–", `peak ${num(Math.max(...cores, 0))} cores${machine.length ? `; whole machine averages ${pct(mean(machine))}` : ""}`);
      const mem = res.map(r => r.totalMemMb).filter(v => v != null);
      tile("Server memory", mem.length ? `${num(mem[mem.length - 1], 0)} MB` : "–", `peak ${num(Math.max(...mem, 0), 0)} MB, child processes included`);
      const out = res.map(r => r.gameOutKBps).filter(v => v != null);
      if (out.length) tile("Game traffic out", `${num(mean(out))} KB/s`, `peak ${num(Math.max(...out))} KB/s`);
      const free = res.map(r => r.machine?.diskFreeGb).filter(v => v != null);
      if (free.length) tile("Free disk", `${num(free[free.length - 1], 0)} GB`, "on the game's drive");
    }
    const players = M.players.filter(p => p.points.some(pt => inR(pt.t)));
    const peakPlayers = samples.reduce((m, s) => Math.max(m, s.players ?? 0), 0);
    tile("Players", int(peakPlayers), `at most at once; ${players.length} different player(s)`);
    const ent = samples.filter(s => s.entities != null);
    if (ent.length) tile("Entities", int(ent[ent.length - 1].entities), `${int(ent[0].entities)} at the start of the range`);
    const occurrences = samples.reduce((n, s) => n + (s.errors || 0), 0);
    tile("Errors and warnings", int(occurrences), `${within(M.errors).length} new kind(s) first seen in this range`);
    $("tiles").innerHTML = tiles.join("");
    $("overview-sub").textContent = `${Time.fmt(R[0])} to ${Time.fmt(R[1])}, ${Time.label(R[0])}.`;
    findings(samples, spikes, res, census, gaps, hours);
  }

  function findings(samples, spikes, res, census, gaps, hours) {
    const out = [];
    const add = (sev, text) => out.push({ sev, text });
    const sevLabel = { critical: "Critical", serious: "Serious", warning: "Warning", good: "Fine", info: "Note" };
    if (spikes.length) {
      const gcShare = spikes.filter(s => s.gc).length / spikes.length;
      const worst = spikes.reduce((a, b) => b.ms > a.ms ? b : a);
      add(worst.ms >= 1000 ? "critical" : "serious", `${spikes.length} lag spike(s); the worst froze the server for ${num(worst.ms, 0)} ms at ${Time.fmt(worst.t)}.`);
      if (gcShare >= 0.5) add("serious", `${pct(gcShare * 100)} of lag spikes happened in a frame where garbage collection ran, so memory churn is the likeliest cause. The heap chart shows the build-up before each collection.`);
      const withPlayers = spikes.filter(s => s.players > 0).length;
      if (withPlayers && withPlayers < spikes.length) add("info", `${withPlayers} of the spikes happened with players online; the map shows where they were.`);
    } else if (samples.length) add("good", `No frame took longer than ${M.settings.spikeMs} ms.`);

    const heap = samples.filter(s => s.heapMb != null);
    if (heap.length > 60 && hours >= 0.5) {
      // Compare the low points (just after collections), not the sawtooth peaks.
      const lows = [];
      const bucket = 5 * 60000;
      for (let t = heap[0].t; t < heap[heap.length - 1].t; t += bucket) {
        const b = heap.filter(s => s.t >= t && s.t < t + bucket);
        if (b.length) lows.push([t, Math.min(...b.map(s => s.heapMb))]);
      }
      const slope = slopePerHour(lows);
      if (slope != null && slope > 30) add("warning", `Even right after garbage collections, memory grows by about ${num(slope, 0)} MB an hour. Something is holding on to memory (a leak, or things piling up in the world).`);
    }

    if (census.length >= 3) {
      const first = census[0], last = census[census.length - 1];
      const h = (last.t - first.t) / 3600000;
      const growth = Object.keys(last.byPrefab || {}).filter(k => !k.startsWith("(")).map(k => ({ k, d: (last.byPrefab[k] || 0) - (first.byPrefab?.[k] || 0) }))
        .filter(g => g.d > 0).sort((a, b) => b.d - a.d);
      // Half an hour at least, and a real pile: short windows and slow regrowth are just noise.
      if (h >= 0.5 && growth.length && growth[0].d >= 100 && growth[0].d / h >= 50)
        add("warning", `"${growth[0].k}" went from ${int(first.byPrefab?.[growth[0].k] || 0)} to ${int(last.byPrefab[growth[0].k])} (about ${int(growth[0].d / h)} an hour). Things piling up like this slow servers down over time.`);
      const slow = census.filter(c => c.durationMs > 50);
      if (slow.length) add("warning", `Counting entities took over 50 ms ${slow.length} time(s); on a world this size, raise CensusSeconds so it runs less often.`);
    }

    const modules = moduleStats(samples);
    if (modules.length && modules[0].avg > 100) add("warning", `"${modules[0].name}" takes ${num(modules[0].avg, 0)} ms of every second on average, the most of any update module.`);

    if (res.length) {
      const busy = res.filter(r => (r.machine?.cpuPct ?? 0) > 85);
      if (busy.length) add("serious", `The whole machine's CPU was above 85% for about ${Time.duration(busy.length * M.settings.resourceSeconds * 1000)}${busy.length ? `, from ${Time.fmt(busy[0].t)}` : ""}. Something else on the machine may be competing with the server.`);
      const mem = res.filter(r => r.machine?.memUsedMb && r.machine?.memTotalMb && r.machine.memUsedMb / r.machine.memTotalMb > 0.9);
      if (mem.length) add("serious", `The machine's memory was over 90% full for about ${Time.duration(mem.length * M.settings.resourceSeconds * 1000)}.`);
      const free = res.map(r => r.machine?.diskFreeGb).filter(v => v != null);
      if (free.length && free[free.length - 1] < 5) add("critical", `Only ${num(free[free.length - 1])} GB free on the game's drive. Saves and logs can fail when it fills up.`);
      const handles = res.filter(r => r.handles != null);
      if (handles.length > 20 && hours >= 0.5) {
        const s = slopePerHour(handles.map(r => [r.t, r.handles]));
        if (s > 200) add("warning", `The server's open handle count grows by about ${int(s)} an hour, which can mean files or sockets aren't being closed.`);
      }
    }

    const groups = M.errorGroups.filter(g => g.Count);
    if (groups.length) {
      const top = groups.slice().sort((a, b) => b.Count - a.Count)[0];
      add(top.Level === "Error" ? "serious" : "warning", `The most repeated problem (${int(top.Count)} times, from ${top.Mod}): ${String(top.Message).split("\n")[0].slice(0, 160)}`);
    } else {
      const mods = {};
      for (const e of within(M.errors)) if (e.mod && e.mod !== "game") mods[e.mod] = (mods[e.mod] || 0) + 1;
      const worst = Object.entries(mods).sort((a, b) => b[1] - a[1])[0];
      if (worst) add("warning", `${worst[0]} produced ${worst[1]} new kind(s) of error or warning.`);
    }
    if (gaps.length) {
      const longest = gaps.reduce((a, b) => (b.to - b.from) > (a.to - a.from) ? b : a);
      add("info", `${gaps.length} gap(s) in the data, the longest ${Time.duration(longest.to - longest.from)} from ${Time.fmt(longest.from)}: the server was down or restarting, or the files opened don't cover that time.`);
    }
    if (!out.length) add("good", "Nothing stands out in this range.");
    $("findings").innerHTML = out.map(f => `<li><span class="sev ${f.sev}">${sevLabel[f.sev]}</span><span>${esc(f.text)}</span></li>`).join("");
  }

  // ---- Lag spikes --------------------------------------------------------------------------------------
  function spikesView() {
    const spikes = within(M.spikes);
    const sampleAt = t => { // the per-second sample covering a spike
      let lo = 0, hi = M.samples.length - 1, best = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (M.samples[mid].t >= t) { best = M.samples[mid]; hi = mid - 1; } else lo = mid + 1; }
      return best && best.t - t <= 2000 ? best : null;
    };
    const rows = spikes.map(s => {
      const sample = sampleAt(s.t);
      const top = sample?.modules ? Object.entries(sample.modules).sort((a, b) => b[1] - a[1])[0] : null;
      return { t: s.t, ms: s.ms, gc: s.gc, players: s.players, entities: s.entities, errors: sample?.errors ?? null, module: top ? `${top[0]} (${num(top[1])} ms)` : "–" };
    });
    $("spikes-sub").textContent = spikes.length
      ? `${spikes.length} frame(s) over ${M.settings.spikeMs} ms in this range. "Busiest module" is the update module that used the most time in that second.`
      : `No frames over ${M.settings.spikeMs} ms in this range.`;
    table($("spike-table"), [
      { key: "t", label: `Time (${Time.label(R[0])})`, render: r => esc(Time.fmt(r.t)) },
      { key: "ms", label: "Frame took", num: true, render: r => `${num(r.ms, 0)} ms` },
      { key: "gc", label: "Garbage collection", render: r => r.gc ? "yes" : "no", sort: r => r.gc ? 1 : 0 },
      { key: "players", label: "Players", num: true },
      { key: "entities", label: "Entities", num: true, render: r => int(r.entities) },
      { key: "errors", label: "Errors that second", num: true, render: r => r.errors == null ? "–" : int(r.errors) },
      { key: "module", label: "Busiest module that second" },
    ], rows, { sortKey: "t" });
    const buckets = [[200, 300], [300, 500], [500, 1000], [1000, 2000], [2000, Infinity]];
    hbars($("spike-buckets"), buckets.map(([a, b]) => ({
      label: b === Infinity ? `${a / 1000} s or more` : a >= 1000 ? `${a / 1000}–${b / 1000} s` : `${a}–${b} ms`,
      value: spikes.filter(s => s.ms >= a && s.ms < b).length,
    })), int);
    const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0"), title: `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`, value: 0 }));
    for (const s of spikes) hours[Time.parts(s.t).h].value++;
    vbars($("spike-hours"), hours);
    $("spike-hours-cap").textContent = `Spikes by hour of day, in ${Time.label(R[0])}`;
  }

  // ---- Players & map -----------------------------------------------------------------------------------
  const map = { canvas: null, ctx: null, view: null, cursorT: null, scrubT: null, points: [] };

  function playersView() {
    const tracks = M.players.map(p => ({ p, pts: p.points.filter(pt => inR(pt.t)) })).filter(x => x.pts.length);
    const step = M.settings.positionSeconds * 1000;
    const rows = tracks.map(({ p, pts }) => {
      let online = 0, dist = 0;
      const chunks = new Map();
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[i - 1], cur = pts[i];
        if (prev && cur.t - prev.t <= step * 3) {
          online += cur.t - prev.t;
          dist += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
          if (cur.chunk) chunks.set(cur.chunk, (chunks.get(cur.chunk) || 0) + (cur.t - prev.t));
        }
      }
      const topChunk = [...chunks.entries()].sort((a, b) => b[1] - a[1])[0];
      const spikes = within(M.spikes).filter(s => s.t >= pts[0].t && s.t <= pts[pts.length - 1].t).length;
      return { p, name: p.name, id: p.id, first: pts[0].t, last: pts[pts.length - 1].t, online, dist, chunks: chunks.size, top: topChunk ? topChunk[0] : "–", spikes };
    });
    $("players-sub").textContent = tracks.length
      ? `${tracks.length} player(s) in this range. Positions are recorded every ${M.settings.positionSeconds} s. Times are ${Time.label(R[0])}.`
      : "No player positions in this range (nobody was online, or the files don't include positions).";
    table($("player-table"), [
      { key: "name", label: "Player", render: r => `<span class="who"><span class="swatch" style="background:${playerColor(r.p)}"></span>${esc(r.name)}</span> <span class="muted">${esc(r.id)}</span>` },
      { key: "first", label: "First seen", render: r => esc(Time.fmt(r.first, "time")) },
      { key: "last", label: "Last seen", render: r => esc(Time.fmt(r.last, "time")) },
      { key: "online", label: "Online", num: true, render: r => esc(Time.duration(r.online)) },
      { key: "dist", label: "Distance (m)", num: true, render: r => int(r.dist) },
      { key: "chunks", label: "Chunks", num: true },
      { key: "top", label: "Most time in" },
      { key: "spikes", label: "Spikes while on", num: true },
    ], rows, { sortKey: "online" });
    const legendPlayers = tracks.slice(0, MAX_IDENTITY).map(({ p }) => `<span><span class="swatch" style="background:${playerColor(p)}"></span>${esc(p.name)}</span>`);
    if (tracks.length > MAX_IDENTITY) legendPlayers.push(`<span><span class="swatch" style="background:${Charts.css("--other")}"></span>${tracks.length - MAX_IDENTITY} more players</span>`);
    legendPlayers.push(`<span><span class="swatch" style="background:transparent;border:2px solid ${Charts.css("--critical")};border-radius:50%"></span>Lag spike</span>`);
    $("map-legend").innerHTML = legendPlayers.join("");
    map.tracks = tracks;
    const times = tracks.flatMap(t => t.pts.map(p => p.t));
    map.tMin = times.length ? Math.min(...times) : R[0];
    map.tMax = times.length ? Math.max(...times) : R[1];
    map.scrubT = null;
    $("map-scrub").value = 1000;
    updateScrubLabel();
    fitMap();
    drawMap();
  }

  function updateScrubLabel() {
    const t = map.scrubT ?? map.tMax;
    $("scrub-label").textContent = `Positions at ${Time.fmt(t, "time")}`;
  }

  function fitMap() {
    const all = (map.tracks || []).flatMap(t => t.pts);
    if (!all.length) { map.view = null; return; }
    let minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
    let minZ = Math.min(...all.map(p => p.z)), maxZ = Math.max(...all.map(p => p.z));
    const span = Math.max(maxX - minX, maxZ - minZ, 40) * 1.15;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    map.view = { minX: cx - span / 2, minZ: cz - span / 2, span };
  }

  function drawMap() {
    const canvas = $("map");
    const dpr = devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (!size) return;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const muted = Charts.css("--muted"), grid = Charts.css("--grid"), surface = Charts.css("--surface"), ink = Charts.css("--ink");
    map.points = [];
    if (!map.view) {
      ctx.fillStyle = muted; ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No positions in this time range", size / 2, size / 2);
      return;
    }
    const v = map.view;
    const px = x => (x - v.minX) / v.span * size;
    const pz = z => size - (z - v.minZ) / v.span * size; // north up
    // Grid every "nice" number of metres.
    const raw = v.span / 6, mag = 10 ** Math.floor(Math.log10(raw));
    const stepM = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.font = "10px system-ui, sans-serif";
    for (let x = Math.ceil(v.minX / stepM) * stepM; x <= v.minX + v.span; x += stepM) {
      ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), size); ctx.stroke();
      ctx.fillText(`x ${Math.round(x)}`, px(x) + 3, size - 4);
    }
    for (let z = Math.ceil(v.minZ / stepM) * stepM; z <= v.minZ + v.span; z += stepM) {
      ctx.beginPath(); ctx.moveTo(0, pz(z)); ctx.lineTo(size, pz(z)); ctx.stroke();
      ctx.fillText(`z ${Math.round(z)}`, 3, pz(z) - 3);
    }
    ctx.fillStyle = muted; ctx.textAlign = "right"; ctx.fillText("N ↑", size - 6, 14); ctx.textAlign = "left";

    const step = M.settings.positionSeconds * 1000;
    if ($("map-paths").checked) for (const { p, pts } of map.tracks) {
      ctx.strokeStyle = playerColor(p); ctx.lineWidth = 2; ctx.globalAlpha = 0.7; ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const brk = i === 0 || pt.t - pts[i - 1].t > step * 3;
        if (brk) ctx.moveTo(px(pt.x), pz(pt.z)); else ctx.lineTo(px(pt.x), pz(pt.z));
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const pt of pts) map.points.push({ x: px(pt.x), y: pz(pt.z), p, pt });
    }
    if ($("map-spikes").checked) {
      ctx.strokeStyle = Charts.css("--critical"); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
      for (const s of within(M.spikes)) for (const { p, pts } of map.tracks) {
        const pt = nearest(pts, s.t, step * 1.5);
        if (!pt) continue;
        const r = 4 + Math.min(6, s.ms / 300);
        ctx.beginPath(); ctx.arc(px(pt.x), pz(pt.z), r, 0, Math.PI * 2); ctx.stroke();
        map.points.push({ x: px(pt.x), y: pz(pt.z), p, pt, spike: s });
      }
      ctx.globalAlpha = 1;
    }
    // Where everyone was at the cursor (hovering the timeline) or the scrubber.
    const at = map.cursorT ?? map.scrubT ?? map.tMax;
    for (const { p, pts } of map.tracks) {
      const pt = nearest(pts, at, step * 1.5);
      if (!pt) continue;
      ctx.fillStyle = playerColor(p); ctx.strokeStyle = surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px(pt.x), pz(pt.z), 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(p.name, px(pt.x) + 9, pz(pt.z) - 7);
    }
  }

  function nearest(pts, t, maxDist) {
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].t < t) lo = mid + 1; else hi = mid; }
    let best = null;
    for (const i of [lo - 1, lo]) {
      const pt = pts[i];
      if (pt && Math.abs(pt.t - t) <= maxDist && (!best || Math.abs(pt.t - t) < Math.abs(best.t - t))) best = pt;
    }
    return best;
  }

  function mapHover(ev) {
    const canvas = $("map"), tip = $("map-tip");
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    let best = null, bd = 12;
    for (const pnt of map.points) { const d = Math.hypot(pnt.x - x, pnt.y - y); if (d < bd) { bd = d; best = pnt; } }
    if (!best) { tip.hidden = true; return; }
    const pt = best.pt;
    tip.innerHTML = `<strong>${esc(best.p.name)}</strong> at ${esc(Time.fmt(pt.t))}<br>x ${num(pt.x, 1)}, y ${num(pt.y, 1)}, z ${num(pt.z, 1)}${pt.chunk ? `<br>${esc(pt.chunk)}` : ""}${best.spike ? `<br>During a ${num(best.spike.ms, 0)} ms lag spike` : ""}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(rect.width - 200, x + 12)}px`;
    tip.style.top = `${y + 12}px`;
  }

  // ---- Entities ----------------------------------------------------------------------------------------
  function entitiesView() {
    const census = within(M.census);
    if (!census.length) {
      $("entities-sub").textContent = "No entity counts in this range (they're taken every minute once the server is up).";
      $("census-table").innerHTML = ""; $("chunk-table").innerHTML = "";
      return;
    }
    const first = census[0], last = census[census.length - 1];
    const h = Math.max((last.t - first.t) / 3600000, 1e-9);
    $("entities-sub").textContent = `${census.length} count(s) from ${Time.fmt(first.t)} to ${Time.fmt(last.t)} (${Time.label(R[0])}). `
      + `Counting took ${num(mean(census.map(c => c.durationMs)))} ms on average. A type that keeps growing is a buildup worth looking at.`;
    const names = new Set(census.flatMap(c => Object.keys(c.byPrefab || {})));
    const rows = [...names].map(n => {
      const series = census.map(c => c.byPrefab?.[n] ?? 0);
      return { name: n, first: series[0], last: series[series.length - 1], change: series[series.length - 1] - series[0], perHour: census.length > 1 ? (series[series.length - 1] - series[0]) / h : null, peak: Math.max(...series) };
    });
    table($("census-table"), [
      { key: "name", label: "Type" },
      { key: "first", label: "At start", num: true, render: r => int(r.first) },
      { key: "last", label: "At end", num: true, render: r => int(r.last) },
      { key: "change", label: "Change", num: true, render: r => (r.change > 0 ? "+" : "") + int(r.change) },
      { key: "perHour", label: "Per hour", num: true, render: r => r.perHour == null ? "–" : (r.perHour > 0 ? "+" : "") + int(r.perHour) },
      { key: "peak", label: "Peak", num: true, render: r => int(r.peak) },
    ], rows, { sortKey: "change" });
    const chunks = new Set(census.flatMap(c => Object.keys(c.byChunk || {})));
    const chunkRows = [...chunks].map(n => ({ name: n, first: first.byChunk?.[n] ?? 0, last: last.byChunk?.[n] ?? 0 })).map(r => ({ ...r, change: r.last - r.first }));
    table($("chunk-table"), [
      { key: "name", label: "Chunk" },
      { key: "first", label: "At start", num: true, render: r => int(r.first) },
      { key: "last", label: "At end", num: true, render: r => int(r.last) },
      { key: "change", label: "Change", num: true, render: r => (r.change > 0 ? "+" : "") + int(r.change) },
    ], chunkRows, { sortKey: "last", caption: "The census keeps the 25 chunks with the most entities each time." });
  }

  // ---- Errors ------------------------------------------------------------------------------------------
  function errorsView() {
    const errors = within(M.errors);
    const groups = new Map(M.errorGroups.map(g => [g.Id, g]));
    const total = within(M.samples).reduce((n, s) => n + (s.errors || 0), 0);
    $("errors-sub").textContent = `${errors.length} new kind(s) of error or warning first seen in this range; ${int(total)} occurrence(s) in all (the Errors chart in the timeline shows when). `
      + (groups.size ? "Counts and stack traces come from the report's errors.json and cover the whole session, not just this range." : "Open a report (canary report) to also get counts and stack traces.");
    const rows = errors.map(e => ({ ...e, g: groups.get(e.id) }));
    table($("error-table"), [
      { key: "t", label: `First seen (${Time.label(R[0])})`, render: r => esc(Time.fmt(r.t)) },
      { key: "level", label: "Level" },
      { key: "mod", label: "From" },
      { key: "logger", label: "Logger", render: r => `<span class="muted">${esc(r.logger)}</span>` },
      { key: "count", label: "Times", num: true, sort: r => r.g?.Count ?? -1, render: r => r.g ? int(r.g.Count) : "–" },
      { key: "message", label: "Message", render: r => r.g?.Stack
          ? `<details><summary>${esc(String(r.message).split("\n")[0])}</summary><pre>${esc(r.g.Stack)}</pre></details>`
          : esc(String(r.message).split("\n")[0]) },
    ], rows, { sortKey: "t" });
    const byMod = {};
    for (const e of errors) byMod[e.mod || "unknown"] = (byMod[e.mod || "unknown"] || 0) + 1;
    hbars($("errors-by-mod"), Object.entries(byMod).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })), int);
  }

  // ---- Update modules ------------------------------------------------------------------------------------
  function moduleStats(samples) {
    const sums = {}, peaks = {}, counts = {};
    for (const s of samples) if (s.modules) for (const [k, v] of Object.entries(s.modules)) {
      sums[k] = (sums[k] || 0) + v; peaks[k] = Math.max(peaks[k] || 0, v);
    }
    const n = samples.filter(s => s.modules).length || 1;
    const all = Object.keys(M.cols.modules);
    const total = all.reduce((t, k) => t + (sums[k] || 0), 0) || 1;
    return all.map(k => ({ name: k, avg: (sums[k] || 0) / n, peak: peaks[k] || 0, share: 100 * (sums[k] || 0) / total })).sort((a, b) => b.avg - a.avg);
  }

  function modulesView() {
    const stats = moduleStats(within(M.samples));
    hbars($("module-bars"), stats.map(s => ({ label: s.name, value: s.avg })), v => `${num(v)} ms/s`);
    table($("module-table"), [
      { key: "name", label: "Module" },
      { key: "avg", label: "Average ms/s", num: true, render: r => num(r.avg) },
      { key: "peak", label: "Worst second (ms)", num: true, render: r => num(r.peak) },
      { key: "share", label: "Share of module time", num: true, render: r => pct(r.share) },
    ], stats, { sortKey: "avg", empty: "No module timings (RecordUpdateModules may be off)." });
  }

  // ---- Mods ------------------------------------------------------------------------------------------------
  function modsView() {
    const samples = within(M.samples);
    const secRows = Object.keys(M.cols.sections).map(k => {
      const vals = samples.map(s => s.sections?.[k] ?? 0);
      return { kind: "Section", name: k, avg: mean(vals), peak: Math.max(0, ...vals), last: null };
    });
    const metRows = Object.keys(M.cols.metrics).map(k => {
      const vals = samples.map(s => s.metrics?.[k]).filter(v => v != null);
      return { kind: "Metric", name: k, avg: mean(vals), peak: vals.length ? Math.max(...vals) : null, last: vals.length ? vals[vals.length - 1] : null };
    });
    $("mods-sub").textContent = "Sections are time other mods measured with CanaryApi.Section (ms per second); metrics are numbers they reported with CanaryApi.Metric. "
      + (M.mods ? "The mod list comes from the report." : "Open a report to see which mods were installed.");
    table($("section-table"), [
      { key: "kind", label: "Kind" },
      { key: "name", label: "Name" },
      { key: "avg", label: "Average", num: true, render: r => r.kind === "Section" ? `${num(r.avg)} ms/s` : num(r.avg) },
      { key: "peak", label: "Peak", num: true, render: r => r.kind === "Section" ? `${num(r.peak)} ms/s` : num(r.peak) },
      { key: "last", label: "Last", num: true, render: r => r.last == null ? "–" : num(r.last) },
    ], [...secRows, ...metRows], { sortKey: "avg", empty: "No mod sections or metrics. Mods add them through Canary's API." });
    const mods = M.mods;
    if (mods) {
      const folder = new Map((mods.modsFolder || []).filter(m => m.id).map(m => [m.files?.find(f => f.endsWith(".dll")), m]));
      table($("mods-table"), [
        { key: "name", label: "Loaded mod" },
        { key: "version", label: "Version" },
        { key: "author", label: "Author" },
        { key: "file", label: "File", render: r => `<span class="muted">${esc(r.file)}</span>` },
        { key: "id", label: "Installed as", render: r => esc(folder.get(r.file)?.id || "") },
      ], mods.melons || [], { sortKey: "name", sortDir: "ascending", caption: "Mods and plugins MelonLoader loaded" });
    } else $("mods-table").innerHTML = "";
  }

  // ---- Files & time zones --------------------------------------------------------------------------------
  function filesView() {
    const rows = M.files.map(f => {
      const h = f.headers[0];
      return {
        name: f.name, kind: h?.kind ?? (f.container === "zip" ? "report" : "unknown"), part: h?.part ?? "", records: f.records.length,
        from: f.tMin, to: f.tMax, zone: h?.utcOffsetMin != null ? `${h.timeZone} (${Time.offsetText(h.utcOffsetMin)}${h.daylightSaving ? ", daylight saving" : ""})` : "not recorded",
        version: h ? `Canary ${h.canary}, game ${h.game}` : "Canary 0.1.0 (no header)", notes: f.notes.join(" "),
      };
    });
    table($("file-table"), [
      { key: "name", label: "File" },
      { key: "kind", label: "Kind", render: r => esc(r.kind) + (r.part ? ` <span class="pill">part ${esc(r.part)}</span>` : "") },
      { key: "records", label: "Records", num: true, render: r => int(r.records) },
      { key: "from", label: `From (${Time.label(R[0])})`, render: r => esc(Time.fmt(r.from)) },
      { key: "fromUtc", label: "From (UTC)", sort: r => r.from, render: r => r.from ? esc(new Date(r.from).toISOString().replace("T", " ").slice(0, 19)) : "–" },
      { key: "to", label: "To", render: r => esc(Time.fmt(r.to)) },
      { key: "zone", label: "Server's time zone" },
      { key: "version", label: "Written by" },
      { key: "notes", label: "Notes", render: r => `<span class="muted">${esc(r.notes)}</span>` },
    ], rows, { sortKey: "from", sortDir: "ascending" });
    const sum = $("report-summary");
    if (M.summaries.length) { sum.hidden = false; sum.textContent = M.summaries.map(s => `${s.name}\n${s.text}`).join("\n\n"); }
    else sum.hidden = true;
  }

  // ---- Raw ---------------------------------------------------------------------------------------------------
  let rawShown = 200;
  function rawView(reset) {
    if (reset) rawShown = 200;
    const type = $("raw-type").value, filter = $("raw-filter").value.trim().toLowerCase();
    const list = M.all.filter(r => (type === "all" || r.type === type) && (r.type === "header" || inR(r.t)));
    const lines = [];
    let matched = 0;
    for (const r of list) {
      const json = JSON.stringify(r);
      if (filter && !json.toLowerCase().includes(filter)) continue;
      matched++;
      if (lines.length < rawShown) lines.push(`<div><span class="rt">${esc(Time.fmt(r.t))}</span> ${esc(json)}</div>`);
    }
    $("raw-list").innerHTML = lines.join("") || `<div class="muted">No records match.</div>`;
    $("raw-count").textContent = `${int(matched)} record(s); showing ${int(Math.min(matched, rawShown))}. Times in ${Time.label(R[0])}.`;
    $("raw-more").hidden = matched <= rawShown;
  }

  function initRaw() {
    const types = ["all", ...new Set(M.all.map(r => r.type))];
    $("raw-type").innerHTML = types.map(t => `<option value="${t}">${t}</option>`).join("");
  }

  return {
    set model(m) { M = m; },
    setRange(min, max) { R = [min, max]; },
    renderAll() { overview(); spikesView(); playersView(); entitiesView(); errorsView(); modulesView(); modsView(); filesView(); rawView(true); },
    initRaw, rawView, drawMap, mapHover, fitMap, updateScrubLabel, map,
    moreRaw() { rawShown += 500; rawView(false); },
  };
})();
