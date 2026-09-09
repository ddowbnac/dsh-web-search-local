
import type { SearchEngine } from '../types.js';
import { createBingEngine } from './bing.js';
import { createDuckDuckGoEngine } from './duckduckgo.js';
import { createWikipediaEngine } from './wikipedia.js';

export interface DefaultEnginesOptions {
  readonly maxResults: number;
  readonly snippetLength: number;
}

export function createDefaultEngines(opts: DefaultEnginesOptions): SearchEngine[] {
  return [
    createDuckDuckGoEngine(opts),
    { ...createBingEngine(opts), optional: true },
    { ...createWikipediaEngine(opts), optional: true },
  ];
}
