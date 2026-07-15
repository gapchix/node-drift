import { pinIntersectsRange } from './spec.js';
import type { Declaration, Finding, SourceId, VersionSpec } from './types.js';

export interface DriftResult {
  findings: Finding[];
  majors: number[];
  verdict: string;
  diagnostics: string[];
}

const DEV_PRECEDENCE: readonly SourceId[] = [
  'volta',
  'nvmrc',
  'node-version',
  'tool-versions',
  'mise',
];

interface Anchor {
  major: number;
  /** Human handle, e.g. `.nvmrc` or `--expect 22`. */
  label: string;
  declaration?: Declaration;
}

/** Human handle for a declaration in finding messages. */
export function describeDeclaration(declaration: Declaration): string {
  if (declaration.label === '') return declaration.file;
  if (declaration.file === 'package.json' || declaration.file.endsWith('/package.json')) {
    return `${declaration.file} ${declaration.label}`;
  }
  // Labels like `FROM node (stage "build")` or `setup-node (job "deploy")` read
  // badly double-wrapped — keep just the stage/job/service part.
  const context = /(?:stage|job|service)\s+"[^"]+"/.exec(declaration.label)?.[0];
  if (context !== undefined) return `${declaration.file} (${context})`;
  return `${declaration.file} (${declaration.label})`;
}

function driftFinding(declaration: Declaration, major: number, anchor: Anchor): Finding {
  const verb = declaration.role === 'dev' ? 'pins' : 'runs';
  const detail =
    declaration.role === 'dev'
      ? [
          'Two version files disagree: developers get different Nodes depending on',
          'which tool they use.',
        ]
      : declaration.role === 'ci'
        ? [
            'This workflow is not a test matrix — it builds or deploys on a major nobody',
            'develops against.',
          ]
        : ['What you ship runs on a different major than what you develop and test on.'];
  return {
    check: 'drift',
    severity: 'error',
    file: declaration.file,
    message: `${describeDeclaration(declaration)} ${verb} Node ${major} — the repo develops on Node ${anchor.major} (${anchor.label})`,
    detail,
  };
}

export function computeDrift(
  declarations: Declaration[],
  expect?: { major: number; raw: string },
): DriftResult {
  const findings: Finding[] = [];
  const diagnostics: string[] = [];

  const pins = declarations.filter((d) => d.spec.kind === 'pin' && d.spec.major !== undefined);
  const devPins = pins.filter((d) => d.role === 'dev');

  // --- the anchor: what this repo *means* by "our Node version"
  let anchor: Anchor | null = null;
  if (expect !== undefined) {
    anchor = { major: expect.major, label: `--expect ${expect.raw}` };
  } else {
    const ordered = [...devPins].sort(
      (a, b) =>
        DEV_PRECEDENCE.indexOf(a.source) - DEV_PRECEDENCE.indexOf(b.source) ||
        a.file.localeCompare(b.file),
    );
    const first = ordered[0];
    if (first !== undefined && first.spec.major !== undefined) {
      anchor = { major: first.spec.major, label: describeDeclaration(first), declaration: first };
    }
  }

  // Range reference when nothing pins a dev version.
  const enginesRanges = declarations.filter(
    (d) => d.source === 'engines' && d.spec.kind === 'range' && d.spec.range !== undefined,
  );
  const rangeRef = anchor === null ? (enginesRanges[0] ?? null) : null;

  // Soft anchor: majority major among pins when nothing authoritative exists.
  let softMajor: number | null = null;
  if (anchor === null && rangeRef === null && pins.length > 0) {
    const freq = new Map<number, number>();
    for (const d of pins) {
      const major = d.spec.major ?? 0;
      freq.set(major, (freq.get(major) ?? 0) + 1);
    }
    softMajor = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  }

  const ciPinMajors = new Set<number>();
  const matrixExtras = new Set<number>();
  let sawResolvableCi = false;

  for (const declaration of declarations) {
    const spec = declaration.spec;

    if (spec.kind === 'float') {
      declaration.status = 'float';
      findings.push({
        check: 'float',
        severity: 'warning',
        file: declaration.file,
        message: `${describeDeclaration(declaration)} floats ("${spec.raw}") — ${spec.note ?? 'resolves to a different version over time'}`,
        detail: [
          'Today this resolves to one version; after the next Node release, the same',
          'file quietly means something newer.',
        ],
      });
      continue;
    }

    if (spec.kind === 'unknown' || spec.kind === 'file-ref') {
      declaration.status = 'unknown';
      diagnostics.push(
        `${describeDeclaration(declaration)}: could not interpret "${spec.raw}"${spec.note !== undefined ? ` (${spec.note})` : ''}`,
      );
      continue;
    }

    if (spec.kind === 'range') {
      if (
        declaration.source === 'engines' &&
        anchor !== null &&
        spec.range !== undefined &&
        !pinIntersectsRange(anchorProbe(anchor), spec.range)
      ) {
        declaration.status = 'drift';
        findings.push({
          check: 'drift',
          severity: 'error',
          file: declaration.file,
          message: `${describeDeclaration(declaration)} "${spec.raw}" excludes Node ${anchor.major} — the version this repo develops on (${anchor.label})`,
          detail: [
            'npm warns on install (and errors under engine-strict) for the very people',
            "following the repo's own version file.",
          ],
        });
      } else {
        declaration.status = 'ok';
      }
      continue;
    }

    // pins from here on
    const major = spec.major ?? 0;
    if (declaration.role === 'ci') {
      sawResolvableCi = true;
      ciPinMajors.add(major);
    }

    if (anchor !== null && declaration === anchor.declaration) {
      declaration.status = 'ok';
      continue;
    }

    if (anchor !== null) {
      if (major !== anchor.major) {
        if (declaration.role === 'ci' && declaration.matrix === true) {
          matrixExtras.add(major);
          declaration.status = 'ok'; // extra matrix coverage is healthy; single info below
        } else {
          declaration.status = 'drift';
          findings.push(driftFinding(declaration, major, anchor));
        }
      } else {
        const anchorSpec = anchor.declaration?.spec;
        if (
          declaration.role !== 'ci' &&
          anchorSpec?.minor !== undefined &&
          spec.minor !== undefined &&
          (anchorSpec.minor !== spec.minor || (anchorSpec.patch ?? -1) !== (spec.patch ?? -1))
        ) {
          declaration.status = 'info';
          findings.push({
            check: 'drift',
            severity: 'info',
            file: declaration.file,
            message: `${describeDeclaration(declaration)} pins ${spec.raw} while ${anchor.label} pins ${anchorSpec.raw} — same major, different builds`,
          });
        } else {
          declaration.status = 'ok';
        }
      }
      continue;
    }

    if (rangeRef !== null && rangeRef.spec.range !== undefined) {
      if (!pinIntersectsRange(spec, rangeRef.spec.range)) {
        declaration.status = 'drift';
        findings.push({
          check: 'drift',
          severity: 'error',
          file: declaration.file,
          message: `${describeDeclaration(declaration)} pins Node ${major} — outside ${describeDeclaration(rangeRef)} "${rangeRef.spec.raw}"`,
          detail: [
            'With no .nvmrc or volta pin, engines.node is the only stated intent — and',
            'this declaration contradicts it.',
          ],
        });
      } else {
        declaration.status = 'ok';
      }
      continue;
    }

    if (softMajor !== null && major !== softMajor) {
      declaration.status = 'drift';
      findings.push({
        check: 'drift',
        severity: 'error',
        file: declaration.file,
        message: `${describeDeclaration(declaration)} pins Node ${major} — most of this repo uses Node ${softMajor}`,
      });
      continue;
    }

    declaration.status = 'ok';
  }

  if (anchor !== null && matrixExtras.size > 0) {
    findings.push({
      check: 'drift',
      severity: 'info',
      message: `CI matrices also test Node ${[...matrixExtras].sort((a, b) => a - b).join(', ')} — extra coverage, not drift`,
    });
  }
  if (anchor !== null && sawResolvableCi && !ciPinMajors.has(anchor.major)) {
    findings.push({
      check: 'untested',
      severity: 'warning',
      message: `no CI workflow runs Node ${anchor.major} — the version this repo develops on (${anchor.label})`,
      detail: ['CI exercises other majors; the one developers actually use ships untested.'],
    });
  }
  if (anchor === null && rangeRef === null && pins.length > 0) {
    findings.push({
      check: 'drift',
      severity: 'info',
      message:
        'nothing authoritative pins a dev Node version — add a .nvmrc (or volta.node / engines.node) as the anchor',
    });
  }
  if (declarations.length === 0) {
    findings.push({
      check: 'float',
      severity: 'warning',
      message: 'nothing in this repo declares a Node version at all',
      detail: [
        'Every developer, container, and CI runner picks its own. Add a .nvmrc and',
        'engines.node to give them an anchor.',
      ],
    });
  }

  // Verdict majors: versions the repo pins as authoritative (matrix entries excluded).
  const majorSet = new Set<number>();
  for (const d of pins) {
    if (d.role === 'ci' && d.matrix === true) continue;
    if (d.spec.major !== undefined) majorSet.add(d.spec.major);
  }
  if (expect !== undefined) majorSet.add(expect.major);
  const majors = [...majorSet].sort((a, b) => a - b);

  const floats = declarations.filter((d) => d.spec.kind === 'float').length;
  let verdict: string;
  if (majors.length > 1) {
    verdict = `this repo believes in ${majors.length} different Node versions (${majors.join(', ')}). pick one.`;
  } else if (majors.length === 1) {
    const major = majors[0] ?? 0;
    verdict =
      floats > 0
        ? `pinned to Node ${major} — but ${floats} floating declaration${floats === 1 ? '' : 's'} could disagree tomorrow.`
        : `everyone agrees on Node ${major}. suspiciously disciplined.`;
  } else if (floats > 0) {
    verdict = 'nothing pinned — every declaration floats. living dangerously.';
  } else if (enginesRanges.length > 0) {
    const first = enginesRanges[0];
    verdict = `only a range (engines.node "${first?.spec.raw ?? ''}") — nothing pins an actual version.`;
  } else {
    verdict = 'no Node version declared anywhere. living dangerously.';
  }

  return { findings, majors, verdict, diagnostics };
}

function anchorProbe(anchor: Anchor): VersionSpec {
  return (
    anchor.declaration?.spec ?? { kind: 'pin', raw: String(anchor.major), major: anchor.major }
  );
}
