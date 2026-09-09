
export interface EngineOptions {
  readonly corpusDirs: readonly string[];
  readonly indexPath: string;
  readonly includeExts: ReadonlySet<string>;
  readonly excludeDirs: ReadonlySet<string>;
  readonly excludeFiles: ReadonlySet<string>;
  readonly excludeSuffixes: readonly string[];
  readonly maxFileSizeBytes: number;
  readonly snippetLength: number;
  readonly autoReindex: boolean;
  readonly minReindexIntervalMs: number;
  readonly maxFilesPerBuild: number;
}

export interface DocRow {
  readonly key: string;
  readonly path: string;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly hash: string;
  readonly publishedAt: string;
}

export interface Hit {
  readonly url: string;
  readonly path: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly publishedAt?: string;
}

export interface IndexStats {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly totalDocs: number;
  readonly elapsedMs: number;
}

export interface SearchDriver {
  readonly kind: 'fts5' | 'json';
  open(): Promise<void>;
  upsert(rows: readonly DocRow[]): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
  keys(): Promise<ReadonlySet<string>>;
  search(query: string, maxResults: number): Promise<Hit[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}
