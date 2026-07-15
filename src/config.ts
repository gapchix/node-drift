import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuditError, errorMessage } from './errors.js';
import { CHECK_IDS, type AuditConfig, type CheckId } from './types.js';

const CONFIG_FILES = ['nodrift.config.json', '.nodriftrc.json'];

interface RawConfig {
  expect?: unknown;
  ignore?: unknown;
  failOn?: unknown;
}

function validate(raw: RawConfig, origin: string): AuditConfig {
  const config: AuditConfig = { ignore: [], failOn: [] };
  if (raw.expect !== undefined) {
    if (typeof raw.expect !== 'string' && typeof raw.expect !== 'number') {
      throw new AuditError(`${origin}: "expect" must be a string`);
    }
    config.expect = String(raw.expect);
  }
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore) || raw.ignore.some((value) => typeof value !== 'string')) {
      throw new AuditError(`${origin}: "ignore" must be an array of strings`);
    }
    config.ignore = raw.ignore as string[];
  }
  if (raw.failOn !== undefined) {
    if (
      !Array.isArray(raw.failOn) ||
      raw.failOn.some((value) => !(CHECK_IDS as readonly string[]).includes(String(value)))
    ) {
      throw new AuditError(`${origin}: "failOn" entries must be one of: ${CHECK_IDS.join(', ')}`);
    }
    config.failOn = raw.failOn as CheckId[];
  }
  return config;
}

function readJson(path: string, origin: string): RawConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RawConfig;
  } catch (error) {
    throw new AuditError(`could not parse ${origin}: ${errorMessage(error)}`);
  }
}

export function loadConfig(dir: string, configPath?: string): AuditConfig {
  if (configPath !== undefined) {
    const abs = resolve(dir, configPath);
    if (!existsSync(abs)) throw new AuditError(`config file not found: ${configPath}`);
    return validate(readJson(abs, configPath), configPath);
  }
  for (const name of CONFIG_FILES) {
    const abs = join(dir, name);
    if (existsSync(abs)) return validate(readJson(abs, name), name);
  }
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { nodrift?: RawConfig };
      if (pkg.nodrift !== undefined) return validate(pkg.nodrift, 'package.json "nodrift" key');
    } catch {
      // a broken package.json surfaces as a scan diagnostic, not a config error
    }
  }
  return { ignore: [], failOn: [] };
}
