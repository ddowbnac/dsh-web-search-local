# @djdowbnac/dsh-web-search-local

A web-search provider for the DeepSeek Harness without an account or API key, plus an optional fully local full-text index over your own files.

The plugin registers two search providers and one fetch provider on the `ctx.web` seam:

| Provider | What it does | Network |
|---|---|---|
| `web` | Internet search via the built-in metasearch (`auto`, `searxng`) or DuckDuckGo only (`duckduckgo`). | outbound HTTPS to the upstreams |
| `local` | Full-text search over a local corpus (BM25, snippets, incremental re-index, `bun:sqlite` FTS5 on Bun, pure-JS JSON on Node). | none |
| `local` (fetch) | Reads `file://` URLs from disk and retrieves the `http(s)://` URLs `web_search` returns. | on fetch only |

Pin `web` when you want internet search without a keyed external API. The stock `web-search-deepseek` plugin requires a DeepSeek account and API key.

## Internet search (`web`)

The `engine` field selects the backend (UI or YAML):

- `auto` (default): the built-in metasearch. Fans out to DuckDuckGo, Bing, and Wikipedia in parallel, then merges, dedups, and ranks the hits. No instance, no URL, no setup.
- `duckduckgo`: DuckDuckGo only, the keyless public endpoint `html.duckduckgo.com/html/`. Filters out the ad rows (`duckduckgo.com/y.js`).
- `searxng`: the same built-in metasearch. The value name is kept for compatibility with the 0.1.x instance model.

## Install and mount

The package is published on npm, so a normal install pulls the registry version:

```bash
dsh plugin --profile web add @djdowbnac/dsh-web-search-local
```

That is the whole install. `dsh plugin` initializes the profile on first use and forwards to `pnpm add` inside the profile directory (pnpm must be on PATH). To pin an exact version, add the full specifier (`dsh plugin --profile web add @djdowbnac/dsh-web-search-local@1.1.2`).

Remove it with:

```bash
dsh plugin --profile web remove @djdowbnac/dsh-web-search-local
```

### From a checkout (development)

To work on the plugin itself, point the same command at the checkout instead of the package name:

```bash
# from the plugin's checkout directory
dsh plugin --profile web add .
```

The directory becomes a pnpm local dependency, so the profile resolves the package name to this checkout, and the bundle registration works the same way. The dependency is a local link, so the profile always loads the current checkout. After editing sources, re-run `bun run build` for the change to take effect.

### Zero-install (advanced)

To skip the pnpm dependency entirely, point the row's `name` at a built entry point. From a checkout, that is `bun run build` first, then:

```yaml
name: 'file:///<path>/dhs-web-search-local/lib/index.js'
```

### Mounting the integration

The dependency installs (npm or checkout) need no manual mount. The layer order is: the stock base/surface bundle layers, the package bundle layers in `dsh.profile.bundles` order (this plugin's is last among them), the profile's `cordis.patch.yml` (user layer), `$DSH_HOME/cordis.patch.yml`, and any `--patch` overlays: the later layer wins. So the shipped patch is a stock base the user layer overrides freely: set `corpusDirs`, switch `engine`, pin a different provider. Inspect the composed tree any time:

```bash
dsh --profile web --dump-config
```

For the zero-install path (manual mount), apply `./cordis.patch.yml` as a `--patch` overlay, or merge its rows into the profile's `cordis.patch.yml` at `$DSH_HOME/profiles/web/cordis.patch.yml` (default home `~/.dsh`), adapting `name` to the `file://` entry. A patch replaces the target row's whole `config`, so the snippet restates `searchProvider` and `fetchProvider`:

```yaml
- insert:
    - id: web-search-local
      name: 'file:///<path>/dhs-web-search-local/lib/index.js'   # zero-install entry
      config:
        corpusDirs: [!!js process.cwd()]   # optional. Only used by the `local` provider
        # engine: auto                     # auto | duckduckgo | searxng
- id: web
  config:
    searchProvider: web      # <- internet. Use `local` for on-disk corpus search.
    fetchProvider: local
```

> **Pinning is mandatory.** The stock `deepseek-official` provider is always "available", so without pinning `searchProvider` the seam reports `WEB_PROVIDER_AMBIGUOUS`. The stock `web-search-deepseek` / `web-fetch-http` rows may stay (registered but unselected). The shipped bundle patch does the pinning and deliberately sets no `corpusDirs`: an auto-applied layer must not index the boot directory. Set it in the user layer or via the settings section.

## Configuration

The provider exposes the `web-search-local` settings section, persisted to `$DSH_HOME/settings.yaml` (hot-reloaded, so a change reaches the next search with no restart):

| Field | Default | Meaning |
|---|---|---|
| `engine` | `auto` | Web backend: `auto` (metasearch: DuckDuckGo + Bing + Wikipedia), `duckduckgo`, or `searxng` (= metasearch, kept for 0.1.x compatibility). |
| `corpusDirs` | `[]` | Directories to index (absolute or `~`). Only used by the `local` search provider. Empty returns an informed empty result. |
| `include` | built-in text/code set | Extra extensions to index (with or without a leading dot). |
| `exclude` | built-in (`node_modules`, `.git`, `*.min.js`, lockfiles, more) | Extra dir names, file names, or dot-suffixes to skip. |
| `indexDir` | `<DSH home>/web-search-local` | Where `index.db` or `index.fallback.json` and `manifest.json` live. |
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
2. **UI card:** when the deployment renders third-party plugin cards, a card appears under Settings -> Plugins for `web-search-local` (engine, corpus dirs, max results, snippet length, index dir, auto-reindex, then Save). It is optional: when the deployment does not render cards, the YAML path remains fully functional.

## Known limitations

- Web coverage: DuckDuckGo, Bing, and Wikipedia, all keyless. Google is not scraped directly because its CAPTCHAs are fragile. Rate limits and anti-bot walls depend on IP reputation (datacenter vs. residential). A walled upstream just drops out, and the healthy upstreams' merged results are still served. The search throws `WEB_PROVIDER_ERROR` (with per-upstream detail) only when every non-optional upstream fails.
- DDG anomaly pages: under heavy abuse, DuckDuckGo can serve a challenge or anomaly page instead of results. The adapter records it as a typed `challenge` failure, the same as any other upstream failure.
- `publishedAt`: Wikipedia hits carry it (the API `timestamp`). DuckDuckGo and Bing hits do not, because those upstreams expose no reliable date. Local corpus results use the file mtime.
