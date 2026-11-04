/**
 * The merged artwork set every renderer reads.
 *
 * The three source sets stay separate (`src/logos/{intl,cn,vendors}.ts`) so
 * `scripts/build.ts` can validate each file's artwork entries independently and
 * report a broken mark against the file that owns it. Renderers and the icon
 * picker only import this module, so a caller never needs to know which set owns
 * a key.
 *
 * The merged object is frozen: artwork is loaded once, is never mutated at
 * runtime, and the icon picker iterates its keys to build the brand option list.
 */
import type { LogoSet } from '../types';
import { LOGOS as CN_LOGOS } from './cn';
import { LOGOS as INTL_LOGOS } from './intl';
import { LOGOS as VENDOR_LOGOS } from './vendors';

export const LOGOS: LogoSet = Object.freeze({
  ...INTL_LOGOS,
  ...CN_LOGOS,
  ...VENDOR_LOGOS,
});
