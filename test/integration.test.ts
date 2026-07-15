import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runAudit, shouldFail } from '../src/audit.js';
import { AuditError } from '../src/errors.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

describe('runAudit on fixtures', () => {
  it('drifty: finds every planted drift', () => {
    const result = runAudit({ dir: fixture('drifty') });
    const errors = result.findings.filter((f) => f.severity === 'error');
    // Dockerfile ×2 stages (24), deploy.yml (20), netlify.toml (18)
    expect(errors).toHaveLength(4);
    expect(result.majors).toEqual([18, 20, 22, 24]);
    expect(result.verdict).toContain('4 different Node versions');
    expect(shouldFail(result, ['drift'])).toBe(true);
    expect(shouldFail(result, [])).toBe(false);
    // matrix containing the anchor: no untested warning
    expect(result.findings.some((f) => f.check === 'untested')).toBe(false);
  });

  it('clean: everything agrees, node-version-file resolved', () => {
    const result = runAudit({ dir: fixture('clean') });
    expect(result.findings).toEqual([]);
    expect(result.majors).toEqual([22]);
    expect(result.verdict).toContain('everyone agrees on Node 22');
    const ciDecl = result.declarations.find((d) => d.source === 'gha-setup-node');
    expect(ciDecl?.spec.raw).toBe('.nvmrc → 22.11.0');
    expect(ciDecl?.status).toBe('ok');
  });

  it('floaty: all floats, nothing pinned', () => {
    const result = runAudit({ dir: fixture('floaty') });
    expect(result.findings.filter((f) => f.check === 'float')).toHaveLength(2);
    expect(result.majors).toEqual([]);
    expect(shouldFail(result, ['float'])).toBe(true);
    expect(shouldFail(result, ['drift'])).toBe(false);
  });

  it('honours --expect over the discovered anchor', () => {
    const result = runAudit({ dir: fixture('clean'), expect: '24' });
    expect(result.findings.some((f) => f.message.includes('--expect 24'))).toBe(true);
    expect(shouldFail(result, ['drift'])).toBe(true);
  });

  it('rejects a non-repo directory with an AuditError', () => {
    expect(() => runAudit({ dir: fixture('..') + '/does-not-exist' })).toThrow(AuditError);
  });

  it('rejects a vague expect value', () => {
    expect(() => runAudit({ dir: fixture('clean'), expect: 'lts/*' })).toThrow(AuditError);
  });
});
