import { WebError } from '@deepseek-ai/dsh-web';
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';


export const LOCAL_FETCH_PROVIDER_ID = 'local';

const MAX_BYTES = 2_000_000;

export class LocalFetchProvider implements WebFetchProvider {
  readonly id = LOCAL_FETCH_PROVIDER_ID;

  available(): boolean {
    return true;
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted === true) throw new WebError('Local fetch aborted', 'WEB_ABORTED', { cause: signal?.reason });
    let u: URL;
    try {
      u = new URL(request.url);
    } catch {
      throw new WebError(`Invalid URL: ${request.url}`, 'WEB_INVALID_URL');
    }
    if (u.protocol === 'file:') return fetchFile(u, signal);
    if (u.protocol === 'http:' || u.protocol === 'https:') return fetchHttp(u, signal);
    throw new WebError(`Unsupported protocol for local fetch: ${u.protocol}`, 'WEB_PROVIDER_ERROR');
  }
}

function cap(text: string): { content: string; truncated: boolean } {
  if (text.length > MAX_BYTES) return { content: text.slice(0, MAX_BYTES), truncated: true };
  return { content: text, truncated: false };
}

function fetchFile(u: URL, signal?: AbortSignal): WebFetchResult {
  const p = fileURLToPath(u);
  let buf: Buffer;
  try {
    buf = readFileSync(p);
  } catch (e) {
    throw new WebError(`Local fetch failed to read ${p}: ${String(e)}`, 'WEB_PROVIDER_ERROR', { cause: e });
  }
  if (signal?.aborted === true) throw new WebError('Local fetch aborted', 'WEB_ABORTED', { cause: signal.reason });
  const kind: 'html' | 'text' = /\.(html?|xhtml)$/i.test(p) ? 'html' : 'text';
  const { content, truncated } = cap(buf.toString('utf8'));
  return { url: u.href, statusCode: 200, body: { kind, content }, truncated };
}

async function fetchHttp(u: URL, signal?: AbortSignal): Promise<WebFetchResult> {
  let res: Response;
  try {
    res = await fetch(u.href, { redirect: 'follow', signal });
  } catch (e) {
    if (signal?.aborted === true) throw new WebError('Local fetch aborted', 'WEB_ABORTED', { cause: signal.reason });
    throw new WebError(`Local fetch failed: ${String(e)}`, 'WEB_PROVIDER_ERROR', { cause: e });
  }
  const text = await res.text().catch(() => '');
  const ct = res.headers.get('content-type') ?? '';
  const kind: 'html' | 'text' = ct.includes('html') ? 'html' : 'text';
  const { content, truncated } = cap(text);
  return { url: u.href, statusCode: res.status, body: { kind, content }, truncated };
}
