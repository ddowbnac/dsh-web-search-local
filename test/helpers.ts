import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function cleanup(dir: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(40);
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}

export function makeCorpus(root: string): { root: string; files: Record<string, string> } {
  const files: Record<string, string> = {
    'sqlite.md':
      '# SQLite guide\n\nFTS5 provides bm25 ranking and snippet generation for full text search.\n',
    'rust.md': '# Rust search\n\nTantivy is a full text search engine written in Rust.\n',
    'notes.html':
      '<html><head><title>Local notes</title></head><body><p>An inverted index maps terms to postings for a local index.</p></body></html>\n',
    'bm25.txt': 'BM25 is a bag-of-words retrieval function ranking documents by term frequency.\n',
    'node_modules/junk.md': '# Junk\n\nThis should be excluded because it lives in node_modules.\n',
    'bundle.min.js': 'var x=1; /* minified, should be excluded by suffix */\n',
  };
  const written: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    written[rel] = p;
  }
  const binPath = join(root, 'blob.bin');
  writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x41, 0x42]));
  return { root, files: written };
}
