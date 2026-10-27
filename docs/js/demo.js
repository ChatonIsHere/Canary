// Synthetic demo data, in exactly the format the mod writes, so the viewer can be tried without a server.
// It's made up: five players wandering about, a mod that throws, logs piling up, the usual garbage
// collection pauses. The "server" is in UTC-05:00 so the time zone switch has something to show.
"use strict";

const Demo = (() => {
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function generate() {
    const r = rng(42);
    const hours = 2;
    const end = Math.floor(Date.now() / 60000) * 60000 - 10 * 60000;
    const start = end - hours * 3600000;
    const offsetMin = -300;
    const recs = [];
    const iso = (ms, off) => {
      const d = new Date(ms + off * 60000).toISOString().replace("Z", "");
      const sign = off < 0 ? "-" : "+", a = Math.abs(off);
      return `${d}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
    };
    recs.push({
      type: "header", t: start, canary: "demo", game: "demo", kind: "demo (synthetic data)",
      utc: new Date(start).toISOString(), serverTime: iso(start, offsetMin), utcOffsetMin: offsetMin,
      timeZone: "Eastern Standard Time", timeZoneName: "(UTC-05:00) Eastern Time (US & Canada)", daylightSaving: false,
      settings: { spikeMs: 200, bufferMinutes: 10, positionSeconds: 5, censusSeconds: 60, recordUpdateModules: true, resourceSeconds: 5 },
      environment: { platform: "Wine 10.0", os: "Windows 10 (10.0.19045) 64bit", cores: 24, linuxKernel: "6.8.0-45-generic", container: "Docker" },
    });

    const names = ["Rowan", "Ash", "Kit", "Sage", "Wren"];
    // Each player has a base they potter around, and the odd trip between bases.
    const bases = [[-180, 120], [160, 200], [40, -160], [-220, -140], [210, -40]];
    const players = names.map((name, i) => ({
      id: 1000 + i, name, x: bases[i][0], y: 130, z: bases[i][1], hx: r() * Math.PI * 2, home: bases[i],
      join: start + i * 9 * 60000, leave: i === 3 ? start + 70 * 60000 : end + 1,
    }));
    const restartFrom = start + 95 * 60000, restartTo = restartFrom + 3 * 60000;
    let heap = 420, logs = 40, bodies = 0;
    const scene = 4181;
    let gcNext = start + 20000;

    for (let t = start; t <= end; t += 1000) {
      if (t >= restartFrom && t < restartTo) continue;
      const online = players.filter(p => t >= p.join && t < p.leave);
      // Heap creeps up between collections; a collection takes it back down and sometimes stalls a frame.
      heap += 0.9 + online.length * 0.25 + r() * 0.4;
      let gc = 0, gcSpike = 0;
      if (t >= gcNext) {
        gc = 1;
        gcSpike = heap > 520 ? 900 + r() * 900 : 30 + r() * 120;
        heap = 400 + r() * 30 + (t - start) / 3600000 * 25;
        gcNext = t + 15000 + r() * 20000;
      }
      const load = 1 + online.length * 0.18;
      const avg = 11.1 + r() * 0.3 * load;
      let max = avg + r() * 4 * load;
      const busyBase = t > start + 60 * 60000 && t < start + 66 * 60000; // a player's big build
      if (busyBase && r() < 0.08) max = 220 + r() * 300;
      if (gcSpike) max = Math.max(max, gcSpike);
      const sample = {
        type: "sample", t, frames: max > 200 ? 88 : 90, avgMs: +avg.toFixed(2), p50Ms: +(avg - 0.1).toFixed(2),
        p95Ms: +(avg + r() * 1.5 * load).toFixed(2), maxMs: +max.toFixed(2), gc: [gc, gc, gc],
        heapMb: +heap.toFixed(2), memMb: +(1900 + heap * 0.3 + online.length * 22).toFixed(2), players: online.length,
        entities: scene + logs + bodies, errors: 0,
        modules: {
          "Shared Update Module": +(0.4 + r() * 0.2 + online.length * 0.6).toFixed(3),
          "AI Agent Updater": +(2 + r() * 1.5 + online.length * 1.2).toFixed(3),
          "Networking Receiving": +(0.6 + online.length * 3.5 + r()).toFixed(3),
          "Networking Sending": +(0.1 + online.length * 2.1 + r() * 0.5).toFixed(3),
          "Heat Source Update": +(0.05 + r() * 0.05).toFixed(3),
        },
        sections: { "DemoMod.Pathfinding": +(online.length * 4 + r() * 3).toFixed(2) },
        metrics: { "DemoMod.QueueLength": Math.round(online.length * 3 + r() * 5) },
      };
      if (busyBase) sample.modules["Shared Update Module"] += 25 + r() * 20;
      if (online.length && r() < 0.004) { sample.errors = 1 + Math.floor(r() * 3); }
      recs.push(sample);
      if (max >= 200 && t > start + 15000) {
        recs.push({ type: "spike", t: t - 400, ms: +max.toFixed(2), gc: !!gcSpike && gcSpike >= 200, players: online.length, entities: sample.entities });
      }

      // Every 5 s: positions and resources.
      if ((t - start) % 5000 === 0) {
        for (const p of online) {
          if (r() < 0.003) p.home = bases[Math.floor(r() * bases.length)];
          p.hx += (r() - 0.5) * 0.7;
          const dx = p.home[0] - p.x, dz = p.home[1] - p.z;
          if (Math.hypot(dx, dz) > 60) p.hx += Math.sign(Math.sin(Math.atan2(dz, dx) - p.hx)) * 0.6;
          const speed = 0.4 + r() * 1.2;
          p.x += Math.cos(p.hx) * speed * 5; p.z += Math.sin(p.hx) * speed * 5;
          p.y = 120 + Math.sin(p.x / 40) * 8;
        }
        if (online.length) recs.push({
          type: "positions", t, players: online.map(p => ({
            id: p.id, name: p.name, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
            chunk: `Chunk ${Math.floor((p.x + 1000) / 80)}-${Math.floor((p.z + 1000) / 80)}`,
          })),
        });
        const cores = 0.35 + online.length * 0.22 + (busyBase ? 0.6 : 0) + r() * 0.1;
        recs.push({
          type: "resources", t, cpuPct: +(cores / 24 * 100).toFixed(2), cpuCores: +cores.toFixed(2),
          memMb: sample.memMb, privateMb: +(sample.memMb * 1.05).toFixed(2), handles: 1160 + Math.floor((t - start) / 600000),
          threads: 81, diskReadKBps: +(r() * 30).toFixed(2), diskWriteKBps: +(4 + r() * 20 + ((t - start) % 300000 < 5000 ? 900 : 0)).toFixed(2),
          gameOutKBps: +(online.length * (35 + r() * 15)).toFixed(2), gamePacketsOut: +(online.length * 60 + r() * 10).toFixed(2),
          gamePacketsIn: +(online.length * 45 + r() * 10).toFixed(2),
          children: [{ pid: 4242, name: "UnityCrashHandler64.exe", threads: 3, cpuPct: 0, memMb: 12 }],
          container: (() => {
            // A 2-core, 4 GB container: the big build pushes it into its CPU limit.
            const want = cores + 0.15 + (busyBase ? 1.1 : 0);
            const used = Math.min(2, want);
            return {
              kind: "Docker", cpuCores: +used.toFixed(2), cpuPct: +(used / 2 * 100).toFixed(2), cpuLimitCores: 2,
              throttledPct: +Math.max(0, (want - 2) / want * 100).toFixed(2), throttles: want > 2 ? 40 : 0,
              memMb: +(sample.memMb + 180).toFixed(2), memLimitMb: 4096,
              diskReadKBps: +(r() * 40).toFixed(2), diskWriteKBps: +(6 + r() * 25).toFixed(2),
              netRxKBps: +(online.length * 30 + r() * 8).toFixed(2), netTxKBps: +(online.length * 48 + r() * 10).toFixed(2), processes: 14,
            };
          })(),
          totalCpuPct: +(cores / 24 * 100).toFixed(2), totalMemMb: +(sample.memMb + 12).toFixed(2),
          machine: {
            cores: 24, cpuPct: +(4 + cores / 24 * 100 + r() * 3 + (t > start + 80 * 60000 && t < start + 88 * 60000 ? 84 : 0)).toFixed(2),
            memUsedMb: +(23000 + sample.memMb * 0.2).toFixed(2), memTotalMb: 64660, netRxKBps: +(online.length * 30 + r() * 8).toFixed(2),
            netTxKBps: +(online.length * 48 + r() * 10).toFixed(2), diskFreeGb: +(64.8 - (t - start) / 3600000 * 0.4).toFixed(2), diskTotalGb: 1863,
          },
        });
      }

      // Every minute: the census. Dropped logs pile up while players are chopping.
      if ((t - start) % 60000 === 0) {
        logs += online.length * (3 + Math.floor(r() * 4));
        bodies = Math.max(0, bodies + Math.floor(r() * 5) - 2);
        recs.push({
          type: "census", t, total: scene + logs + bodies + 60, durationMs: +(1.4 + r()).toFixed(2),
          byPrefab: {
            "(placed in the scene)": scene, "Wood Log": logs, "Copper Boulder": 9 + Math.floor(r() * 2),
            "Bush": 31, "MushroomRed Full Ripe": 3, "Dropped Stick": Math.floor(logs / 4), "Wyrm Corpse": bodies, "Arrow": 12,
          },
          byChunk: { "Global Chunk": scene, "Chunk 12-13": 40 + Math.floor(logs * 0.7), "Chunk 11-12": 30 + Math.floor(logs * 0.2), "Chunk 13-12": 22 },
        });
      }
    }

    const errAt = (min, e) => recs.push(Object.assign({ type: "error", t: start + min * 60000 }, e));
    errAt(12, { id: "4f1c2a90", level: "Error", logger: "MelonLoader", mod: "DemoMod", message: "System.NullReferenceException: Object reference not set to an instance of an object" });
    errAt(33, { id: "a83b0c11", level: "Warn", logger: "Unhandled", mod: "game", message: "The referenced script on this Behaviour is missing!" });
    errAt(61, { id: "77de0f42", level: "Error", logger: "DemoMod.Building", mod: "DemoMod", message: "Couldn't place structure: too many pieces in chunk" });
    errAt(83, { id: "0c9e7b55", level: "Error", logger: "Alta.Api.DataTransferModels.Utility.RetryHandler", mod: "game", message: "System.Net.Http.HttpRequestException: Failed sending web request" });
    const mark = (min, text) => recs.push({ type: "mark", t: start + min * 60000, text });
    mark(59, "Rowan starts building the big hall");
    mark(80, "Backup job running on the host");
    mark(98, "Server back after restart");

    // After the restart, a new header, as a new part would have.
    recs.push(Object.assign({}, recs[0], { t: restartTo, utc: new Date(restartTo).toISOString(), serverTime: iso(restartTo, offsetMin), part: 2 }));
    recs.sort((a, b) => a.t - b.t);

    const errorGroups = [
      { Id: "4f1c2a90", Level: "Error", Logger: "MelonLoader", Mod: "DemoMod", ExceptionType: "System.NullReferenceException", Message: "System.NullReferenceException: Object reference not set to an instance of an object", Stack: "System.NullReferenceException: Object reference not set to an instance of an object\n  at DemoMod.Pathfinding.Step () [0x00012]\n  at DemoMod.DemoMod.OnUpdate () [0x00003]", FirstSeen: new Date(start + 12 * 60000).toISOString(), LastSeen: new Date(end - 60000).toISOString(), Count: 1284 },
      { Id: "77de0f42", Level: "Error", Logger: "DemoMod.Building", Mod: "DemoMod", Message: "Couldn't place structure: too many pieces in chunk", FirstSeen: new Date(start + 61 * 60000).toISOString(), LastSeen: new Date(start + 66 * 60000).toISOString(), Count: 57 },
      { Id: "a83b0c11", Level: "Warn", Logger: "Unhandled", Mod: "game", Message: "The referenced script on this Behaviour is missing!", FirstSeen: new Date(start + 33 * 60000).toISOString(), LastSeen: new Date(start + 33 * 60000).toISOString(), Count: 4 },
      { Id: "0c9e7b55", Level: "Error", Logger: "Alta.Api.DataTransferModels.Utility.RetryHandler", Mod: "game", ExceptionType: "System.Net.Http.HttpRequestException", Message: "System.Net.Http.HttpRequestException: Failed sending web request", FirstSeen: new Date(start + 83 * 60000).toISOString(), LastSeen: new Date(start + 84 * 60000).toISOString(), Count: 2 },
    ];
    const mods = {
      melons: [
        { name: "TavernLib", version: "1.5.4", author: "Tavern Team", file: "TavernLib.dll" },
        { name: "Canary", version: "demo", author: "ChatonIsHere", file: "Canary.dll" },
        { name: "DemoMod", version: "2.1.0", author: "Someone", file: "DemoMod.dll" },
      ],
      modsFolder: [{ folder: "Someone.DemoMod", id: "Someone.DemoMod", version: "2.1.0", files: ["DemoMod.dll", "manifest.json"] }],
    };
    return {
      name: "demo (synthetic data)", size: 0, container: "demo", records: recs,
      notes: ["This is made-up demo data, not a real server."],
      extras: { errorGroups, mods, summary: "Demo data: made up to show what the viewer does." },
    };
  }

  return { generate };
})();
