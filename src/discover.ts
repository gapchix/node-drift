import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from './errors.js';

export type FileKind =
  | 'nvmrc'
  | 'node-version'
  | 'tool-versions'
  | 'mise'
  | 'package-json'
  | 'dockerfile'
  | 'compose'
  | 'gitlab-ci'
  | 'workflow'
  | 'netlify'
  | 'devcontainer';

export interface DiscoveredFile {
  /** Repo-relative path, forward slashes. */
  rel: string;
  abs: string;
  kind: FileKind;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'tmp',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.output',
  '.svelte-kit',
  'target',
  '__pycache__',
  '.venv',
]);

const MAX_DEPTH = 6;

const COMPOSE_RE = /^(?:docker-)?compose(?:[._-][\w.-]+)?\.ya?ml$/i;

function classify(name: string, rel: string): FileKind | null {
  const lower = name.toLowerCase();
  // Workflows first: any YAML under .github/workflows/ is a workflow, whatever its name.
  if (/\.ya?ml$/i.test(name) && /(^|\/)\.github\/workflows\//.test(rel)) return 'workflow';
  if (name === '.nvmrc') return 'nvmrc';
  if (name === '.node-version') return 'node-version';
  if (name === '.tool-versions') return 'tool-versions';
  if (lower === 'mise.toml' || lower === '.mise.toml') return 'mise';
  if (name === 'package.json') return 'package-json';
  if (
    lower === 'dockerfile' ||
    lower === 'containerfile' ||
    lower.startsWith('dockerfile.') ||
    lower.endsWith('.dockerfile')
  ) {
    return 'dockerfile';
  }
  if (lower === '.gitlab-ci.yml' || lower === '.gitlab-ci.yaml') return 'gitlab-ci';
  if (COMPOSE_RE.test(name)) return 'compose';
  if (lower === 'netlify.toml') return 'netlify';
  if (lower === 'devcontainer.json') return 'devcontainer';
  return null;
}

/** Compiles an ignore glob (`*` matches anything, `?` one char) against repo-relative paths. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export function discover(
  root: string,
  ignoreGlobs: readonly string[],
): { files: DiscoveredFile[]; diagnostics: string[] } {
  const files: DiscoveredFile[] = [];
  const diagnostics: string[] = [];
  const matchers = ignoreGlobs.map(globToRegExp);

  const walk = (dirAbs: string, dirRel: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(`could not read ${dirRel === '' ? '.' : dirRel}: ${errorMessage(error)}`);
      return;
    }
    for (const entry of entries) {
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`;
      if (matchers.some((re) => re.test(rel))) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || depth >= MAX_DEPTH) continue;
        walk(join(dirAbs, entry.name), rel, depth + 1);
      } else if (entry.isFile()) {
        const kind = classify(entry.name, rel);
        if (kind !== null) files.push({ rel, abs: join(dirAbs, entry.name), kind });
      }
    }
  };

  walk(root, '', 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, diagnostics };
}
