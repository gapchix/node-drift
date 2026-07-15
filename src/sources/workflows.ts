import { parse } from 'yaml';
import { errorMessage } from '../errors.js';
import { parseNodeImage, parseVersionish } from '../spec.js';
import { asRecord } from '../util.js';
import type { Declaration, VersionSpec } from '../types.js';

interface Entry {
  text: string;
  note?: string;
}

function entriesFromScalar(value: unknown): Entry[] {
  if (typeof value === 'string') return value === '' ? [] : [{ text: value }];
  if (typeof value === 'number') {
    const text = String(value);
    if (!Number.isInteger(value)) {
      // The classic actions/setup-node trap: node-version: 22.10 is YAML for 22.1.
      return [
        { text, note: `unquoted YAML number — "${text}" may have lost a trailing zero (quote it)` },
      ];
    }
    return [{ text }];
  }
  return [];
}

function resolveVersionValue(
  value: unknown,
  matrix: Record<string, unknown>,
  env: Record<string, unknown>,
): { entries: Entry[]; fromMatrix: boolean; diagnostics: string[] } {
  if (Array.isArray(value)) {
    return { entries: value.flatMap(entriesFromScalar), fromMatrix: true, diagnostics: [] };
  }
  if (typeof value === 'number') {
    return { entries: entriesFromScalar(value), fromMatrix: false, diagnostics: [] };
  }
  if (typeof value !== 'string') {
    return { entries: [], fromMatrix: false, diagnostics: ['node-version has an unexpected type'] };
  }
  const expr = /^\$\{\{\s*(matrix|env)\.([\w.-]+)\s*\}\}$/.exec(value.trim());
  if (expr !== null) {
    const scope = expr[1];
    const key = expr[2] ?? '';
    const resolved = scope === 'matrix' ? matrix[key] : env[key];
    if (resolved === undefined) {
      return {
        entries: [],
        fromMatrix: scope === 'matrix',
        diagnostics: [`could not resolve \${{ ${scope ?? ''}.${key} }}`],
      };
    }
    if (Array.isArray(resolved)) {
      return { entries: resolved.flatMap(entriesFromScalar), fromMatrix: true, diagnostics: [] };
    }
    return {
      entries: entriesFromScalar(resolved),
      fromMatrix: scope === 'matrix',
      diagnostics: [],
    };
  }
  if (value.includes('${{')) {
    return {
      entries: [],
      fromMatrix: false,
      diagnostics: [`could not resolve expression "${value}"`],
    };
  }
  return { entries: [{ text: value }], fromMatrix: false, diagnostics: [] };
}

function specFromEntry(entry: Entry): VersionSpec {
  const spec = parseVersionish(entry.text);
  if (entry.note !== undefined) {
    spec.note = spec.note !== undefined ? `${spec.note}; ${entry.note}` : entry.note;
  }
  return spec;
}

/** GitHub Actions workflows: `actions/setup-node` versions (scalar, array, matrix, env, file) and job container images. */
export function parseWorkflow(
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
  const workflow = asRecord(doc);
  if (workflow === null) return { declarations: [], diagnostics: [] };
  const declarations: Declaration[] = [];
  const diagnostics: string[] = [];
  const workflowEnv = asRecord(workflow['env']) ?? {};
  const jobs = asRecord(workflow['jobs']) ?? {};

  for (const [jobId, jobValue] of Object.entries(jobs)) {
    const job = asRecord(jobValue);
    if (job === null) continue;
    const env = { ...workflowEnv, ...(asRecord(job['env']) ?? {}) };
    const matrix = asRecord(asRecord(job['strategy'])?.['matrix']) ?? {};

    const container = job['container'];
    const containerImage =
      typeof container === 'string' ? container : asRecord(container)?.['image'];
    if (typeof containerImage === 'string') {
      const spec = parseNodeImage(containerImage);
      if (spec !== null) {
        declarations.push({
          source: 'gha-container',
          role: 'ci',
          file,
          label: `container (job "${jobId}")`,
          spec,
        });
      }
    }

    const steps = Array.isArray(job['steps']) ? job['steps'] : [];
    for (const stepValue of steps) {
      const step = asRecord(stepValue);
      if (step === null) continue;
      const uses = step['uses'];
      if (typeof uses !== 'string' || !uses.startsWith('actions/setup-node')) continue;
      const withBlock = asRecord(step['with']) ?? {};

      const versionFile = withBlock['node-version-file'];
      if (typeof versionFile === 'string') {
        declarations.push({
          source: 'gha-setup-node',
          role: 'ci',
          file,
          label: `setup-node node-version-file (job "${jobId}")`,
          spec: { kind: 'file-ref', raw: versionFile, ref: versionFile },
        });
      }

      const nodeVersion = withBlock['node-version'];
      if (nodeVersion === undefined) continue;
      const resolved = resolveVersionValue(nodeVersion, matrix, env);
      for (const diagnostic of resolved.diagnostics) diagnostics.push(`${file}: ${diagnostic}`);
      const isMatrix = resolved.fromMatrix || resolved.entries.length > 1;
      for (const entry of resolved.entries) {
        declarations.push({
          source: 'gha-setup-node',
          role: 'ci',
          file,
          label: isMatrix ? `setup-node matrix (job "${jobId}")` : `setup-node (job "${jobId}")`,
          spec: specFromEntry(entry),
          ...(isMatrix ? { matrix: true } : {}),
        });
      }
    }
  }
  return { declarations, diagnostics };
}
