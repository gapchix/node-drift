import { errorMessage } from '../errors.js';
import { parseEngines, parseVersionish } from '../spec.js';
import type { Declaration } from '../types.js';

/** `package.json`: `engines.node` (a range or pin) and `volta.node` (a dev pin). */
export function parsePackageJson(
  file: string,
  content: string,
): { declarations: Declaration[]; diagnostics: string[] } {
  let pkg: { engines?: Record<string, unknown>; volta?: Record<string, unknown> };
  try {
    pkg = JSON.parse(content) as typeof pkg;
  } catch (error) {
    return {
      declarations: [],
      diagnostics: [`${file}: JSON parse failed (${errorMessage(error)})`],
    };
  }
  const declarations: Declaration[] = [];
  const engines = pkg.engines?.['node'];
  if (typeof engines === 'string') {
    declarations.push({
      source: 'engines',
      role: 'range',
      file,
      label: 'engines.node',
      spec: parseEngines(engines),
    });
  }
  const volta = pkg.volta?.['node'];
  if (typeof volta === 'string') {
    declarations.push({
      source: 'volta',
      role: 'dev',
      file,
      label: 'volta.node',
      spec: parseVersionish(volta),
    });
  }
  return { declarations, diagnostics: [] };
}
