import { describe, expect, test } from 'bun:test';
import { dedupKey, isTrackingParam } from '../src/web/metasearch/url.js';
import { mergeAndInterleave, normalizeHits } from '../src/web/metasearch/merge.js';
import { runMetasearch } from '../src/web/metasearch/orchestrator.js';
import { MetasearchError, type MetasearchHit, type SearchEngine } from '../src/web/metasearch/types.js';
import { CHROME_UA } from '../src/web/metasearch/http.js';
import { createDuckDuckGoEngine } from '../src/web/metasearch/engines/duckduckgo.js';
import { installFetchMock } from './web-helpers.js';

function hit(url: string, title = 't', snippet = 's', publishedAt?: string): MetasearchHit {
  return publishedAt ? { url, title, snippet, publishedAt } : { url, title, snippet };
}

async function readFixture(name: string): Promise<string> {
  return Bun.file(new URL(`fixtures/metasearch/${name}`, import.meta.url)).text();
}

describe('dedupKey', () => {
  test('http and https share the same key (scheme excluded)', () => {
    expect(dedupKey('http://example.com/page')).toBe(dedupKey('https://example.com/page'));
  });
  test('host case is normalized (D1)', () => {
    expect(dedupKey('https://Example.COM/page')).toBe(dedupKey('https://example.com/page'));
  });
  test('default ports are stripped; non-default ports are kept', () => {
    expect(dedupKey('http://example.com:80/x')).toBe(dedupKey('http://example.com/x'));
    expect(dedupKey('https://example.com:443/x')).toBe(dedupKey('https://example.com/x'));
    expect(dedupKey('http://example.com:8080/x')).not.toBe(dedupKey('http://example.com/x'));
    expect(dedupKey('https://example.com:80/x')).not.toBe(dedupKey('https://example.com/x'));
  });
  test('trailing slash is stripped except the bare root path (D2)', () => {
    expect(dedupKey('https://example.com/page/')).toBe(dedupKey('https://example.com/page'));
    expect(dedupKey('https://example.com/')).toBe(dedupKey('https://example.com'));
  });
  test('tracking params are ignored in the key: utm_ prefix + named list (D3)', () => {
    expect(dedupKey('https://example.com/p?utm_source=ddg&gclid=abc&id=1')).toBe(
      dedupKey('https://example.com/p?id=1'),
    );
    expect(dedupKey('https://example.com/?ref=1&msclkid=x')).toBe(dedupKey('https://example.com/'));
    expect(dedupKey('https://example.com/?fbclid=zz&igshid=yy&x=1')).toBe(
      dedupKey('https://example.com/?x=1'),
    );
  });
  test('near-miss param names are kept (whole-name / prefix-boundary only)', () => {
    expect(dedupKey('https://example.com/?xref=1')).not.toBe(dedupKey('https://example.com/'));
    expect(dedupKey('https://example.com/?refs=1')).not.toBe(dedupKey('https://example.com/'));
    expect(isTrackingParam('utm_medium')).toBe(true);
    expect(isTrackingParam('ref')).toBe(true);
    expect(isTrackingParam('xref')).toBe(false);
    expect(isTrackingParam('utm')).toBe(false);
  });
  test('query param order is canonical (D3)', () => {
    expect(dedupKey('https://example.com/p?a=1&b=2')).toBe(dedupKey('https://example.com/p?b=2&a=1'));
  });
  test('fragment is excluded from the key (D4)', () => {
    expect(dedupKey('https://example.com/p#section')).toBe(dedupKey('https://example.com/p'));
  });
  test('non-http(s) and unparseable URLs yield null', () => {
    expect(dedupKey('ftp://example.com/x')).toBeNull();
    expect(dedupKey('file:///C:/local.md')).toBeNull();
    expect(dedupKey('javascript:alert(1)')).toBeNull();
    expect(dedupKey('not a url at all')).toBeNull();
    expect(dedupKey('')).toBeNull();
  });
});

describe('normalizeHits', () => {
  test('drops non-http(s)/unparseable, trims + collapses whitespace, snippet==title -> empty', () => {
    const out = normalizeHits([
      { url: '  https://a.example/ok  ', title: '  Multi   Space  ', snippet: '  a\tb\n c ' },
      { url: 'file:///local/x', title: 'local', snippet: 'nope' },
      { url: 'garbage', title: 'bad', snippet: 'nope' },
      { url: 'https://b.example/x', title: 'Same', snippet: '  Same  ' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ url: 'https://a.example/ok', title: 'Multi Space', snippet: 'a b c' });
    expect(out[1]).toEqual({ url: 'https://b.example/x', title: 'Same', snippet: '' });
  });
  test('keeps a non-empty publishedAt (trimmed)', () => {
    const out = normalizeHits([
      { url: 'https://a.example/x', title: 't', snippet: 's', publishedAt: ' 2026-01-02T00:00:00Z ' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].publishedAt).toBe('2026-01-02T00:00:00Z');
  });
});

describe('mergeAndInterleave', () => {
  function eng(id: string, weight = 1): SearchEngine {
    return { id, displayName: id, timeoutMs: 5000, weight, search: async () => [] };
  }

  test('cross-engine duplicate -> 1 hit: longer title/snippet win, https preferred', () => {
    const out = mergeAndInterleave(
      [
        { eng: eng('a'), hits: [hit('http://example.com/a', 'Short', 'A snippet')] },
        { eng: eng('b'), hits: [hit('https://example.com/a/', 'A much longer title', 'A considerably longer snippet text')] },
      ],
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://example.com/a/');
    expect(out[0].title).toBe('A much longer title');
    expect(out[0].snippet).toBe('A considerably longer snippet text');
  });

  test('duplicates within one engine collapse to a single hit', () => {
    const out = mergeAndInterleave(
      [{ eng: eng('a'), hits: [hit('https://x.example/1'), hit('https://x.example/1'), hit('https://x.example/2')] }],
      10,
    );
    expect(out.map((h) => h.url)).toEqual(['https://x.example/1', 'https://x.example/2']);
  });

  test('balance: one slot per engine per rank round (engine #1 slots alternate)', () => {
    const out = mergeAndInterleave(
      [
        { eng: eng('a'), hits: [hit('https://a.example/1'), hit('https://a.example/2'), hit('https://a.example/3')] },
        { eng: eng('b'), hits: [hit('https://b.example/1'), hit('https://b.example/2')] },
        { eng: eng('c'), hits: [hit('https://c.example/1')] },
      ],
      10,
    );
    expect(out.map((h) => h.url)).toEqual([
      'https://a.example/1',
      'https://b.example/1',
      'https://c.example/1',
      'https://a.example/2',
      'https://b.example/2',
      'https://a.example/3',
    ]);
  });

  test('score (sum of weight/rank) orders a rank tier above registration order', () => {
    const out = mergeAndInterleave(
      [
        { eng: eng('a'), hits: [hit('https://x.example/u2'), hit('https://x.example/u1')] },
        { eng: eng('b'), hits: [hit('https://x.example/u1'), hit('https://x.example/u3')] },
      ],
      10,
    );
    expect(out.map((h) => h.url)).toEqual(['https://x.example/u1', 'https://x.example/u2', 'https://x.example/u3']);
  });

  test('engine weight breaks a score tie (first-surfacing engine)', () => {
    const out = mergeAndInterleave(
      [
        { eng: eng('a', 1), hits: [hit('https://x.example/u1')] },
        { eng: eng('b', 2), hits: [hit('https://x.example/u2'), hit('https://x.example/u1')] },
      ],
      10,
    );
    expect(out.map((h) => h.url)).toEqual(['https://x.example/u2', 'https://x.example/u1']);
  });

  test('maxResults cap truncates after ordering', () => {
    const out = mergeAndInterleave(
      [
        { eng: eng('a'), hits: [hit('https://a.example/1'), hit('https://a.example/2'), hit('https://a.example/3')] },
        { eng: eng('b'), hits: [hit('https://b.example/1'), hit('https://b.example/2'), hit('https://b.example/3')] },
        { eng: eng('c'), hits: [hit('https://c.example/1'), hit('https://c.example/2'), hit('https://c.example/3')] },
      ],
      4,
    );
    expect(out).toHaveLength(4);
    expect(out.map((h) => h.url)).toEqual([
      'https://a.example/1',
      'https://b.example/1',
      'https://c.example/1',
      'https://a.example/2',
    ]);
  });

  test('publishedAt survives the merge (first non-empty wins)', () => {
    const out = mergeAndInterleave(
      [
        { eng: eng('a'), hits: [hit('https://x.example/d'), hit('https://x.example/p', 't2', 's2', '2026-01-02T00:00:00Z')] },
        { eng: eng('b'), hits: [hit('https://x.example/d', 't', 's', '2025-06-01T00:00:00Z')] },
      ],
      10,
    );
    const d = out.find((h) => h.url === 'https://x.example/d');
    const p = out.find((h) => h.url === 'https://x.example/p');
    expect(d?.publishedAt).toBe('2025-06-01T00:00:00Z');
    expect(p?.publishedAt).toBe('2026-01-02T00:00:00Z');
  });
});

describe('runMetasearch (fake engines, no network)', () => {
  type Behavior =
    | { kind: 'hits'; hits: MetasearchHit[]; delayMs?: number }
    | { kind: 'fail'; error: Error; delayMs?: number };

  function makeEngine(
    id: string,
    behavior: Behavior,
    over: { timeoutMs?: number; weight?: number; optional?: boolean } = {},
  ): SearchEngine {
    return {
      id,
      displayName: id,
      timeoutMs: 5000,
      weight: 1,
      ...over,
      search(_query: string, signal: AbortSignal): Promise<MetasearchHit[]> {
        return new Promise<MetasearchHit[]>((resolve, reject) => {
          const fail = () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
          if (signal.aborted) {
            fail();
            return;
          }
          const t = setTimeout(() => {
            if (behavior.kind === 'hits') resolve(behavior.hits);
            else reject(behavior.error);
          }, behavior.delayMs ?? 0);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            fail();
          }, { once: true });
        });
      },
    };
  }

  test('all engines ok: merged hits, diagnostics in registration order, ms >= 0', async () => {
    const res = await runMetasearch(
      [
        makeEngine('a', { kind: 'hits', hits: [hit('https://a.example/1')] }),
        makeEngine('b', { kind: 'hits', hits: [hit('https://b.example/1'), hit('https://b.example/2')] }),
      ],
      'test query',
    );
    expect(res.hits.map((h) => h.url)).toEqual(['https://a.example/1', 'https://b.example/1', 'https://b.example/2']);
    expect(res.diagnostics.map((d) => [d.engine, d.ok, d.hits])).toEqual([
      ['a', true, 1],
      ['b', true, 2],
    ]);
    expect(res.ms).toBeGreaterThanOrEqual(0);
  });

  test('one engine fails: others still serve; failure recorded in diagnostics', async () => {
    const res = await runMetasearch(
      [
        makeEngine('ok', { kind: 'hits', hits: [hit('https://ok.example/1')] }),
        makeEngine('bad', { kind: 'fail', error: new Error('upstream exploded') }),
      ],
      'q',
    );
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].url).toBe('https://ok.example/1');
    expect(res.diagnostics).toHaveLength(2);
    expect(res.diagnostics[0]).toMatchObject({ engine: 'ok', ok: true, hits: 1 });
    expect(res.diagnostics[1]).toMatchObject({ engine: 'bad', ok: false, hits: 0, error: 'upstream exploded' });
  });

  test('all engines fail -> MetasearchError listing every per-engine error', async () => {
    let threw: unknown;
    try {
      await runMetasearch(
        [
          makeEngine('a', { kind: 'fail', error: new Error('boom-a') }),
          makeEngine('b', { kind: 'fail', error: new Error('boom-b') }),
        ],
        'q',
      );
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(MetasearchError);
    const err = threw as MetasearchError;
    expect(err.message).toContain('a (boom-a)');
    expect(err.message).toContain('b (boom-b)');
    expect(err.diagnostics).toHaveLength(2);
    expect(err.diagnostics.every((d) => !d.ok)).toBe(true);
  });

  test('optional engine failing alone (others healthy) -> no throw, recorded in diagnostics', async () => {
    const res = await runMetasearch(
      [
        makeEngine('ok', { kind: 'hits', hits: [hit('https://ok.example/1')] }),
        makeEngine('exp', { kind: 'fail', error: new Error('flakey') }, { optional: true }),
      ],
      'q',
    );
    expect(res.hits).toHaveLength(1);
    expect(res.diagnostics[0]).toMatchObject({ engine: 'ok', ok: true });
    expect(res.diagnostics[1]).toMatchObject({ engine: 'exp', ok: false, error: 'flakey' });
  });

  test('only an optional engine, and it fails -> empty result, no throw', async () => {
    const res = await runMetasearch([makeEngine('exp', { kind: 'fail', error: new Error('flakey') }, { optional: true })], 'q');
    expect(res.hits).toEqual([]);
    expect(res.diagnostics[0]).toMatchObject({ engine: 'exp', ok: false, error: 'flakey' });
  });

  test('zero hits from healthy engines -> empty hits, ok diagnostics', async () => {
    const res = await runMetasearch(
      [makeEngine('a', { kind: 'hits', hits: [] }), makeEngine('b', { kind: 'hits', hits: [] })],
      'q',
    );
    expect(res.hits).toEqual([]);
    expect(res.diagnostics.every((d) => d.ok && d.hits === 0)).toBe(true);
  });

  test('empty query -> MetasearchError', async () => {
    await expect(runMetasearch([makeEngine('a', { kind: 'hits', hits: [] })], '   ')).rejects.toThrow('empty query');
  });

  test('no engines configured -> MetasearchError', async () => {
    await expect(runMetasearch([], 'q')).rejects.toThrow('no search engines configured');
  });

  test('global budget: a slow engine is dropped as timeout while a fast one still serves', async () => {
    const res = await runMetasearch(
      [
        makeEngine('slow', { kind: 'hits', hits: [hit('https://slow.example/1')], delayMs: 300 }, { timeoutMs: 10_000 }),
        makeEngine('fast', { kind: 'hits', hits: [hit('https://fast.example/1')] }),
      ],
      'q',
      { globalTimeoutMs: 120 },
    );
    expect(res.hits.map((h) => h.url)).toEqual(['https://fast.example/1']);
    const fast = res.diagnostics.find((d) => d.engine === 'fast');
    const slow = res.diagnostics.find((d) => d.engine === 'slow');
    expect(fast).toMatchObject({ ok: true, hits: 1 });
    expect(slow).toMatchObject({ ok: false, error: 'timeout', hits: 0 });
  });

  test('pre-aborted signal -> rejection (AbortError-compatible)', async () => {
    const c = new AbortController();
    c.abort();
    let threw: unknown;
    try {
      await runMetasearch([makeEngine('a', { kind: 'hits', hits: [hit('https://a.example/1')] })], 'q', {
        signal: c.signal,
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(Error);
    expect((threw as Error).name).toBe('AbortError');
  });

  test('maxResults 0 -> empty output (exact-cap invariant)', () => {
    const out = mergeAndInterleave(
      [
        {
          eng: makeEngine('a', { kind: 'hits', hits: [] }),
          hits: [hit('https://a.example/1'), hit('https://a.example/2')],
        },
      ],
      0,
    );
    expect(out).toEqual([]);
  });

  test('maxResults option truncates the merged output', async () => {
    const res = await runMetasearch(
      [
        makeEngine('a', { kind: 'hits', hits: [hit('https://a.example/1'), hit('https://a.example/2'), hit('https://a.example/3')] }),
        makeEngine('b', { kind: 'hits', hits: [hit('https://b.example/1'), hit('https://b.example/2'), hit('https://b.example/3')] }),
      ],
      'q',
      { maxResults: 3 },
    );
    expect(res.hits).toHaveLength(3);
  });
});

describe('createDuckDuckGoEngine (fixture)', () => {
  test('factory shape: id / displayName / timeoutMs / weight', () => {
    const e = createDuckDuckGoEngine({ maxResults: 10, snippetLength: 160 });
    expect(e.id).toBe('duckduckgo');
    expect(e.displayName).toBe('DuckDuckGo');
    expect(e.timeoutMs).toBe(10000);
    expect(e.weight).toBe(1);
    expect(e.optional).toBeUndefined();
    expect(typeof e.search).toBe('function');
  });

  test('parses the live-captured fixture: >=5 hits, correct top hit, no ad rows', async () => {
    const html = await readFixture('duckduckgo.html');
    const mock = installFetchMock((url) =>
      url.startsWith('https://html.duckduckgo.com/html/') ? { body: html } : { fail: 'unexpected url: ' + url },
    );
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 10, snippetLength: 160 });
      const hits = await engine.search('typescript metasearch engine', new AbortController().signal);
      expect(hits.length).toBeGreaterThanOrEqual(5);
      expect(hits[0].url).toBe('https://github.com/topics/metasearch-engine?l=typescript');
      expect(hits[0].title).toBe('metasearch-engine · GitHub Topics · GitHub');
      expect(hits.every((h) => !h.url.includes('duckduckgo.com/y.js'))).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test('requests the html endpoint with the Chrome UA + accept header', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> | null }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
      seen.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        headers: (init?.headers ?? null) as Record<string, string> | null,
      });
      return new Response('<a class="result__a" href="https://x.example/">t</a>', { status: 200 });
    }) as typeof fetch;
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 5, snippetLength: 100 });
      await engine.search('hello world', new AbortController().signal);
    } finally {
      globalThis.fetch = orig;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://html.duckduckgo.com/html/?q=hello+world');
    expect(seen[0].headers?.['user-agent']).toBe(CHROME_UA);
    expect(seen[0].headers?.['accept']).toContain('text/html');
  });
});
