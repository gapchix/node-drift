import { parse } from 'yaml';
import { errorMessage } from '../errors.js';
import { parseNodeImage } from '../spec.js';
import type { Declaration } from '../types.js';

function contextLabel(source: 'compose' | 'gitlab-ci', path: readonly string[]): string {
  if (source === 'compose') {
    const service = path[0] === 'services' ? path[1] : undefined;
    return service !== undefined ? `service "${service}"` : 'image';
  }
  const job = path[0];
  if (job === undefined || job === 'default') return 'default image';
  return `job "${job}"`;
}

/** Compose files and `.gitlab-ci.yml`: any `image:` value that names a Node image. */
export function parseImageYaml(
  source: 'compose' | 'gitlab-ci',
  file: string,
  content: string,
): { declarations: Declaration[]; diagnostics: string[] } {
  let doc: unknown;
  try {
    doc = parse(content, { merge: true }) as unknown;
  } catch (error) {
    return {
      declarations: [],
      diagnostics: [`${file}: YAML parse failed (${errorMessage(error)})`],
    };
  }
  const declarations: Declaration[] = [];
  const seen = new Set<object>();

  const visit = (node: unknown, path: readonly string[]): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, path);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'image' && typeof value === 'string') {
        const spec = parseNodeImage(value);
        if (spec !== null) {
          declarations.push({
            source,
            role: source === 'compose' ? 'runtime' : 'ci',
            file,
            label: contextLabel(source, path),
            spec,
          });
        }
      } else {
        visit(value, [...path, key]);
      }
    }
  };

  visit(doc, []);
  return { declarations, diagnostics: [] };
}
