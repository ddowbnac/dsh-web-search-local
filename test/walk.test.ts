import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkCorpus, docKey } from '../src/engine/walk.js';
import { makeCorpus } from './helpers.js';
import type { EngineOptions } from '../src/types.js';

const INCLUDE = new Set([
  'md', 'markdown', 'txt', 'html', 'htm', 'js', 'mjs', 'json',
]);
const EXCLUDE_DIRS = new Set(['node_modules']);
const EXCLUDE_FILES = new Set(['.ds_store']);
const SUFFIXES = ['.min.js', '.map'];

function opts(root: string, overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    corpusDirs: [root],
    indexPath: join(root, '__index__'),
    includeExts: INCLUDE,
    excludeDirs: EXCLUDE_DIRS,
    excludeFiles: EXCLUDE_FILES,
    excludeSuffixes: SUFFIXES,
    maxFileSizeBytes: 5_000_000,
    snippetLength: 160,
    autoReindex: true,
    minReindexIntervalMs: 2000,
    maxFilesPerBuild: 20_000,
    ...overrides,
  };
}

describe('walkCorpus', () => {
  test('indexes text files and applies include/exclude', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-walk-'));
    try {
      makeCorpus(dir);
      const { rows, truncated } = await walkCorpus(opts(dir));
      expect(truncated).toBe(false);
      const keys = new Set(rows.map((r) => r.key));
      expect(rows.some((r) => r.title === 'SQLite guide')).toBe(true);
      expect(keys.has(docKey(join(dir, 'sqlite.md')))).toBe(true);
      expect(keys.has(docKey(join(dir, 'rust.md')))).toBe(true);
      expect(keys.has(docKey(join(dir, 'notes.html')))).toBe(true);
      expect(keys.has(docKey(join(dir, 'bm25.txt')))).toBe(true);
      expect(keys.has(docKey(join(dir, 'node_modules/junk.md')))).toBe(false);
      expect(keys.has(docKey(join(dir, 'bundle.min.js')))).toBe(false);
      expect(keys.has(docKey(join(dir, 'blob.bin')))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rows carry file:// url, title, hash, publishedAt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-walk-'));
    try {
      makeCorpus(dir);
      const { rows } = await walkCorpus(opts(dir));
      const sqlite = rows.find((r) => r.key === docKey(join(dir, 'sqlite.md')))!;
      expect(sqlite.url.startsWith('file://')).toBe(true);
      expect(sqlite.title).toBe('SQLite guide');
      expect(sqlite.hash).toMatch(/^[a-f0-9]{40}$/);
      expect(sqlite.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(sqlite.body).toContain('bm25');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('empty corpus yields no rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-walk-'));
    try {
      const { rows } = await walkCorpus(opts(dir));
      expect(rows).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('maxFilesPerBuild caps a single large directory and marks truncated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-walk-'));
    try {
      for (let i = 0; i < 60; i++) {
        writeFileSync(join(dir, `doc-${String(i).padStart(3, '0')}.txt`), `document number ${i} about topic ${i}\n`);
      }
      const { rows, truncated } = await walkCorpus(opts(dir, { maxFilesPerBuild: 12 }));
      expect(rows.length).toBeLessThanOrEqual(12);
      expect(truncated).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('honors maxFileSizeBytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-walk-'));
    try {
      const { files } = makeCorpus(dir);
      writeBig(join(dir, 'big.md'), 10_000);
      const { rows } = await walkCorpus(opts(dir, { maxFileSizeBytes: 5_000 }));
      expect(rows.some((r) => r.key === docKey(join(dir, 'big.md')))).toBe(false);
      expect(files['sqlite.md']).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { writeFileSync } from 'node:fs';
function writeBig(p: string, approxBytes: number): void {
  writeFileSync(p, 'x'.repeat(approxBytes));
}
