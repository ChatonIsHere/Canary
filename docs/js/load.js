// Reading Canary files and turning their records into one model. Recordings (.jsonl / .jsonl.gz, one or
// many parts), saved buffers and report zips can be opened together; their records are merged, de-duplicated
// (a recording starts with a copy of the buffer) and sorted.
"use strict";

const Load = (() => {
  const GZIP = [0x1f, 0x8b], ZIP = [0x50, 0x4b];

  function concat(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // Decompresses as much as there is. A file cut short (copied while being written) still yields every
  // complete line before the cut.
  function gunzip(u8) {
    const chunks = [];
    let truncated = false;
    const stream = new fflate.Gunzip(data => chunks.push(data));
    try {
      stream.push(u8, false);
      stream.push(new Uint8Array(0), true);
    } catch (e) {
      truncated = true;
    }
    return { text: new TextDecoder().decode(concat(chunks)), truncated };
  }

  function parseLines(text) {
    const records = [];
    let bad = 0, cutLast = false;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      line = line.trim();
      if (!line) return;
      try {
        const r = JSON.parse(line);
        if (r && typeof r.type === "string" && typeof r.t === "number") records.push(r);
        else bad++;
      } catch {
        if (i >= lines.length - 2) cutLast = true; else bad++;
      }
    });
    return { records, bad, cutLast };
  }

  async function readFile(file) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    return parseBytes(file.name, u8);
  }

  function parseBytes(name, u8) {
    const out = { name, size: u8.length, records: [], notes: [], extras: {} };
    const is = sig => sig.every((b, i) => u8[i] === b);
    if (is(ZIP)) {
      out.container = "zip";
      let entries;
      try {
        entries = fflate.unzipSync(u8, { filter: f => /(^|\/)(buffer\.jsonl|errors\.json|mods\.json|summary\.txt)$/.test(f.name) });
      } catch (e) {
        out.notes.push(`Couldn't open the zip: ${e.message}`);
        return out;
      }
      const text = n => {
        const key = Object.keys(entries).find(k => k === n || k.endsWith("/" + n));
        return key ? new TextDecoder().decode(entries[key]) : null;
      };
      const buffer = text("buffer.jsonl");
      if (buffer != null) addLines(out, buffer);
      else out.notes.push("No buffer.jsonl inside; is this a Canary report?");
      try { const e = text("errors.json"); if (e) out.extras.errorGroups = JSON.parse(e); } catch { out.notes.push("errors.json couldn't be read."); }
      try { const m = text("mods.json"); if (m) out.extras.mods = JSON.parse(m); } catch { out.notes.push("mods.json couldn't be read."); }
      const s = text("summary.txt"); if (s) out.extras.summary = s;
      return out;
    }
    if (is(GZIP)) {
      out.container = "gzip";
      const { text, truncated } = gunzip(u8);
      if (truncated) out.notes.push("The file ends early (copied while it was being written?); everything up to the cut was read.");
      addLines(out, text);
      return out;
    }
    out.container = "text";
    addLines(out, new TextDecoder().decode(u8));
    return out;
  }

  function addLines(out, text) {
    const { records, bad, cutLast } = parseLines(text);
    out.records.push(...records);
    if (bad) out.notes.push(`${bad} line(s) weren't Canary records and were skipped.`);
    if (cutLast) out.notes.push("The last line was cut off and was skipped.");
    if (!records.length) out.notes.push("No Canary records found.");
  }

  // ---- Model -----------------------------------------------------------------------------------------

  // Merges every opened file into one model the views read from.
  function build(files) {
    const seen = new Set();
    const all = [];
    for (const f of files) {
      f.headers = f.records.filter(r => r.type === "header");
      const data = f.records.filter(r => r.type !== "header");
      f.tMin = data.length ? Math.min(...data.map(r => r.t)) : null;
      f.tMax = data.length ? Math.max(...data.map(r => r.t)) : null;
      for (const r of f.records) {
        // One sample or resources record per moment; other types can share a millisecond.
        const key = r.type === "sample" || r.type === "resources"
          ? `${r.type}|${r.t}` : `${r.type}|${r.t}|${JSON.stringify(r).length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(r);
      }
    }
    all.sort((a, b) => a.t - b.t);

    const by = type => all.filter(r => r.type === type);
    const headers = by("header");
    const samples = by("sample");
    const data = all.filter(r => r.type !== "header");
    const m = {
      files, headers,
      samples, spikes: by("spike"), errors: by("error"), positions: by("positions"),
      census: by("census"), resources: by("resources"), marks: by("mark"),
      errorGroups: files.flatMap(f => f.extras.errorGroups || []),
      mods: files.map(f => f.extras.mods).find(Boolean) || null,
      summaries: files.filter(f => f.extras.summary).map(f => ({ name: f.name, text: f.extras.summary })),
      tMin: data.length ? data[0].t : null,
      tMax: data.length ? data[data.length - 1].t : null,
      all,
    };
    m.settings = Object.assign({ spikeMs: 200, positionSeconds: 5, censusSeconds: 60, resourceSeconds: 5 },
      ...headers.map(h => h.settings || {}));
    m.gaps = findGaps(samples.map(s => s.t), 5000);
    m.cols = sampleColumns(samples, m.gaps);
    m.res = resourceColumns(m.resources, m.settings.resourceSeconds);
    m.players = playerTracks(m.positions);
    return m;
  }

  // Stretches with no samples: the server was down, or the files don't cover that time.
  function findGaps(times, maxStep) {
    const gaps = [];
    for (let i = 1; i < times.length; i++)
      if (times[i] - times[i - 1] > maxStep) gaps.push({ from: times[i - 1], to: times[i] });
    return gaps;
  }

  // uPlot wants columns: one x array (seconds) and one array per series. A null row is inserted in every
  // gap so lines break there instead of joining across it.
  function sampleColumns(samples, gaps) {
    const keys = { modules: new Set(), sections: new Set(), metrics: new Set() };
    for (const s of samples) for (const k of Object.keys(keys)) if (s[k]) for (const n of Object.keys(s[k])) keys[k].add(n);
    const c = {
      t: [], avg: [], p50: [], p95: [], max: [], heap: [], mem: [], players: [], entities: [], errors: [],
      gc: [], frames: [], modules: {}, sections: {}, metrics: {},
    };
    for (const k of ["modules", "sections", "metrics"]) for (const n of keys[k]) c[k][n] = [];
    const gapStarts = new Set(gaps.map(g => g.from));
    const push = (s, isGap) => {
      c.t.push(isGap ? (s.t + 1000) / 1000 : s.t / 1000);
      const v = x => isGap ? null : (x ?? null);
      c.avg.push(v(s.avgMs)); c.p50.push(v(s.p50Ms)); c.p95.push(v(s.p95Ms)); c.max.push(v(s.maxMs));
      c.heap.push(v(s.heapMb)); c.mem.push(v(s.memMb || null)); c.players.push(v(s.players));
      c.entities.push(v(s.entities)); c.errors.push(v(s.errors)); c.frames.push(v(s.frames));
      c.gc.push(isGap ? null : (s.gc ? s.gc[0] : null));
      // The mod leaves out modules that took no time, so a missing module in a sample that has others is 0.
      for (const n of keys.modules) c.modules[n].push(isGap ? null : (s.modules ? (s.modules[n] ?? 0) : null));
      for (const n of keys.sections) c.sections[n].push(isGap ? null : (s.sections ? (s.sections[n] ?? 0) : 0));
      for (const n of keys.metrics) c.metrics[n].push(isGap ? null : (s.metrics?.[n] ?? null));
    };
    for (const s of samples) {
      push(s, false);
      if (gapStarts.has(s.t)) push(s, true);
    }
    return c;
  }

  function resourceColumns(list, intervalSeconds) {
    const c = {
      t: [], cpuPct: [], cpuCores: [], totalCpuPct: [], memMb: [], privateMb: [], totalMemMb: [], handles: [], threads: [],
      diskRead: [], diskWrite: [], gameOut: [], pktOut: [], pktIn: [],
      mCpu: [], mMemUsed: [], mMemTotal: [], rx: [], tx: [], diskFree: [], children: {},
    };
    const childNames = new Set();
    for (const r of list) for (const ch of r.children || []) childNames.add(ch.name);
    for (const n of childNames) c.children[n] = { cpu: [], mem: [] };
    const maxStep = Math.max(3, intervalSeconds * 3) * 1000;
    let last = null;
    const push = (r, gap) => {
      const v = x => gap ? null : (x ?? null);
      c.t.push(gap ? (last.t + 1000) / 1000 : r.t / 1000);
      c.cpuPct.push(v(r.cpuPct)); c.cpuCores.push(v(r.cpuCores)); c.totalCpuPct.push(v(r.totalCpuPct));
      c.memMb.push(v(r.memMb)); c.privateMb.push(v(r.privateMb)); c.totalMemMb.push(v(r.totalMemMb));
      c.handles.push(v(r.handles)); c.threads.push(v(r.threads));
      c.diskRead.push(v(r.diskReadKBps)); c.diskWrite.push(v(r.diskWriteKBps));
      c.gameOut.push(v(r.gameOutKBps)); c.pktOut.push(v(r.gamePacketsOut)); c.pktIn.push(v(r.gamePacketsIn));
      const mc = r.machine || {};
      c.mCpu.push(v(mc.cpuPct)); c.mMemUsed.push(v(mc.memUsedMb)); c.mMemTotal.push(v(mc.memTotalMb));
      c.rx.push(v(mc.netRxKBps)); c.tx.push(v(mc.netTxKBps)); c.diskFree.push(v(mc.diskFreeGb));
      for (const n of childNames) {
        const ch = gap ? null : (r.children || []).find(x => x.name === n);
        c.children[n].cpu.push(ch ? (ch.cpuPct ?? null) : null);
        c.children[n].mem.push(ch ? (ch.memMb ?? null) : null);
      }
    };
    for (const r of list) {
      if (last && r.t - last.t > maxStep) push(last, true);
      push(r, false);
      last = r;
    }
    return c;
  }

  // Per player: their positions over time, from the positions records.
  function playerTracks(positions) {
    const players = new Map();
    for (const rec of positions) for (const p of rec.players || []) {
      const key = p.id || p.name;
      if (!players.has(key)) players.set(key, { id: p.id, name: p.name || `Player ${p.id}`, points: [], order: players.size });
      players.get(key).points.push({ t: rec.t, x: p.x, y: p.y, z: p.z, chunk: p.chunk });
    }
    return [...players.values()];
  }

  return { readFile, parseBytes, build };
})();
