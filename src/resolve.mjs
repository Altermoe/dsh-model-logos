/**
 * Model icon resolution: explicit user override first, heuristic second.
 *
 * The persisted override document is a nested dictionary:
 *
 *     {
 *       "deepseek-account": { "deepseek-flash": "deepseek" },
 *       "volcengine": { "my-local-model": "letter" | "none" | "qwen" }
 *     }
 *
 * Overrides are keyed by provider id + model id (never the display name alone)
 * so two providers may serve a same-named model with different brands. A value
 * of `none` means the user explicitly disabled the mark; a value of `letter`
 * asks for the generated letter tile (see {@link letterTextFor}) even when no
 * artwork/brand matches — the escape hatch for exotic local models.
 *
 * Pure: no DOM, no network. The client bundle inlines this module.
 */
import { LOGO_KEYS, matchModelLogo } from './match.mjs';

/** Values that mean "no icon" when persisted. */
const DISABLED = 'none';

/** Override value that asks for the generated letter tile. */
const LETTER = 'letter';

/** Text a letter tile is generated from: display name, then id. */
export function letterTextFor(provider, model) {
  const candidates = [model?.name, model?.id, provider?.name, provider?.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return '?';
}

/** Read a property as an own data property, so `__proto__`/`constructor` are inert. */
function own(object, key) {
  if (object === null || typeof object !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

/** Trim an identity part; non-strings become an empty string. */
function idOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether a value is one of the artwork keys. */
export function isKnownLogoKey(value) {
  return typeof value === 'string' && LOGO_KEYS.includes(value);
}

/**
 * The explicit override for one provider+model pair.
 * @param {unknown} overrides - persisted override document.
 * @param {string} providerId - provider route id.
 * @param {string} modelId - model id.
 * @returns {string | null} A brand key, `'none'`, `'letter'`, or null when unset.
 */
export function overrideIcon(overrides, providerId, modelId) {
  const provider = idOf(providerId);
  const model = idOf(modelId);
  if (provider === '' || model === '') return null;
  const bucket = own(overrides, provider);
  const value = own(bucket, model);
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Return a new override document with one pair set. Passing null/undefined (or
 * the empty string) removes the pair instead.
 * @param {unknown} overrides - current document.
 * @param {string} providerId - provider route id.
 * @param {string} modelId - model id.
 * @param {string | null | undefined} icon - brand key, `'none'`, or a removal value.
 * @returns {Record<string, Record<string, string>>} a new document.
 */
export function withOverride(overrides, providerId, modelId, icon) {
  const provider = idOf(providerId);
  const model = idOf(modelId);
  const value = typeof icon === 'string' ? icon.trim() : '';
  if (provider === '' || model === '' || value === '') {
    return withoutOverride(overrides, providerId, modelId);
  }
  const next = copyDocument(overrides);
  const bucket = copyBucket(own(next, provider));
  Object.defineProperty(bucket, model, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(next, provider, {
    value: bucket,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
}

/**
 * Return a new override document with one pair removed.
 * @param {unknown} overrides - current document.
 * @param {string} providerId - provider route id.
 * @param {string} modelId - model id.
 * @returns {Record<string, Record<string, string>>} a new document.
 */
export function withoutOverride(overrides, providerId, modelId) {
  const provider = idOf(providerId);
  const model = idOf(modelId);
  if (provider === '' || model === '') return copyDocument(overrides);
  const bucket = own(overrides, provider);
  if (own(bucket, model) === undefined) return copyDocument(overrides);
  const next = copyDocument(overrides);
  const nextBucket = copyBucket(bucket);
  Reflect.deleteProperty(nextBucket, model);
  if (Object.keys(nextBucket).length === 0) Reflect.deleteProperty(next, provider);
  else {
    Object.defineProperty(next, provider, {
      value: nextBucket,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next;
}

/**
 * Flatten a document into stable, sorted rows.
 * @param {unknown} overrides - persisted document.
 * @returns {Array<{ providerId: string, modelId: string, icon: string }>}
 */
export function flattenOverrides(overrides) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return [];
  const rows = [];
  for (const providerId of Object.keys(overrides).sort()) {
    const bucket = own(overrides, providerId);
    if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    for (const modelId of Object.keys(bucket).sort()) {
      const icon = own(bucket, modelId);
      if (typeof icon === 'string' && icon !== '') rows.push({ providerId, modelId, icon });
    }
  }
  return rows;
}

/**
 * Resolve the mark for one provider+model identity.
 *
 * Order: explicit override (a known brand key, `letter`, or `none`) → heuristic
 * initial icon → no icon. An unknown/stale override value is ignored, exactly
 * like a deleted artwork key would be.
 * @param {unknown} overrides - persisted override document.
 * @param {{ id?: string, name?: string } | null | undefined} provider - provider identity.
 * @param {{ id?: string, name?: string } | null | undefined} model - model identity.
 * @returns {{ key: string | null, source: 'override' | 'heuristic' | 'none', disabled: boolean, letter: boolean }}
 */
export function resolveModelIcon(overrides, provider, model) {
  const explicit = overrideIcon(overrides, provider?.id, model?.id);
  if (explicit === DISABLED) return { key: null, source: 'override', disabled: true, letter: false };
  if (explicit === LETTER) return { key: null, source: 'override', disabled: false, letter: true };
  if (explicit !== null && isKnownLogoKey(explicit)) {
    return { key: explicit, source: 'override', disabled: false, letter: false };
  }
  const heuristic = matchModelLogo({ provider: provider ?? {}, model: model ?? {} });
  if (heuristic !== null) return { key: heuristic, source: 'heuristic', disabled: false, letter: false };
  return { key: null, source: 'none', disabled: false, letter: false };
}

/** Deep-copy a document into a null-prototype-free plain object of own fields. */
function copyDocument(overrides) {
  const out = {};
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return out;
  for (const providerId of Object.keys(overrides)) {
    const bucket = own(overrides, providerId);
    if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    Object.defineProperty(out, providerId, {
      value: copyBucket(bucket),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Copy one provider bucket, keeping only non-empty string icons. */
function copyBucket(bucket) {
  const out = {};
  if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) return out;
  for (const modelId of Object.keys(bucket)) {
    const icon = own(bucket, modelId);
    if (typeof icon !== 'string' || icon === '') continue;
    Object.defineProperty(out, modelId, {
      value: icon,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
