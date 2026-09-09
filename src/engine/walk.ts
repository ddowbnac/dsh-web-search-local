import { createHash } from 'node:crypto';
import { stat, readFile, readdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractText, isBinary } from './extract.js';
import type { DocRow, EngineOptions } from '../types.js';


export interface WalkResult {
  readonly rows: DocRow[];
  readonly truncated: boolean;
  readonly scannedDirs: number;
  readonly skipped: number;
  readonly readErrors: number;
}

const POOL = 16;

export function docKey(absPath: string): string {
  return normalize(absPath).split(sep).join('/').toLowerCase();
}

function extOf(p: string): string {
  return extname(p).slice(1).toLowerCase();
}

function isExcluded(opts: EngineOptions, dir: string, file: string): boolean {
  if (opts.excludeDirs.has(dir.toLowerCase())) return true;
  const lower = file.toLowerCase();
  if (opts.excludeFiles.has(lower)) return true;
  for (const suffix of opts.excludeSuffixes) if (lower.endsWith(suffix)) return true;
  return false;
}

export async function walkCorpus(opts: EngineOptions, signal?: AbortSignal): Promise<WalkResult> {
  const queue: string[] = [];
  const roots = opts.corpusDirs
    .map((d) => (isAbsolute(d) ? normalize(d) : resolve(d)))
    .filter((d) => d.length > 0);
  for (const r of roots) queue.push(r);

  const visited = new Set<string>();
  const rows: DocRow[] = [];
  let scannedDirs = 0;
  let skipped = 0;
  let readErrors = 0;
  let truncated = false;
  let next = 0;

  const hash = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');

  async function processFile(p: string): Promise<void> {
    if (rows.length >= opts.maxFilesPerBuild) return;
    const file = basename(p);
    const parent = p.slice(0, Math.max(0, p.length - file.length - 1));
    if (isExcluded(opts, parent, file)) {
      skipped++;
      return;
    }
    const ext = extOf(p);
    if (!opts.includeExts.has(ext)) {
      skipped++;
      return;
    }
    let st;
    try {
      st = await stat(p);
    } catch {
      skipped++;
      return;
    }
    if (!st.isFile()) {
      skipped++;
      return;
    }
    if (st.size > opts.maxFileSizeBytes) {
      skipped++;
      return;
    }
    let buf: Buffer;
    try {
      buf = await readFile(p);
    } catch {
      readErrors++;
      return;
    }
    if (isBinary(buf)) {
      skipped++;
      return;
    }
    const { title, text } = extractText(p, buf);
    if (text.trim().length === 0 && !title) {
      skipped++;
      return;
    }
    rows.push({
      key: docKey(p),
      path: p,
      url: pathToFileURL(p).href,
      title: title ?? basename(p),
      body: text,
      mtimeMs: st.mtimeMs,
      size: st.size,
      hash: hash(buf),
      publishedAt: new Date(st.mtimeMs).toISOString(),
    });
  }

  async function process(p: string): Promise<void> {
    if (signal?.aborted || rows.length >= opts.maxFilesPerBuild) return;
    let st;
    try {
      st = await stat(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      let real: string;
      try {
        real = await realpathSafe(p);
      } catch {
        return;
      }
      if (visited.has(real)) return;
      visited.add(real);
      scannedDirs++;
      let entries;
      try {
        entries = await readdir(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (signal?.aborted || rows.length >= opts.maxFilesPerBuild) {
          truncated = true;
          return;
        }
        const child = join(p, ent.name);
        if (ent.isDirectory() || ent.isSymbolicLink()) {
          queue.push(child);
        } else if (ent.isFile()) {
          await processFile(child);
        }
      }
    } else if (st.isFile()) {
      await processFile(p);
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (signal?.aborted || truncated || rows.length >= opts.maxFilesPerBuild) {
        truncated = truncated || rows.length >= opts.maxFilesPerBuild;
        break;
      }
      const i = next++;
      if (i >= queue.length) break;
      await process(queue[i]);
      if (rows.length >= opts.maxFilesPerBuild) {
        truncated = true;
        break;
      }
    }
  }

  await Promise.all(Array.from({ length: POOL }, () => worker()));

  return { rows, truncated, scannedDirs, skipped, readErrors };
}

async function realpathSafe(p: string): Promise<string> {
  try {
    const { realpath } = await import('node:fs/promises');
    return await realpath(p);
  } catch {
    return normalize(p);
  }
}
