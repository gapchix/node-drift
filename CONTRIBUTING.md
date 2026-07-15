# Contributing

Thanks for helping! This tool lives or dies by covering the creative ways real repos declare Node versions, so bug reports with the offending file — or just a pasted `--json` output — are the most valuable contribution there is.

## Development setup

Requirements: Node.js ≥ 20, npm.

```bash
npm ci          # install
npm test        # unit + fixture tests (fast, no network)
npm run lint    # eslint + prettier
npm run typecheck
npm run build   # emits dist/
```

`npm run demo` runs the built CLI against [fixtures/drifty](./fixtures/drifty) — handy for eyeballing report changes. `npm run svg` regenerates `docs/report.svg` (the README hero image) from that same output; rerun it whenever report formatting changes.

## Fixtures

Three small fake repos under `fixtures/` anchor the integration tests:

- `drifty/` — one of everything wrong: Dockerfile on the wrong major, a deploy workflow off-anchor, a stale `netlify.toml`, plus a healthy CI matrix that must **not** be flagged.
- `clean/` — everything agrees, including a `node-version-file:` reference the tool must resolve.
- `floaty/` — nothing pinned (`lts/*`, `node:latest`).

If you add a parser or a drift rule, plant its scenario in a fixture (or extend one) and assert it in `test/integration.test.ts`, plus a focused unit test for the parser itself.

## Project layout

```
src/
  cli.ts               CLI entry (arg parsing, exit codes)
  audit.ts             orchestrates a run; public runAudit()/shouldFail()
  discover.ts          recursive file discovery + classification
  spec.ts              version text → VersionSpec (pins, ranges, floats,
                       codenames, container image tags)
  drift.ts             the drift engine: anchor selection + findings
  config.ts            expect/ignore/failOn config loading + validation
  report.ts            human-readable rendering
  sources/             one parser per file format
test/
  *.test.ts            unit tests per module
  integration.test.ts  fixture-repo assertions
```

## Guidelines

- TypeScript strict; keep `npm run lint && npm run typecheck && npm test` green.
- Runtime dependencies are capped at `picocolors` + `yaml` + `semver` — propose anything new in an issue first.
- False positives are worse than false negatives: report-only by default, and anything the tool can't interpret becomes an honest `note`, never a guess.
- CI runs on Linux and Windows — mind path separators (repo-relative paths are normalized to forward slashes).

## Releases

Maintainers: bump the version, update `CHANGELOG.md`, and `npm publish` — `prepublishOnly` runs the full gate.
