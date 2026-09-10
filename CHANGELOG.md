## [1.1.2](https://github.com/ddowbnac/dsh-web-search-local/compare/v1.1.1...v1.1.2) (2026-09-10)


### Bug Fixes

* **release:** write NPM_TOKEN to runner .npmrc before publish ([601a58b](https://github.com/ddowbnac/dsh-web-search-local/commit/601a58b6ef63e47bb4b9c048da9b9a6104b025b4))

# [1.1.0](https://github.com/ddowbnac/dsh-web-search-local/compare/v1.0.0...v1.1.0) (2026-09-10)


### Features

* auto-mount the integration as a dsh bundle patch ([b015a66](https://github.com/ddowbnac/dsh-web-search-local/commit/b015a666fb390bd521c5881d60ce35ea107944a2))

# 1.0.0 (2026-09-09)


### Bug Fixes

* **ci:** regenerate bun.lock as lockfileVersion 1 (bun 1.3-compatible) ([c43db29](https://github.com/ddowbnac/dsh-web-search-local/commit/c43db29253d9c361bbecb162fc08af3842c52eb1))
* match web-search-local card to the platform plugin-card chrome ([2830dcf](https://github.com/ddowbnac/dsh-web-search-local/commit/2830dcff375389b0eae92e71e4d6166fd4d011ae))
* **release:** secrets context is invalid in if: — gate npm publish via step output ([1065c11](https://github.com/ddowbnac/dsh-web-search-local/commit/1065c11eb31ae8f43e2cf9010efe9d2d4652fef8))
* **release:** switch to angular preset to fix writer-9 conflict in generateNotes ([0cb79eb](https://github.com/ddowbnac/dsh-web-search-local/commit/0cb79eb3bc7c73626b7b918d9d41e31c073a329d))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are automated by [semantic-release](https://github.com/semantic-release/semantic-release)
using the [conventional-commits](https://www.conventionalcommits.org/) preset:
`feat:` → minor, `fix:`/`perf:` → patch, `BREAKING CHANGE` → major.
Dependency updates (`chore(deps):`, produced by Renovate) do not trigger a release.

## Unreleased

Initial changelog. The next `feat:`/`fix:`/breaking commit merged into `master`
will create the first tagged release (`v*`), which the `Release` workflow then
packs and publishes.
