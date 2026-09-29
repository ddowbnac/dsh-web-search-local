#!/usr/bin/env node
/**
 * Offline functional smoke test for the bundled ../lib/index.js.
 *
 * - Works under Node >= 18 (JSON BM25 backend) and Bun (bun:sqlite FTS5).
 * - No network, no node_modules: only node: builtins + the inlined bundle.
 * - Models the dsh 0.1.7 plugin contract: `apply(ctx, config)` receives live
 *   volatile config refs (read via `.get()`, mutated in place through the
 *   cosmokit volatile write symbol) and observes `loader/volatile-update`
 *   instead of being re-run on settings changes.
 * - Exits 0 with a one-line summary on success; 1 with details on any failure.
 *
 * Usage: node scripts/smoke.mjs   (or: bun scripts/smoke.mjs)
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const isBun = typeof globalThis.Bun !== 'undefined';
const runtimeLabel = isBun ? `bun@${globalThis.Bun.version}` : `node@${process.version}`;

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}
// Set before cleanup runs; process.exit() is called only after the finally
// block, because process.exit() skips finally blocks entirely.
let exitCode = 0;

// The cosmokit volatile write symbol: the 0.1.7 host loader re-resolves
// volatile config fields in place through `ref[SYMBOL](newValue)`.
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

const libPath = fileURLToPath(new URL('../lib/index.js', import.meta.url));

let root;
let ctx; // hoisted so finally can dispose the engine
try {
  // ---- corpus + index scaffolding ---------------------------------------
  root = mkdtempSync(join(tmpdir(), 'wsl-smoke-'));
  const corpusDir = join(root, 'corpus');
  const indexDir = join(root, 'index');
  mkdirSync(corpusDir);

  const TOKEN_A = 'zzqxwv'; // distinctive nonsense token, notes.md only
  const TOKEN_B = 'kqrztn'; // distinctive nonsense token, plain.txt only
  const notesContent = `# Release note\n\nThis document mentions the ${TOKEN_A} marker for smoke testing.\n`;
  const plainContent = `${TOKEN_B} appears only in this plain text document.\n`;
  const fillerContent = `Unrelated filler that should never rank for either token.\n`;
  const notesPath = join(corpusDir, 'notes.md');
  const plainPath = join(corpusDir, 'plain.txt');
  const fillerPath = join(corpusDir, 'filler.txt');
  writeFileSync(notesPath, notesContent);
  writeFileSync(plainPath, plainContent);
  writeFileSync(fillerPath, fillerContent);

  // ---- minimal mock ctx matching apply()'s expected 0.1.7 shape --------
  const searchProviders = [];
  const fetchProviders = [];
  const eventHandlers = {};
  ctx = {
    on(event, handler) {
      (eventHandlers[event] ??= []).push(handler);
    },
    web: {
      registerSearchProvider(p) {
        searchProviders.push(p);
      },
      registerFetchProvider(p) {
        fetchProviders.push(p);
      },
    },
    get: () => undefined, // unused: indexDir is set explicitly, so no $DSH_HOME fallback
  };

  // ---- import bundle, apply with explicit temp dirs ----------------------
  const mod = await import(pathToFileURL(libPath).href);

  // Module exports.
  assert(mod.name === 'web-search-local', `name export: got ${JSON.stringify(mod.name)}`);
  assert(Array.isArray(mod.inject) && mod.inject[0] === 'web', `inject export must start with 'web': got ${JSON.stringify(mod.inject)}`);
  assert(typeof mod.apply === 'function', 'apply export must be a function');
  assert(typeof mod.Config === 'function', 'Config export must be callable');
  assert(mod.LOCAL_SEARCH_PROVIDER_ID === 'local', `LOCAL_SEARCH_PROVIDER_ID: got ${JSON.stringify(mod.LOCAL_SEARCH_PROVIDER_ID)}`);
  assert(mod.WEB_SEARCH_PROVIDER_ID === 'web', `WEB_SEARCH_PROVIDER_ID: got ${JSON.stringify(mod.WEB_SEARCH_PROVIDER_ID)}`);
  assert(mod.LOCAL_FETCH_PROVIDER_ID === 'local', `LOCAL_FETCH_PROVIDER_ID: got ${JSON.stringify(mod.LOCAL_FETCH_PROVIDER_ID)}`);

  // 0.1.7 config model: Config() yields live volatile refs, not plain values.
  const config = mod.Config();
  for (const field of ['corpusDirs', 'include', 'exclude', 'indexDir', 'maxResults', 'snippetLength', 'engine', 'autoReindex', 'maxFileSizeBytes']) {
    assert(typeof config[field]?.get === 'function', `Config() field '${field}' must be a volatile ref exposing .get()`);
  }
  assert(Array.isArray(config.corpusDirs.get()), `Config() corpusDirs default must be an array: got ${JSON.stringify(config.corpusDirs.get())}`);
  // Seed the temp dirs through the volatile write symbol, the way the 0.1.7
  // host loader re-resolves volatile fields in place.
  config.corpusDirs[VOLATILE_WRITE]([corpusDir]);
  config.indexDir[VOLATILE_WRITE](indexDir);
  mod.apply(ctx, config);

  // apply() must observe the 0.1.7 volatile-update event (no settings seam).
  assert(
    (eventHandlers['loader/volatile-update'] ?? []).length >= 1,
    'apply() must register a loader/volatile-update handler',
  );
  // Providers registered by apply().
  assert(searchProviders.length === 2, `two search providers registered: got ${searchProviders.length}`);
  const local = searchProviders.find((p) => p.id === 'local');
  const web = searchProviders.find((p) => p.id === 'web');
  assert(!!local, 'a search provider with id "local" is registered');
  assert(!!web, 'a search provider with id "web" is registered');
  assert(fetchProviders.length === 1, `one fetch provider registered: got ${fetchProviders.length}`);
  assert(fetchProviders[0]?.id === 'local', `fetch provider id: got ${JSON.stringify(fetchProviders[0]?.id)}`);
  for (const p of [...searchProviders, ...fetchProviders]) {
    assert(p.available() === true, `provider ${JSON.stringify(p.id)} must be available()`);
    assert(typeof p.id === 'string' && p.id.length > 0, 'provider id must be a non-empty string');
  }

  // Local search: first call blocks until warm()'s index build finishes.
  const resA = await local.search({ query: TOKEN_A, maxResults: 5 });
  assert(resA && Array.isArray(resA.sources), 'local search result has sources array');
  assert(resA.sources.length >= 1, `local search for '${TOKEN_A}' returns >= 1 hit: got ${resA.sources.length}`);
  const topA = resA.sources[0];
  assert(topA.url === pathToFileURL(notesPath).href, `top hit url is notes.md as file:// URL: got ${JSON.stringify(topA.url)}`);
  assert(typeof topA.title === 'string' && topA.title.length > 0, `top hit title non-empty: got ${JSON.stringify(topA.title)}`);
  assert(typeof topA.snippet === 'string' && topA.snippet.length > 0, 'top hit snippet non-empty');
  assert(!resA.truncated, 'local search result not truncated');

  const resB = await local.search({ query: TOKEN_B, maxResults: 5 });
  assert(resB.sources.length >= 1 && resB.sources[0].url === pathToFileURL(plainPath).href, `local search for '${TOKEN_B}' finds plain.txt`);

  // Local fetch: file:// URL of a corpus file returns its original content.
  const fr = await fetchProviders[0].fetch({ url: pathToFileURL(notesPath).href });
  assert(fr.statusCode === 200, `fetch statusCode 200: got ${fr.statusCode}`);
  assert(fr.body?.kind === 'text', `fetch body kind "text": got ${JSON.stringify(fr.body?.kind)}`);
  assert(fr.body?.content === notesContent, 'fetch returns the original file content');
  assert(fr.truncated === false, 'fetch result not truncated');

  // Report the backend actually used (Node -> json, Bun -> fts5).
  const engine = typeof ctx.__localSearchEngine === 'function' ? ctx.__localSearchEngine() : undefined;
  const backend = engine ? engine.driverKind() : 'unknown';
  assert(backend === 'fts5' || backend === 'json', `driverKind is fts5|json: got ${JSON.stringify(backend)}`);

  // Volatile update lifecycle: mutate a ref in place and fire the registered
  // handler, exactly as the 0.1.7 loader emits `loader/volatile-update`;
  // apply() must pick the change up (rebuild the engine) without re-running.
  config.maxResults[VOLATILE_WRITE](42);
  assert(config.maxResults.get() === 42, `volatile write must update the live ref: got ${JSON.stringify(config.maxResults.get())}`);
  for (const handler of eventHandlers['loader/volatile-update'] ?? []) handler([['maxResults']]);
  const engineAfter = ctx.__localSearchEngine ? ctx.__localSearchEngine() : undefined;
  assert(engineAfter !== engine, 'a volatile update must trigger an engine rebuild');

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    console.error(`smoke FAILED: runtime=${runtimeLabel} backend=${backend} (${failures.length} failed assertion${failures.length === 1 ? '' : 's'})`);
    exitCode = 1;
  } else {
    console.log(
      `smoke OK: runtime=${runtimeLabel} backend=${backend} (${resA.sources.length} hit${resA.sources.length === 1 ? '' : 's'} for '${TOKEN_A}', ${resB.sources.length} hit${resB.sources.length === 1 ? '' : 's'} for '${TOKEN_B}')`,
    );
  }
} catch (e) {
  console.error(`smoke FAILED: runtime=${runtimeLabel} unexpected error: ${e && e.stack ? e.stack : String(e)}`);
  exitCode = 1;
} finally {
  // Close the engine (releases bun:sqlite handles) before removing temp dirs.
  try {
    const engine = ctx && typeof ctx.__localSearchEngine === 'function' ? ctx.__localSearchEngine() : undefined;
    await engine?.dispose?.();
  } catch {
    // best effort
  }
  try {
    if (root) rmSync(root, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
process.exit(exitCode);
