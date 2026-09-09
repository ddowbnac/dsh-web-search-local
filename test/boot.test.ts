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

function mockCtx() {
  const web = new MockWeb();
  const ctx = {
    web,
    get: (n: string) => (n === 'dshHomePath' ? (s: string) => join(tmpdir(), 'dsh-home', s) : undefined),
    inject: (deps: string[], cb: (c: any) => void) => {
      if (deps.includes('settings')) {
        cb({
          settings: {
            installSection: (_owner: unknown, _ns: string, _schema: unknown, entry: unknown, hooks: any) => {
              hooks.setSource(() => entry);
            },
          },
        });
      }
    },
  };
  return ctx;
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
      const ctx: any = mockCtx();
      apply(ctx, { corpusDirs: [dir], indexDir: join(dir, 'idx') } as any);

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
      const ctx: any = mockCtx();
      apply(ctx, { corpusDirs: [dir], indexDir: join(dir, 'idx') } as any);
      const res = await ctx.web.search({ query: 'index', maxResults: 1 });
      expect(res.sources.length).toBeLessThanOrEqual(1);
      expect(typeof res.truncated).toBe('boolean');
      await ctx.__localSearchEngine().dispose();
    } finally {
      await cleanup(dir);
    }
  });
});
