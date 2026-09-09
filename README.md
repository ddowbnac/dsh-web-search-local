# @deepseek-ai/dsh-web-search-local

A web-search provider for the DeepSeek Harness (`ctx.web`). It lets `web_search` query the real internet without a DeepSeek/Exa/Perplexity account or an API key, and it adds an optional fully local full-text index over your own files.

The plugin registers two search providers and one fetch provider on the `ctx.web` seam:

| Provider id | What it does | Network |
|---|---|---|
| `web` | Real internet search, via the built-in metasearch (engines `auto`/`searxng`) or DuckDuckGo only (`duckduckgo`). | yes (outbound HTTPS to the upstream engines) |
| `local` | Full-text search over a local corpus (BM25 ranking, snippets, incremental re-index, `bun:sqlite` FTS5 on Bun, pure-JS JSON index on Node). | none |
| `local` (fetch) | Reads `file://` URLs from disk and retrieves `http(s)://` URLs, so the sources `web_search` returns are usable by `web_fetch`. | on fetch only |

Pin the `web` provider when you want internet search without a keyed external API. The stock `web-search-deepseek` plugin requires a DeepSeek account and API key.

---

## Internet search (the `web` provider)

The `engine` setting selects the backend (UI or YAML):

- **`auto`** (default): the built-in in-process metasearch. It fans out to DuckDuckGo, Bing, and Wikipedia in parallel, then merges, dedups, and ranks the combined hits. DuckDuckGo is one of the three upstream engines, not a fallback tier. There is no instance, no URL, and no setup.
- **`duckduckgo`**: the DuckDuckGo upstream only, the keyless public HTML endpoint (`html.duckduckgo.com/html/`). Ad-injected rows (`duckduckgo.com/y.js`) are filtered out.
- **`searxng`**: the same built-in metasearch. We kept the value name for settings compatibility with the 0.1.x instance model. There is no instance and no URL to point at.

### Built-in metasearch

The `auto` and `searxng` backends run a simplified port of SearXNG inside the plugin process (TypeScript, `src/web/metasearch/`). The only runtime requirement is outbound HTTPS `fetch` from the harness process. There is no Python, no venv, no instance to install, no port to bind, and no API key.

- Fan-out: each query runs all three upstream engines concurrently (registration order fixed: DuckDuckGo first). Each engine is a small adapter, `{ id, displayName, timeoutMs, weight, search() }`, with a pure parser and typed soft-failures (`EngineError` kinds: `http`, `network`, `parse`, `challenge`).
- Per-engine budget: 10 s per engine inside a 20 s per-request budget for the whole search. Both compose with the caller's `AbortSignal` (composable `AbortSignal`s, no timer leaks). A slow or hung engine is dropped and recorded, and the remaining engines still answer within the budget.
- Merge, dedup, rank: every rule ports a SearXNG rule, and the port is traceable. URL normalization yields a dedup identity (host case-insensitive, scheme ignored, trailing slash, tracking params, and fragment stripped), a port of SearXNG's `MainResult.__hash__` (the per-rule divergences are listed under [How it works](#how-it-works)). Duplicates across engines merge into one hit (the longest title and snippet win, an `https://` URL is preferred for display, and the engine-to-rank map is unioned). The score is the sum of engine-weight/rank (port of `calculate_score`). The final order is the historical round-robin balancer: one slot per engine per rank tier, score-descending within a tier, capped at `maxResults` with snippets clipped to `snippetLength`.
- Engine set: DuckDuckGo is the one non-optional engine, the guaranteed keyless upstream. Bing and Wikipedia are registered `optional`, so a failed optional engine cannot kill an otherwise healthy search.
- Failure semantics: if every non-optional upstream fails (network error, HTTP >= 400, parse failure, or challenge page), the search throws `WEB_PROVIDER_ERROR` with per-engine detail. "The web has no results" and "every upstream is broken" must not look alike to the caller. On partial failure the healthy engines' merged results are returned, and the per-engine health is exposed on the `__wslMetasearch` diagnostics side-channel (`status` `ok`/`failed`/`skipped`, hit count, duration, error text).
- Informed empty: zero hits from healthy engines return an empty result whose content names which engines answered and which failed, so the caller can tell "no results" apart from "upstreams struggling".
- Agent sandbox: the web path spawns nothing, binds no port, and writes no files. Only outbound HTTPS is needed, so the metasearch works inside DSH agent sandboxes that forbid children and fixed ports.
- Dates: Wikipedia hits carry `publishedAt` (the API's `timestamp`). DuckDuckGo and Bing do not expose a reliable publication date.

---

## Runtime matrix

The `dsh` harness runs on Node.js. The local corpus engine therefore has two backends and picks one at runtime with a guarded dynamic import:

| Runtime | Backend | Index file | Notes |
|---|---|---|---|
| **Node.js** (default harness) | Pure-JS inverted index, hand-rolled BM25 | `index.fallback.json` | Zero dependencies. Works on Node 18+ and Bun. |
| **Bun** | `bun:sqlite` FTS5 (guarded `import("bun:sqlite")`, only when the `Bun` global exists) | `index.db` (WAL) | Native `bm25()` + `snippet()`. Faster on large corpora. |

Both backends are fully local, and the provider's public behavior is identical: same `WebSearchResult` shape, `file://` sources, BM25-style ranking, snippets, and an informed empty on a 0-document corpus. On Node the FTS5 module is never imported, so there is no `bun:sqlite` link error. The web backends use only global `fetch` (Node >= 18 or Bun) plus `node:` builtins, so they work on either runtime.

---

## How it works

- Web provider (`src/web/`):
  - `metasearch/orchestrator.ts`: the fan-out. SearXNG's per-engine threads become a `Promise.allSettled` of self-catching tasks, with composable AbortSignals (caller signal + global deadline + per-engine timeout), partial-failure diagnostics, and all-non-optional-failed -> `MetasearchError`.
  - `metasearch/types.ts`: the `SearchEngine` adapter contract (`id`, `displayName`, `timeoutMs`, `weight`, `optional?`, `search()`), `EngineDiagnostic`, `MetasearchError`, and `EngineError` (typed soft-failures: `http`/`network`/`parse`/`challenge`).
  - `metasearch/merge.ts`: pure merge/dedup/score/interleave, a port of SearXNG's `merge_two_main_results` + `calculate_score` + the historical round-robin balancer. No I/O, unit-tested.
  - `metasearch/url.ts`: URL normalization + dedup identity (port of SearXNG's `MainResult.__hash__`). Divergences from SearXNG: host lowercased, trailing slash stripped, tracking params + param order canonicalized, fragment excluded.
  - `metasearch/http.ts`: shared upstream fetch helper: consistent Chrome UA, HTTP/network/oversize failures as typed `EngineError`s, 1.5 MB per-response body budget.
  - `metasearch/engines/duckduckgo.ts`: DuckDuckGo upstream, an adapter around the existing keyless scraper. A DDG challenge/anomaly page is a typed `challenge` failure, not "zero results".
  - `metasearch/engines/bing.ts`: Bing upstream, a keyless HTML SERP scraper ported from SearXNG's `searx/engines/bing.py` (`b_results`/`b_algo` rows, `b_caption` snippets, and the `/ck/a?u=a1<base64url>` click-redirect decode).
  - `metasearch/engines/wikipedia.ts`: Wikipedia upstream, the keyless MediaWiki action API (`list=search`, namespace 0). `searchmatch` markup is stripped, and the API `timestamp` becomes `publishedAt`.
  - `metasearch/engines/index.ts`: the default engine set, `[duckduckgo, bing (optional), wikipedia (optional)]`.
  - `duckduckgo.ts`: the keyless DDG HTML scraper, a pure unit-tested HTML parser (`result__a` title anchors + `result__snippet` paired by resolved URL), `uddg` redirect decoding, entity decoding, snippet clipping, and ad-row filtering. It is now also the DuckDuckGo upstream of the metasearch.
  - `provider.ts`: the `web` search provider, with engine selection (`auto`/`duckduckgo`/`searxng`), a 20 s per-request budget composed with the caller's `AbortSignal`, informed-empty content on zero hits, `WEB_ABORTED` / `WEB_PROVIDER_ERROR` mapping, and `lastReport()` (exposed on the seam as `__wslMetasearch`).
- Local corpus engine (`src/engine/`): walks the configured `corpusDirs` (async, bounded worker pool, symlink-safe, per-file skip on error, hard `maxFilesPerBuild` cap), extracts text per extension, and stores it in a single on-disk index (FTS5 on Bun, JSON BM25 on Node, incremental via `manifest.json`).
- Providers (`src/provider.ts`, `src/fetch-provider.ts`): the `local` search provider returns `file://` sources (informed empty on a 0-document corpus). The `local` fetch provider reads `file://` from disk and wraps `http(s)://` retrieval.
- Pre-warm + concurrency: the index builds in the background at plugin mount. All index mutation is serialized behind one async mutex, and a re-scan interval avoids re-walking the corpus on every search. The web provider needs no pre-warm because it spawns nothing.
- Settings + UI: a `web-search-local` section registered through `installSection` (persisted to `$DSH_HOME/settings.yaml`, hot-reloaded) plus an optional browser card under Settings -> Plugins (the platform idiom: the card consumes the `useLocalSearchCard` selector hook and `save`/`discard`/`edit`/`resetField` actions injected by the slot renderer). The card edits engine, corpus dirs, max results, snippet length, index dir, and auto-reindex. It mirrors the platform plugin-card chrome (the stock Shell / Agent loop / Subagent / Web search cards): the same card/header/chevron/footer/field styles on the same design tokens, staged edits with per-field "Overridden" badges and reset-to-default, and a save that writes only on confirm and collapses the card once the write lands.

---

## Install & mount (local, not yet published)

The package is not on the npm registry, so you install it from a checkout. Both options below consume the build artifact, so start with:

```powershell
bun run build
```

### Option A: profile dependency (recommended)

From the plugin's checkout directory, link it into a DSH profile:

```powershell
dsh plugin --profile web add .
```

`dsh plugin` forwards to `pnpm add` inside the profile directory (pnpm must be on PATH). A local directory becomes a pnpm local dependency, so the profile resolves the package name `@deepseek-ai/dsh-web-search-local` to this checkout. An explicit path works too (`dsh plugin --profile web add <path>/dhs-web-search-local`, `file:`/`link:` forms included). Remove it with `dsh plugin --profile web remove @deepseek-ai/dsh-web-search-local`.

The dependency is a local link, so the profile always loads the current checkout. After editing sources, re-run `bun run build` for the change to take effect.

### Option B: zero-install (direct `file://` entry)

Skip the pnpm dependency entirely and point the row's `name` at the built entry point (after `bun run build`):

```yaml
name: '<path>/dhs-web-search-local/lib/index.js'
```

Plugin entries are dynamically imported, so `name` is any ESM specifier: the package name (option A) or an absolute `file://` URL. A bare absolute Windows path is not a valid ESM URL. Use the `file:///` form with forward slashes.

### Mounting the integration

Either way, add the integration rows: apply `./cordis.patch.yml` as a `--patch` overlay, or merge them into the profile's `cordis.patch.yml` at `$DSH_HOME/profiles/web/cordis.patch.yml` (default home `~/.dsh`). A patch replaces the `web` row's whole `config`, so the snippet restates both `searchProvider` and `fetchProvider`:

```yaml
- insert:
    - id: web-search-local
      name: '@deepseek-ai/dsh-web-search-local'   # or the file:// URL (option B)
      config:
        corpusDirs: [!!js process.cwd()]   # optional. Only used by the `local` provider
        # engine: auto                     # auto | duckduckgo | searxng (searxng = built-in metasearch)
- id: web
  config:
    searchProvider: web      # <- internet search. Use `local` for on-disk corpus search instead.
    fetchProvider: local
```

> **Pinning is mandatory.** The stock `deepseek-official` provider is always "available", so without pinning `searchProvider` the seam would report `WEB_PROVIDER_AMBIGUOUS`. The stock `web-search-deepseek` / `web-fetch-http` rows may stay (registered but unselected).

## Configuration

The provider exposes the `web-search-local` settings section, persisted to `$DSH_HOME/settings.yaml` (hot-reloaded, so a change reaches the next search with no restart):

| Field | Default | Meaning |
|---|---|---|
| `engine` | `auto` | Web-search backend: `auto` (built-in metasearch: DuckDuckGo + Bing + Wikipedia), `duckduckgo` (DuckDuckGo only), or `searxng` (= built-in metasearch, kept for 0.1.x compatibility). |
| `corpusDirs` | `[]` | Directories to index (absolute or `~`). Only used by the `local` search provider. An empty list returns an informed empty result. |
| `include` | built-in text/code set | Extra extensions to index (with/without a leading dot). |
| `exclude` | built-in (`node_modules`, `.git`, `*.min.js`, lockfiles, and more) | Extra dir names, file names, or dot-suffixes to skip. |
| `indexDir` | `<DSH home>/web-search-local` | Where the index files (`index.db` or `index.fallback.json`) and `manifest.json` live. |
| `maxResults` | `20` | Per-query source cap (the seam re-enforces the tool's bound). |
| `snippetLength` | `160` | Approximate snippet length. |
| `autoReindex` | `true` | Re-scan the corpus on each search (bounded by an internal interval). `false` = build on change only. |
| `maxFileSizeBytes` | `5000000` | Skip files larger than this. |

Two ways to configure:

1. **YAML (primary):** edit the `web-search-local` section in `$DSH_HOME/settings.yaml` (the same file the Settings UI writes). Example:
   ```yaml
   web-search-local:
     engine: auto
     corpusDirs:
       - D:\docs
       - ~/notes
   ```
2. **UI card:** when the deployment renders third-party plugin cards, a card appears under Settings -> Plugins -> Plugin configuration for `web-search-local` (edit engine, corpus dirs, max results, snippet length, index dir, auto-reindex, then Save). The card is optional. If a deployment does not render plugin cards, the YAML path remains fully functional.

**Migration from 0.1.x:** the 0.1.x settings `searxngUrl` and `manageSearxng` were removed from the schema. If they are still in your `settings.yaml` (or in a `cordis.yml` base layer), the plugin ignores them: it passes them through inert, without validation, and it never errors on them. You can delete them, and the plugin does not rewrite or prune them. `engine: searxng` keeps working: the value now means the built-in metasearch.

## Build & test

```
bun run build           # bun build src/index.ts --target node --format esm --outdir lib, then strip the comments bun injects into the bundle
bun test                # 153 tests (metasearch core + per-engine parsers + provider, local engine/drivers, plugin shape, client bundle)
bunx tsc --noEmit       # strict typecheck (the sources are type-clean; CI enforces this)
node scripts/smoke.mjs  # offline functional smoke test of the built bundle (also: bun scripts/smoke.mjs)
```

Notes:

- The build targets Node (the harness runtime). The single `bun:sqlite` reference is a guarded dynamic import, so the bundle links and runs under Node. It is only evaluated when the `Bun` global exists.
- The build deliberately inlines the peer packages (`@deepseek-ai/*`) and `schemastery`. `schemastery` is not a declared peer, so a bare import would not resolve under a strict pnpm profile layout. The inlined `WebError` is safe because the harness classifies errors by their `.code` property, not cross-package `instanceof`.
- We hand-emit `lib/client.js` (the browser half) in the `window.__ModuleLoader__.load` lazy-CJS format and ship it as-is.

## CI/CD

GitHub Actions, two workflows in `.github/workflows/`:

### `ci.yml` — runs on every push/PR to `master`

| Job | What it does |
|---|---|
| `lint-workflows` | Lints the workflow YAMLs with `actionlint`. |
| `typecheck` | `bunx tsc --noEmit` under the strict tsconfig. |
| `test` | `bun test` (153 offline tests) on a Bun `1.3` / `1.4` matrix. |
| `build` | `bun run build` and uploads the resulting `lib/` as an artifact. |
| `smoke` | `scripts/smoke.mjs` against the built bundle on a Node `20.x` / `22.x` / Bun `1.4` matrix — verifies the runtime matrix end-to-end offline (Node → JSON BM25 backend, Bun → `bun:sqlite` FTS5): exports, provider registration, a real local-corpus search over a temp corpus, and a `file://` fetch. No network, no `node_modules` (the bundle is dependency-free). |

Install is always `bun install --frozen-lockfile` from the committed `bun.lock`. The build-time `@deepseek-ai/*` packages (seam types, schemastery) are `devDependencies`; the published bundle inlines them, so consumers see zero runtime dependencies.

### `release.yml` — tag-driven release + optional npm publish

- **Trigger:** semver tag push (`v0.2.0`) or `workflow_dispatch` (optional `tag` input; defaults to the `package.json` version, creating and pushing the missing tag).
- **`release` job:** validates tag ≡ `package.json` version, builds, `bun pm pack` (honors the `files` field), and publishes a GitHub Release with the tarball + `SHA256SUMS.txt` and generated release notes. Prerelease versions are tagged as prereleases.
- **`publish` job:** `npm publish` to the `@deepseek-ai` scope. Runs **only if the `NPM_TOKEN` repo secret is set** (the scope belongs to the DeepSeek org); without it the workflow still produces the GitHub Release, which is sufficient for the pinned-release install flow.

## Layout

```
src/index.ts                     plugin entry: name, inject, Config, apply (registers local + web providers)
src/provider.ts                  LocalSearchProvider (id "local"): corpus full-text search
src/fetch-provider.ts            LocalFetchProvider (id "local"): file:// + http(s):// retrieval
src/types.ts                     shared local-engine contract: EngineOptions, DocRow, Hit, IndexStats, SearchDriver
src/web/provider.ts              WebSearchProvider (id "web"): engine selection, timeouts, failure mapping, lastReport
src/web/duckduckgo.ts            keyless DDG HTML scraper + pure parser (now also the DDG metasearch upstream)
src/web/metasearch/orchestrator.ts  parallel fan-out, budgets (composable AbortSignals), diagnostics
src/web/metasearch/types.ts      SearchEngine contract, EngineDiagnostic, MetasearchError, EngineError
src/web/metasearch/merge.ts      pure merge/dedup/score/interleave (SearXNG port)
src/web/metasearch/url.ts        URL normalization + dedup identity (SearXNG __hash__ port)
src/web/metasearch/http.ts       shared upstream fetch helper (UA, typed failures, body budget)
src/web/metasearch/engines/duckduckgo.ts   DDG upstream adapter (challenge detection)
src/web/metasearch/engines/bing.ts         Bing HTML scraper (b_results/b_algo, /ck/a decode)
src/web/metasearch/engines/wikipedia.ts    Wikipedia MediaWiki action API (publishedAt)
src/web/metasearch/engines/index.ts        default engine set [duckduckgo, bing*, wikipedia*] (*optional)
src/engine/engine.ts             local corpus orchestrator: mutex, manifest, prewarm, backend pick
src/engine/fts5.ts               bun:sqlite FTS5 driver (+ guarded loadSqlite/fts5Available)
src/engine/fallback.ts           pure-JS inverted index in JSON (BM25): the Node backend
src/engine/walk.ts               async corpus walk
src/engine/extract.ts            per-extension text extraction
src/engine/terms.ts              shared tokenizer
lib/client.js                    browser UI card (settings.plugin.item)
lib/types/*.d.ts                 hand-emitted type surface (entry + client)
scripts/strip-bundle-comments.mjs  post-build step: strips the comments bun build injects into lib/index.js
test/fixtures/metasearch/        live-captured upstream fixtures (duckduckgo.html, bing.html, wikipedia.json, startpage.html)
scripts/smoke.mjs                offline functional smoke test for the built bundle (CI runtime matrix; node or bun)
.github/workflows/ci.yml         CI: actionlint + typecheck + test (bun matrix) + build + smoke (node/bun matrix)
.github/workflows/release.yml    CD: tag -> validate -> build -> GitHub Release (+ optional npm publish with NPM_TOKEN)
bun.lock                         committed lockfile (CI installs with --frozen-lockfile)
cordis.patch.yml                 example integration
```

## Known limitations

- Web coverage: DuckDuckGo, Bing, and Wikipedia, all keyless. Google direct is not scraped because its CAPTCHAs are fragile. Rate limits and anti-bot walls depend on IP reputation (datacenter vs. residential). A walled engine just drops out, and the healthy engines' merged results are still served. The search throws `WEB_PROVIDER_ERROR` (with per-engine detail) only when every non-optional upstream fails.
- DDG anomaly pages: under heavy abuse, DuckDuckGo can serve a challenge or anomaly page instead of results. The adapter records it as a typed `challenge` failure, the same as any other engine failure.
- `publishedAt`: Wikipedia hits carry it (the API `timestamp`). DuckDuckGo and Bing hits do not, because those upstreams expose no reliable date. Local corpus results use the file mtime.
- Local corpus tokenizer: `unicode61` handles Latin and Cyrillic well. Dense CJK may need the `trigram` tokenizer (future work).
- FTS5 only on Bun: on Node the (equally local) JSON index is used. It is slightly slower on very large corpora.
- Two DSH processes sharing one `indexDir`: the Bun backend handles them via `busy_timeout` plus single-writer. A cross-process lockfile is a possible hardening.
