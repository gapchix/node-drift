import { parseVersionish } from '../spec.js';
import type { Declaration } from '../types.js';

/** `netlify.toml`: `NODE_VERSION = "…"` in any environment block — bounded regex, no TOML dependency. */
export function parseNetlify(file: string, content: string): Declaration[] {
  const declarations: Declaration[] = [];
  const re = /^\s*NODE_VERSION\s*=\s*["']?([^"'\s#]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match[1] === undefined) continue;
    declarations.push({
      source: 'netlify',
      role: 'runtime',
      file,
      label: 'NODE_VERSION',
      spec: parseVersionish(match[1]),
    });
  }
  return declarations;
}
