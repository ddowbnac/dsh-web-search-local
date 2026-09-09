import { describe, expect, test } from 'bun:test';
import { extractText, isBinary } from '../src/engine/extract.js';

describe('isBinary', () => {
  test('detects NUL bytes', () => {
    expect(isBinary(Buffer.from([0x00, 0x01, 0x02]))).toBe(true);
    expect(isBinary(Buffer.from('hello world'))).toBe(false);
  });
});

describe('extractText', () => {
  test('markdown frontmatter title + body', () => {
    const buf = Buffer.from('---\ntitle: My Title\n---\n# Heading\n\nBody text here.\n');
    const r = extractText('a.md', buf);
    expect(r.title).toBe('My Title');
    expect(r.text).toContain('Body text here.');
    expect(r.text).toContain('Heading');
  });

  test('markdown falls back to first heading', () => {
    const r = extractText('b.md', Buffer.from('# First Heading\n\nSome body.\n'));
    expect(r.title).toBe('First Heading');
    expect(r.text).toContain('Some body.');
  });

  test('html title + tag strip', () => {
    const html = '<html><head><title>Page Title</title></head><body><p>Hello &amp; welcome</p><script>x</script></body></html>';
    const r = extractText('c.html', Buffer.from(html));
    expect(r.title).toBe('Page Title');
    expect(r.text).toContain('Hello & welcome');
    expect(r.text).not.toContain('<script>');
    expect(r.text).not.toContain('x');
  });

  test('plain text passthrough', () => {
    const r = extractText('d.txt', Buffer.from('Just some text.\nSecond line.'));
    expect(r.title).toBeUndefined();
    expect(r.text).toContain('Just some text.');
  });

  test('json/code indexed as raw text', () => {
    const r = extractText('e.json', Buffer.from('{"a":1}'));
    expect(r.text).toContain('"a":1');
  });
});
