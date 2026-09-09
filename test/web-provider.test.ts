import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { WebSearchProvider, WEB_SEARCH_PROVIDER_ID, type WebOptions } from '../src/web/provider.js';
import { installFetchMock, type FetchMockResponse } from './web-helpers.js';


const DDG_FIXTURE = readFileSync(new URL('./fixtures/metasearch/duckduckgo.html', import.meta.url), 'utf8');
const BING_FIXTURE = readFileSync(new URL('./fixtures/metasearch/bing.html', import.meta.url), 'utf8');
const WIKI_FIXTURE = readFileSync(new URL('./fixtures/metasearch/wikipedia.json', import.meta.url), 'utf8');

const BASE: WebOptions = { engine: 'auto', maxResults: 20, snippetLength: 160 };

const DDG_HOST = 'https://html.duckduckgo.com/html/';
const BING_HOST = 'https://www.bing.com/search';
const WIKI_HOST = 'https://en.wikipedia.org/w/api.php';

interface UpstreamFailures {
  ddg?: string;
  bing?: string;
  wikipedia?: string;
}

function routeMeta(fails: UpstreamFailures = {}): (url: string) => FetchMockResponse {
  return (url) => {
    if (url.startsWith(DDG_HOST)) {
      if (fails.ddg) return { fail: fails.ddg };
      return { body: DDG_FIXTURE, headers: { 'content-type': 'text/html' } };
    }
    if (url.startsWith(BING_HOST)) {
      if (fails.bing) return { fail: fails.bing };
      return { body: BING_FIXTURE, headers: { 'content-type': 'text/html' } };
    }
    if (url.startsWith(WIKI_HOST)) {
      if (fails.wikipedia) return { fail: fails.wikipedia };
      return { body: WIKI_FIXTURE, headers: { 'content-type': 'application/json' } };
    }
    return { fail: 'unexpected url: ' + url };
  };
}

const DDG_NO_RESULTS =
  '<!DOCTYPE html><html><head><title>Results</title></head><body><div class="results"></div></body></html>';
const BING_NO_RESULTS = '<!DOCTYPE html><html><body><ol id="b_results"></ol></body></html>';
const WIKI_NO_RESULTS = '{"batchcomplete":"","query":{}}';

const DDG_TOP_HIT = 'https://github.com/topics/metasearch-engine?l=typescript';
const BING_FIRST_HIT = 'https://www.typescriptlang.org/';
const WIKI_HIT = 'https://en.wikipedia.org/wiki/List_of_free_and_open-source_software_packages';

describe('WebSearchProvider (built-in metasearch)', () => {
  test('id and available', () => {
    const p = new WebSearchProvider(() => BASE);
    expect(p.id).toBe(WEB_SEARCH_PROVIDER_ID);
    expect(p.id).toBe('web');
    expect(p.available()).toBe(true);
  });

  test('available(): always true for all three engine values', () => {
    expect(new WebSearchProvider(() => ({ ...BASE, engine: 'auto' })).available()).toBe(true);
    expect(new WebSearchProvider(() => ({ ...BASE, engine: 'duckduckgo' })).available()).toBe(true);
    expect(new WebSearchProvider(() => ({ ...BASE, engine: 'searxng' })).available()).toBe(true);
  });

  test('lastReport() is null before the first search', () => {
    expect(new WebSearchProvider(() => BASE).lastReport()).toBeNull();
  });

  test('auto fans out to all three upstreams and returns the merged set', async () => {
    const mock = installFetchMock(routeMeta());
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'auto' }));
      const res = await p.search({ query: 'typescript metasearch engine' });
      expect(mock.calls.some((u) => u.startsWith(DDG_HOST))).toBe(true);
      expect(mock.calls.some((u) => u.startsWith(BING_HOST))).toBe(true);
      expect(mock.calls.some((u) => u.startsWith(WIKI_HOST))).toBe(true);
      expect(res.sources.length).toBeGreaterThanOrEqual(10);
      expect(res.sources.length).toBeLessThanOrEqual(20);
      const urls = res.sources.map((s) => s.url);
      expect(urls).toContain(DDG_TOP_HIT);
      expect(urls).toContain(BING_FIRST_HIT);
      expect(urls).toContain(WIKI_HIT);
      const wiki = res.sources.find((s) => s.url === WIKI_HIT);
      expect(wiki?.publishedAt).toBe('2026-09-06T18:29:40Z');
    } finally {
      mock.restore();
    }
  });

  test('searxng (compat value) fans out to the same three upstreams', async () => {
    const mock = installFetchMock(routeMeta());
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'searxng' }));
      const res = await p.search({ query: 'typescript metasearch engine' });
      expect(mock.calls.some((u) => u.startsWith(DDG_HOST))).toBe(true);
      expect(mock.calls.some((u) => u.startsWith(BING_HOST))).toBe(true);
      expect(mock.calls.some((u) => u.startsWith(WIKI_HOST))).toBe(true);
      expect(res.sources.length).toBeGreaterThanOrEqual(1);
      expect(res.sources.map((s) => s.url)).toContain(DDG_TOP_HIT);
    } finally {
      mock.restore();
    }
  });

  test('engine duckduckgo -> only the DDG upstream is fetched', async () => {
    const mock = installFetchMock(routeMeta());
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'duckduckgo' }));
      const res = await p.search({ query: 'typescript metasearch engine' });
      expect(res.sources.length).toBeGreaterThanOrEqual(1);
      expect(res.sources.map((s) => s.url)).toContain(DDG_TOP_HIT);
      expect(mock.calls.some((u) => u.startsWith(DDG_HOST))).toBe(true);
      expect(mock.calls.some((u) => u.startsWith(BING_HOST))).toBe(false);
      expect(mock.calls.some((u) => u.startsWith(WIKI_HOST))).toBe(false);
      expect(p.lastReport()?.engines.map((e) => e.id)).toEqual(['duckduckgo']);
    } finally {
      mock.restore();
    }
  });

  test('request.maxResults overrides the configured default', async () => {
    const mock = installFetchMock(routeMeta());
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'duckduckgo' }));
      const res = await p.search({ query: 'x', maxResults: 2 });
      expect(res.sources).toHaveLength(2);
    } finally {
      mock.restore();
    }
  });

  test('no results from healthy engines -> informed content, empty sources', async () => {
    const mock = installFetchMock((url) => {
      if (url.startsWith(DDG_HOST)) return { body: DDG_NO_RESULTS };
      if (url.startsWith(BING_HOST)) return { body: BING_NO_RESULTS };
      if (url.startsWith(WIKI_HOST)) return { body: WIKI_NO_RESULTS };
      return { fail: 'unexpected url: ' + url };
    });
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'auto' }));
      const res = await p.search({ query: 'zzzz no such thing zzzz' });
      expect(res.sources).toHaveLength(0);
      expect(res.content).toMatch(/no results/);
      expect(res.content).not.toMatch(/searxng/i);
      const rep = p.lastReport();
      expect(rep?.engines).toHaveLength(3);
      expect(rep?.engines.every((e) => e.status === 'ok' && e.hits === 0)).toBe(true);
      expect(rep?.served).toBe(0);
      expect(rep?.merged).toBe(0);
    } finally {
      mock.restore();
    }
  });

  test('aborted signal -> WEB_ABORTED', async () => {
    const mock = installFetchMock(routeMeta());
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'auto' }));
      const ac = new AbortController();
      ac.abort();
      let threw: unknown;
      try {
        await p.search({ query: 'x' }, ac.signal);
      } catch (e) {
        threw = e;
      }
      expect((threw as { code?: string }).code).toBe('WEB_ABORTED');
      expect(mock.calls).toHaveLength(0);
    } finally {
      mock.restore();
    }
  });

  test('all upstreams fail -> WEB_PROVIDER_ERROR with per-engine detail', async () => {
    const mock = installFetchMock(routeMeta({ ddg: 'ECONNREFUSED', bing: 'ECONNREFUSED', wikipedia: 'ECONNREFUSED' }));
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'auto' }));
      let threw: unknown;
      try {
        await p.search({ query: 'x' });
      } catch (e) {
        threw = e;
      }
      const err = threw as { code?: string; message?: string };
      expect(err.code).toBe('WEB_PROVIDER_ERROR');
      expect(err.message).toContain('duckduckgo');
      expect(err.message).toContain('bing');
      expect(err.message).toContain('wikipedia');
      expect(mock.calls).toHaveLength(3);
    } finally {
      mock.restore();
    }
  });

  test('partial failure (bing down) -> merged results, no error', async () => {
    const mock = installFetchMock(routeMeta({ bing: 'ECONNREFUSED' }));
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'auto' }));
      const res = await p.search({ query: 'typescript metasearch engine' });
      expect(res.sources.length).toBeGreaterThanOrEqual(10);
      expect(res.sources.map((s) => s.url)).toContain(DDG_TOP_HIT);
      expect(res.sources.map((s) => s.url)).toContain(WIKI_HIT);
    } finally {
      mock.restore();
    }
  });

  test('__wslMetasearch report shape (lastReport) reflects the mocked outcomes', async () => {
    const mock = installFetchMock(routeMeta({ bing: 'ECONNREFUSED' }));
    try {
      const p = new WebSearchProvider(() => ({ ...BASE, engine: 'auto' }));
      const res = await p.search({ query: 'typescript metasearch engine' });
      const rep = p.lastReport();
      expect(rep).not.toBeNull();
      expect(rep?.query).toBe('typescript metasearch engine');
      expect(typeof rep?.finishedAt).toBe('number');
      expect(rep?.engines.map((e) => e.id)).toEqual(['duckduckgo', 'bing', 'wikipedia']);
      expect(rep?.engines[0].status).toBe('ok');
      expect(rep?.engines[0].detail).toBe('');
      expect(rep?.engines[0].ms).toBeGreaterThanOrEqual(0);
      expect(rep?.engines[0].hits).toBeGreaterThanOrEqual(1);
      expect(rep?.engines[1].status).toBe('failed');
      expect(rep?.engines[1].detail).toContain('ECONNREFUSED');
      expect(rep?.engines[1].hits).toBe(0);
      expect(rep?.engines[1].ms).toBeGreaterThanOrEqual(0);
      expect(rep?.engines[2].status).toBe('ok');
      expect(rep?.engines[2].hits).toBe(1);
      expect(rep?.merged).toBeGreaterThanOrEqual(res.sources.length);
      expect(rep?.served).toBe(res.sources.length);
    } finally {
      mock.restore();
    }
  });
});
