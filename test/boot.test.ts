import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, Config, name, inject, WEB_SEARCH_LOCAL_SETTINGS_NAMESPACE } from '../src/index.js';
import { makeCorpus, cleanup } from './helpers.js';

class MockWeb {
  searchProviders = new Map<string, any>();
  fetchProviders = new Map<string, any>();
  config: { searchProvider?: string; fetchProvider?: string } = { searchProvider: 'local', fetchProvider: 'local' };

  registerSearchProvider(p: any): () => void {
    if (this.searchProviders.has(p.id)) throw new Error('WEB_DUPLICATE_PROVIDER');
    this.searchProviders.set(p.id, p);
    return () => this.searchProviders.delete(p.id);
  }
  registerFetchProvider(p: any): () => void {
    if (this.fetchProviders.has(p.id)) throw new Error('WEB_DUPLICATE_PROVIDER');
    this.fetchProviders.set(p.id, p);
    return () => this.fetchProviders.delete(p.id);
  }
  private pick(kind: 'search' | 'fetch'): any {
    const reg = kind === 'search' ? this.searchProviders : this.fetchProviders;
    const id = kind === 'search' ? this.config.searchProvider : this.config.fetchProvider;
    if (id) {
      if (!reg.has(id)) throw new Error('WEB_PROVIDER_CONFIGURED_MISSING');
      const p = reg.get(id);
      if (!p.available()) throw new Error('WEB_PROVIDER_CONFIGURED_UNAVAILABLE');
      return p;
    }
    const usable = [...reg.values()].filter((p) => p.available());
    if (usable.length === 1) return usable[0];
    if (usable.length > 1) throw new Error('WEB_PROVIDER_AMBIGUOUS');
    throw new Error('WEB_PROVIDER_UNAVAILABLE');
  }
  async search(req: { query: string; maxResults?: number }, signal?: AbortSignal) {
    const p = this.pick('search');
    const r = await p.search(req, signal);
    if (req.maxResults != null && r.sources.length > req.maxResults) {
      return { ...r, sources: r.sources.slice(0, req.maxResults), truncated: true };
    }
    return r;
  }
  async fetch(req: { url: string }, signal?: AbortSignal) {
    const p = this.pick('fetch');
    return p.fetch(req, signal);
  }
}

// cosmokit's volatile write marker (global symbol shared across inlined refs).
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** A single 0.1.7 volatile ref (cosmokit `createVolatile` shape): live value read via `.get()`. */
type VolatileRef<T> = { readonly get: () => T; [VOLATILE_WRITE]: (v: T) => void };

type Engine = 'auto' | 'duckduckgo' | 'searxng';

interface VolatileConfig {
  readonly corpusDirs: VolatileRef<string[]>;
  readonly include: VolatileRef<string[]>;
  readonly exclude: VolatileRef<string[]>;
  readonly indexDir: VolatileRef<string>;
  readonly maxResults: VolatileRef<number>;
  readonly snippetLength: VolatileRef<number>;
  readonly engine: VolatileRef<Engine>;
  readonly autoReindex: VolatileRef<boolean>;
  readonly maxFileSizeBytes: VolatileRef<number>;
}

type EngineHandle = { corpusDirs(): string[]; dispose(): Promise<void> };

/** The boot ctx seam: everything `apply` can legally use here, plus the `__localSearchEngine` handle it defines. */
type BootContext = {
  web: MockWeb;
  on: (event: string, handler: (paths: string[][]) => void) => void;
  get: (n: string) => ((s: string) => string) | undefined;
  __localSearchEngine: () => EngineHandle;
};

/**
 * Build a 0.1.7 volatile-shaped config: each of the 9 `Config` fields is a live ref read
 * via `.get()`, seeded from plain values. Mutate the underlying value through the
 * `cosmokit.volatile.write` symbol the way the 0.1.7 host loader re-resolves volatile
 * fields in place (no apply re-run).
 */
function withRefs(seed: {
  corpusDirs: string[];
  include?: string[];
  exclude?: string[];
  indexDir?: string;
  maxResults?: number;
  snippetLength?: number;
  engine?: Engine;
  autoReindex?: boolean;
  maxFileSizeBytes?: number;
}): { config: VolatileConfig } {
  let corpusDirs = [...seed.corpusDirs];
  let include = [...(seed.include ?? [])];
  let exclude = [...(seed.exclude ?? [])];
  let indexDir = seed.indexDir ?? '';
  let maxResults = seed.maxResults ?? 20;
  let snippetLength = seed.snippetLength ?? 160;
  let engine: Engine = seed.engine ?? 'auto';
  let autoReindex = seed.autoReindex ?? true;
  let maxFileSizeBytes = seed.maxFileSizeBytes ?? 5_000_000;
  const ref = <T>(initial: T): VolatileRef<T> => ({
    get: () => initial,
    [VOLATILE_WRITE]: (v: T) => void (initial = v),
  });
  return {
    config: {
      corpusDirs: ref(corpusDirs),
      include: ref(include),
      exclude: ref(exclude),
      indexDir: ref(indexDir),
      maxResults: ref(maxResults),
      snippetLength: ref(snippetLength),
      engine: ref(engine),
      autoReindex: ref(autoReindex),
      maxFileSizeBytes: ref(maxFileSizeBytes),
    },
  };
}

function mockCtx(): { ctx: BootContext; events: Record<string, Array<() => void>> } {
  const web = new MockWeb();
  const events: Record<string, Array<() => void>> = {};
  const ctx = {
    web,
    on: (event: string, handler: (paths: string[][]) => void) => {
      (events[event] ??= []).push(() => handler([] as string[][]));
    },
    get: (n: string) => (n === 'dshHomePath' ? (s: string) => join(tmpdir(), 'dsh-home', s) : undefined),
  } as BootContext; // `apply` defines `__localSearchEngine` on the ctx at runtime.
  return { ctx, events };
}

function boot(seed: { corpusDirs: string[]; indexDir: string }) {
  const { ctx, events } = mockCtx();
  const { config } = withRefs({ corpusDirs: seed.corpusDirs, indexDir: seed.indexDir });
  apply(ctx, config as any); // the harness refs carry no cosmokit provenance; `apply` only reads `.get()`.
  return { ctx, events, config };
}

describe('plugin entry', () => {
  test('exports the expected plugin shape', () => {
    expect(name).toBe('web-search-local');
    expect(inject).toEqual(['web']);
    expect(WEB_SEARCH_LOCAL_SETTINGS_NAMESPACE).toBe('web-search-local');
    expect(Config).toBeDefined();
  });

  test('apply registers local search + fetch providers; ctx.web.search returns file:// sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-boot-'));
    try {
      makeCorpus(dir);
      const { ctx } = boot({ corpusDirs: [dir], indexDir: join(dir, 'idx') });

      expect(ctx.web.searchProviders.has('local')).toBe(true);
      expect(ctx.web.fetchProviders.has('local')).toBe(true);

      const res = await ctx.web.search({ query: 'sqlite', maxResults: 10 });
      expect(res.sources.length).toBeGreaterThan(0);
      expect(res.sources[0].url.startsWith('file://')).toBe(true);
      expect(res.truncated).toBe(false);

      const fetchRes = await ctx.web.fetch({ url: res.sources[0].url });
      expect(fetchRes.statusCode).toBe(200);
      expect(fetchRes.body.content.length).toBeGreaterThan(0);

      await ctx.__localSearchEngine().dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('seam caps sources to maxResults and sets truncated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-boot-'));
    try {
      makeCorpus(dir);
      const { ctx } = boot({ corpusDirs: [dir], indexDir: join(dir, 'idx') });
      const res = await ctx.web.search({ query: 'index', maxResults: 1 });
      expect(res.sources.length).toBeLessThanOrEqual(1);
      expect(typeof res.truncated).toBe('boolean');
      await ctx.__localSearchEngine().dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('a volatile config change flows live without apply being re-run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-boot-'));
    try {
      makeCorpus(dir);
      const { ctx, events, config } = boot({ corpusDirs: [], indexDir: join(dir, 'idx') });

      // Materialize the engine over the initial (empty) corpus.
      const res1 = await ctx.web.search({ query: 'rust' });
      expect(res1.sources.length).toBe(0);
      const before = ctx.__localSearchEngine();

      // The 0.1.7 host updates the volatile ref in place and emits `loader/volatile-update`
      // on the fiber (no apply re-run): the plugin must re-resolve on the next build.
      config.corpusDirs[VOLATILE_WRITE]([dir]);
      (events['loader/volatile-update'] ?? []).forEach((h) => h());

      const after = ctx.__localSearchEngine();
      expect(after).not.toBe(before);
      expect(after.corpusDirs()).toEqual([dir]);
      const res2 = await ctx.web.search({ query: 'rust' });
      expect(res2.sources.length).toBeGreaterThan(0);

      await after.dispose();
    } finally {
      await cleanup(dir);
    }
  });
});
