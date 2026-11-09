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
import { LOGO_KEYS, matchModelLogo, matchVendorLogo } from './match';
import type {
  IconResolution,
  Identity,
  OverrideDocument,
  ProviderIconResolution,
  ProviderOverrideDocument,
} from './types';

/** Values that mean "no icon" when persisted. */
const DISABLED = 'none';

/** Override value that asks for the generated letter tile. */
const LETTER = 'letter';

/** Text a letter tile is generated from: display name, then id. */
export function letterTextFor(provider: Identity | null | undefined, model: Identity | null | undefined): string {
  const candidates = [model?.name, model?.id, provider?.name, provider?.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return '?';
}

/**
 * Text a provider letter tile is generated from: display name, then route id.
 * @param providerId - provider route id.
 * @param displayName - provider display name from the directory, when known.
 */
export function providerLetterTextFor(providerId: unknown, displayName?: unknown): string {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (name !== '') return name;
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  return id !== '' ? id : '?';
}

/** Read a property as an own data property, so `__proto__`/`constructor` are inert. */
function own(object: unknown, key: string): unknown {
  if (object === null || typeof object !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(object, key) ? (object as Record<string, unknown>)[key] : undefined;
}

/** Trim an identity part; non-strings become an empty string. */
function idOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether a value is one of the artwork keys. */
export function isKnownLogoKey(value: unknown): value is string {
  return typeof value === 'string' && LOGO_KEYS.includes(value);
}

/**
 * The explicit override for one provider+model pair.
 * @param overrides - persisted override document.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @returns A brand key, `'none'`, `'letter'`, or null when unset.
 */
export function overrideIcon(overrides: unknown, providerId: unknown, modelId: unknown): string | null {
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
 * @param overrides - current document.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @param icon - brand key, `'none'`, or a removal value.
 * @returns a new document.
 */
export function withOverride(
  overrides: unknown,
  providerId: unknown,
  modelId: unknown,
  icon: string | null | undefined,
): OverrideDocument {
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
 * @param overrides - current document.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @returns a new document.
 */
export function withoutOverride(overrides: unknown, providerId: unknown, modelId: unknown): OverrideDocument {
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
 * @param overrides - persisted document.
 */
export function flattenOverrides(overrides: unknown): Array<{ providerId: string; modelId: string; icon: string }> {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return [];
  const rows: Array<{ providerId: string; modelId: string; icon: string }> = [];
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
 * @param overrides - persisted override document.
 * @param provider - provider identity.
 * @param model - model identity.
 */
export function resolveModelIcon(
  overrides: unknown,
  provider: Identity | null | undefined,
  model: Identity | null | undefined,
): IconResolution {
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

/* -------------------------------------------------------------------------- */
/* Provider (vendor / channel) overrides                                      */
/* -------------------------------------------------------------------------- */

/**
 * The explicit override for one provider, or null when unset.
 *
 * The provider document is one level flat (`providerId → icon`), so a provider
 * override and a model override never collide: they live in separate settings
 * fields.
 * @param overrides - persisted provider override document.
 * @param providerId - provider route id.
 * @returns A brand key, `'none'`, `'letter'`, or null when unset.
 */
export function providerOverrideIcon(overrides: unknown, providerId: unknown): string | null {
  const provider = idOf(providerId);
  if (provider === '') return null;
  const value = own(overrides, provider);
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Return a new provider override document with one entry set. Passing
 * null/undefined (or the empty string) removes the entry instead.
 * @param overrides - current document.
 * @param providerId - provider route id.
 * @param icon - brand key, `'none'`, or a removal value.
 * @returns a new document.
 */
export function withProviderOverride(
  overrides: unknown,
  providerId: unknown,
  icon: string | null | undefined,
): ProviderOverrideDocument {
  const provider = idOf(providerId);
  const value = typeof icon === 'string' ? icon.trim() : '';
  if (provider === '' || value === '') return withoutProviderOverride(overrides, providerId);
  const next = copyProviderDocument(overrides);
  Object.defineProperty(next, provider, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
}

/**
 * Return a new provider override document with one entry removed.
 * @param overrides - current document.
 * @param providerId - provider route id.
 * @returns a new document.
 */
export function withoutProviderOverride(overrides: unknown, providerId: unknown): ProviderOverrideDocument {
  const provider = idOf(providerId);
  if (provider === '') return copyProviderDocument(overrides);
  if (own(overrides, provider) === undefined) return copyProviderDocument(overrides);
  const next = copyProviderDocument(overrides);
  Reflect.deleteProperty(next, provider);
  return next;
}

/**
 * Flatten a provider document into stable, sorted rows.
 * @param overrides - persisted document.
 */
export function flattenProviderOverrides(overrides: unknown): Array<{ providerId: string; icon: string }> {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return [];
  const rows: Array<{ providerId: string; icon: string }> = [];
  for (const providerId of Object.keys(overrides).sort()) {
    const icon = own(overrides, providerId);
    if (typeof icon === 'string' && icon !== '') rows.push({ providerId, icon });
  }
  return rows;
}

/**
 * Resolve the vendor/channel mark for one provider identity.
 *
 * Order: explicit override (a known brand key, `letter`, or `none`) → official
 * channel table (`matchVendorLogo`, route-id based) → the generated letter tile
 * for an official channel the artwork cannot name. A hand-declared (custom)
 * provider resolves to no mark at all: an invented brand would be a lie, so its
 * 22px seat stays reserved and empty.
 * @param overrides - persisted provider override document.
 * @param providerId - provider route id.
 * @param options - `fallback` enables the letter tile for unknown channels;
 *   `allowFallback` is the legacy spelling of the same flag.
 */
export function resolveProviderIcon(
  overrides: unknown,
  providerId: unknown,
  options?: { fallback?: boolean; allowFallback?: boolean } | null,
): ProviderIconResolution {
  const provider = idOf(providerId);
  const fallback =
    options !== null && options !== undefined ? options.fallback === true || options.allowFallback === true : false;
  if (provider === '') return { key: null, source: 'none', disabled: false, letter: false };
  const explicit = providerOverrideIcon(overrides, provider);
  if (explicit === DISABLED) return { key: null, source: 'override', disabled: true, letter: false };
  if (explicit === LETTER) return { key: null, source: 'override', disabled: false, letter: true };
  if (explicit !== null && isKnownLogoKey(explicit)) {
    return { key: explicit, source: 'override', disabled: false, letter: false };
  }
  const heuristic = matchVendorLogo(provider);
  if (heuristic !== null) return { key: heuristic, source: 'heuristic', disabled: false, letter: false };
  return { key: null, source: 'none', disabled: false, letter: fallback };
}

/** Deep-copy a document into a null-prototype-free plain object of own fields. */
function copyDocument(overrides: unknown): OverrideDocument {
  const out: OverrideDocument = {};
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
function copyBucket(bucket: unknown): Record<string, string> {
  const out: Record<string, string> = {};
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

/** Deep-copy a flat provider document, keeping only non-empty string icons. */
function copyProviderDocument(overrides: unknown): ProviderOverrideDocument {
  const out: ProviderOverrideDocument = {};
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return out;
  for (const providerId of Object.keys(overrides)) {
    const icon = own(overrides, providerId);
    if (typeof icon !== 'string' || icon === '') continue;
    Object.defineProperty(out, providerId, {
      value: icon,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
