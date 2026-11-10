/**
 * The merged artwork set every renderer reads.
 *
 * `official.generated.ts` is written from the pinned upstream vector files by
 * `scripts/import-logos.ts`; `derived.generated.ts` is rebuilt from the pinned
 * sources under `reference/derived/` by `scripts/derive-marks.ts`, and `manual.ts`
 * holds the few marks that are not from either pinned set (DeepSeek's own whale,
 * Xiaomi, AWS and the Radius fallback) — every source module is re-exported
 * there. Renderers and the icon picker only import this module, so a caller
 * never needs to know which source owns a key.
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
