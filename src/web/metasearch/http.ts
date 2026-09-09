
import { EngineError } from './types.js';

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const DEFAULT_MAX_BYTES = 1_500_000;

export interface FetchUpstreamOptions {
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
  readonly maxBytes?: number;
}

export interface FetchTextResult {
  readonly status: number;
  readonly text: string;
}

export interface FetchJsonResult {
  readonly status: number;
  readonly json: unknown;
}

export async function fetchText(url: string, opts: FetchUpstreamOptions = {}): Promise<FetchTextResult> {
  const { signal, headers, maxBytes = DEFAULT_MAX_BYTES } = opts;
  let res: Response;
  try {
    res = await fetch(url, { signal, redirect: 'follow', headers });
  } catch (e) {
    throw new EngineError(`request to ${url} failed: ${describe(e)}`, 'network');
  }
  if (res.status >= 400) {
    throw new EngineError(`HTTP ${res.status} from ${url}`, 'http');
  }
  const text = await readBodyLimited(res, maxBytes);
  return { status: res.status, text };
}

export async function fetchJson(url: string, opts: FetchUpstreamOptions = {}): Promise<FetchJsonResult> {
  const { status, text } = await fetchText(url, opts);
  try {
    return { status, json: JSON.parse(text) as unknown };
  } catch (e) {
    throw new EngineError(`invalid JSON from ${url}: ${describe(e)}`, 'parse');
  }
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = res.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new EngineError(`response too large: declared ${n} bytes > ${maxBytes}`, 'http');
    }
  }
  const body = res.body;
  if (!body) return await res.text();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new EngineError(`response too large: exceeded ${maxBytes} bytes`, 'http');
      }
      if (value) chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}
