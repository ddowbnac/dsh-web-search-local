
export interface MetasearchHit {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt?: string;
}

export interface EngineDiagnostic {
  readonly engine: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly hits: number;
  readonly error?: string;
}

export interface MetasearchOptions {
  readonly globalTimeoutMs?: number;
  readonly maxResults?: number;
  readonly signal?: AbortSignal;
}

export interface MetasearchResult {
  readonly hits: MetasearchHit[];
  readonly diagnostics: EngineDiagnostic[];
  readonly ms: number;
}

export interface SearchEngine {
  readonly id: string;
  readonly displayName: string;
  readonly timeoutMs: number;
  readonly weight: number;
  readonly optional?: boolean;
  search(query: string, signal: AbortSignal): Promise<MetasearchHit[]>;
}

export class MetasearchError extends Error {
  readonly diagnostics: EngineDiagnostic[];
  constructor(message: string, diagnostics: EngineDiagnostic[]) {
    super(message);
    this.name = 'MetasearchError';
    this.diagnostics = diagnostics;
  }
}

export type EngineErrorKind = 'http' | 'network' | 'parse' | 'challenge';

export class EngineError extends Error {
  readonly kind: EngineErrorKind;
  constructor(message: string, kind: EngineErrorKind) {
    super(message);
    this.name = 'EngineError';
    this.kind = kind;
  }
}
