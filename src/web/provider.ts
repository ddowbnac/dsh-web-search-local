import { WebError } from '@deepseek-ai/dsh-web';
import type {
  WebSearchProvider as WebSearchProviderSeam,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web';
import { runMetasearch } from './metasearch/orchestrator.js';
import type { EngineDiagnostic, MetasearchHit, SearchEngine } from './metasearch/types.js';
import { MetasearchError } from './metasearch/types.js';
import { createDefaultEngines } from './metasearch/engines/index.js';
import { createDuckDuckGoEngine } from './metasearch/engines/duckduckgo.js';


export const WEB_SEARCH_PROVIDER_ID = 'web';

const SEARCH_TIMEOUT_MS = 20_000;

const NO_MERGE_CAP = Number.MAX_SAFE_INTEGER;

export interface WebOptions {
  readonly engine: 'auto' | 'duckduckgo' | 'searxng';
  readonly maxResults: number;
  readonly snippetLength: number;
}

export type WebEngine = WebOptions['engine'];

export interface MetasearchEngineReport {
  readonly id: string;
  readonly status: 'ok' | 'failed' | 'skipped';
  readonly hits: number;
  readonly ms: number | null;
  readonly detail: string;
}

export interface MetasearchReport {
  readonly query: string | null;
  readonly finishedAt: number | null;
  readonly engines: MetasearchEngineReport[];
  readonly merged: number;
  readonly served: number;
}

export class WebSearchProvider implements WebSearchProviderSeam {
  readonly id = WEB_SEARCH_PROVIDER_ID;
  private readonly getOpts: () => WebOptions;
  private report: MetasearchReport | null = null;

  constructor(getOpts: () => WebOptions) {
    this.getOpts = getOpts;
  }

  available(): boolean {
    return true;
  }

  lastReport(): MetasearchReport | null {
    return this.report;
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const o = this.getOpts();
    const query = request.query;
    const maxResults = request.maxResults ?? o.maxResults;
    const engineOpts = { maxResults, snippetLength: o.snippetLength };
    const engines: SearchEngine[] =
      o.engine === 'duckduckgo' ? [createDuckDuckGoEngine(engineOpts)] : createDefaultEngines(engineOpts);

    if (signal?.aborted === true) {
      this.recordReport(query, engines, null, 'aborted', 0, 0);
      throw new WebError('Web search aborted', 'WEB_ABORTED', { cause: signal?.reason });
    }
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])
      : AbortSignal.timeout(SEARCH_TIMEOUT_MS);

    try {
      const result = await runMetasearch(engines, query, {
        globalTimeoutMs: SEARCH_TIMEOUT_MS,
        maxResults: NO_MERGE_CAP,
        signal: combined,
      });
      const sources = toSources(result.hits, maxResults);
      this.recordReport(query, engines, result.diagnostics, '', result.hits.length, sources.length);
      if (sources.length === 0) {
        return { content: noResultsContent(query, result.diagnostics), sources: [], truncated: false };
      }
      return { sources, truncated: false };
    } catch (e) {
      if (combined.aborted || isAbort(e)) {
        this.recordReport(query, engines, null, 'aborted', 0, 0);
        throw new WebError('Web search aborted', 'WEB_ABORTED', { cause: e });
      }
      if (e instanceof MetasearchError) {
        this.recordReport(query, engines, e.diagnostics, e.message, 0, 0);
        throw new WebError(`Web search failed (metasearch): ${diagnosticsSummary(e)}`, 'WEB_PROVIDER_ERROR', {
          cause: e,
        });
      }
      this.recordReport(query, engines, null, e instanceof Error ? e.message : String(e), 0, 0);
      throw new WebError(
        `Web search failed (metasearch): ${String(e instanceof Error ? e.message : e)}`,
        'WEB_PROVIDER_ERROR',
        { cause: e },
      );
    }
  }

  private recordReport(
    query: string,
    engines: SearchEngine[],
    diagnostics: EngineDiagnostic[] | null,
    skipDetail: string,
    merged: number,
    served: number,
  ): void {
    this.report = {
      query,
      finishedAt: Date.now(),
      engines:
        diagnostics && diagnostics.length > 0
          ? diagnostics.map((d) =>
              d.ok
                ? { id: d.engine, status: 'ok' as const, hits: d.hits, ms: d.ms, detail: '' }
                : { id: d.engine, status: 'failed' as const, hits: 0, ms: d.ms, detail: d.error ?? '' },
            )
          : engines.map((e) => ({ id: e.id, status: 'skipped' as const, hits: 0, ms: null, detail: skipDetail })),
      merged,
      served,
    };
  }
}

function toSources(hits: ReadonlyArray<MetasearchHit>, maxResults: number): WebSearchSource[] {
  const out: WebSearchSource[] = [];
  for (const h of hits) {
    if (out.length >= maxResults) break;
    const source: WebSearchSource = {
      url: h.url,
      title: h.title,
      snippet: h.snippet,
      ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
    };
    out.push(source);
  }
  return out;
}

function noResultsContent(query: string, diagnostics: EngineDiagnostic[]): string {
  const summary =
    diagnostics.length > 0
      ? diagnostics.map((d) => (d.ok ? d.engine : `${d.engine} (failed: ${d.error ?? 'error'})`)).join(', ')
      : 'metasearch';
  return (
    `Web search for "${query}" returned no results (engine: ${summary}). ` +
    `Try a different query or reformulate the search terms.`
  );
}

function diagnosticsSummary(e: MetasearchError): string {
  if (e.diagnostics.length === 0) return e.message;
  return e.diagnostics.map((d) => (d.ok ? `${d.engine} (ok)` : `${d.engine} (${d.error ?? 'error'})`)).join('; ');
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.message === 'aborted');
}
