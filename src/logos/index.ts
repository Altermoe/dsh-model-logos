/**
 * The merged artwork set every renderer reads.
 *
 * `official.generated.ts` is written from the pinned upstream vector files by
 * `scripts/import-logos.ts`; `manual.ts` holds the few marks that are not from
 * that package (DeepSeek's own whale, Xiaomi, AWS and the Radius fallback).
 * Renderers and the icon picker only import this module, so a caller never needs
 * to know which source owns a key.
 *
 * The merged object is frozen: artwork is loaded once, is never mutated at
 * runtime, and the icon picker iterates its keys to build the two groups.
 */
import type { LogoSet } from '../types';
import { LOGOS as MANUAL_LOGOS } from './manual';
import { LOGOS as OFFICIAL_LOGOS } from './official.generated';

export { SHARED_VENDOR_MARKS, countLogoEntries, filterLogoGroups, groupLogoEntries } from './groups';
export type { GroupedLogoEntry, LogoGroups } from './groups';

export const LOGOS: LogoSet = Object.freeze({
  ...OFFICIAL_LOGOS,
  ...MANUAL_LOGOS,
});
