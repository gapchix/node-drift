import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { computeDrift } from './drift.js';
import { discover, type DiscoveredFile } from './discover.js';
import { AuditError, errorMessage } from './errors.js';
import { parseVersionish } from './spec.js';
import { parseDevcontainer } from './sources/devcontainer.js';
import { parseDockerfile } from './sources/dockerfile.js';
import { parseImageYaml } from './sources/image-yaml.js';
import { parseNetlify } from './sources/netlify.js';
import { parsePackageJson } from './sources/package-json.js';
import { parseMise, parseToolVersions, parseVersionFile } from './sources/version-files.js';
import { parseWorkflow } from './sources/workflows.js';
import type { AuditConfig, AuditResult, CheckId, Declaration } from './types.js';

export interface AuditOptions {
  /** Repo root to scan. Defaults to the current working directory. */
  dir?: string;
  /** Explicit config file path. */
  configPath?: string;
  /** Concrete version every declaration should agree on (overrides config and the discovered anchor). */
  expect?: string;
}

function parseFile(
  file: DiscoveredFile,
  content: string,
): { declarations: Declaration[]; diagnostics: string[] } {
  switch (file.kind) {
    case 'nvmrc':
      return { declarations: parseVersionFile('nvmrc', file.rel, content), diagnostics: [] };
    case 'node-version':
      return { declarations: parseVersionFile('node-version', file.rel, content), diagnostics: [] };
    case 'tool-versions':
      return { declarations: parseToolVersions(file.rel, content), diagnostics: [] };
    case 'mise':
      return { declarations: parseMise(file.rel, content), diagnostics: [] };
    case 'package-json':
      return parsePackageJson(file.rel, content);
    case 'dockerfile':
      return { declarations: parseDockerfile(file.rel, content), diagnostics: [] };
    case 'compose':
      return parseImageYaml('compose', file.rel, content);
    case 'gitlab-ci':
      return parseImageYaml('gitlab-ci', file.rel, content);
    case 'workflow':
      return parseWorkflow(file.rel, content);
    case 'netlify':
      return { declarations: parseNetlify(file.rel, content), diagnostics: [] };
    case 'devcontainer':
      return parseDevcontainer(file.rel, content);
  }
}

/** Resolves `node-version-file` references against what the referenced file actually declares. */
function resolveFileRefs(declarations: Declaration[], diagnostics: string[]): void {
  for (const declaration of declarations) {
    if (declaration.spec.kind !== 'file-ref' || declaration.spec.ref === undefined) continue;
    const refPath = declaration.spec.ref.replace(/\\/g, '/').replace(/^\.\//, '');
    const candidates = declarations.filter(
      (target) =>
        target.file === refPath && target !== declaration && target.spec.kind !== 'file-ref',
    );
    const target =
      candidates.find((t) => t.role === 'dev') ??
      candidates.find((t) => t.source === 'engines') ??
      candidates[0];
    if (target === undefined) {
      diagnostics.push(
        `${declaration.file}: node-version-file references ${refPath}, which was not found (or declares nothing)`,
      );
      declaration.spec = {
        kind: 'unknown',
        raw: declaration.spec.raw,
        note: `references ${refPath} — not found`,
      };
      continue;
    }
    declaration.spec = {
      ...target.spec,
      raw: `${refPath} → ${target.spec.raw}`,
      note: `follows ${refPath}`,
    };
  }
}

export function runAudit(options: AuditOptions = {}): AuditResult {
  const dir = resolve(options.dir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new AuditError(`directory not found: ${dir}`);
  }
  const config = loadConfig(dir, options.configPath);
  const expectRaw = options.expect ?? config.expect;
  let expect: { major: number; raw: string } | undefined;
  if (expectRaw !== undefined) {
    const spec = parseVersionish(expectRaw);
    if (spec.kind !== 'pin' || spec.major === undefined) {
      throw new AuditError(
        `"expect" must be a concrete version like "22" or "22.11.0" (got "${expectRaw}")`,
      );
    }
    expect = { major: spec.major, raw: expectRaw };
  }

  const { files, diagnostics } = discover(dir, config.ignore);
  const declarations: Declaration[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.abs, 'utf8');
    } catch (error) {
      diagnostics.push(`${file.rel}: read failed (${errorMessage(error)})`);
      continue;
    }
    const parsed = parseFile(file, content);
    declarations.push(...parsed.declarations);
    diagnostics.push(...parsed.diagnostics);
  }

  if (declarations.length === 0 && !files.some((f) => f.kind === 'package-json')) {
    throw new AuditError(
      `no Node version declarations (and no package.json) found in ${dir} — is this a Node repo?`,
    );
  }

  resolveFileRefs(declarations, diagnostics);
  const drift = computeDrift(declarations, expect);
  diagnostics.push(...drift.diagnostics);

  const effectiveConfig: AuditConfig = {
    ...config,
    ...(expectRaw !== undefined ? { expect: expectRaw } : {}),
  };
  return {
    dir,
    config: effectiveConfig,
    declarations,
    findings: drift.findings,
    majors: drift.majors,
    verdict: drift.verdict,
    diagnostics,
  };
}

/** Whether the result should fail the process for the given checks (errors and warnings count). */
export function shouldFail(result: AuditResult, failOn: readonly CheckId[]): boolean {
  return result.findings.some(
    (finding) =>
      failOn.includes(finding.check) &&
      (finding.severity === 'error' || finding.severity === 'warning'),
  );
}
