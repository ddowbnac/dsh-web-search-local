
import { CHROME_UA, fetchText } from '../http.js';
import { EngineError, type MetasearchHit, type SearchEngine } from '../types.js';
import { parseDuckDuckGoHtml } from '../../duckduckgo.js';

export interface DuckDuckGoEngineOptions {
  readonly maxResults: number;
  readonly snippetLength: number;
}

const ENDPOINT = 'https://html.duckduckgo.com/html/';

const CHALLENGE_PATTERNS: ReadonlyArray<string | RegExp> = [
  'challenge-form',
  'anomaly-modal',
  /confirm you.{0,10}re human/i,
];

export function isDdgChallengePage(html: string): boolean {
  return CHALLENGE_PATTERNS.some((p) => (typeof p === 'string' ? html.includes(p) : p.test(html)));
}

export function createDuckDuckGoEngine(opts: DuckDuckGoEngineOptions): SearchEngine {
  return {
    id: 'duckduckgo',
    displayName: 'DuckDuckGo',
    timeoutMs: 10_000,
    weight: 1.0,
    search(query: string, signal: AbortSignal): Promise<MetasearchHit[]> {
      const url = `${ENDPOINT}?${new URLSearchParams({ q: query }).toString()}`;
      return (async () => {
        const { text } = await fetchText(url, {
          signal,
          headers: { 'user-agent': CHROME_UA, accept: 'text/html,application/xhtml+xml' },
        });
        const hits = parseDuckDuckGoHtml(text, opts.maxResults, opts.snippetLength);
        if (hits.length === 0 && isDdgChallengePage(text)) {
          throw new EngineError('DuckDuckGo served a challenge/anomaly page instead of results', 'challenge');
        }
        return hits;
      })();
    },
  };
}
