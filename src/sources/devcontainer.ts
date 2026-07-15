import { errorMessage } from '../errors.js';
import { parseNodeImage, parseVersionish } from '../spec.js';
import { asRecord } from '../util.js';
import type { Declaration } from '../types.js';

function parseJsonc(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    // devcontainer.json is JSONC; strip block comments, whole-line // comments
    // (URLs live inside strings, so line-anchored stripping is safe) and
    // trailing commas, then retry.
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(stripped) as unknown;
  }
}

/** `devcontainer.json`: the `image` reference and/or the node feature's `version`. */
export function parseDevcontainer(
  file: string,
  content: string,
): { declarations: Declaration[]; diagnostics: string[] } {
  let doc: unknown;
  try {
    doc = parseJsonc(content);
  } catch (error) {
    return {
      declarations: [],
      diagnostics: [`${file}: JSONC parse failed (${errorMessage(error)})`],
    };
  }
  const root = asRecord(doc);
  if (root === null) return { declarations: [], diagnostics: [] };
  const declarations: Declaration[] = [];

  const image = root['image'];
  if (typeof image === 'string') {
    const spec = parseNodeImage(image);
    if (spec !== null) {
      declarations.push({ source: 'devcontainer', role: 'runtime', file, label: 'image', spec });
    }
  }

  const features = asRecord(root['features']);
  if (features !== null) {
    for (const [key, value] of Object.entries(features)) {
      if (!/devcontainers\/features\/node(?::|$)/.test(key)) continue;
      const version = typeof value === 'string' ? value : asRecord(value)?.['version'];
      if (typeof version === 'string' && version !== '') {
        declarations.push({
          source: 'devcontainer',
          role: 'runtime',
          file,
          label: 'node feature',
          spec: parseVersionish(version),
        });
      }
    }
  }
  return { declarations, diagnostics: [] };
}
