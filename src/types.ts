export type CheckId = 'drift' | 'float' | 'untested';

export const CHECK_IDS: readonly CheckId[] = ['drift', 'float', 'untested'];

export type Severity = 'error' | 'warning' | 'info';

export type SpecKind = 'pin' | 'range' | 'float' | 'file-ref' | 'unknown';

export interface VersionSpec {
  kind: SpecKind;
  /** The version text exactly as written in the file. */
  raw: string;
  /** Major version, when the spec pins one. */
  major?: number;
  /** Minor version, when stated. */
  minor?: number;
  /** Patch version, when stated. */
  patch?: number;
  /** The semver range (kind `range`). */
  range?: string;
  /** Repo-relative path of the referenced file (kind `file-ref`). */
  ref?: string;
  /** Extra context worth surfacing (codename resolution, float reason, parse caveat). */
  note?: string;
}

export type SourceId =
  | 'nvmrc'
  | 'node-version'
  | 'engines'
  | 'volta'
  | 'tool-versions'
  | 'mise'
  | 'dockerfile'
  | 'compose'
  | 'gitlab-ci'
  | 'gha-setup-node'
  | 'gha-container'
  | 'netlify'
  | 'devcontainer';

/** How a declaration participates in drift analysis (and which report section it lands in). */
export type Role = 'dev' | 'range' | 'runtime' | 'ci';

export type DeclarationStatus = 'ok' | 'drift' | 'float' | 'info' | 'unknown';

export interface Declaration {
  source: SourceId;
  role: Role;
  /** Repo-relative path, forward slashes. */
  file: string;
  /** Human context within the file, e.g. `FROM node (stage "build")`. Empty when the file name says it all. */
  label: string;
  spec: VersionSpec;
  /** True when the version came from a CI matrix/array — extra majors there are healthy. */
  matrix?: boolean;
  /** Set by the drift engine; drives the report marker. */
  status?: DeclarationStatus;
}

export interface Finding {
  check: CheckId;
  severity: Severity;
  /** Plain text (no ANSI) so `--json` output stays clean. */
  message: string;
  /** Repo-relative file the finding anchors to, when it anchors to one. */
  file?: string;
  /** Dim explanation lines rendered under the message. */
  detail?: string[];
}

export interface AuditConfig {
  /** Concrete version every declaration is checked against (overrides the discovered anchor). */
  expect?: string;
  /** Repo-relative path globs (`*` wildcards) excluded from scanning. */
  ignore: string[];
  /** Checks that make the CLI exit non-zero. The `--fail-on` flag overrides this. */
  failOn: CheckId[];
}

export interface AuditResult {
  dir: string;
  config: AuditConfig;
  declarations: Declaration[];
  findings: Finding[];
  /**
   * Distinct majors the repo pins as authoritative, ascending. CI matrix
   * entries are excluded — testing several majors is coverage, not intent.
   */
  majors: number[];
  /** The one-line summary of the repo's state. */
  verdict: string;
  /** Non-finding notes about the audit itself (unparseable files etc.). */
  diagnostics: string[];
}
