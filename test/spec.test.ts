import { describe, expect, it } from 'vitest';
import { parseEngines, parseNodeImage, parseVersionish, pinIntersectsRange } from '../src/spec.js';

describe('parseVersionish', () => {
  it('parses plain majors, v-prefixes, and full versions', () => {
    expect(parseVersionish('22')).toMatchObject({ kind: 'pin', major: 22 });
    expect(parseVersionish('v20.11.1')).toMatchObject({
      kind: 'pin',
      major: 20,
      minor: 11,
      patch: 1,
    });
    expect(parseVersionish('22.x')).toMatchObject({ kind: 'pin', major: 22 });
    expect(parseVersionish('22.x').minor).toBeUndefined();
  });

  it('resolves LTS codenames and flags unknown ones', () => {
    expect(parseVersionish('lts/jod')).toMatchObject({ kind: 'pin', major: 22 });
    expect(parseVersionish('lts/iron')).toMatchObject({ kind: 'pin', major: 20 });
    expect(parseVersionish('lts/zzz')).toMatchObject({ kind: 'unknown' });
  });

  it('treats aliases as floating', () => {
    for (const alias of ['latest', 'current', 'lts/*', 'lts', 'node', 'system']) {
      expect(parseVersionish(alias).kind, alias).toBe('float');
    }
  });

  it('rejects garbage honestly', () => {
    expect(parseVersionish('banana')).toMatchObject({ kind: 'unknown' });
    expect(parseVersionish('')).toMatchObject({ kind: 'unknown' });
  });
});

describe('parseEngines', () => {
  it('keeps concrete versions as pins', () => {
    expect(parseEngines('22')).toMatchObject({ kind: 'pin', major: 22 });
  });

  it('parses ranges', () => {
    expect(parseEngines('>=20')).toMatchObject({ kind: 'range', range: '>=20' });
    expect(parseEngines('^20.10 || ^22')).toMatchObject({ kind: 'range' });
  });

  it('flags invalid expressions', () => {
    expect(parseEngines('not-a-range')).toMatchObject({ kind: 'unknown' });
  });
});

describe('pinIntersectsRange', () => {
  it('checks major-only pins loosely', () => {
    expect(pinIntersectsRange({ kind: 'pin', raw: '22', major: 22 }, '>=20')).toBe(true);
    expect(pinIntersectsRange({ kind: 'pin', raw: '18', major: 18 }, '>=20')).toBe(false);
    // any 22.x could satisfy ^22.5, so a bare "22" pin counts as compatible
    expect(pinIntersectsRange({ kind: 'pin', raw: '22', major: 22 }, '^22.5')).toBe(true);
  });

  it('checks full pins exactly', () => {
    expect(
      pinIntersectsRange({ kind: 'pin', raw: '22.11.0', major: 22, minor: 11, patch: 0 }, '^22.12'),
    ).toBe(false);
    expect(
      pinIntersectsRange({ kind: 'pin', raw: '22.12.1', major: 22, minor: 12, patch: 1 }, '^22.12'),
    ).toBe(true);
  });
});

describe('parseNodeImage', () => {
  it('parses plain and registry-qualified node images', () => {
    expect(parseNodeImage('node:22-alpine')).toMatchObject({ kind: 'pin', major: 22 });
    expect(parseNodeImage('node:22.11.0-bookworm-slim')).toMatchObject({
      kind: 'pin',
      major: 22,
      minor: 11,
      patch: 0,
    });
    expect(parseNodeImage('public.ecr.aws/docker/library/node:20')).toMatchObject({
      kind: 'pin',
      major: 20,
    });
    expect(parseNodeImage('my-registry.example.com:5000/node:22')).toMatchObject({
      kind: 'pin',
      major: 22,
    });
  });

  it('returns null for non-node images', () => {
    expect(parseNodeImage('postgres:17')).toBeNull();
    expect(parseNodeImage('redis')).toBeNull();
    expect(parseNodeImage('mynode:22')).toBeNull();
  });

  it('flags floating tags and missing tags', () => {
    expect(parseNodeImage('node')).toMatchObject({ kind: 'float' });
    expect(parseNodeImage('node:latest')).toMatchObject({ kind: 'float' });
    expect(parseNodeImage('node:alpine')).toMatchObject({ kind: 'float' });
  });

  it('is honest about digests and unresolved variables', () => {
    expect(parseNodeImage('node@sha256:abc123')).toMatchObject({ kind: 'unknown' });
    expect(parseNodeImage('node:${NODE_VERSION}')).toMatchObject({ kind: 'unknown' });
    expect(parseNodeImage('${BASE_IMAGE}')).toBeNull();
  });

  it('handles devcontainer image tags heuristically', () => {
    expect(
      parseNodeImage('mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm'),
    ).toMatchObject({ kind: 'pin', major: 22 });
    expect(
      parseNodeImage('mcr.microsoft.com/devcontainers/typescript-node:22-bullseye'),
    ).toMatchObject({ kind: 'pin', major: 22 });
  });
});
