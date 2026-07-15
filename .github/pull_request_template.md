<!-- Thanks for contributing! A few notes that speed up review: -->

## What

<!-- One or two sentences: what changes and why. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test` is green
- [ ] New parsing/drift behavior has a unit test
- [ ] Scenarios that span files are planted in a fixture repo + asserted in `test/integration.test.ts`
- [ ] No new runtime dependencies beyond picocolors/yaml/semver (or the reasoning is in the PR description)
