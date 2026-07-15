import { describe, expect, it } from 'vitest';
import { parseDevcontainer } from '../src/sources/devcontainer.js';
import { parseDockerfile } from '../src/sources/dockerfile.js';
import { parseImageYaml } from '../src/sources/image-yaml.js';
import { parseNetlify } from '../src/sources/netlify.js';
import { parsePackageJson } from '../src/sources/package-json.js';
import { parseMise, parseToolVersions, parseVersionFile } from '../src/sources/version-files.js';

describe('parseVersionFile', () => {
  it('reads the first meaningful line and strips comments', () => {
    const [decl] = parseVersionFile('nvmrc', '.nvmrc', '\n# our version\n22.11.0 # keep in sync\n');
    expect(decl?.spec).toMatchObject({ kind: 'pin', major: 22, minor: 11, patch: 0 });
    expect(decl?.role).toBe('dev');
  });

  it('returns nothing for an empty file', () => {
    expect(parseVersionFile('nvmrc', '.nvmrc', '\n\n')).toEqual([]);
  });
});

describe('parseToolVersions', () => {
  it('finds the nodejs line among other tools', () => {
    const [decl] = parseToolVersions(
      '.tool-versions',
      'python 3.12.1\nnodejs 22.9.0 20.11.0\nruby 3.3.0\n',
    );
    expect(decl?.spec).toMatchObject({ kind: 'pin', major: 22, minor: 9 });
  });

  it('accepts the "node" spelling mise allows', () => {
    const [decl] = parseToolVersions('.tool-versions', 'node 20\n');
    expect(decl?.spec).toMatchObject({ kind: 'pin', major: 20 });
  });
});

describe('parseMise', () => {
  it('reads node from the tools table', () => {
    const [decl] = parseMise('mise.toml', '[tools]\nnode = "22.11.0"\npython = "3.12"\n');
    expect(decl?.spec).toMatchObject({ kind: 'pin', major: 22 });
  });
});

describe('parsePackageJson', () => {
  it('extracts engines.node and volta.node', () => {
    const { declarations } = parsePackageJson(
      'package.json',
      JSON.stringify({ engines: { node: '>=20' }, volta: { node: '22.11.0' } }),
    );
    expect(declarations).toHaveLength(2);
    expect(declarations[0]).toMatchObject({ source: 'engines', role: 'range' });
    expect(declarations[1]).toMatchObject({ source: 'volta', role: 'dev' });
  });

  it('reports broken JSON as a diagnostic', () => {
    const { declarations, diagnostics } = parsePackageJson('package.json', '{oops');
    expect(declarations).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('parseDockerfile', () => {
  it('reads every node stage and substitutes ARG defaults', () => {
    const decls = parseDockerfile(
      'Dockerfile',
      [
        'ARG NODE_VERSION=22-alpine',
        'FROM node:${NODE_VERSION} AS build',
        'RUN npm ci',
        'FROM postgres:17 AS db',
        'FROM build AS test',
        'FROM node:24',
      ].join('\n'),
    );
    expect(decls).toHaveLength(2);
    expect(decls[0]?.spec).toMatchObject({ kind: 'pin', major: 22 });
    expect(decls[0]?.label).toContain('stage "build"');
    expect(decls[1]?.spec).toMatchObject({ kind: 'pin', major: 24 });
  });

  it('supports ${VAR:-fallback} and --platform', () => {
    const decls = parseDockerfile(
      'Dockerfile',
      'FROM --platform=linux/amd64 node:${NODE_VERSION:-20-slim}\n',
    );
    expect(decls[0]?.spec).toMatchObject({ kind: 'pin', major: 20 });
  });

  it('keeps unresolved variables honest', () => {
    const decls = parseDockerfile('Dockerfile', 'FROM node:$EXTERNAL_VERSION\n');
    expect(decls[0]?.spec.kind).toBe('unknown');
  });
});

describe('parseImageYaml', () => {
  it('labels compose services', () => {
    const { declarations } = parseImageYaml(
      'compose',
      'docker-compose.yml',
      'services:\n  web:\n    image: node:22\n  db:\n    image: postgres:17\n',
    );
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({ role: 'runtime', label: 'service "web"' });
  });

  it('labels gitlab default and job images', () => {
    const { declarations } = parseImageYaml(
      'gitlab-ci',
      '.gitlab-ci.yml',
      'image: node:20\nbuild-job:\n  image: node:22\n  script: [npm ci]\n',
    );
    expect(declarations.map((d) => d.label)).toEqual(['default image', 'job "build-job"']);
    expect(declarations.every((d) => d.role === 'ci')).toBe(true);
  });

  it('reports YAML parse failures as diagnostics', () => {
    const { declarations, diagnostics } = parseImageYaml(
      'compose',
      'docker-compose.yml',
      'a: [b\n',
    );
    expect(declarations).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('parseNetlify', () => {
  it('finds NODE_VERSION in any environment block', () => {
    const decls = parseNetlify(
      'netlify.toml',
      '[build.environment]\n  NODE_VERSION = "18"\n[context.production.environment]\n  NODE_VERSION = "20"\n',
    );
    expect(decls.map((d) => d.spec.major)).toEqual([18, 20]);
  });
});

describe('parseDevcontainer', () => {
  it('reads the image and the node feature, JSONC included', () => {
    const { declarations } = parseDevcontainer(
      '.devcontainer/devcontainer.json',
      `{
        // our container
        "image": "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm",
        "features": {
          "ghcr.io/devcontainers/features/node:1": { "version": "20" },
        },
      }`,
    );
    expect(declarations).toHaveLength(2);
    expect(declarations[0]?.spec).toMatchObject({ major: 22 });
    expect(declarations[1]?.spec).toMatchObject({ major: 20 });
  });
});
