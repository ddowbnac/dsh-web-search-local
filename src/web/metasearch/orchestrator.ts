
import { MetasearchError } from './types.js';
import type {
  EngineDiagnostic,
  MetasearchHit,
  MetasearchOptions,
  MetasearchResult,
  SearchEngine,
} from './types.js';
import { mergeAndInterleave, normalizeHits } from './merge.js';

const DEFAULT_MAX_RESULTS = 10;

export async function runMetasearch(
  engines: ReadonlyArray<SearchEngine>,
  query: string,
  opts: MetasearchOptions = {},
): Promise<MetasearchResult> {
  if (engines.length === 0) throw new MetasearchError('no search engines configured', []);
  if (!query.trim()) throw new MetasearchError('empty query', []);

  const maxEngineMs = Math.max(...engines.map((e) => e.timeoutMs));
  const globalMs = Math.min(opts.globalTimeoutMs ?? maxEngineMs, maxEngineMs);

  const parts: AbortSignal[] = [];
  if (opts.signal) parts.push(opts.signal);
  parts.push(AbortSignal.timeout(globalMs));
  const globalSignal = AbortSignal.any(parts);
  if (globalSignal.aborted) throw toAbortError();

  const t0 = performance.now();
  const settled = await Promise.allSettled(
    engines.map(async (eng) => {
      const t1 = performance.now();
      const engSignal = AbortSignal.any([globalSignal, AbortSignal.timeout(eng.timeoutMs)]);
      try {
        const hits = normalizeHits(await eng.search(query, engSignal));
        return { ok: true as const, eng, hits, ms: performance.now() - t1 };
      } catch (e) {
        const isCallerAbort = opts.signal?.aborted === true;
        const isTimeout = !isCallerAbort && (engSignal.aborted || isTimeoutError(e));
        return {
          ok: false as const,
          eng,
          error: isCallerAbort ? 'aborted' : isTimeout ? 'timeout' : describeError(e),
          ms: performance.now() - t1,
        };
      }
    }),
  );

  if (opts.signal?.aborted) throw toAbortError();

  const diagnostics: EngineDiagnostic[] = [];
  const perEngine: Array<{ eng: SearchEngine; hits: MetasearchHit[] }> = [];
  let nonOptionalFailures = 0;
  for (const s of settled) {
    const r = s.status === 'fulfilled' ? s.value : undefined;
    if (!r) throw new MetasearchError('internal error: engine task rejected unexpectedly', diagnostics);
    if (r.ok) {
      perEngine.push({ eng: r.eng, hits: r.hits });
      diagnostics.push({ engine: r.eng.id, ok: true, ms: Math.round(r.ms), hits: r.hits.length });
    } else {
      if (r.error !== 'aborted' && !r.eng.optional) nonOptionalFailures++;
      diagnostics.push({ engine: r.eng.id, ok: false, ms: Math.round(r.ms), hits: 0, error: r.error });
    }
  }

  if (perEngine.length === 0 && nonOptionalFailures > 0) {
    throw new MetasearchError(
      `All search engines failed: ` +
        diagnostics.filter((d) => !d.ok).map((d) => `${d.engine} (${d.error})`).join('; '),
      diagnostics,
    );
  }

  const merged = mergeAndInterleave(perEngine, opts.maxResults ?? DEFAULT_MAX_RESULTS);
  return { hits: merged, diagnostics, ms: Math.round(performance.now() - t0) };
}

function isTimeoutError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'TimeoutError' || e.name === 'ETIMEDOUT') return true;
  return /timeout|timed ?out/i.test(e.message);
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

function toAbortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}
