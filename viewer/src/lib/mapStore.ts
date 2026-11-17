// Game map: map.png and map.json from tools/extract_map.py, drawn under the player positions. Kept in
// IndexedDB for next time; without storage it lasts until the page closes. Without one, the bundled map is used.
import type { MapMeta } from "./map"

interface Saved { meta: MapMeta; blob: Blob }

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((ok, fail) => {
    const req = indexedDB.open("canary", 1)
    req.onupgradeneeded = () => req.result.createObjectStore("map")
    req.onerror = () => fail(req.error)
    req.onsuccess = () => {
      const db = req.result
      try {
        const tx = db.transaction("map", mode)
        const r = fn(tx.objectStore("map"))
        tx.oncomplete = () => { db.close(); ok(r.result) }
        tx.onerror = tx.onabort = () => { db.close(); fail(tx.error) }
      } catch (e) { db.close(); fail(e) }
    }
  })
}

export const mapDb = {
  async get(): Promise<Saved | null> { try { return (await run<Saved | undefined>("readonly", (s) => s.get("current"))) ?? null } catch { return null } },
  async set(v: Saved) { try { await run("readwrite", (s) => s.put(v, "current")); return true } catch { return false } },
  async clear() { try { await run("readwrite", (s) => s.delete("current")) } catch { /* no storage */ } },
}

export const isMapMeta = (j: unknown): j is MapMeta => {
  const m = j as MapMeta | null
  return !!m && [m.bottomLeft, m.topRight].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
    && m.topRight[0] > m.bottomLeft[0] && m.topRight[1] > m.bottomLeft[1]
}

// The map that ships with the viewer (public/map.json and its image), or null if it can't be fetched.
export async function bundledMap(): Promise<Saved | null> {
  try {
    const r = await fetch("map.json")
    const meta: unknown = r.ok ? await r.json() : null
    if (!isMapMeta(meta)) return null
    const img = await fetch(meta.image || "map.webp")
    return img.ok ? { meta, blob: await img.blob() } : null
  } catch { return null }
}

// Takes map.png and map.json (recognised by content) out of a batch of files.
export async function splitMapFiles(files: File[]) {
  const rest: File[] = [], images: File[] = []
  let meta: MapMeta | null = null
  for (const f of files) {
    if (/^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)) { images.push(f); continue }
    if (/\.json$/i.test(f.name) && f.size < 65536) {
      try { const j = JSON.parse(await f.text()); if (isMapMeta(j)) { meta = j; continue } } catch { /* not a map */ }
    }
    rest.push(f)
  }
  return { rest, meta, images }
}

const store = {
  get(k: string) { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* private window */ } },
}
export { store }
