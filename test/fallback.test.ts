import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonDriver } from '../src/engine/fallback.js';
import { walkCorpus, docKey } from '../src/engine/walk.js';
import { makeCorpus } from './helpers.js';
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

describe('JsonDriver (pure-JS fallback)', () => {
  test('build then search', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-json-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const d = new JsonDriver(join(dir, 'idx'), { snippetLength: 160 });
      await d.open();
      await d.upsert(rows);
      expect(await d.count()).toBe(4);
      const hits = await d.search('sqlite', 10);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].title).toBe('SQLite guide');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('incremental add / delete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-json-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const d = new JsonDriver(join(dir, 'idx'), { snippetLength: 160 });
      await d.open();
      await d.upsert(rows);
      const added: DocRow = {
        key: docKey(join(dir, 'added.md')),
        path: join(dir, 'added.md'),
        url: `file://${join(dir, 'added.md')}`,
        title: 'Added doc',
        body: 'A unique zebra word lives here.',
        mtimeMs: Date.now(),
        size: 30,
        hash: 'y'.repeat(40),
        publishedAt: new Date().toISOString(),
      };
      await d.upsert([added]);
      expect(await d.count()).toBe(5);
      expect((await d.search('zebra', 5)).some((h) => h.title === 'Added doc')).toBe(true);
      await d.delete([added.key]);
      expect(await d.count()).toBe(4);
      expect(await d.search('zebra', 5)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('persists across reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-json-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const idx = join(dir, 'idx');
      {
        const d = new JsonDriver(idx, { snippetLength: 160 });
        await d.open();
        await d.upsert(rows);
        await d.close();
      }
      const d2 = new JsonDriver(idx, { snippetLength: 160 });
      await d2.open();
      expect(await d2.count()).toBe(4);
      expect((await d2.search('sqlite', 5)).some((h) => h.title === 'SQLite guide')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
