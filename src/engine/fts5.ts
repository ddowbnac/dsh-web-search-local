import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractTerms } from './terms.js';
import type { DocRow, EngineOptions, Hit, SearchDriver } from '../types.js';


export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}
export interface SqliteModule {
  Database: new (path: string, opts?: { create?: boolean; enableFTS5?: boolean }) => SqliteDatabase;
}

type Stmt = {
  run(...params: unknown[]): { lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

let fts5Probe: boolean | undefined;
let sqliteModule: SqliteModule | null | undefined;
let sqlitePromise: Promise<SqliteModule | null> | undefined;

function onBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

export async function loadSqlite(): Promise<SqliteModule | null> {
  if (sqliteModule !== undefined) return sqliteModule;
  if (!sqlitePromise) {
    sqlitePromise = (async () => {
      if (!onBun()) return null;
      try {
        return (await import('bun:sqlite')) as unknown as SqliteModule;
      } catch {
        return null;
      }
    })();
    void sqlitePromise.then((m) => {
      sqliteModule = m;
    });
  }
  return sqlitePromise;
}

export async function fts5Available(): Promise<boolean> {
  if (fts5Probe !== undefined) return fts5Probe;
  try {
    const mod = await loadSqlite();
    if (!mod) {
      fts5Probe = false;
      return false;
    }
    const db = new mod.Database(':memory:', { create: true, enableFTS5: true });
    try {
      db.exec('CREATE VIRTUAL TABLE fts5_probe USING fts5(x)');
      fts5Probe = true;
    } finally {
      db.close();
    }
  } catch {
    fts5Probe = false;
  }
  return fts5Probe;
}

export function fts5AvailableSync(): boolean {
  if (fts5Probe !== undefined) return fts5Probe;
  return onBun();
}

export function buildFts5Match(query: string): string | null {
  const terms = extractTerms(query);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(' OR ');
}

const SNIPPET_BEFORE = '[[ ';
const SNIPPET_AFTER = ' ]]';

export class Fts5Driver implements SearchDriver {
  readonly kind = 'fts5' as const;
  private db: SqliteDatabase | undefined;
  private readonly indexPath: string;
  private readonly snippetLength: number;

  constructor(indexPath: string, opts: Pick<EngineOptions, 'snippetLength'>) {
    this.indexPath = indexPath;
    this.snippetLength = opts.snippetLength;
  }

  private get d(): SqliteDatabase {
    if (!this.db) throw new Error('Fts5Driver used before open()');
    return this.db;
  }

  async open(): Promise<void> {
    if (this.db) return;
    const mod = await loadSqlite();
    if (!mod) throw new Error('FTS5 driver requires the Bun runtime (bun:sqlite unavailable)');
    mkdirSync(this.indexPath, { recursive: true });
    this.db = new mod.Database(join(this.indexPath, 'index.db'), { create: true, enableFTS5: true });
    this.db.exec('PRAGMA busy_timeout = 5000;');
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      this.db.exec('PRAGMA journal_mode = DELETE;');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files(
        docid INTEGER PRIMARY KEY AUTOINCREMENT,
        key   TEXT NOT NULL UNIQUE COLLATE NOCASE,
        path  TEXT NOT NULL,
        url   TEXT NOT NULL,
        title TEXT NOT NULL,
        publishedAt TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(title, body, tokenize='unicode61');
    `);
  }

  async upsert(rows: readonly DocRow[]): Promise<void> {
    const db = this.d;
    const getDocid = db.prepare('SELECT docid FROM files WHERE key = ?');
    const updFile = db.prepare('UPDATE files SET path=?, url=?, title=?, publishedAt=? WHERE docid=?');
    const insFile = db.prepare('INSERT INTO files(key, path, url, title, publishedAt) VALUES (?,?,?,?,?)');
    const delDoc = db.prepare('DELETE FROM docs WHERE rowid = ?');
    const insDoc = db.prepare('INSERT INTO docs(rowid, title, body) VALUES (?,?,?)');
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        const existing = getDocid.get(r.key) as { docid: number } | null;
        let docid: number;
        if (existing) {
          docid = existing.docid;
          updFile.run(r.path, r.url, r.title, r.publishedAt, docid);
        } else {
          const res = insFile.run(r.key, r.path, r.url, r.title, r.publishedAt);
          docid = Number(res.lastInsertRowid);
        }
        delDoc.run(docid);
        insDoc.run(docid, r.title, r.body);
      }
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
      }
      throw e;
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const db = this.d;
    const ph = keys.map(() => '?').join(',');
    db.exec('BEGIN');
    try {
      db.prepare(`DELETE FROM docs WHERE rowid IN (SELECT docid FROM files WHERE key IN (${ph}))`).run(...keys);
      db.prepare(`DELETE FROM files WHERE key IN (${ph})`).run(...keys);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
      }
      throw e;
    }
  }

  async keys(): Promise<ReadonlySet<string>> {
    const rows = this.d.prepare('SELECT key FROM files').all() as { key: string }[];
    return new Set(rows.map((r) => r.key));
  }

  async search(query: string, maxResults: number): Promise<Hit[]> {
    const match = buildFts5Match(query);
    if (!match) return [];
    const lim = Math.max(1, Math.min(200, Math.floor(maxResults) || 20));
    const len = Math.max(20, this.snippetLength);
    const sql = `
      SELECT f.url, f.path, f.title, f.publishedAt,
             bm25(docs) AS raw,
             snippet(docs, -1, ${q(SNIPPET_BEFORE)}, ${q(SNIPPET_AFTER)}, ' … ', ${len}) AS snip
      FROM docs
      JOIN files f ON f.docid = docs.rowid
      WHERE docs MATCH ?
      ORDER BY raw ASC
      LIMIT ?`;
    let rows;
    try {
      rows = this.d.prepare(sql).all(match, lim) as {
        url: string;
        path: string;
        title: string;
        publishedAt: string | null;
        raw: number;
        snip: string;
      }[];
    } catch {
      return [];
    }
    return rows.map((r) => ({
      url: r.url,
      path: r.path,
      title: r.title,
      snippet: r.snip,
      score: -r.raw,
      ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
    }));
  }

  async count(): Promise<number> {
    const row = this.d.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number };
    return row.n;
  }

  async close(): Promise<void> {
    try {
      this.db?.close();
    } catch {
    }
    this.db = undefined;
  }
}

function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
