import z from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from './engine/engine.js';
import type { LocalEngine } from './engine/engine.js';
import type { EngineOptions } from './types.js';
import { LocalSearchProvider, LOCAL_SEARCH_PROVIDER_ID } from './provider.js';
import { LocalFetchProvider, LOCAL_FETCH_PROVIDER_ID } from './fetch-provider.js';
import { WebSearchProvider, WEB_SEARCH_PROVIDER_ID, type WebOptions } from './web/provider.js';


export const name = 'web-search-local';
export const inject = ['web'] as const;
export const WEB_SEARCH_LOCAL_SETTINGS_NAMESPACE = 'web-search-local';
export { LOCAL_SEARCH_PROVIDER_ID };
export { WEB_SEARCH_PROVIDER_ID };
export { LOCAL_FETCH_PROVIDER_ID };

const DEFAULT_INCLUDE_EXTS = new Set<string>([
  'md', 'markdown', 'mdx', 'txt', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml',
  'ini', 'env', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'svelte', 'vue',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'sh', 'bash', 'ps1',
  'sql', 'php', 'swift', 'kt', 'lua', 'r', 'pl', 'ex', 'exs', 'clj', 'zig', 'dart', 'scala',
  'groovy', 'rst', 'adoc', 'tex',
]);
const DEFAULT_EXCLUDE_DIRS = new Set<string>([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', 'dist', 'build', 'out', 'coverage',
  '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.parcel-cache', 'target', '.idea',
  '.vscode', '.terraform', '.gradle', 'bin', 'obj', '.dsh',
]);
const DEFAULT_EXCLUDE_FILES = new Set<string>([
  '.ds_store', 'thumbs.db', 'desktop.ini', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'bun.lock', 'cargo.lock', 'go.sum', 'composer.lock', 'poetry.lock', 'gemfile.lock',
]);
const DEFAULT_EXCLUDE_SUFFIXES: string[] = ['.min.js', '.min.css', '.map', '.tsbuildinfo', '.lockb'];

export const Config = z.object({
  corpusDirs: z.array(z.string()).default([]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  indexDir: z.string().default(''),
  maxResults: z.number().step(1).min(1).default(20),
  snippetLength: z.number().step(1).min(20).default(160),
  engine: z
    .union([z.const('auto'), z.const('duckduckgo'), z.const('searxng')])
    .default('auto')
    .comment(
      'Web search backend: auto (built-in metasearch), duckduckgo, or searxng (= built-in metasearch, kept for compatibility).',
    ),
  autoReindex: z.boolean().default(true),
  maxFileSizeBytes: z.number().step(1).min(0).default(5_000_000),
});

/** Normalized config object (schema output type) as validated by `Config`. */
type ConfigValue = ReturnType<typeof Config>;

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

function defaultLocalIndexDir(ctx: unknown): string {
  try {
    const get = (ctx as { get?: (n: string) => unknown })?.get;
    if (typeof get === 'function') {
      const dhp = get.call(ctx, 'dshHomePath');
      if (typeof dhp === 'function') return (dhp as (s: string) => string)('web-search-local');
    }
  } catch {
  }
  const base = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(base, 'web-search-local');
}

function toExts(include: readonly string[]): ReadonlySet<string> {
  if (include.length === 0) return DEFAULT_INCLUDE_EXTS;
  const set = new Set<string>();
  for (const raw of include) {
    const e = raw.replace(/^\./, '').toLowerCase();
    if (e.length > 0) set.add(e);
  }
  return set.size > 0 ? set : DEFAULT_INCLUDE_EXTS;
}

function parseExcludes(exclude: readonly string[]): {
  excludeDirs: ReadonlySet<string>;
  excludeFiles: ReadonlySet<string>;
  excludeSuffixes: string[];
} {
  const dirs = new Set<string>(DEFAULT_EXCLUDE_DIRS);
  const files = new Set<string>(DEFAULT_EXCLUDE_FILES);
  const suffixes = [...DEFAULT_EXCLUDE_SUFFIXES];
  for (const raw of exclude) {
    const lower = raw.toLowerCase();
    if (lower.includes('/')) {
      for (const seg of lower.split('/')) if (seg.length > 0) dirs.add(seg);
    } else if (lower.startsWith('.')) {
      suffixes.push(lower);
    } else {
      dirs.add(lower);
      files.add(lower);
    }
  }
  return { excludeDirs: dirs, excludeFiles: files, excludeSuffixes: suffixes };
}

function resolveOptions(ctx: unknown, config: ConfigValue): EngineOptions {
  const corpusDirs = (config.corpusDirs ?? []).map((d) => expandHome(d));
  const { excludeDirs, excludeFiles, excludeSuffixes } = parseExcludes(config.exclude ?? []);
  return {
    corpusDirs,
    indexPath: config.indexDir ? expandHome(config.indexDir) : defaultLocalIndexDir(ctx),
    includeExts: toExts(config.include ?? []),
    excludeDirs,
    excludeFiles,
    excludeSuffixes,
    maxFileSizeBytes: config.maxFileSizeBytes ?? 5_000_000,
    snippetLength: config.snippetLength ?? 160,
    autoReindex: config.autoReindex ?? true,
    minReindexIntervalMs: 2000,
    maxFilesPerBuild: 20_000,
  };
}

function resolveWebOptions(config: ConfigValue): WebOptions {
  return {
    engine: config.engine ?? 'auto',
    maxResults: config.maxResults ?? 20,
    snippetLength: config.snippetLength ?? 160,
  };
}

export function apply(ctx: {
  inject: (deps: string[], cb: (c: { settings: { installSection: (...a: unknown[]) => void } }) => void) => void;
  web: {
    registerSearchProvider: (p: { id: string; available: () => boolean; search: unknown }) => void;
    registerFetchProvider: (p: { id: string; available: () => boolean; fetch: unknown }) => void;
  };
  effect?: (execute: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>, label?: string) => unknown;
  get?: (name: string) => unknown;
}, config: ConfigValue): void {
  let current = (): ConfigValue => config;
  let engine: LocalEngine | undefined;
  let dirty = true;

  const engineNow = (): LocalEngine => {
    if (!engine || dirty) {
      void engine?.dispose();
      engine = createEngine(resolveOptions(ctx, current()));
      dirty = false;
      engine.warm();
    }
    return engine;
  };

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_LOCAL_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source: () => ConfigValue) => {
        current = source;
      },
      onChange: () => {
        dirty = true;
      },
    });
  });

  const webProvider = new WebSearchProvider(() => resolveWebOptions(current()));
  ctx.web.registerSearchProvider(new LocalSearchProvider(() => engineNow()));
  ctx.web.registerSearchProvider(webProvider);
  ctx.web.registerFetchProvider(new LocalFetchProvider());

  try {
    Object.defineProperty(ctx, '__localSearchEngine', {
      value: () => engineNow(),
      enumerable: false,
      configurable: true,
    });
  } catch {
  }
  try {
    Object.defineProperty(ctx.web, '__wslMetasearch', {
      value: () => webProvider.lastReport(),
      enumerable: false,
      configurable: true,
    });
  } catch {
  }

  engineNow();
}
