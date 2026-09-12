# CI/CD

GitHub Actions, three workflows in `.github/workflows/` (plus GitHub-native Dependabot for dependency updates):

```
push to master (conventional commits)
   └─> semantic-release.yml     analyze -> bump package.json -> CHANGELOG.md
                                  -> commit "chore(release): vX [skip ci]" -> push v* tag
                └─> release.yml  validate tag==version -> build -> pack
                                  -> GitHub Release (+ optional npm publish)

dependabot (independent)         opens "chore(deps):" PRs (bun ecosystem, never trigger a release)
```

The release pipeline is split into two stages: `semantic-release.yml` owns *versioning + tagging* (from conventional commits) and `release.yml` owns *packaging + publishing*. They hand off through the `v*` tag, and the tag-equals-version check in `release.yml` still holds because semantic-release bumps `package.json` before it pushes the tag.

### `ci.yml`: runs on every push/PR to `master`

| Job | What it does |
|---|---|
| `lint-workflows` | Lints the workflow YAMLs with `actionlint`. |
| `typecheck` | `bunx tsc --noEmit` under the strict tsconfig. |
| `test` | `bun test` (157 offline tests) on a Bun `1.3` / `1.4` matrix. |
| `build` | `bun run build` and uploads the resulting `lib/` as an artifact. |
| `smoke` | `scripts/smoke.mjs` against the built bundle on a Node `20.x` / `22.x` / Bun `1.4` matrix: exports, provider registration, a real local-corpus search over a temp corpus, and a `file://` fetch. No network, no `node_modules` (the bundle is dependency-free). |

Install is always `bun install --frozen-lockfile` from the committed `bun.lock`. The build-time `@deepseek-ai/*` packages (seam types, schemastery) are `devDependencies`, and the published bundle inlines them, so consumers see zero runtime dependencies.

### `semantic-release.yml`: stage 1, versioning + tagging from conventional commits

- **Trigger:** every `push` to `master`. The release type comes from the [conventional-commits](https://www.conventionalcommits.org/) preset: `feat:` → minor, `fix:`/`perf:` → patch, `BREAKING CHANGE` → major. Any other type (`chore:`, `docs:`, …) produces no release, which is why Dependabot's `chore(deps):` merges never bump the version.
- **On a release-worthy push:** writes `CHANGELOG.md`, bumps the version in `package.json` (`@semantic-release/npm` with `npmPublish: false`, so no `npm publish` happens here), commits `chore(release): vX.Y.Z [skip ci]`, and pushes the `vX.Y.Z` tag.
- **`[skip ci]`** in the commit subject stops the workflow from re-running on its own release commit (no loop). The `v*` tag then hands off to `release.yml`.
- **Auth:** the built-in `GITHUB_TOKEN` with `contents: write`, enough to push the commit + tag while `master` has no branch protection. If `master` is branch-protected, switch to a GitHub App token (a PAT is not recommended).
- **Concurrency:** `group: release-<ref>` with `cancel-in-progress: false`, so two back-to-back merges queue instead of racing the version bump / tag push.
- **Baseline:** `master` already carries the `v1.1.2` tag, so semantic-release treats it as the last release and the next bump starts from it (`feat:` → `1.2.0`, `fix:`/`perf:` → `1.1.3`, breaking → `2.0.0`). A tag-less repo would jump straight to `1.0.0` (`FIRST_RELEASE`), so the baseline tag matters.

### `release.yml`: stage 2, tag-driven packaging + optional npm publish

- **Trigger:** semver tag push (`v1.1.2`), normally the tag `semantic-release.yml` just pushed, or `workflow_dispatch` (optional `tag` input, and empty uses the `package.json` version, creating and pushing the missing tag).
- **`release` job:** validates tag equals `package.json` version, builds, `bun pm pack` (honors the `files` field), and publishes a GitHub Release with the tarball + `SHA256SUMS.txt` and generated release notes. Prerelease versions are tagged as prereleases.
- **`publish` job:** `npm publish --access public`. Runs **only when the repo secret `NPM_TOKEN` is set**, and without it the workflow still produces the GitHub Release, which is sufficient for the pinned-release install flow.

### `dependabot.yml`: dependency updates (GitHub-native Dependabot)

- The [`bun`](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#package-ecosystem-) ecosystem (`package-ecosystem: "bun"`, bun >= 1.1.39) owns both `package.json` and the committed `bun.lock`, checked weekly: no self-hosted updater, no extra token, and its lockfile updates stay in sync with CI's `bun install --frozen-lockfile`.
- `commit-message.prefix` is pinned to `chore(deps)`: Dependabot's defaults are `build(deps)` (version updates) and `fix(deps)` (security updates), and a merged `fix(deps):` commit **would** bump a patch release. With the pinned prefix, merging a dependency PR runs `semantic-release.yml` but produces no release, the same invariant the repo had under Renovate.
- Security updates still arrive (their PRs are not subject to the open-PR limit), with the same release-safe prefix.
