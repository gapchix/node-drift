import { parseVersionish } from '../spec.js';
import type { Declaration } from '../types.js';

/** `.nvmrc` and `.node-version`: a single version on the first meaningful line. */
export function parseVersionFile(
  source: 'nvmrc' | 'node-version',
  file: string,
  content: string,
): Declaration[] {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim(); // nvm allows comments
    if (line === '') continue;
    return [{ source, role: 'dev', file, label: '', spec: parseVersionish(line) }];
  }
  return [];
}

/** `.tool-versions` (asdf/mise): `nodejs 22.11.0 [fallback…]` — first entry wins. */
export function parseToolVersions(file: string, content: string): Declaration[] {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^(?:nodejs|node)\s+(\S+)/.exec(line);
    if (match?.[1] === undefined) continue;
    return [
      { source: 'tool-versions', role: 'dev', file, label: '', spec: parseVersionish(match[1]) },
    ];
  }
  return [];
}

/** `mise.toml`: `node = "22"` under [tools] — bounded regex, no TOML dependency. */
export function parseMise(file: string, content: string): Declaration[] {
  const match = /^\s*"?(?:node|nodejs)"?\s*=\s*["']([^"']+)["']/m.exec(content);
  if (match?.[1] === undefined) return [];
  return [
    { source: 'mise', role: 'dev', file, label: 'tools.node', spec: parseVersionish(match[1]) },
  ];
}
