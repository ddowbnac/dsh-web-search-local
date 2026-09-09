
import { CHROME_UA, fetchJson } from '../http.js';
import { EngineError, type MetasearchHit, type SearchEngine } from '../types.js';
import { htmlToText } from '../../duckduckgo.js';

const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

const WIKI_BASE = 'https://en.wikipedia.org/wiki/';

export interface WikipediaEngineOptions {
  readonly maxResults: number;
  readonly snippetLength: number;
}

export function parseWikipediaApi(jsonText: string, snippetLength: number): MetasearchHit[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new EngineError(`invalid JSON in Wikipedia API response: ${describe(e)}`, 'parse');
  }
  return parseWikipediaApiData(data, snippetLength);
}

function parseWikipediaApiData(data: unknown, snippetLength: number): MetasearchHit[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const search = (data as { query?: { search?: unknown } }).query?.search;
  if (!Array.isArray(search)) return [];

  const hits: MetasearchHit[] = [];
  for (const item of search) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as { title?: unknown; snippet?: unknown; timestamp?: unknown };
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;
    const url = WIKI_BASE + title.replace(/ /g, '_');
    const rawSnippet = typeof rec.snippet === 'string' ? rec.snippet : '';
    const publishedAt = typeof rec.timestamp === 'string' && rec.timestamp !== '' ? rec.timestamp : undefined;
    hits.push({
      url,
      title,
      snippet: clipSnippet(htmlToText(rawSnippet), snippetLength),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    });
  }
  return hits;
}

export function createWikipediaEngine(opts: WikipediaEngineOptions): SearchEngine {
  return {
    id: 'wikipedia',
    displayName: 'Wikipedia',
    timeoutMs: 10_000,
    weight: 1.0,
    search(query: string, signal: AbortSignal): Promise<MetasearchHit[]> {
      const url = `${API_ENDPOINT}?${new URLSearchParams({
        action: 'query',
        list: 'search',
        format: 'json',
        srnamespace: '0',
        srlimit: String(opts.maxResults),
        srsearch: query,
      }).toString()}`;
      return (async () => {
        const { json } = await fetchJson(url, {
          signal,
          headers: { 'user-agent': CHROME_UA, accept: 'application/json' },
        });
        return parseWikipediaApiData(json, opts.snippetLength);
      })();
    },
  };
}

function clipSnippet(s: string, len: number): string {
  if (len <= 0) return '';
  if (s.length <= len) return s;
  const cut = s.slice(0, len);
  const sp = cut.lastIndexOf(' ');
  return (sp > len * 0.5 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}
