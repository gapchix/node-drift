import { parseNodeImage } from '../spec.js';
import type { Declaration } from '../types.js';

const ARG_RE = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/i;
const FROM_RE = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * `Dockerfile` / `Containerfile`: every `FROM node:…` across all stages, with
 * same-file `ARG` defaults substituted (including `${VAR:-fallback}` syntax).
 */
export function parseDockerfile(file: string, content: string): Declaration[] {
  const declarations: Declaration[] = [];
  const args = new Map<string, string>();
  const stages = new Set<string>();
  const text = content.replace(/\\\r?\n/g, ' '); // join line continuations
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const arg = ARG_RE.exec(line);
    if (arg?.[1] !== undefined) {
      args.set(arg[1], stripQuotes(arg[2] ?? ''));
      continue;
    }
    const from = FROM_RE.exec(line);
    if (from?.[1] === undefined) continue;
    const stage = from[2];
    const image = from[1].replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-+]([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (whole: string, braced?: string, fallback?: string, bare?: string): string => {
        const key = braced ?? bare;
        if (key === undefined) return whole;
        const value = args.get(key);
        if (value !== undefined && value !== '') return value;
        return fallback !== undefined && fallback !== '' ? fallback : whole;
      },
    );
    if (stages.has(image.toLowerCase())) {
      // FROM <earlier stage> — not an image reference
      if (stage !== undefined) stages.add(stage.toLowerCase());
      continue;
    }
    if (stage !== undefined) stages.add(stage.toLowerCase());
    const spec = parseNodeImage(image);
    if (spec === null) continue;
    declarations.push({
      source: 'dockerfile',
      role: 'runtime',
      file,
      label: stage !== undefined ? `FROM node (stage "${stage}")` : 'FROM node',
      spec,
    });
  }
  return declarations;
}
