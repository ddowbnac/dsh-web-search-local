import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web';
import type { LocalEngine } from './engine/engine.js';


export const LOCAL_SEARCH_PROVIDER_ID = 'local';

function cleanSnippet(s: string): string {
  return s.replace(/\[\[/g, '').replace(/\]\]/g, '').replace(/\s+/g, ' ').trim();
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.message === 'aborted';
}

// Fresh read per call: TS narrows `signal?.aborted` after the pre-await check, so a
// direct re-comparison would be flagged as having no overlap even though the signal
// may have been aborted during the await.
function isSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export class LocalSearchProvider implements WebSearchProvider {
  readonly id = LOCAL_SEARCH_PROVIDER_ID;
  private readonly getEngine: () => LocalEngine;

  constructor(getEngine: () => LocalEngine) {
    this.getEngine = getEngine;
  }

  available(): boolean {
    return true;
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (isSignalAborted(signal)) throw new WebError('Local search aborted', 'WEB_ABORTED', { cause: signal?.reason });
    let engine: LocalEngine;
    try {
      engine = this.getEngine();
    } catch (e) {
      throw new WebError(`Local search provider is not configured: ${String(e)}`, 'WEB_PROVIDER_ERROR', { cause: e });
    }
    let hits;
    try {
      hits = await engine.search(request.query, request.maxResults ?? 20, signal);
    } catch (e) {
      if (isSignalAborted(signal) || isAbort(e)) {
        throw new WebError('Local search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? e });
      }
      throw new WebError(`Local search failed: ${String(e)}`, 'WEB_PROVIDER_ERROR', { cause: e });
    }
    const sources: WebSearchSource[] = hits.map((h) => ({
      url: h.url,
      title: h.title,
      snippet: cleanSnippet(h.snippet),
      ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
    }));
    if (sources.length === 0) {
      const dirs = engine.corpusDirs();
      return {
        content:
          `Local index has 0 documents for "${request.query}". ` +
          `Corpus dirs: ${dirs.length > 0 ? dirs.join(', ') : '(none configured)'}. ` +
          `Set corpusDirs under Settings > Plugins (web-search-local) and search again.`,
        sources: [],
        truncated: false,
      };
    }
    return { sources, truncated: false };
  }
}
