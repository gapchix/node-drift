import { describe, expect, it } from 'vitest';
import { computeDrift } from '../src/drift.js';
import type { Declaration, Role, SourceId, VersionSpec } from '../src/types.js';

function decl(
  source: SourceId,
  role: Role,
  file: string,
  spec: Partial<VersionSpec> & { kind: VersionSpec['kind']; raw: string },
  extra: Partial<Declaration> = {},
): Declaration {
  return { source, role, file, label: extra.label ?? '', spec, ...extra };
}

const nvmrc22 = () => decl('nvmrc', 'dev', '.nvmrc', { kind: 'pin', raw: '22', major: 22 });

describe('computeDrift', () => {
  it('flags runtime pins on a different major than the anchor', () => {
    const declarations = [
      nvmrc22(),
      decl('dockerfile', 'runtime', 'Dockerfile', { kind: 'pin', raw: 'node:24', major: 24 }),
    ];
    const result = computeDrift(declarations);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ check: 'drift', severity: 'error' });
    expect(declarations[1]?.status).toBe('drift');
    expect(result.majors).toEqual([22, 24]);
    expect(result.verdict).toContain('2 different Node versions');
  });

  it('flags engines ranges that exclude the anchor', () => {
    const result = computeDrift([
      nvmrc22(),
      decl('engines', 'range', 'package.json', { kind: 'range', raw: '>=24', range: '>=24' }),
    ]);
    expect(result.findings[0]?.message).toContain('excludes Node 22');
  });

  it('treats matrix extras as info and matching matrices as healthy', () => {
    const matrix = (major: number) =>
      decl(
        'gha-setup-node',
        'ci',
        '.github/workflows/ci.yml',
        { kind: 'pin', raw: String(major), major },
        { matrix: true, label: 'setup-node matrix (job "test")' },
      );
    const result = computeDrift([nvmrc22(), matrix(20), matrix(22), matrix(24)]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ check: 'drift', severity: 'info' });
    expect(result.majors).toEqual([22]); // matrix entries are coverage, not intent
  });

  it('warns when no CI version matches the anchor', () => {
    const matrix = (major: number) =>
      decl(
        'gha-setup-node',
        'ci',
        '.github/workflows/ci.yml',
        { kind: 'pin', raw: String(major), major },
        { matrix: true },
      );
    const result = computeDrift([nvmrc22(), matrix(20), matrix(24)]);
    const untested = result.findings.find((f) => f.check === 'untested');
    expect(untested).toMatchObject({ severity: 'warning' });
    expect(untested?.message).toContain('no CI workflow runs Node 22');
  });

  it('flags single-version workflows that disagree (the deploy.yml case)', () => {
    const result = computeDrift([
      nvmrc22(),
      decl('gha-setup-node', 'ci', '.github/workflows/deploy.yml', {
        kind: 'pin',
        raw: '20',
        major: 20,
      }),
    ]);
    expect(result.findings[0]).toMatchObject({ check: 'drift', severity: 'error' });
    expect(result.findings[0]?.message).toContain('deploy.yml');
  });

  it('checks pins against engines when no dev pin exists', () => {
    const result = computeDrift([
      decl('engines', 'range', 'package.json', { kind: 'range', raw: '>=20', range: '>=20' }),
      decl('dockerfile', 'runtime', 'Dockerfile', { kind: 'pin', raw: 'node:18', major: 18 }),
    ]);
    expect(result.findings[0]?.message).toContain('outside');
  });

  it('surfaces same-major minor disagreements between hard pins as info', () => {
    const result = computeDrift([
      decl(
        'volta',
        'dev',
        'package.json',
        { kind: 'pin', raw: '22.9.0', major: 22, minor: 9, patch: 0 },
        { label: 'volta.node' },
      ),
      decl('nvmrc', 'dev', '.nvmrc', {
        kind: 'pin',
        raw: '22.11.0',
        major: 22,
        minor: 11,
        patch: 0,
      }),
    ]);
    expect(result.findings[0]).toMatchObject({ check: 'drift', severity: 'info' });
    expect(result.findings[0]?.message).toContain('same major, different builds');
  });

  it('lets --expect override the discovered anchor', () => {
    const declarations = [nvmrc22()];
    const result = computeDrift(declarations, { major: 24, raw: '24' });
    expect(result.findings[0]?.message).toContain('--expect 24');
    expect(declarations[0]?.status).toBe('drift');
  });

  it('reports float-only repos as living dangerously', () => {
    const result = computeDrift([
      decl('nvmrc', 'dev', '.nvmrc', { kind: 'float', raw: 'lts/*', note: 'floats' }),
    ]);
    expect(result.findings.every((f) => f.check === 'float')).toBe(true);
    expect(result.verdict).toContain('living dangerously');
  });

  it('warns when nothing declares a version at all', () => {
    const result = computeDrift([]);
    expect(result.findings[0]?.message).toContain('nothing in this repo declares');
    expect(result.verdict).toContain('living dangerously');
  });
});
