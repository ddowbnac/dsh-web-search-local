import { describe, expect, test } from 'bun:test';
import { createDuckDuckGoEngine, isDdgChallengePage } from '../src/web/metasearch/engines/duckduckgo.js';
import { fetchJson, fetchText } from '../src/web/metasearch/http.js';
import { EngineError } from '../src/web/metasearch/types.js';
import { installFetchMock } from './web-helpers.js';

const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';

const CHALLENGE_HTML = `<!DOCTYPE html><html><head><title>Challenge</title></head><body>
<form id="challenge-form" action="/challenge" method="post">
  <input type="hidden" name="token" value="x" />
  <button type="submit">Verify you are human</button>
</form>
</body></html>`;

const ANOMALY_HTML =
  `<html><body><div class="anomaly-modal">Let’s confirm you’re human.</div></body></html>`;

async function readFixture(name: string): Promise<string> {
  return Bun.file(new URL(`fixtures/metasearch/${name}`, import.meta.url)).text();
}

async function expectEngineError(
  engine: ReturnType<typeof createDuckDuckGoEngine>,
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

describe('DDG engine: challenge detection', () => {
  test('challenge-form page -> EngineError kind "challenge"', async () => {
    const mock = installFetchMock((url) => (url.startsWith(DDG_ENDPOINT) ? { body: CHALLENGE_HTML } : { fail: url }));
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 5, snippetLength: 100 });
      await expectEngineError(engine, 'challenge');
    } finally {
      mock.restore();
    }
  });

  test('anomaly copy (typographic apostrophe) -> EngineError kind "challenge"', async () => {
    const mock = installFetchMock((url) => (url.startsWith(DDG_ENDPOINT) ? { body: ANOMALY_HTML } : { fail: url }));
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 5, snippetLength: 100 });
      await expectEngineError(engine, 'challenge');
    } finally {
      mock.restore();
    }
  });

  test('isDdgChallengePage: markers detected, normal pages not', () => {
    expect(isDdgChallengePage(CHALLENGE_HTML)).toBe(true);
    expect(isDdgChallengePage(ANOMALY_HTML)).toBe(true);
    expect(isDdgChallengePage("<p>Let's confirm you're human.</p>")).toBe(true);
    expect(isDdgChallengePage('<html><body>normal results</body></html>')).toBe(false);
  });

  test('legit SERP whose result text contains challenge copy -> NOT a challenge (no false positive)', async () => {
    const legitSerp = `<!DOCTYPE html><html><head><title>Results</title></head><body><div class="results">
  <div class="result results--group">
    <div class="links_main links_deep result__body">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://captcha.example/guide">How to confirm you're human</a></h2>
      <a class="result__snippet" href="https://captcha.example/guide">This guide explains how to confirm you're human when a site shows a captcha challenge.</a>
    </div>
  </div>
</div></body></html>`;
    const mock = installFetchMock((url) => (url.startsWith(DDG_ENDPOINT) ? { body: legitSerp } : { fail: url }));
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 5, snippetLength: 100 });
      const hits = await engine.search("confirm you're human", new AbortController().signal);
      expect(hits).toHaveLength(1);
      expect(hits[0].url).toBe('https://captcha.example/guide');
    } finally {
      mock.restore();
    }
  });

  test('real fixture page -> resolves with hits (no false-positive challenge)', async () => {
    const html = await readFixture('duckduckgo.html');
    const mock = installFetchMock((url) => (url.startsWith(DDG_ENDPOINT) ? { body: html } : { fail: url }));
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 10, snippetLength: 160 });
      const hits = await engine.search('typescript metasearch engine', new AbortController().signal);
      expect(hits.length).toBeGreaterThanOrEqual(5);
    } finally {
      mock.restore();
    }
  });

  test('HTTP >= 400 -> EngineError kind "http" with the status in the message', async () => {
    const mock = installFetchMock(() => ({ status: 429, body: 'slow down' }));
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 5, snippetLength: 100 });
      const err = await expectEngineError(engine, 'http');
      expect(err.message).toContain('429');
    } finally {
      mock.restore();
    }
  });

  test('network failure -> EngineError kind "network"', async () => {
    const mock = installFetchMock(() => ({ fail: 'ECONNREFUSED' }));
    try {
      const engine = createDuckDuckGoEngine({ maxResults: 5, snippetLength: 100 });
      const err = await expectEngineError(engine, 'network');
      expect(err.message).toContain('ECONNREFUSED');
    } finally {
      mock.restore();
    }
  });
});

describe('fetchText / fetchJson (shared upstream helper)', () => {
  test('oversized streaming body is aborted -> EngineError kind "http"', async () => {
    const mock = installFetchMock(() => ({ body: 'x'.repeat(4096) }));
    try {
      let threw: unknown;
      try {
        await fetchText('https://upstream.example/big', { maxBytes: 100 });
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(EngineError);
      expect((threw as EngineError).kind).toBe('http');
      expect((threw as EngineError).message).toContain('100');
    } finally {
      mock.restore();
    }
  });

  test('declared content-length over the limit -> EngineError kind "http"', async () => {
    const mock = installFetchMock(() => ({
      body: 'never read',
      headers: { 'content-length': '999999' },
    }));
    try {
      let threw: unknown;
      try {
        await fetchText('https://upstream.example/declared', { maxBytes: 100 });
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(EngineError);
      expect((threw as EngineError).kind).toBe('http');
      expect((threw as EngineError).message).toContain('999999');
    } finally {
      mock.restore();
    }
  });

  test('fetchJson parses a JSON body', async () => {
    const mock = installFetchMock(() => ({ body: '{"ok":true,"n":3}' }));
    try {
      const { json, status } = await fetchJson('https://upstream.example/json');
      expect(status).toBe(200);
      expect(json).toEqual({ ok: true, n: 3 });
    } finally {
      mock.restore();
    }
  });

  test('fetchJson on an invalid JSON body -> EngineError kind "parse"', async () => {
    const mock = installFetchMock(() => ({ body: 'not json' }));
    try {
      let threw: unknown;
      try {
        await fetchJson('https://upstream.example/json');
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(EngineError);
      expect((threw as EngineError).kind).toBe('parse');
    } finally {
      mock.restore();
    }
  });
});
