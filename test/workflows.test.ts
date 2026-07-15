import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/sources/workflows.js';

function workflow(stepsYaml: string, extra = ''): string {
  return `name: CI\non: push\n${extra}jobs:\n  test:\n    runs-on: ubuntu-latest\n${stepsYaml}`;
}

describe('parseWorkflow', () => {
  it('reads a scalar node-version', () => {
    const { declarations } = parseWorkflow(
      'ci.yml',
      workflow(
        '    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n',
      ),
    );
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({ role: 'ci', spec: { kind: 'pin', major: 22 } });
    expect(declarations[0]?.matrix).toBeUndefined();
  });

  it('resolves ${{ matrix.node }} into one declaration per entry', () => {
    const { declarations } = parseWorkflow(
      'ci.yml',
      workflow(
        '    strategy:\n      matrix:\n        node: [20, 22, 24]\n    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: ${{ matrix.node }}\n',
      ),
    );
    expect(declarations.map((d) => d.spec.major)).toEqual([20, 22, 24]);
    expect(declarations.every((d) => d.matrix === true)).toBe(true);
  });

  it('resolves ${{ env.NODE_VERSION }} from workflow env', () => {
    const { declarations } = parseWorkflow(
      'ci.yml',
      workflow(
        '    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: ${{ env.NODE_VERSION }}\n',
        'env:\n  NODE_VERSION: 22\n',
      ),
    );
    expect(declarations[0]?.spec).toMatchObject({ kind: 'pin', major: 22 });
    expect(declarations[0]?.matrix).toBeUndefined();
  });

  it('emits a file reference for node-version-file', () => {
    const { declarations } = parseWorkflow(
      'ci.yml',
      workflow(
        '    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version-file: .nvmrc\n',
      ),
    );
    expect(declarations[0]?.spec).toMatchObject({ kind: 'file-ref', ref: '.nvmrc' });
  });

  it('flags the unquoted 22.10 → 22.1 YAML trap', () => {
    const { declarations } = parseWorkflow(
      'ci.yml',
      workflow(
        '    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22.10\n',
      ),
    );
    expect(declarations[0]?.spec).toMatchObject({ kind: 'pin', major: 22, minor: 1 });
    expect(declarations[0]?.spec.note).toContain('trailing zero');
  });

  it('reads job container images', () => {
    const { declarations } = parseWorkflow(
      'ci.yml',
      workflow('    container: node:20-bullseye\n    steps: []\n'),
    );
    expect(declarations[0]).toMatchObject({ source: 'gha-container', spec: { major: 20 } });
  });

  it('reports unresolvable expressions as diagnostics, not guesses', () => {
    const { declarations, diagnostics } = parseWorkflow(
      'ci.yml',
      workflow(
        '    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: ${{ inputs.node }}\n',
      ),
    );
    expect(declarations).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });
});
