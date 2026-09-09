import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBingEngine, parseBingHtml, resolveBingUrl } from '../src/web/metasearch/engines/bing.js';
import { EngineError } from '../src/web/metasearch/types.js';
import { installFetchMock } from './web-helpers.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/metasearch/bing.html', import.meta.url));

function ckA(target: string): string {
  const b64 = Buffer.from(target, 'utf8').toString('base64url').replace(/=+$/, '');
  return `https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;u=a1${b64}&amp;ntb=1`;
}

describe('parseBingHtml: real captured fixture', () => {
  const html = readFileSync(FIXTURE, 'utf8');
  const hits = parseBingHtml(html, 10, 160);

  test('parses >= 5 rows from the real SERP', () => {
    expect(hits.length).toBeGreaterThanOrEqual(5);
  });

  test('every url is absolute http(s)', () => {
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.url).toMatch(/^https?:\/\//);
  });

  test('no /ck/a click-redirects leak into the output (decode worked)', () => {
    for (const h of hits) expect(h.url).not.toContain('/ck/a');
  });

  test('first hit matches the fixture first row (decoded typescriptlang.org)', () => {
    expect(hits[0].title).toBe('TypeScript : JavaScript With Syntax For Types.');
    expect(hits[0].url).toBe('https://www.typescriptlang.org/');
    expect(hits[0].snippet).toMatch(/^TypeScript extends JavaScript by adding types to the language\./);
  });

  test('snippets are plain text (no tags) and mostly non-empty', () => {
    for (const h of hits) expect(h.snippet).not.toContain('<');
    const nonEmpty = hits.filter((h) => h.snippet.length > 0).length;
    expect(nonEmpty).toBeGreaterThanOrEqual(Math.ceil(hits.length / 2));
  });

  test('ad / pagination junk absent: no leftover bing.com/ck/a, no FORM= paging urls, no duplicate urls', () => {
    const urls = hits.map((h) => h.url);
    for (const u of urls) {
      expect(u).not.toContain('https://www.bing.com/ck/a');
      expect(u).not.toContain('FORM=');
    }
    for (const h of hits) expect(h.title).not.toContain('Next page');
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('parseBingHtml: synthetic pages', () => {
  const SYNTHETIC = `<!DOCTYPE html><html><body>
<ol id="b_results" class="">
<li class="b_algo" data-id iid=SERP.1>
  <h2 class=""><a target="_blank" href="${ckA('https://example.com/x')}">Redirected &lt;Title&gt;</a></h2>
  <div class="b_caption"><p class="b_lineclamp2">First snippet.</p></div>
</li>
<li class="b_ad"><h2><a href="https://ads.example/sponsored">Ad row</a></h2></li>
<li class="b_algo" data-id iid=SERP.2>
  <h2 class=""><a target="_blank" href="https://example.org/y">Plain absolute</a></h2>
  <div class="b_caption"><p>Second <b>bold</b> snippet.</p></div>
</li>
<li class="b_algo" data-id iid=SERP.3>
  <h2 class=""><a target="_blank" href="/relative/path">Relative</a></h2>
  <div class="b_caption"><p>Should be skipped.</p></div>
</li>
<li class="b_pag"><a href="/search?q=x&amp;first=11&amp;FORM=PERE">2</a></li>
</ol></body></html>`;

  test('decodes /ck/a a1 base64url and passes plain absolute hrefs through', () => {
    const hits = parseBingHtml(SYNTHETIC, 10, 100);
    expect(hits.length).toBe(2);
    expect(hits[0].url).toBe('https://example.com/x');
    expect(hits[0].title).toBe('Redirected <Title>');
    expect(hits[0].snippet).toBe('First snippet.');
    expect(hits[1].url).toBe('https://example.org/y');
    expect(hits[1].snippet).toBe('Second bold snippet.');
  });

  test('page without <ol id="b_results"> -> EngineError kind "parse"', () => {
    let threw: unknown;
    try {
      parseBingHtml('<html><body><p>consent wall</p></body></html>', 5, 100);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(EngineError);
    expect((threw as EngineError).kind).toBe('parse');
  });

  test('container present with zero b_algo rows -> []', () => {
    expect(parseBingHtml('<html><body><ol id="b_results"></ol></body></html>', 5, 100)).toEqual([]);
  });

  test('maxResults caps the output', () => {
    const hits = parseBingHtml(SYNTHETIC, 1, 100);
    expect(hits.length).toBe(1);
    expect(hits[0].url).toBe('https://example.com/x');
  });
});

describe('resolveBingUrl', () => {
  test('decodes a1 /ck/a payloads (with and without padding needed)', () => {
    expect(resolveBingUrl(ckA('https://example.com/x'))).toBe('https://example.com/x');
    expect(resolveBingUrl(ckA('https://example.com'))).toBe('https://example.com');
  });

  test('plain hrefs pass through; protocol-relative becomes absolute', () => {
    expect(resolveBingUrl('https://plain.example/page')).toBe('https://plain.example/page');
    expect(resolveBingUrl('//example.org/x')).toBe('https://example.org/x');
  });
});

describe('createBingEngine', () => {
  test('factory shape', () => {
    const engine = createBingEngine({ maxResults: 10, snippetLength: 160 });
    expect(engine.id).toBe('bing');
    expect(engine.displayName).toBe('Bing');
    expect(engine.timeoutMs).toBe(10_000);
    expect(engine.weight).toBe(1.0);
  });

  test('search() GETs bing.com/search?q=… and parses the fixture body', async () => {
    const html = readFileSync(FIXTURE, 'utf8');
    const mock = installFetchMock((url) =>
      url.startsWith('https://www.bing.com/search?') ? { body: html } : { fail: url },
    );
    try {
      const engine = createBingEngine({ maxResults: 10, snippetLength: 160 });
      const hits = await engine.search('typescript metasearch engine', new AbortController().signal);
      expect(hits.length).toBeGreaterThanOrEqual(5);
      expect(mock.calls[0]).toBe('https://www.bing.com/search?q=typescript+metasearch+engine');
    } finally {
      mock.restore();
    }
  });
});
