
import { CHROME_UA, fetchText } from '../http.js';
import { EngineError, type MetasearchHit, type SearchEngine } from '../types.js';
import { decodeEntities, htmlToText } from '../../duckduckgo.js';

export interface BingEngineOptions {
  readonly maxResults: number;
  readonly snippetLength: number;
}

const ENDPOINT = 'https://www.bing.com/search';

export function resolveBingUrl(href: string): string {
  let h = decodeEntities(href);
  if (!h) return h;
  if (h.startsWith('//')) h = 'https:' + h;
  try {
    const u = new URL(h);
    if (u.hostname.endsWith('bing.com') && u.pathname.startsWith('/ck/a')) {
      const enc = u.searchParams.get('u');
      if (enc && enc.startsWith('a1')) {
        const b64 = enc.slice(2);
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const decoded = Buffer.from(padded, 'base64url').toString('utf8');
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded;
      }
    }
  } catch {
  }
  return h;
}

export function parseBingHtml(html: string, maxResults: number, snippetLength: number): MetasearchHit[] {
  const ol = html.match(/<ol\b[^>]*id="b_results"[^>]*>([\s\S]*?)<\/ol>/i);
  if (!ol) {
    throw new EngineError('Bing response has no b_results container (layout drift / consent / captcha page)', 'parse');
  }
  const body = ol[1];

  const rowRe = /<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body)) !== null) starts.push(m.index);

  const nextLiRe = /<li[\s>]/g;

  const hits: MetasearchHit[] = [];
  for (const start of starts) {
    if (hits.length >= maxResults) break;
    nextLiRe.lastIndex = start + 3;
    const next = nextLiRe.exec(body);
    const block = body.slice(start, next ? next.index : body.length);

    const h2a = block.match(/<h2[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h2a) continue;
    const url = resolveBingUrl(h2a[1]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (url.includes('/ck/a')) continue;
    const title = htmlToText(h2a[2]);
    if (!title) continue;

    hits.push({ url, title, snippet: extractSnippet(block, snippetLength) });
  }
  return hits;
}

function extractSnippet(block: string, snippetLength: number): string {
  const stripped = block.replace(
    /<span\b[^>]*class="[^"]*algoSlug_icon[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
    ' ',
  );
  const cap = stripped.match(/<div\b[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>/i);
  const scope = cap ? stripped.slice(cap.index ?? 0) : stripped;
  const parts: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(scope)) !== null) {
    const t = htmlToText(m[1]);
    if (t) parts.push(t);
  }
  return clip(parts.join(' '), snippetLength);
}

function clip(s: string, len: number): string {
  if (s.length <= len) return s;
  const cut = s.slice(0, len);
  const sp = cut.lastIndexOf(' ');
  return (sp > len * 0.5 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

export function createBingEngine(opts: BingEngineOptions): SearchEngine {
  return {
    id: 'bing',
    displayName: 'Bing',
    timeoutMs: 10_000,
    weight: 1.0,
    search(query: string, signal: AbortSignal): Promise<MetasearchHit[]> {
      const url = `${ENDPOINT}?${new URLSearchParams({ q: query }).toString()}`;
      return (async () => {
        const { text } = await fetchText(url, {
          signal,
          headers: {
            'user-agent': CHROME_UA,
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9',
          },
        });
        return parseBingHtml(text, opts.maxResults, opts.snippetLength);
      })();
    },
  };
}
