import { describe, expect, test } from 'bun:test';
import { createWikipediaEngine, parseWikipediaApi } from '../src/web/metasearch/engines/wikipedia.js';
import { EngineError } from '../src/web/metasearch/types.js';
import { installFetchMock } from './web-helpers.js';

const WIKI_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

async function readFixture(name: string): Promise<string> {
  return Bun.file(new URL(`fixtures/metasearch/${name}`, import.meta.url)).text();
}

async function expectEngineError(
  engine: ReturnType<typeof createWikipediaEngine>,
  kind: 'http' | 'network' | 'parse' | 'challenge',
): Promise<EngineError> {
  let threw: unknown;
  try {
    await engine.search('q', new AbortController().signal);
  } catch (e) {
    threw = e;
  }
  expect(threw).toBeInstanceOf(EngineError);
  expect((threw as EngineError).kind).toBe(kind);
  return threw as EngineError;
}

const DASH = '\u2013';

const EXPECTED_FIXTURE_SNIPPET = `Zope ${DASH} web application server SearXNG ${DASH} self-hostable metasearch engine YaCy ${DASH} P2P-based search engine JXplorer ${DASH} LDAP client Nextcloud ${DASH} fork of ownCloud`;

const EXPECTED_FIXTURE_URL = 'https://en.wikipedia.org/wiki/List_of_free_and_open-source_software_packages';
const EXPECTED_FIXTURE_TITLE = 'List of free and open-source software packages';
const EXPECTED_FIXTURE_TIMESTAMP = '2026-09-06T18:29:40Z';

describe('parseWikipediaApi: real captured fixture', () => {
  test('wikipedia.json -> exactly the fixture hit (title/url/snippet/publishedAt)', async () => {
    const jsonText = await readFixture('wikipedia.json');
    const hits = parseWikipediaApi(jsonText, 200);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBe(1);
    const [hit] = hits;
    expect(hit.title).toBe(EXPECTED_FIXTURE_TITLE);
    expect(hit.url).toBe(EXPECTED_FIXTURE_URL);
    expect(hit.snippet).toBe(EXPECTED_FIXTURE_SNIPPET);
    expect(hit.publishedAt).toBe(EXPECTED_FIXTURE_TIMESTAMP);
  });

  test('snippet has no tags; url is canonical https://en.wikipedia.org/wiki/… (spaces -> underscores)', async () => {
    const jsonText = await readFixture('wikipedia.json');
    const [hit] = parseWikipediaApi(jsonText, 200);
    expect(hit.snippet).not.toContain('<span');
    expect(hit.snippet).not.toContain('<');
    expect(hit.snippet).not.toContain('>');
    expect(hit.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/[A-Za-z0-9._-]+$/);
    expect(hit.url).not.toContain(' ');
  });
});

describe('parseWikipediaApi: synthetic JSON', () => {
  test('multiple items: searchmatch spans stripped, entities decoded, timestamp surfaced', () => {
    const jsonText = JSON.stringify({
      batchcomplete: '',
      query: {
        search: [
          {
            ns: 0,
            pageid: 1,
            title: 'Foo & Bar',
            snippet:
              'A <span class="searchmatch">foo</span> &amp; <span class="searchmatch">bar</span> page with &quot;quotes&quot; and &#x27;apostrophes&#x27;.',
            timestamp: '2025-01-02T03:04:05Z',
          },
          { ns: 0, pageid: 2, title: 'Baz', snippet: 'Baz snippet, no matches.' },
        ],
      },
    });
    const hits = parseWikipediaApi(jsonText, 200);
    expect(hits.length).toBe(2);
    expect(hits[0].title).toBe('Foo & Bar');
    expect(hits[0].url).toBe('https://en.wikipedia.org/wiki/Foo_&_Bar');
    expect(hits[0].snippet).toBe(`A foo & bar page with "quotes" and 'apostrophes'.`);
    expect(hits[0].publishedAt).toBe('2025-01-02T03:04:05Z');
    expect(hits[1].title).toBe('Baz');
    expect(hits[1].url).toBe('https://en.wikipedia.org/wiki/Baz');
    expect(hits[1].snippet).toBe('Baz snippet, no matches.');
    expect(hits[1].publishedAt).toBeUndefined();
  });

  test('snippet clipped to snippetLength (word boundary + ellipsis)', () => {
    const jsonText = JSON.stringify({
      query: { search: [{ pageid: 1, title: 'Long', snippet: 'alpha beta gamma delta epsilon zeta' }] },
    });
    const [hit] = parseWikipediaApi(jsonText, 15);
    expect(hit.snippet).toBe('alpha beta…');
  });

  test('empty search array -> []', () => {
    const jsonText = '{"batchcomplete":"","query":{"searchinfo":{"totalhits":0},"search":[]}}';
    expect(parseWikipediaApi(jsonText, 200)).toEqual([]);
  });

  test('missing/absent query.search -> [] (0-hit responses carry no search key)', () => {
    expect(parseWikipediaApi('{"query":{}}', 200)).toEqual([]);
    expect(parseWikipediaApi('{"batchcomplete":""}', 200)).toEqual([]);
    expect(parseWikipediaApi('null', 200)).toEqual([]);
    expect(parseWikipediaApi('"just a string"', 200)).toEqual([]);
  });

  test('malformed JSON -> EngineError kind "parse"', () => {
    try {
      parseWikipediaApi('{"query": oops', 200);
      expect.unreachable('expected EngineError for malformed JSON');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).kind).toBe('parse');
    }
  });
});

describe('createWikipediaEngine', () => {
  test('metadata: id, displayName, timeoutMs, weight', () => {
    const engine = createWikipediaEngine({ maxResults: 5, snippetLength: 200 });
    expect(engine.id).toBe('wikipedia');
    expect(engine.displayName).toBe('Wikipedia');
    expect(engine.timeoutMs).toBe(10_000);
    expect(engine.weight).toBe(1.0);
  });

  test('real fixture body through fetch -> hit; correct action-API request params', async () => {
    const jsonText = await readFixture('wikipedia.json');
    const mock = installFetchMock((url) => (url.startsWith(WIKI_ENDPOINT) ? { body: jsonText } : { fail: url }));
    try {
      const engine = createWikipediaEngine({ maxResults: 3, snippetLength: 200 });
      const hits = await engine.search('typescript metasearch engine', new AbortController().signal);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].title).toBe(EXPECTED_FIXTURE_TITLE);
      expect(hits[0].url).toBe(EXPECTED_FIXTURE_URL);
      expect(hits[0].publishedAt).toBe(EXPECTED_FIXTURE_TIMESTAMP);

      const req = new URL(mock.calls[0]);
      expect(req.origin + req.pathname).toBe(WIKI_ENDPOINT);
      expect(req.searchParams.get('action')).toBe('query');
      expect(req.searchParams.get('list')).toBe('search');
      expect(req.searchParams.get('format')).toBe('json');
      expect(req.searchParams.get('srnamespace')).toBe('0');
      expect(req.searchParams.get('srlimit')).toBe('3');
      expect(req.searchParams.get('srsearch')).toBe('typescript metasearch engine');
    } finally {
      mock.restore();
    }
  });

  test('genuinely empty search (HTTP 200, no search key) -> [] not an error', async () => {
    const mock = installFetchMock(() => ({
      body: '{"batchcomplete":"","query":{"searchinfo":{"totalhits":0}}}',
    }));
    try {
      const engine = createWikipediaEngine({ maxResults: 5, snippetLength: 200 });
      const hits = await engine.search('zzz qqq nothing matches', new AbortController().signal);
      expect(hits).toEqual([]);
    } finally {
      mock.restore();
    }
  });

  test('HTTP >= 400 -> EngineError kind "http" with the status in the message', async () => {
    const mock = installFetchMock(() => ({ status: 429, body: 'rate limited' }));
    try {
      const engine = createWikipediaEngine({ maxResults: 5, snippetLength: 200 });
      const err = await expectEngineError(engine, 'http');
      expect(err.message).toContain('429');
    } finally {
      mock.restore();
    }
  });

  test('network failure -> EngineError kind "network"', async () => {
    const mock = installFetchMock(() => ({ fail: 'ENOTFOUND' }));
    try {
      const engine = createWikipediaEngine({ maxResults: 5, snippetLength: 200 });
      const err = await expectEngineError(engine, 'network');
      expect(err.message).toContain('ENOTFOUND');
    } finally {
      mock.restore();
    }
  });
});
