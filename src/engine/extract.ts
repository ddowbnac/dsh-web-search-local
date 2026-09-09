import { extname } from 'node:path';


export function isBinary(buffer: Buffer): boolean {
  const n = Math.min(buffer.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function decode(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    const latin1 = buffer.toString('latin1');
    if (!latin1.includes('\uFFFD')) return latin1;
  }
  return utf8;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&amp;/gi, '&');
}

function htmlToText(html: string): { title?: string; text: string } {
  let title: string | undefined;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (m) title = decodeEntities(m[1].replace(/\s+/g, ' ').trim()) || undefined;

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body);
  body = body.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: body };
}

function markdownTitle(src: string): { title?: string; body: string } {
  let title: string | undefined;
  let body = src;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (fm) {
    const tline = /^title\s*:\s*(.+)$/im.exec(fm[1]);
    if (tline) {
      title = tline[1].trim().replace(/^["']|["']$/g, '') || undefined;
    }
    body = src.slice(fm[0].length);
  }
  if (!title) {
    const h = /^\s*#{1,6}\s+(.+)$/m.exec(body);
    if (h) title = h[1].trim() || undefined;
  }
  return { title, body: body.trim() };
}

export interface Extracted {
  readonly title?: string;
  readonly text: string;
}

export function extractText(filePath: string, buffer: Buffer): Extracted {
  const ext = extname(filePath).slice(1).toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm': {
      const { title, text } = htmlToText(decode(buffer));
      return { title, text };
    }
    case 'md':
    case 'markdown':
    case 'mdx': {
      const src = decode(buffer);
      const { title, body } = markdownTitle(src);
      return { title, text: body };
    }
    case 'txt':
    case 'log':
    case 'csv':
    case 'tsv':
    case 'json':
    case 'jsonl':
    case 'toml':
    case 'ini':
    case 'env':
    case 'yml':
    case 'yaml':
    default:
      return { text: decode(buffer) };
  }
}
