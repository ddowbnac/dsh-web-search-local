
export interface WebHit {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ENDPOINT = 'https://html.duckduckgo.com/html/';

export function htmlToText(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeFromCode(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

export function resolveResultUrl(href: string): string {
  let h = decodeEntities(href);
  if (!h) return h;
  if (h.startsWith('//')) h = 'https:' + h;
  try {
    const u = new URL(h);
    if (u.hostname.endsWith('duckduckgo.com') && (u.pathname === '/l/' || u.pathname === '/l')) {
      const uddg = u.searchParams.get('uddg');
      if (uddg) return uddg;
    }
  } catch {
  }
  return h;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

export function parseDuckDuckGoHtml(html: string, maxResults: number, snippetLength: number): WebHit[] {
  const titleAnchors = extractAnchors(html, 'result__a');
  const snippets = extractAnchors(html, 'result__snippet').map((a) => ({
    url: resolveResultUrl(a.href),
    text: htmlToText(a.text),
  }));

  const hits: WebHit[] = [];
  for (const { href, text } of titleAnchors) {
    if (hits.length >= maxResults) break;
    const url = resolveResultUrl(href);
    const title = htmlToText(text);
    if (!url || !url.startsWith('http')) continue;
    if (isAdUrl(url)) continue;
    const match = snippets.find((s) => s.url === url) ?? null;
    hits.push({ url, title: title || url, snippet: match ? clip(match.text, snippetLength) : '' });
  }
  return hits;
}

interface Anchor {
  href: string;
  text: string;
}

function extractAnchors(html: string, cls: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const classAttr = attr(tag, 'class') ?? '';
    if (!classAttr.split(/\s+/).includes(cls)) continue;
    const close = html.indexOf('</a>', m.index + tag.length);
    if (close === -1) continue;
    out.push({ href: attr(tag, 'href') ?? '', text: html.slice(m.index + tag.length, close) });
    re.lastIndex = close;
  }
  return out;
}

function clip(s: string, len: number): string {
  if (s.length <= len) return s;
  const cut = s.slice(0, len);
  const sp = cut.lastIndexOf(' ');
  return (sp > len * 0.5 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

export function isAdUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').endsWith('duckduckgo.com') && u.pathname.startsWith('/y.js');
  } catch {
    return false;
  }
}

export async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  snippetLength: number,
  signal?: AbortSignal,
): Promise<WebHit[]> {
  const url = ENDPOINT + '?' + new URLSearchParams({ q: query }).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });
  } catch (e) {
    if (signal?.aborted === true) throw e;
    throw new Error(`DuckDuckGo request failed: ${String(e)}`);
  }
  if (!res.ok) throw new Error(`DuckDuckGo request failed: HTTP ${res.status}`);
  const html = await res.text();
  return parseDuckDuckGoHtml(html, maxResults, snippetLength);
}
