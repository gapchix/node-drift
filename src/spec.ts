import semver from 'semver';
import type { VersionSpec } from './types.js';

/** Node.js LTS codenames → major. Extend as new LTS lines are announced. */
const LTS_CODENAMES: Record<string, number> = {
  argon: 4,
  boron: 6,
  carbon: 8,
  dubnium: 10,
  erbium: 12,
  fermium: 14,
  gallium: 16,
  hydrogen: 18,
  iron: 20,
  jod: 22,
  krypton: 24,
};

const FLOAT_ALIASES = new Set([
  'latest',
  'current',
  'node',
  'stable',
  'lts',
  'lts/*',
  '*',
  'system',
]);

const PIN_RE = /^v?(\d+)(?:\.(\d+|x|\*)(?:\.(\d+|x|\*))?)?$/;

/** Parses a version as written in `.nvmrc` / volta / setup-node / `NODE_VERSION`-style fields. */
export function parseVersionish(rawInput: string): VersionSpec {
  const raw = rawInput.trim();
  if (raw === '') return { kind: 'unknown', raw, note: 'empty version' };
  const lower = raw.toLowerCase();
  if (FLOAT_ALIASES.has(lower)) {
    return { kind: 'float', raw, note: 'resolves to a different version over time' };
  }
  const codename = /^lts\/([a-z]+)$/.exec(lower);
  if (codename?.[1] !== undefined) {
    const major = LTS_CODENAMES[codename[1]];
    if (major === undefined) return { kind: 'unknown', raw, note: 'unrecognized LTS codename' };
    return { kind: 'pin', raw, major, note: `${raw} = Node ${major}` };
  }
  const pin = PIN_RE.exec(lower);
  if (pin?.[1] !== undefined) {
    const spec: VersionSpec = { kind: 'pin', raw, major: Number(pin[1]) };
    if (pin[2] !== undefined && /^\d+$/.test(pin[2])) spec.minor = Number(pin[2]);
    if (pin[3] !== undefined && /^\d+$/.test(pin[3])) spec.patch = Number(pin[3]);
    return spec;
  }
  return { kind: 'unknown', raw, note: 'unrecognized version expression' };
}

/** Parses `engines.node`: concrete versions become pins, everything else a semver range. */
export function parseEngines(rawInput: string): VersionSpec {
  const raw = rawInput.trim();
  const asPin = parseVersionish(raw);
  if (asPin.kind !== 'unknown') return asPin;
  if (semver.validRange(raw) !== null) return { kind: 'range', raw, range: raw };
  return { kind: 'unknown', raw, note: 'not a valid semver range' };
}

/** Whether a pinned version, at its stated precision, can satisfy a range. */
export function pinIntersectsRange(spec: VersionSpec, range: string): boolean {
  if (spec.major === undefined) return true;
  try {
    if (spec.patch !== undefined) {
      return semver.satisfies(`${spec.major}.${spec.minor ?? 0}.${spec.patch}`, range);
    }
    const probe = spec.minor !== undefined ? `${spec.major}.${spec.minor}.x` : `${spec.major}.x`;
    return semver.intersects(probe, range);
  } catch {
    return true; // unparseable range: benefit of the doubt
  }
}

const IMAGE_TAG_VERSION_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?=$|-)/;

/**
 * Parses a container image reference; returns a spec when it names a Node
 * image (`node:22-alpine`, `…/library/node:22`, devcontainer `javascript-node`
 * variants), or null for non-Node images.
 */
export function parseNodeImage(imageInput: string): VersionSpec | null {
  const image = imageInput.trim();
  if (image === '') return null;
  if (image.includes('$')) {
    return /node/i.test(image)
      ? { kind: 'unknown', raw: image, note: 'unresolved variable in image reference' }
      : null;
  }
  const atIndex = image.indexOf('@');
  const withoutDigest = atIndex === -1 ? image : image.slice(0, atIndex);
  const namePart = withoutDigest.slice(withoutDigest.lastIndexOf('/') + 1);
  const colon = namePart.indexOf(':');
  const name = colon === -1 ? namePart : namePart.slice(0, colon);
  const tag = colon === -1 ? undefined : namePart.slice(colon + 1);
  const isDevcontainerImage = name === 'javascript-node' || name === 'typescript-node';
  if (name !== 'node' && !isDevcontainerImage) return null;
  if (tag === undefined || tag === '') {
    if (atIndex !== -1) {
      return { kind: 'unknown', raw: image, note: 'digest-pinned — version not stated' };
    }
    return { kind: 'float', raw: image, note: 'no tag means latest' };
  }
  if (isDevcontainerImage) {
    // Tags look like "1-22-bookworm" (template rev, node major, distro) or "22-bullseye".
    const numeric = tag.split('-').filter((part) => /^\d+(\.\d+)*$/.test(part));
    const picked = numeric.length >= 2 ? numeric[1] : numeric[0];
    if (picked === undefined) {
      return { kind: 'float', raw: image, note: `tag "${tag}" states no Node version` };
    }
    const parts = picked.split('.').map((n) => Number.parseInt(n, 10));
    const spec: VersionSpec = {
      kind: 'pin',
      raw: image,
      major: parts[0] ?? 0,
      note: 'devcontainer image tag (heuristic)',
    };
    if (parts[1] !== undefined) spec.minor = parts[1];
    if (parts[2] !== undefined) spec.patch = parts[2];
    return spec;
  }
  const match = IMAGE_TAG_VERSION_RE.exec(tag);
  if (match?.[1] === undefined) {
    return { kind: 'float', raw: image, note: `tag "${tag}" floats across majors` };
  }
  const spec: VersionSpec = { kind: 'pin', raw: image, major: Number(match[1]) };
  if (match[2] !== undefined) spec.minor = Number(match[2]);
  if (match[3] !== undefined) spec.patch = Number(match[3]);
  return spec;
}
