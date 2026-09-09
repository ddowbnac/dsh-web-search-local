import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFts5Match, fts5AvailableSync, Fts5Driver } from '../src/engine/fts5.js';
import { walkCorpus, docKey } from '../src/engine/walk.js';
import { makeCorpus, cleanup } from './helpers.js';
import type { DocRow, EngineOptions } from '../src/types.js';

function opts(root: string): EngineOptions {
  return {
    corpusDirs: [root],
    indexPath: join(root, '__idx__'),
    includeExts: new Set(['md', 'markdown', 'txt', 'html', 'htm', 'js']),
    excludeDirs: new Set(['node_modules']),
    excludeFiles: new Set(['.ds_store']),
    excludeSuffixes: ['.min.js', '.map'],
    maxFileSizeBytes: 5_000_000,
    snippetLength: 160,
    autoReindex: true,
    minReindexIntervalMs: 2000,
    maxFilesPerBuild: 20_000,
  };
}

describe('buildFts5Match', () => {
  test('OR-joined prefix terms', () => {
    expect(buildFts5Match('how to configure search')).toBe(`"how"* OR "to"* OR "configure"* OR "search"*`);
  });
  test('dedupes and lowercases', () => {
    expect(buildFts5Match('SQLite sqlite SQLITE')).toBe(`"sqlite"*`);
  });
  test('empty / operator-only returns null', () => {
    expect(buildFts5Match('')).toBeNull();
    expect(buildFts5Match('   ')).toBeNull();
    expect(buildFts5Match('!!! ??? ---')).toBeNull();
  });
  test('caps term count', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(' ');
    expect(buildFts5Match(many)!.split(' OR ').length).toBeLessThanOrEqual(24);
  });
});

describe('Fts5Driver (skipped when this Bun build lacks FTS5)', () => {
  const run = fts5AvailableSync() ? test : test.skip;

  run('build then search ranks by relevance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fts5-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const driver = new Fts5Driver(join(dir, 'idx'), { snippetLength: 160 });
      try {
        await driver.open();
        await driver.upsert(rows);
        expect(await driver.count()).toBe(4);
        const hits = await driver.search('sqlite', 10);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].title).toBe('SQLite guide');
        expect(hits[0].snippet.toLowerCase()).toContain('sqlite');
        expect(hits[0].score).toBeGreaterThan(0);
        expect(hits[0].url.startsWith('file://')).toBe(true);
      } finally {
        await driver.close();
      }
    } finally {
      await cleanup(dir);
    }
  });

  run('multi-term query recalls via OR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fts5-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const driver = new Fts5Driver(join(dir, 'idx'), { snippetLength: 160 });
      try {
        await driver.open();
        await driver.upsert(rows);
        const hits = await driver.search('rust tantivy', 10);
        expect(hits.some((h) => h.title === 'Rust search')).toBe(true);
      } finally {
        await driver.close();
      }
    } finally {
      await cleanup(dir);
    }
  });

  run('incremental add / change / delete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fts5-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const driver = new Fts5Driver(join(dir, 'idx'), { snippetLength: 160 });
      try {
        await driver.open();
        await driver.upsert(rows);
        expect(await driver.count()).toBe(4);
        const added: DocRow = {
          key: docKey(join(dir, 'added.md')),
          path: join(dir, 'added.md'),
          url: `file://${join(dir, 'added.md')}`,
          title: 'Added doc',
          body: 'This is a unique zebra word.',
          mtimeMs: Date.now(),
          size: 30,
          hash: 'x'.repeat(40),
          publishedAt: new Date().toISOString(),
        };
        await driver.upsert([added]);
        expect(await driver.count()).toBe(5);
        expect((await driver.search('zebra', 5)).some((h) => h.title === 'Added doc')).toBe(true);
        await driver.delete([added.key]);
        expect(await driver.count()).toBe(4);
        expect(await driver.search('zebra', 5)).toHaveLength(0);
        expect([...(await driver.keys())]).toHaveLength(4);
      } finally {
        await driver.close();
      }
    } finally {
      await cleanup(dir);
    }
  });

  run('survives restart (persistent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fts5-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const idx = join(dir, 'idx');
      {
        const d = new Fts5Driver(idx, { snippetLength: 160 });
        await d.open();
        await d.upsert(rows);
        await d.close();
      }
      const d2 = new Fts5Driver(idx, { snippetLength: 160 });
      try {
        await d2.open();
        expect(await d2.count()).toBe(4);
        expect((await d2.search('sqlite', 5)).some((h) => h.title === 'SQLite guide')).toBe(true);
      } finally {
        await d2.close();
      }
    } finally {
      await cleanup(dir);
    }
  });
});
