/**
 * User-created custom icons: persisted shape, validation, crop geometry and the
 * inline SVG tile that makes a raster icon render through the existing mark
 * contract.
 *
 * Every mark surface (`composer label`, Settings decoration, picker previews and
 * the Model icons page) renders the `svg` string of a `ModelMark` / `VendorMark`
 * through `dangerouslySetInnerHTML`. A custom icon therefore ships as one
 * self-contained 24×24 SVG whose `<image>` element references the cropped data
 * URL: the raster payload stays untouched, no renderer needs an `<img>` branch,
 * and the size ladder (20 / 22 / 36px) scales the tile exactly like brand
 * artwork. Future animated/video kinds will replace this wrapper with a media
 * mark instead of widening this one.
 *
 * The tile keeps the shared rounded-square silhouette: brand artwork is a
 * `rect rx="6"` on the 24-unit canvas, and the `<image>` is clipped by the same
 * 25% corner radius (`6 / 24`), so a custom icon rounds by 5px at 20px, 5.5px at
 * 22px and 9px at 36px — the ratio scales with the box instead of hard-coding a
 * pixel radius. The clip lives in the SVG itself (no stylesheet or wrapper
 * class), so every current and future surface gets it for free.
 *
 * The module is pure: no DOM, no side effects. A custom icon is persisted in the
 * plugin's settings namespace (`customIcons`), and an override references it as
 * `custom:<id>`.
 */
import { escapeXml } from './artwork';
import type { CustomIcon, CustomIconDocument } from './types';

/** Override-value prefix that names a user-created icon. */
export const DSHML_CUSTOM_PREFIX = 'custom:';

/** The only payload kind implemented in this release. */
export const DSHML_CUSTOM_KIND_IMAGE = 'image';

/** Upper bound on the number of stored custom icons (keeps one settings file sane). */
export const DSHML_CUSTOM_MAX_ICONS = 40;

/** Upper bound on a custom icon's display name, in code points. */
export const DSHML_CUSTOM_MAX_NAME = 24;

/** Square edge length the picker renders a cropped icon into. */
export const DSHML_CUSTOM_ICON_PX = 128;

/**
 * Corner-radius ratio of the shared mark tile: every brand mark is a 24-unit
 * square with `rx="6"`, so a custom icon rounds by 6/24 of its rendered box.
 */
const DSHML_CUSTOM_TILE_RADIUS = '25%';

/** Inline clip that gives the raster tile the same rounded corners as artwork. */
const DSHML_CUSTOM_TILE_CLIP = 'clip-path: inset(0 round ' + DSHML_CUSTOM_TILE_RADIUS + ')';

/**
 * Upper bound on the stored data-URL string (128 KiB of characters).
 *
 * 128×128 PNG logos land far below it; the bound only excludes pathological
 * payloads from the settings document and matches the Host Config validation.
 */
export const DSHML_CUSTOM_MAX_DATA_URL = 128 * 1024;

/** Largest source file the picker reads before cropping (browser memory bound). */
export const DSHML_CUSTOM_MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/** Raster types the upload input accepts (GIF waits for the animated tab). */
export const DSHML_CUSTOM_IMAGE_TYPES: readonly string[] = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

/** Generated ids only use characters that survive a settings path and a dict key. */
const CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** A cropped image is stored only as a PNG/WebP base64 data URL. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;

/** Whether a value is a syntactically valid custom-icon id. */
export function dshmlIsCustomIconId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_ID.test(value);
}

/**
 * The persisted override value of one custom icon (`custom:<id>`), or null when
 * the id is invalid.
 * @param id - generated icon id.
 */
export function dshmlCustomIconKey(id: unknown): string | null {
  return dshmlIsCustomIconId(id) ? DSHML_CUSTOM_PREFIX + id : null;
}

/**
 * The icon id inside an override value, or null when the value is not a custom
 * sentinel.
 * @param value - persisted override value.
 */
export function dshmlCustomIconIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(DSHML_CUSTOM_PREFIX)) return null;
  const id = trimmed.slice(DSHML_CUSTOM_PREFIX.length);
  return dshmlIsCustomIconId(id) ? id : null;
}

/**
 * Normalize a name typed by the user: every whitespace run (including newlines)
 * collapses to one space, then the ends are trimmed.
 * @param value - raw input.
 */
export function dshmlCleanCustomName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/gu, ' ').trim();
}

/** Why a custom-icon name was rejected. */
export type DshmlCustomNameProblem = 'empty' | 'too-long' | 'duplicate';

/** Outcome of validating one custom-icon name. */
export type DshmlCustomNameResult = { ok: true; name: string } | { ok: false; problem: DshmlCustomNameProblem };

/**
 * Validate a name for a new (or renamed) custom icon.
 *
 * Names are trimmed, whitespace-collapsed, unique case-insensitively and bounded
 * to {@link DSHML_CUSTOM_MAX_NAME} code points. Uniqueness only compares against
 * the names already stored, so a rename can keep its own name by passing
 * `ignoreId`.
 * @param value - raw input.
 * @param icons - current custom-icon document.
 * @param ignoreId - id the rename targets (skipped by the duplicate check).
 */
export function dshmlValidateCustomName(
  value: unknown,
  icons: CustomIconDocument,
  ignoreId?: string | null,
): DshmlCustomNameResult {
  const name = dshmlCleanCustomName(value);
  if (name === '') return { ok: false, problem: 'empty' };
  if (Array.from(name).length > DSHML_CUSTOM_MAX_NAME) return { ok: false, problem: 'too-long' };
  const folded = name.toLowerCase();
  for (const icon of Object.values(icons)) {
    if (ignoreId !== undefined && ignoreId !== null && icon.id === ignoreId) continue;
    if (icon.name.toLowerCase() === folded) return { ok: false, problem: 'duplicate' };
  }
  return { ok: true, name };
}

/** Whether a value is a cropped icon payload this plugin may store. */
export function dshmlIsCustomImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= DSHML_CUSTOM_MAX_DATA_URL && DATA_IMAGE.test(value)
  );
}

/**
 * Whether a browser-declared file type is one the upload input accepts.
 * @param value - `File.type` (or any raw value).
 */
export function dshmlIsAcceptedImageType(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const base = value.split(';')[0];
  const mediaType = base !== undefined ? base.trim().toLowerCase() : '';
  return DSHML_CUSTOM_IMAGE_TYPES.includes(mediaType);
}

/** One normalized custom icon read from the settings document. */
function dshmlCustomIconFrom(id: string, raw: unknown): CustomIcon | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const read = (key: string): unknown => (Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : undefined);
  const name = dshmlCleanCustomName(read('name'));
  if (name === '') return null;
  const image = read('image');
  if (!dshmlIsCustomImageDataUrl(image)) return null;
  const kind = read('kind');
  // Only the image kind exists in this release; an unknown payload is skipped
  // (not rendered as a broken tile) so a future version can read it first.
  if (kind !== undefined && kind !== DSHML_CUSTOM_KIND_IMAGE) return null;
  const createdAt = read('createdAt');
  return {
    id,
    name,
    kind: DSHML_CUSTOM_KIND_IMAGE,
    image,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0,
  };
}

/**
 * Validate one persisted `customIcons` dictionary into a plain, own-property
 * document. Invalid entries (bad id, missing name, non-data-URL image, unknown
 * kind) are skipped instead of breaking the picker.
 * @param raw - value read from the settings document (host-shaped, so unknown).
 */
export function dshmlCustomIconsOf(raw: unknown): CustomIconDocument {
  const out: CustomIconDocument = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  try {
    for (const id of Object.keys(raw)) {
      if (!dshmlIsCustomIconId(id)) continue;
      if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
      const icon = dshmlCustomIconFrom(id, (raw as Record<string, unknown>)[id]);
      if (icon === null) continue;
      Object.defineProperty(out, id, { value: icon, enumerable: true, writable: true, configurable: true });
    }
  } catch {
    /* keep whatever was collected before a hostile getter threw */
  }
  return out;
}

/**
 * Every custom icon as a sorted array: creation time first, then id, so the
 * picker order is stable across reloads and independent of object key order.
 * @param icons - validated custom-icon document.
 */
export function dshmlCustomIconList(icons: CustomIconDocument): CustomIcon[] {
  const list = Object.values(icons);
  list.sort(function byAge(left, right) {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
  return list;
}

/**
 * Generate a new custom-icon id.
 *
 * Uses `crypto.randomUUID()` where the platform offers it (the DSH Web GUI runs
 * in current Chromium/Edge); the fallback stays deterministic enough to be a
 * unique key on any engine and keeps the id inside {@link CUSTOM_ID}.
 * @param now - injectable timestamp for tests.
 */
export function dshmlNewCustomIconId(now?: number): string {
  const stamp = typeof now === 'number' && Number.isFinite(now) ? Math.floor(now) : Date.now();
  try {
    const crypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (crypto !== undefined && typeof crypto.randomUUID === 'function') {
      const uuid = crypto.randomUUID();
      if (dshmlIsCustomIconId('c-' + uuid)) return 'c-' + uuid;
    }
  } catch {
    /* fall through to the timestamp id */
  }
  const random = Math.random().toString(36).slice(2, 10);
  return 'c-' + stamp.toString(36) + '-' + (random === '' ? '0' : random);
}

/** A pixel rectangle inside the source image (natural coordinates). */
export interface DshmlCropPixels {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Whether a value is a finite number. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Clamp the crop rectangle `react-easy-crop` reports (pixels in natural image
 * coordinates) into the source image, so a fractional/rounded area can never ask
 * `drawImage` for pixels outside the bitmap.
 * @param area - `{ x, y, width, height }` in natural pixels.
 * @param mediaWidth - image natural width.
 * @param mediaHeight - image natural height.
 * @returns the clamped source rectangle, or null when the input is unusable.
 */
export function dshmlCropRect(area: unknown, mediaWidth: unknown, mediaHeight: unknown): DshmlCropPixels | null {
  if (area === null || typeof area !== 'object') return null;
  const record = area as Record<string, unknown>;
  const x = finite(record.x);
  const y = finite(record.y);
  const width = finite(record.width);
  const height = finite(record.height);
  const mw = finite(mediaWidth);
  const mh = finite(mediaHeight);
  if (x === null || y === null || width === null || height === null || mw === null || mh === null) return null;
  if (mw <= 0 || mh <= 0 || width <= 0 || height <= 0 || x < 0 || y < 0) return null;
  const sx = Math.min(Math.max(0, Math.round(x)), Math.max(0, Math.floor(mw) - 1));
  const sy = Math.min(Math.max(0, Math.round(y)), Math.max(0, Math.floor(mh) - 1));
  const sw = Math.min(Math.max(1, Math.round(width)), Math.floor(mw) - sx);
  const sh = Math.min(Math.max(1, Math.round(height)), Math.floor(mh) - sy);
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}

/** One custom icon rendered as a mark: the stored name plus the SVG tile. */
export interface DshmlCustomMark {
  title: string;
  svg: string;
}

/**
 * Look one custom icon up in an already-parsed document and render it as a mark.
 * A missing id (a reference left behind by a hand-edited settings document)
 * resolves to null instead of a broken tile.
 * @param icons - validated custom-icon document.
 * @param value - `custom:<id>` override value or a bare id.
 */
export function dshmlCustomMarkFor(icons: CustomIconDocument, value: unknown): DshmlCustomMark | null {
  const id = dshmlCustomIconIdOf(value) ?? (typeof value === 'string' && value !== '' ? value : null);
  if (id === null || !Object.prototype.hasOwnProperty.call(icons, id)) return null;
  const icon = icons[id];
  return icon !== undefined ? { title: icon.name, svg: dshmlCustomMarkSvg(icon) } : null;
}

/**
 * The inline SVG tile a custom icon renders as: one 24×24 `<svg>` whose `<image>`
 * fills the viewBox with the cropped data URL, clipped to the shared rounded
 * corners. No ids, scripts, event handlers or external references; the data URL
 * is XML-escaped and the clip is a constant.
 * @param icon - stored custom icon (or any object carrying its `image`).
 */
export function dshmlCustomMarkSvg(icon: Pick<CustomIcon, 'image'> | null | undefined): string {
  const image = icon !== null && icon !== undefined && typeof icon.image === 'string' ? icon.image : '';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
    '<image href="' +
    escapeXml(image) +
    '" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid slice" style="' +
    DSHML_CUSTOM_TILE_CLIP +
    '"/>' +
    '</svg>'
  );
}
