import type { Context } from '@deepseek-ai/cordis';

/**
 * dsh 0.1.7 client face: the settings service is `configForms`; the controller for this
 * plugin is obtained via `ctx.configForms.get('web-search-local')` (namespace = entry id).
 */
declare type ConfigFormController = {
  getSnapshot(): unknown;
  subscribe(listener: (snapshot: unknown) => void): () => void;
  set(field: string, value: unknown): Promise<void>;
  unset(field: string): Promise<void>;
  dispose(): void;
};

export declare const inject: readonly ['slots', 'locale', 'configForms'];

export declare function apply(ctx: Context & { configForms: { get(entryId: string): ConfigFormController } }): void;
