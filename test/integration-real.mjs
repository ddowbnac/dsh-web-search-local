import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import WebRuntime from '@deepseek-ai/dsh-web';
import * as plugin from '../lib/index.js';

const dir = mkdtempSync(join(tmpdir(), 'dsh-real-'));
try {
  const corpus = join(dir, 'corpus');
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, 'hello.md'), '# Hello world\n\nThe quick brown fox jumps over the lazy dog. Local search demo.\n');
  writeFileSync(join(corpus, 'guide.md'), '# Configure guide\n\nHow to configure the local web search provider in the harness.\n');
  writeFileSync(join(corpus, 'bm25.txt'), 'BM25 ranking powers full text search engines like FTS5.\n');

  const ctx = new Context();
  new WebRuntime(ctx, { searchProvider: 'local', fetchProvider: 'local' });
  plugin.apply(ctx, { corpusDirs: [corpus], indexDir: join(dir, 'idx') });

  const web = ctx.web ?? ctx.get('web');
  console.log('ctx.web present:', !!web);

  const res = await web.search({ query: 'configure local search', maxResults: 5 });
  console.log('search sources:', res.sources.length);
  for (const s of res.sources) console.log('  -', s.title, '|', (s.snippet || '').replace(/\s+/g, ' ').slice(0, 56));
  const top = res.sources[0];
  console.log('top url is file://:', top.url.startsWith('file://'));

  const fr = await web.fetch({ url: top.url });
  console.log('fetch status:', fr.statusCode, '| kind:', fr.body.kind, '| bytes:', fr.body.content.length);

  console.log('PIN-AND-LOCAL-OK');
  await ctx.__localSearchEngine?.()?.dispose?.();
} finally {
  await new Promise((r) => setTimeout(r, 60));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
console.log('REAL-BOOT-DONE');
