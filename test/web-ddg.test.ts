import { describe, expect, test } from 'bun:test';
import {
  parseDuckDuckGoHtml,
  resolveResultUrl,
  htmlToText,
  decodeEntities,
  searchDuckDuckGo,
} from '../src/web/duckduckgo.js';
import { DDG_HTML, DDG_EMPTY_HTML, installFetchMock } from './web-helpers.js';

describe('decodeEntities', () => {
  test('named + numeric entities (whitespace untouched — htmlToText collapses it)', () => {
    expect(decodeEntities('a &amp; b &quot;c&quot; &#39;d&#39; &#x27;e&#x27; &lt;f&gt; &nbsp;g')).toBe("a & b \"c\" 'd' 'e' <f>  g");
  });
});

describe('htmlToText', () => {
  test('strips tags, decodes entities, collapses whitespace', () => {
    expect(htmlToText('<b>BM25</b> is a <b>ranking</b>\n\nalgorithm &amp; more.')).toBe('BM25 is a ranking algorithm & more.');
  });
});

describe('resolveResultUrl', () => {
  test('decodes the uddg redirect parameter', () => {
    expect(resolveResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fpage&amp;rut=x')).toBe('https://www.example.com/page');
  });
  test('handles absolute duckduckgo.com redirect URLs', () => {
    expect(resolveResultUrl('https://duckduckgo.com/l/?uddg=http%3A%2F%2Fexample.org%2Fx&rut=1')).toBe('http://example.org/x');
  });
  test('makes protocol-relative non-DDG hrefs absolute', () => {
    expect(resolveResultUrl('//example.com/plain')).toBe('https://example.com/plain');
  });
  test('passes plain URLs through', () => {
    expect(resolveResultUrl('https://plain.example/path')).toBe('https://plain.example/path');
  });
  test('empty href stays empty', () => {
    expect(resolveResultUrl('')).toBe('');
  });
});

describe('parseDuckDuckGoHtml', () => {
  test('extracts title, real url, and snippet from realistic markup', () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML, 10, 160);
    expect(hits).toHaveLength(4);
    expect(hits[0].url).toBe('https://www.deepseek.com/harness/en/');
    expect(hits[0].title).toBe('DeepSeek Harness developer preview');
    expect(hits[0].snippet).toBe('DeepSeek Harness is a developer preview where everything is a plugin.');
  });
  test('decodes entities in titles and snippets', () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML, 10, 160);
    expect(hits[1].title).toBe('Rust"s \'full text\' engine');
    expect(hits[1].url).toBe('https://example.org/quoted');
    expect(hits[1].snippet).toContain('written in Rust & friends');
  });
  test('passes non-redirect result links through', () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML, 10, 160);
    expect(hits[2].url).toBe('https://plain.example/page');
  });
  test('honors maxResults', () => {
    expect(parseDuckDuckGoHtml(DDG_HTML, 2, 160)).toHaveLength(2);
  });
  test('missing snippet yields empty snippet string', () => {
    const html = '<a class="result__a" href="https://x.example/">Only title</a>';
    const hits = parseDuckDuckGoHtml(html, 5, 100);
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBe('');
  });
  test('anomaly / no-results page yields zero hits', () => {
    expect(parseDuckDuckGoHtml(DDG_EMPTY_HTML, 10, 160)).toHaveLength(0);
  });
  test('filters DDG-injected ad rows (duckduckgo.com/y.js targets)', () => {
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_domain%3Dx.com&amp;rut=ad1">Sponsored result</a>' +
      '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js&amp;rut=ad1">ad copy</a>' +
      '<a class="result__a" href="https://real.example/">Real result</a>' +
      '<a class="result__snippet" href="https://real.example/">real copy</a>';
    const hits = parseDuckDuckGoHtml(html, 10, 160);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('https://real.example/');
  });
  test('snippet clipping appends an ellipsis at a word boundary', () => {
    const html =
      '<a class="result__a" href="https://x.example/">t</a>' +
      '<a class="result__snippet" href="https://x.example/">word '.repeat(30) + '</a>';
    const hits = parseDuckDuckGoHtml(html, 5, 40);
    expect(hits[0].snippet.endsWith('…')).toBe(true);
    expect(hits[0].snippet.length).toBeLessThanOrEqual(41);
    expect(hits[0].snippet).not.toMatch(/…\S/);
  });
});

describe('searchDuckDuckGo (mocked fetch)', () => {
  test('requests the html endpoint and parses the response', async () => {
    const mock = installFetchMock((url) => (url.startsWith('https://html.duckduckgo.com/html/') ? { body: DDG_HTML } : { fail: 'unexpected ' + url }));
    try {
      const hits = await searchDuckDuckGo('deepseek harness', 3, 160);
      expect(hits).toHaveLength(3);
      expect(mock.calls[0]).toContain('q=deepseek');
      expect(hits[0].url).toBe('https://www.deepseek.com/harness/en/');
    } finally {
      mock.restore();
    }
  });
  test('HTTP error surfaces as a thrown error', async () => {
    const mock = installFetchMock(() => ({ status: 429, body: 'slow down' }));
    try {
      let threw: unknown;
      try {
        await searchDuckDuckGo('x', 5, 100);
      } catch (e) {
        threw = e;
      }
      expect(String(threw)).toContain('429');
    } finally {
      mock.restore();
    }
  });
});
