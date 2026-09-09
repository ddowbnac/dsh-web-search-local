import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSearchProvider, LOCAL_SEARCH_PROVIDER_ID } from '../src/provider.js';
import { LocalFetchProvider, LOCAL_FETCH_PROVIDER_ID } from '../src/fetch-provider.js';
import { createEngine } from '../src/engine/engine.js';
import { makeCorpus, cleanup } from './helpers.js';
import type { EngineOptions } from '../src/types.js';

function engineOpts(root: string, index: string, overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    corpusDirs: [root],
    indexPath: index,
    includeExts: new Set(['md', 'markdown', 'txt', 'html', 'htm', 'js']),
    excludeDirs: new Set(['node_modules']),
    excludeFiles: new Set(['.ds_store']),
    excludeSuffixes: ['.min.js', '.map'],
    maxFileSizeBytes: 5_000_000,
    snippetLength: 160,
    autoReindex: true,
    minReindexIntervalMs: 2000,
    maxFilesPerBuild: 20_000,
    ...overrides,
  };
}

describe('LocalSearchProvider', () => {
  test('id and available', async () => {
    const p = new LocalSearchProvider(() => createEngine(engineOpts(mkdtempSync(join(tmpdir(), 'dsh-p-')), join(tmpdir(), 'i'))));
    expect(p.id).toBe(LOCAL_SEARCH_PROVIDER_ID);
    expect(p.id).toBe('local');
    expect(p.available()).toBe(true);
  });

  test('search returns seam-shaped sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-p-'));
    try {
      makeCorpus(dir);
      const engine = createEngine(engineOpts(dir, join(dir, 'idx')));
      const p = new LocalSearchProvider(() => engine);
      const res = await p.search({ query: 'sqlite', maxResults: 10 });
      expect(res.truncated).toBe(false);
      expect(res.sources.length).toBeGreaterThan(0);
      const s = res.sources[0];
      expect(s.url.startsWith('file://')).toBe(true);
      expect(typeof s.title).toBe('string');
      expect(typeof s.snippet).toBe('string');
      expect(s.snippet).not.toContain('[[');
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('empty corpus -> informed content, empty sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-p-'));
    try {
      const engine = createEngine(engineOpts(dir, join(dir, 'idx'), { corpusDirs: [] }));
      const p = new LocalSearchProvider(() => engine);
      const res = await p.search({ query: 'anything' });
      expect(res.sources).toHaveLength(0);
      expect(res.content).toMatch(/0 documents/);
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('aborted search -> WEB_ABORTED', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-p-'));
    try {
      makeCorpus(dir);
      const engine = createEngine(engineOpts(dir, join(dir, 'idx')));
      const p = new LocalSearchProvider(() => engine);
      const ac = new AbortController();
      ac.abort();
      let threw: unknown;
      try {
        await p.search({ query: 'x' }, ac.signal);
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeDefined();
      expect((threw as { code?: string }).code).toBe('WEB_ABORTED');
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });
});

describe('LocalFetchProvider', () => {
  test('id and available', () => {
    const f = new LocalFetchProvider();
    expect(f.id).toBe(LOCAL_FETCH_PROVIDER_ID);
    expect(f.id).toBe('local');
    expect(f.available()).toBe(true);
  });

  test('fetches a file:// url from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-f-'));
    try {
      makeCorpus(dir);
      const f = new LocalFetchProvider();
      const target = join(dir, 'sqlite.md');
      const { pathToFileURL } = await import('node:url');
      const res = await f.fetch({ url: pathToFileURL(target).href });
      expect(res.statusCode).toBe(200);
      expect(res.body.kind).toBe('text');
      expect(res.body.content).toContain('SQLite');
    } finally {
      await cleanup(dir);
    }
  });

  test('invalid url -> WEB_INVALID_URL', async () => {
    const f = new LocalFetchProvider();
    let threw: unknown;
    try {
      await f.fetch({ url: 'not a url' });
    } catch (e) {
      threw = e;
    }
    expect((threw as { code?: string }).code).toBe('WEB_INVALID_URL');
  });
});
