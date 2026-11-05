// The records Canary writes (src/Recording/Records.cs). Every field is optional: older versions wrote fewer.

export interface Rec {
  type: string
  t: number
  [key: string]: unknown
}

export interface Environment {
  platform?: string
  os?: string
  cores?: number
  linuxKernel?: string
  container?: string
}

export interface Melon {
  name?: string
  version?: string
  author?: string
  file?: string
}

export interface ManagedMod {
  id?: string
  version?: string
  parity_required?: boolean
  targets?: string[]
  client_side?: boolean
  server_side?: boolean
  source_repo?: string
}

export interface ServerInfo {
  name?: string
  scene?: string
  melonLoader?: string
  tavernLib?: string
  launcher?: string
  maxPlayers?: number
  password?: boolean
  whitelist?: boolean
  communityListed?: boolean
  region?: string
  gcTimerSeconds?: number
  modsHash?: string
  errors?: string[]
  melons?: Melon[]
  mods?: ManagedMod[]
  untracked?: { name: string }[]
}

export interface Header extends Rec {
  canary?: string
  game?: string
  kind?: string
  name?: string
  part?: number
  utcOffsetMin?: number
  timeZone?: string
  daylightSaving?: boolean
  settings?: Partial<Settings>
  environment?: Environment
  server?: ServerInfo
}

export interface Sample extends Rec {
  frames?: number
  avgMs?: number
  p50Ms?: number
  p95Ms?: number
  maxMs?: number
  gc?: number[]
  heapMb?: number
  memMb?: number
  players?: number
  entities?: number
  errors?: number
  modules?: Record<string, number>
  phases?: Record<string, number>
  chunks?: number
  sections?: Record<string, number>
  metrics?: Record<string, number>
}

export interface Spike extends Rec {
  ms: number
  gc?: boolean
  players: number
  entities: number
  phases?: Record<string, number>
}

export interface ErrorRec extends Rec {
  id?: string
  level?: string
  logger?: string
  mod?: string
  message?: string
}

export interface Census extends Rec {
  total: number
  durationMs: number
  byPrefab?: Record<string, number>
  byChunk?: Record<string, number>
}

export interface Mark extends Rec {
  text?: string
}

export interface PlayerPosition {
  id: number
  name?: string
  x: number
  y: number
  z: number
  chunk?: string
}

export interface Positions extends Rec {
  players?: PlayerPosition[]
}

export interface Machine {
  cores?: number
  cpuPct?: number
  memUsedMb?: number
  memTotalMb?: number
  netRxKBps?: number
  netTxKBps?: number
  diskFreeGb?: number
}

export interface Container {
  kind?: string
  cpuCores?: number
  cpuPct?: number
  cpuLimitCores?: number
  throttledPct?: number
  memMb?: number
  memLimitMb?: number
  diskReadKBps?: number
  diskWriteKBps?: number
  netRxKBps?: number
  netTxKBps?: number
  processes?: number
}

export interface Resources extends Rec {
  cpuPct?: number
  cpuCores?: number
  memMb?: number
  privateMb?: number
  handles?: number
  threads?: number
  diskReadKBps?: number
  diskWriteKBps?: number
  gameOutKBps?: number
  gamePacketsOut?: number
  gamePacketsIn?: number
  children?: { name: string; cpuPct?: number; memMb?: number }[]
  totalCpuPct?: number
  totalMemMb?: number
  machine?: Machine
  container?: Container
}

// From a report zip's errors.json.
export interface ErrorGroup {
  Id?: string
  Level?: string
  Mod?: string
  Message?: string
  Count?: number
  Stack?: string
}

export interface ModsJson {
  melons?: Melon[]
  modsFolder?: { id?: string; files?: string[] }[]
}

export interface Settings {
  spikeMs: number
  positionSeconds: number
  censusSeconds: number
  resourceSeconds: number
}

export interface ParsedFile {
  name: string
  size: number
  container?: "zip" | "gzip" | "text"
  records: Rec[]
  notes: string[]
  extras: { errorGroups?: ErrorGroup[]; mods?: ModsJson; summary?: string }
  headers: Header[]
  tMin: number | null
  tMax: number | null
}

export type Col = (number | null)[]

export interface SampleCols {
  t: number[]
  avg: Col
  p50: Col
  p95: Col
  max: Col
  heap: Col
  mem: Col
  players: Col
  entities: Col
  errors: Col
  gc: Col
  frames: Col
  chunks: Col
  modules: Record<string, Col>
  sections: Record<string, Col>
  metrics: Record<string, Col>
  phases: Record<string, Col>
}

export const RESOURCE_KEYS = [
  "cpuPct", "cpuCores", "totalCpuPct", "memMb", "privateMb", "totalMemMb", "handles", "threads",
  "diskRead", "diskWrite", "gameOut", "pktOut", "pktIn",
  "mCpu", "mMemUsed", "mMemTotal", "rx", "tx", "diskFree",
  "cCores", "cLimit", "cThrottled", "cMem", "cMemLimit", "cDiskRead", "cDiskWrite", "cRx", "cTx", "cProcs",
] as const

export type ResourceCols = Record<(typeof RESOURCE_KEYS)[number], Col> & {
  t: number[]
  hasContainer: boolean
  children: Record<string, { cpu: Col; mem: Col }>
}

export interface TrackPoint {
  t: number
  x: number
  y: number
  z: number
  chunk?: string
}

export interface Player {
  id: number
  name: string
  points: TrackPoint[]
  order: number
}

export interface Gap {
  from: number
  to: number
}

export interface Model {
  files: ParsedFile[]
  headers: Header[]
  samples: Sample[]
  spikes: Spike[]
  errors: ErrorRec[]
  positions: Positions[]
  census: Census[]
  resources: Resources[]
  marks: Mark[]
  errorGroups: ErrorGroup[]
  mods: ModsJson | null
  summaries: { name: string; text: string }[]
  tMin: number
  tMax: number
  all: Rec[]
  environment: Environment | null
  serverHeader: Header | null
  server: ServerInfo | null
  inContainer: boolean
  settings: Settings
  gaps: Gap[]
  cols: SampleCols
  res: ResourceCols
  players: Player[]
  phaseNames: { work: string[]; idle: string[] }
}
