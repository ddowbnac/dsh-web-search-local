
export declare const name: 'web-search-local';
export declare const inject: readonly ['web'];
export declare const WEB_SEARCH_LOCAL_SETTINGS_NAMESPACE: 'web-search-local';
export declare const LOCAL_SEARCH_PROVIDER_ID: 'local';
export declare const WEB_SEARCH_PROVIDER_ID: 'web';
export declare const LOCAL_FETCH_PROVIDER_ID: 'local';

export declare const Config: unknown;

/** Plain resolved shape - live ref values produced by `config.<field>.get()` on a 0.1.7 volatile `Config`. */
export type ResolvedConfig = {
  corpusDirs: string[];
  include: string[];
  exclude: string[];
  indexDir: string;
  maxResults: number;
  snippetLength: number;
  engine: 'auto' | 'duckduckgo' | 'searxng';
  autoReindex: boolean;
  maxFileSizeBytes: number;
};

export declare function apply(
  ctx: {
    on: (event: string, handler: (paths: string[][]) => void) => void;
    web: {
      registerSearchProvider: (p: { id: string; available: () => boolean; search: unknown }) => void;
      registerFetchProvider: (p: { id: string; available: () => boolean; fetch: unknown }) => void;
    };
    effect?: (execute: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>, label?: string) => unknown;
    get?: (name: string) => unknown;
  },
  config: ResolvedConfig,
): void;
