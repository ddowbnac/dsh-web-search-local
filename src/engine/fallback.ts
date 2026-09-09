import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractTerms } from './terms.js';
import type { DocRow, EngineOptions, Hit, SearchDriver } from '../types.js';


interface DocMeta {
  path: string;
  url: string;
  title: string;
  publishedAt?: string;
  text: string;
  dl: number;
}

interface Snapshot {
  version: number;
  docs: Record<string, DocMeta>;
  postings: Record<string, Record<string, number>>;
}

const VERSION = 1;
const K1 = 1.5;
const B = 0.75;

export class JsonDriver implements SearchDriver {
  readonly kind = 'json' as const;
  private readonly file: string;
  private readonly snippetLength: number;
  private docs = new Map<string, DocMeta>();
  private postings = new Map<string, Map<string, number>>();

  constructor(indexPath: string, opts: Pick<EngineOptions, 'snippetLength'>) {
    mkdirSync(indexPath, { recursive: true });
    this.file = join(indexPath, 'index.fallback.json');
    this.snippetLength = opts.snippetLength;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const snap = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot;
      if (snap.version !== VERSION) return;
      for (const [k, m] of Object.entries(snap.docs)) this.docs.set(k, m);
      for (const [t, posting] of Object.entries(snap.postings)) {
        const map = new Map<string, number>();
        for (const [k, tf] of Object.entries(posting)) map.set(k, tf);
        this.postings.set(t, map);
      }
    } catch {
      this.docs = new Map();
      this.postings = new Map();
    }
  }

  private persist(): void {
    const snap: Snapshot = {
      version: VERSION,
      docs: Object.fromEntries(this.docs),
      postings: Object.fromEntries([...this.postings].map(([t, m]) => [t, Object.fromEntries(m)])),
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap));
    renameSync(tmp, this.file);
  }

  async open(): Promise<void> {
  }

  async upsert(rows: readonly DocRow[]): Promise<void> {
    for (const r of rows) {
      this.removePostings(r.key);
      this.docs.set(r.key, {
        path: r.path,
        url: r.url,
        title: r.title,
        ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
        text: r.body,
        dl: extractTerms(r.title + ' ' + r.body, 100000).length,
      });
      const freq = new Map<string, number>();
      for (const t of extractTerms(r.title + ' ' + r.body, 100000)) {
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      for (const [t, tf] of freq) {
        let posting = this.postings.get(t);
        if (!posting) {
          posting = new Map();
          this.postings.set(t, posting);
        }
        posting.set(r.key, tf);
      }
    }
    this.persist();
  }

  private removePostings(key: string): void {
    for (const posting of this.postings.values()) posting.delete(key);
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const k of keys) {
      this.removePostings(k);
      this.docs.delete(k);
    }
    this.persist();
  }

  async keys(): Promise<ReadonlySet<string>> {
    return new Set(this.docs.keys());
  }

  async search(query: string, maxResults: number): Promise<Hit[]> {
    const terms = extractTerms(query);
    if (terms.length === 0) return [];
    const N = this.docs.size;
    if (N === 0) return [];
    let avgdl = 0;
    for (const m of this.docs.values()) avgdl += m.dl;
    avgdl = avgdl / N;

    const scores = new Map<string, number>();
    const df = (t: string) => this.postings.get(t)?.size ?? 0;
    const idf = (t: string) => Math.log(1 + (N - df(t) + 0.5) / (df(t) + 0.5));

    for (const t of terms) {
      const posting = this.postings.get(t);
      const candidates = new Map<string, number>();
      for (const [it, map] of this.postings) {
        if (it === t || it.startsWith(t)) {
          for (const [k, tf] of map) candidates.set(k, (candidates.get(k) ?? 0) + tf);
        }
      }
      const qidf = idf(t);
      for (const [k, tf] of candidates) {
        const m = this.docs.get(k);
        if (!m) continue;
        const denom = tf + K1 * (1 - B + (B * m.dl) / (avgdl || 1));
        const s = qidf * ((tf * (K1 + 1)) / denom);
        scores.set(k, (scores.get(k) ?? 0) + s);
      }
    }

    const ranked = [...scores.entries()]
      .map(([k, s]) => ({ k, s }))
      .sort((a, b) => b.s - a.s)
      .slice(0, Math.max(1, Math.min(200, Math.floor(maxResults) || 20)));

    return ranked.map(({ k, s }) => {
      const m = this.docs.get(k)!;
      return {
        url: m.url,
        path: m.path,
        title: m.title,
        snippet: makeSnippet(m.text, terms, this.snippetLength),
        score: s,
        ...(m.publishedAt ? { publishedAt: m.publishedAt } : {}),
      };
    });
  }

  async count(): Promise<number> {
    return this.docs.size;
  }

  async close(): Promise<void> {
  }
}

function makeSnippet(text: string, terms: string[], max: number): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at === -1 || i < at)) at = i;
  }
  const raw = text.trim();
  if (at === -1) return raw.slice(0, max);
  const start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(raw.length, at + max);
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < raw.length ? ' …' : '';
  return prefix + raw.slice(start, end).replace(/\s+/g, ' ').trim() + suffix;
}
