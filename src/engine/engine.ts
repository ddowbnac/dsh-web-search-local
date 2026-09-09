import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { walkCorpus } from './walk.js';
import { Fts5Driver, fts5Available, fts5AvailableSync } from './fts5.js';
import { JsonDriver } from './fallback.js';
import type { DocRow, EngineOptions, Hit, IndexStats, SearchDriver } from '../types.js';


export interface EngineEvents {
  onEvent?: (event: { type: string; [k: string]: unknown }) => void;
}

export interface LocalEngine {
  search(query: string, maxResults?: number, signal?: AbortSignal): Promise<Hit[]>;
  ensure(signal?: AbortSignal): Promise<IndexStats>;
  reindex(signal?: AbortSignal): Promise<IndexStats>;
  getStats(): IndexStats | null;
  isReady(): boolean;
  driverKind(): 'fts5' | 'json';
  corpusDirs(): readonly string[];
  warm(): void;
  dispose(): Promise<void>;
}

const EMPTY: IndexStats = { added: 0, changed: 0, removed: 0, unchanged: 0, totalDocs: 0, elapsedMs: 0 };

interface ManifestEntry {
  hash: string;
  mtimeMs: number;
  size: number;
}
interface Manifest {
  version: number;
  files: Record<string, ManifestEntry>;
}
const MANIFEST_VERSION = 1;

async function createDriver(indexPath: string, opts: EngineOptions): Promise<SearchDriver> {
  if (await fts5Available()) {
    return new Fts5Driver(indexPath, opts);
  }
  return new JsonDriver(indexPath, opts);
}

export function createEngine(opts: EngineOptions, events?: EngineEvents): LocalEngine {
  let driver: SearchDriver | undefined;
  let manifest = loadManifest(join(opts.indexPath, 'manifest.json'));
  let lastScanMs = 0;
  let built = false;
  let stats: IndexStats | null = null;
  let disposed = false;
  let warmPromise: Promise<IndexStats> | undefined;

  let tail: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((r) => (release = r));
    return prev
      .catch(() => {})
      .then(async () => {
        try {
          return await fn();
        } finally {
          release();
        }
      });
  }

  async function initDriver(): Promise<SearchDriver> {
    if (driver) return driver;
    const d = await createDriver(opts.indexPath, opts);
    await d.open();
    driver = d;
    events?.onEvent?.({ type: 'engine/driver', kind: d.kind, indexPath: opts.indexPath });
    return d;
  }

  function saveManifest(files: Record<string, ManifestEntry>): void {
    mkdirSync(opts.indexPath, { recursive: true });
    const path = join(opts.indexPath, 'manifest.json');
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: MANIFEST_VERSION, files }));
    renameSync(tmp, path);
    manifest = { version: MANIFEST_VERSION, files };
  }

  async function build(
    mode: 'full' | 'incremental',
    signal?: AbortSignal,
  ): Promise<IndexStats> {
    const d = await initDriver();
    const t0 = Date.now();
    const { rows, truncated } = await walkCorpus(opts, signal);
    if (signal?.aborted) throw abortError(signal);

    const old = manifest.files;
    const newFiles: Record<string, ManifestEntry> = truncated ? { ...old } : {};
    for (const r of rows) newFiles[r.key] = { hash: r.hash, mtimeMs: r.mtimeMs, size: r.size };

    let added = 0;
    let changed = 0;
    let unchanged = 0;
    const toUpsert: DocRow[] = [];
    for (const r of rows) {
      const prev = old[r.key];
      if (mode === 'full') {
        added++;
        toUpsert.push(r);
      } else if (!prev) {
        added++;
        toUpsert.push(r);
      } else if (prev.hash !== r.hash) {
        changed++;
        toUpsert.push(r);
      } else {
        unchanged++;
      }
    }
    const removedKeys = truncated ? [] : Object.keys(old).filter((k) => !(k in newFiles));
    const removed = removedKeys.length;

    if (toUpsert.length > 0) await d.upsert(toUpsert);
    if (removedKeys.length > 0) await d.delete(removedKeys);
    saveManifest(newFiles);

    const totalDocs = await d.count();
    const result: IndexStats = {
      added,
      changed,
      removed,
      unchanged,
      totalDocs,
      elapsedMs: Date.now() - t0,
    };
    stats = result;
    built = true;
    lastScanMs = Date.now();
    events?.onEvent?.({ type: 'engine/indexed', mode, ...result, truncated });
    return result;
  }

  const engine: LocalEngine = {
    async search(query, maxResults = 20, signal) {
      if (disposed) throw new Error('engine disposed');
      await engine.ensure(signal);
      if (signal?.aborted) throw abortError(signal);
      const d = driver!;
      return d.search(query, maxResults);
    },
    async ensure(signal) {
      if (disposed) throw new Error('engine disposed');
      return withLock(async () => {
        if (!driver) await initDriver();
        if (!built) {
          await build('full', signal);
          return stats ?? EMPTY;
        }
        if (!opts.autoReindex) return stats ?? EMPTY;
        if (Date.now() - lastScanMs < opts.minReindexIntervalMs) return stats ?? EMPTY;
        await build('incremental', signal);
        return stats ?? EMPTY;
      });
    },
    async reindex(signal) {
      if (disposed) throw new Error('engine disposed');
      return withLock(async () => {
        if (!driver) await initDriver();
        await build(built ? 'incremental' : 'full', signal);
        return stats ?? EMPTY;
      });
    },
    getStats() {
      return stats;
    },
    isReady() {
      return built;
    },
    driverKind() {
      return driver?.kind ?? (fts5AvailableSync() ? 'fts5' : 'json');
    },
    corpusDirs() {
      return opts.corpusDirs;
    },
    warm() {
      if (disposed) return;
      if (!warmPromise) {
        warmPromise = engine
          .ensure()
          .catch((e) => events?.onEvent?.({ type: 'engine/warm-error', error: String(e) }));
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await driver?.close();
      } catch {
      }
    },
  };

  return engine;
}

function loadManifest(path: string): Manifest {
  if (!existsSync(path)) return { version: MANIFEST_VERSION, files: {} };
  try {
    const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    if (m.version === MANIFEST_VERSION && m.files) return m;
  } catch {
  }
  return { version: MANIFEST_VERSION, files: {} };
}

function abortError(signal?: AbortSignal): Error {
  return new Error('aborted', { cause: signal?.reason });
}
