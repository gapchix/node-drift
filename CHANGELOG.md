# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-15

Initial release.

### Added

- **Cross-file Node version audit**: reads `.nvmrc`, `.node-version`,
  `package.json` (`engines.node`, `volta.node`), `.tool-versions`, `mise.toml`,
  Dockerfiles/Containerfiles (all stages, `ARG` substitution), compose files,
  `.gitlab-ci.yml`, GitHub Actions workflows (`setup-node` scalars, arrays,
  `${{ matrix.* }}` / `${{ env.* }}`, `node-version-file`, job containers),
  `netlify.toml`, and `devcontainer.json` — recursively, monorepo-aware.
- **Drift engine** with an anchor model (`--expect` > volta > `.nvmrc` >
  `.node-version` > asdf/mise), major-level drift errors, `engines`-exclusion
  detection, CI-matrix awareness (extras are info, missing anchor coverage is
  an `untested` warning, single-version workflow mismatch is an error), and
  `float` warnings for `latest` / `lts/*` / untagged images.
- LTS codename resolution (`lts/jod` → 22) and detection of the unquoted-YAML
  `node-version: 22.10` → `22.1` trap.
- Report-only CLI with `--json`, `--fail-on`, `--expect`, `--config`;
  programmatic API (`runAudit`, `shouldFail`, `renderReport`).
- Configuration via `nodrift.config.json`, `.nodriftrc.json`, or a `nodrift`
  package.json key: `expect`, `ignore` globs, `failOn`.
- Fixture repos (`drifty`, `clean`, `floaty`) wired into the test suite; CI on
  Linux (Node 20/22/24) and Windows, with the repo auditing itself as a gate.

[Unreleased]: https://github.com/gapchix/node-drift/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gapchix/node-drift/releases/tag/v0.1.0
