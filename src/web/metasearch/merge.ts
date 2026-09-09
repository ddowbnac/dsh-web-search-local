
import type { MetasearchHit, SearchEngine } from './types.js';
import { dedupKey } from './url.js';

export interface Merged {
  readonly key: string;
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  engines: Map<string, number>;
  score: number;
  readonly firstSeenEngine: string;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeHits(raw: ReadonlyArray<MetasearchHit>): MetasearchHit[] {
  const out: MetasearchHit[] = [];
  for (const h of raw) {
    const url = (h?.url ?? '').trim();
    if (!dedupKey(url)) continue;
    const title = collapseWs(h?.title ?? '');
    const snippet0 = collapseWs(h?.snippet ?? '');
    const snippet = snippet0 === title ? '' : snippet0;
    const publishedAt = (h?.publishedAt ?? '').trim();
    out.push(publishedAt ? { url, title, snippet, publishedAt } : { url, title, snippet });
  }
  return out;
}

export function mergeHit(map: Map<string, Merged>, hit: MetasearchHit, eng: SearchEngine, rank: number): Merged {
  const key = dedupKey(hit.url);
  if (key === null) throw new Error(`mergeHit: unparseable hit url ${JSON.stringify(hit.url)} (run normalizeHits first)`);
  const existing = map.get(key);
  if (!existing) {
    const m: Merged = {
      key,
      url: hit.url,
      title: hit.title,
      snippet: hit.snippet,
      engines: new Map([[eng.id, rank]]),
      score: 0,
      firstSeenEngine: eng.id,
    };
    if (hit.publishedAt) m.publishedAt = hit.publishedAt;
    map.set(key, m);
    return m;
  }
  existing.engines.set(eng.id, rank);
  if (hit.snippet.length > existing.snippet.length) existing.snippet = hit.snippet;
  if (hit.title.length > existing.title.length) existing.title = hit.title;
  if (!existing.title) existing.title = hit.title;
  if (!existing.snippet) existing.snippet = hit.snippet;
  if (!existing.publishedAt && hit.publishedAt) existing.publishedAt = hit.publishedAt;
  if (existing.url.startsWith('http:') && hit.url.startsWith('https:')) existing.url = hit.url;
  return existing;
}

function scoreOf(m: Merged, weightOf: (id: string) => number): number {
  let s = 0;
  for (const [engineId, rank] of m.engines) s += weightOf(engineId) / rank;
  return s;
}

export function mergeAndInterleave(
  perEngine: ReadonlyArray<{ eng: SearchEngine; hits: MetasearchHit[] }>,
  maxResults: number,
): MetasearchHit[] {
  if (maxResults <= 0) return [];
  const map = new Map<string, Merged>();
  const lists: Array<{ eng: SearchEngine; hits: Merged[] }> = perEngine.map(({ eng, hits }) => {
    const list: Merged[] = [];
    hits.forEach((h, i) => list.push(mergeHit(map, h, eng, i + 1)));
    return { eng, hits: list };
  });

  const weightOf = new Map<string, number>(perEngine.map((p) => [p.eng.id, p.eng.weight]));
  for (const m of map.values()) m.score = scoreOf(m, (id) => weightOf.get(id) ?? 1);

  const emitted = new Set<Merged>();
  const out: MetasearchHit[] = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.hits.length));
  outer: for (let r = 1; r <= maxLen; r++) {
    const tier: Merged[] = [];
    const seen = new Set<Merged>();
    for (const l of lists) {
      const m = l.hits[r - 1];
      if (m && !emitted.has(m) && !seen.has(m)) {
        seen.add(m);
        tier.push(m);
      }
    }
    tier.sort(
      (a, b) =>
        b.score - a.score ||
        (weightOf.get(b.firstSeenEngine) ?? 1) - (weightOf.get(a.firstSeenEngine) ?? 1),
    );
    for (const m of tier) {
      emitted.add(m);
      const hit: MetasearchHit = { url: m.url, title: m.title, snippet: m.snippet };
      if (m.publishedAt) hit.publishedAt = m.publishedAt;
      out.push(hit);
      if (out.length >= maxResults) break outer;
    }
  }
  return out;
}
