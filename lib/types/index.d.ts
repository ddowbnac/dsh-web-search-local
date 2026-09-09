
export declare const name: 'web-search-local';
export declare const inject: readonly ['web'];
export declare const WEB_SEARCH_LOCAL_SETTINGS_NAMESPACE: 'web-search-local';
export declare const LOCAL_SEARCH_PROVIDER_ID: 'local';
export declare const WEB_SEARCH_PROVIDER_ID: 'web';
export declare const LOCAL_FETCH_PROVIDER_ID: 'local';

export declare const Config: unknown;

export interface WebSearchLocalConfig {
  engine?: 'auto' | 'duckduckgo' | 'searxng';
  corpusDirs?: string[];
  include?: string[];
  exclude?: string[];
  indexDir?: string;
  maxResults?: number;
  snippetLength?: number;
  autoReindex?: boolean;
  maxFileSizeBytes?: number;
}

export interface WebSearchLocalContext {
  inject: (deps: string[], cb: (c: { settings: { installSection: (...a: unknown[]) => void } }) => void) => void;
  web: {
    registerSearchProvider: (p: { id: string; available: () => boolean; search: unknown }) => void;
    registerFetchProvider: (p: { id: string; available: () => boolean; fetch: unknown }) => void;
  };
  effect?: (execute: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>, label?: string) => unknown;
  get?: (name: string) => unknown;
}

export declare function apply(ctx: WebSearchLocalContext, config: WebSearchLocalConfig): void;
