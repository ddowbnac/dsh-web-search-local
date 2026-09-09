import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('createEngine', () => {
  test('search returns local hits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eng-'));
    try {
      makeCorpus(dir);
      const engine = createEngine(engineOpts(dir, join(dir, 'idx')));
      const hits = await engine.search('sqlite', 10);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].title).toBe('SQLite guide');
      expect(engine.isReady()).toBe(true);
      expect(engine.getStats()!.totalDocs).toBe(4);
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('incremental reindex picks up a new file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eng-'));
    try {
      makeCorpus(dir);
      const engine = createEngine(engineOpts(dir, join(dir, 'idx')));
      await engine.ensure();
      writeFileSync(join(dir, 'zebra.md'), '# Zebra\n\nA unique zebra document.\n');
      await engine.reindex();
      const hits = await engine.search('zebra', 10);
      expect(hits.some((h) => h.title === 'Zebra')).toBe(true);
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('concurrent searches are serialized and consistent (mutex)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eng-'));
    try {
      makeCorpus(dir);
      const engine = createEngine(engineOpts(dir, join(dir, 'idx')));
      const results = await Promise.all([
        engine.search('sqlite', 5),
        engine.search('rust', 5),
        engine.search('bm25', 5),
        engine.search('index', 5),
      ]);
      for (const r of results) expect(Array.isArray(r)).toBe(true);
      expect(results[0].some((h) => h.title === 'SQLite guide')).toBe(true);
      expect(results[1].some((h) => h.title === 'Rust search')).toBe(true);
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('empty corpus reports 0 docs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eng-'));
    try {
      const engine = createEngine(engineOpts(dir, join(dir, 'idx'), { corpusDirs: [] }));
      const stats = await engine.ensure();
      expect(stats.totalDocs).toBe(0);
      const hits = await engine.search('anything', 5);
      expect(hits).toHaveLength(0);
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('driverKind is fts5 or json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eng-'));
    try {
      const engine = createEngine(engineOpts(dir, join(dir, 'idx')));
      await engine.ensure();
      expect(['fts5', 'json']).toContain(engine.driverKind());
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });

  test('a truncated sweep never deletes previously-indexed docs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eng-'));
    try {
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(dir, `d${i}.md`), `# Doc ${i}\n\nUnique needle needleword${i} lives here.\n`);
      }
      const idx = join(dir, 'idx');

      let engine = createEngine(engineOpts(dir, idx, { maxFilesPerBuild: 100 }));
      await engine.ensure();
      expect(engine.getStats()!.totalDocs).toBe(6);
      await engine.dispose();

      engine = createEngine(engineOpts(dir, idx, { maxFilesPerBuild: 2, autoReindex: false }));
      const stats = await engine.reindex();
      expect(stats.removed).toBe(0);
      const allNeedles = [];
      for (let i = 0; i < 6; i++) {
        const hits = await engine.search(`needleword${i}`, 5);
        allNeedles.push(hits.length);
      }
      expect(engine.getStats()!.totalDocs).toBe(6);
      expect(allNeedles.every((n) => n === 1)).toBe(true);
      await engine.dispose();
    } finally {
      await cleanup(dir);
    }
  });
});
