import pc from 'picocolors';
import type {
  AuditResult,
  CheckId,
  Declaration,
  DeclarationStatus,
  Role,
  Severity,
} from './types.js';

export interface ReportOptions {
  version: string;
  /** Checks the CLI will fail on — rendered in the summary. */
  failOn?: readonly CheckId[];
}

const SYMBOLS: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const STATUS_RANK: Record<NonNullable<DeclarationStatus>, number> = {
  drift: 0,
  float: 1,
  unknown: 2,
  info: 3,
  ok: 4,
};

const SECTIONS: { title: string; role: Role }[] = [
  { title: 'dev pins', role: 'dev' },
  { title: 'ranges', role: 'range' },
  { title: 'docker & deploy', role: 'runtime' },
  { title: 'ci', role: 'ci' },
];

function paint(severity: Severity, text: string): string {
  if (severity === 'error') return pc.red(text);
  if (severity === 'warning') return pc.yellow(text);
  return pc.cyan(text);
}

function statusMarker(status: DeclarationStatus | undefined): string {
  switch (status) {
    case 'drift':
      return pc.red('✖');
    case 'float':
      return pc.yellow('⚠');
    case 'info':
      return pc.cyan('ℹ');
    case 'unknown':
      return pc.dim('?');
    default:
      return pc.green('✓');
  }
}

interface Row {
  status: DeclarationStatus;
  file: string;
  label: string;
  value: string;
}

function buildRows(declarations: readonly Declaration[]): Row[] {
  const groups = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    const key = `${declaration.file}|${declaration.label}`;
    const list = groups.get(key) ?? [];
    list.push(declaration);
    groups.set(key, list);
  }
  const rows: Row[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const status = group
      .map((d) => d.status ?? 'ok')
      .sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0];
    rows.push({
      status: status ?? 'ok',
      file: first.file,
      label: first.label,
      value: group.map((d) => d.spec.raw).join(', '),
    });
  }
  return rows;
}

/** Renders the human-readable report. Colors follow picocolors auto-detection. */
export function renderReport(result: AuditResult, options: ReportOptions): string {
  const lines: string[] = [];
  const fileCount = new Set(result.declarations.map((d) => d.file)).size;
  lines.push(pc.bold(`nodrift v${options.version}`));
  lines.push(
    pc.dim(
      `scanned ${result.dir} — ${result.declarations.length} declaration${result.declarations.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}`,
    ),
  );

  const sections = SECTIONS.map((section) => ({
    title: section.title,
    rows: buildRows(result.declarations.filter((d) => d.role === section.role)),
  })).filter((section) => section.rows.length > 0);

  const fileWidth = Math.max(0, ...sections.flatMap((s) => s.rows.map((r) => r.file.length)));
  const labelWidth = Math.max(0, ...sections.flatMap((s) => s.rows.map((r) => r.label.length)));

  for (const section of sections) {
    lines.push('');
    lines.push(pc.bold(`  ${section.title}`));
    for (const row of section.rows) {
      const label = labelWidth > 0 ? `  ${pc.dim(row.label.padEnd(labelWidth))}` : '';
      lines.push(
        `  ${statusMarker(row.status)}  ${row.file.padEnd(fileWidth)}${label}  ${row.value}`,
      );
    }
  }

  const ordered = [...result.findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  if (ordered.length > 0) {
    lines.push('');
    lines.push(pc.bold('  findings'));
    for (const finding of ordered) {
      lines.push('');
      lines.push(`  ${paint(finding.severity, SYMBOLS[finding.severity])}  ${finding.message}`);
      for (const line of finding.detail ?? []) lines.push(pc.dim(`     ${line}`));
    }
  }

  for (const diagnostic of result.diagnostics) {
    lines.push('');
    lines.push(pc.dim(`  note: ${diagnostic}`));
  }

  lines.push('');
  const count = (severity: Severity): number =>
    result.findings.filter((f) => f.severity === severity).length;
  if (result.findings.length === 0) {
    lines.push(pc.green(`✓ ${result.verdict}`));
  } else {
    const errors = count('error');
    const warnings = count('warning');
    lines.push(
      `${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${count('info')} info`,
    );
    lines.push(pc.bold(result.verdict));
    const failOn = options.failOn ?? [];
    const failing = ordered.filter(
      (f) => failOn.includes(f.check) && (f.severity === 'error' || f.severity === 'warning'),
    );
    if (failing.length > 0) {
      lines.push(
        pc.red(`✖ failing on: ${[...new Set(failing.map((f) => f.check))].join(', ')} (exit 1)`),
      );
    } else if (failOn.length === 0) {
      lines.push(pc.dim('report-only mode — pass --fail-on drift to gate CI'));
    }
  }
  lines.push('');
  return lines.join('\n');
}
