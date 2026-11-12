/**
 * Motion-icon domain: sampling maths, sprite geometry, playback policy and the
 * self-contained SVG that plays a sprite atlas through SMIL.
 *
 * This module is pure (no DOM, no side effects) so the parts that decide *what*
 * is stored and *how it moves* are unit-tested without a browser. The browser
 * half lives in `src/media-source.ts` (decode a frame at a time) and
 * `src/sprite.ts` (sample + encode the atlas).
 *
 * Storage shape (see `src/types.ts`): a custom icon keeps its cropped poster in
 * `image` and adds an optional `motion` record. The atlas is one horizontal strip
 * — `frames × frameWidth` wide, `frameWidth` high — so the geometry is implied
 * by the two numbers and can never contradict the pixels. Playback is a single
 * `x` displacement on the `<image>` with `calcMode="discrete"`: one step per
 * `1 / fps` seconds, no ids, no scripts and no external references.
 */
import { escapeXml } from './artwork';
import type { CustomIcon, CustomIconMotion, DshmlPlayback, DshmlPlaybackMode, DshmlPlaybackSurface } from './types';

/** Smallest frame count a stored `motion` record may declare. */
export const DSHML_MOTION_MIN_FRAMES = 2;

/** Largest frame count a stored `motion` record may declare. */
export const DSHML_MOTION_MAX_FRAMES = 24;

/** Smallest frame count the sampling studio offers (fewer reads as a slideshow). */
export const DSHML_MOTION_SAMPLE_MIN_FRAMES = 4;

/** Default square edge of one atlas frame (the stored sampling budget). */
export const DSHML_MOTION_DEFAULT_FRAME_WIDTH = 128;

/** Smallest frame edge a stored `motion` record may declare. */
export const DSHML_MOTION_MIN_FRAME_WIDTH = 96;

/** Largest frame edge a stored `motion` record may declare (forward compatibility). */
export const DSHML_MOTION_MAX_FRAME_WIDTH = 256;

/** Upper bound on `frames × frameWidth`, keeping the atlas a sane bitmap. */
export const DSHML_MOTION_MAX_ATLAS_WIDTH = 4096;

/** Longest clip the studio samples, in milliseconds. */
export const DSHML_MOTION_MAX_RANGE_MS = 2000;

/** Shortest clip the studio samples, in milliseconds. */
export const DSHML_MOTION_MIN_RANGE_MS = 120;

/** Highest useful sampled rate at 128 px: beyond this the extra frames are noise. */
export const DSHML_MOTION_MAX_SAMPLE_FPS = 15;

/** Frame-rate heuristic used to pick the initial frame count for a range. */
export const DSHML_MOTION_INITIAL_FPS = 12;

/** Slowest playback rate a stored `motion` record may declare. */
export const DSHML_MOTION_MIN_PLAYBACK_FPS = 0.5;

/** Fastest playback rate a stored `motion` record may declare. */
export const DSHML_MOTION_MAX_PLAYBACK_FPS = 30;

/** Largest animated-image source the studio reads (browser memory bound). */
export const DSHML_MOTION_MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** Largest video source the studio reads. */
export const DSHML_MOTION_MAX_VIDEO_BYTES = 64 * 1024 * 1024;

/** Longest animated-image frame sequence decoded (guards a pathological GIF). */
export const DSHML_MOTION_MAX_SOURCE_FRAMES = 1200;

/** Longest edge of the work canvas every source is decoded into. */
export const DSHML_MOTION_WORK_PX = 1024;

/** Recording the source frame timestamps gives up after this long. */
export const DSHML_MOTION_MAX_DECODE_MS = 15_000;

/** Upper bound on one encoded atlas data URL, mirroring the host schema. */
export const DSHML_MOTION_MAX_ATLAS_CHARS = 128 * 1024;

/** Quality ladder the automatic slimming walks, best first. */
export const DSHML_MOTION_QUALITY_LADDER: readonly number[] = Object.freeze([0.92, 0.82, 0.72, 0.62, 0.52]);

/** Frame-edge ladder the automatic slimming walks after the frame count. */
export const DSHML_MOTION_FRAME_PX_LADDER: readonly number[] = Object.freeze([128, 112, 96]);

/** Quality used for the first encode and for the frame/size ladder stages. */
export const DSHML_MOTION_DEFAULT_QUALITY = 0.92;

/** Quality used once the slimming stage changes the frame count or the frame edge. */
export const DSHML_MOTION_SLIM_QUALITY = 0.72;

/** Poster quality before any size correction. */
export const DSHML_MOTION_POSTER_QUALITY = 0.8;

/** Playback surfaces, in the order the Settings group lists them. */
export const DSHML_PLAYBACK_SURFACES: readonly DshmlPlaybackSurface[] = Object.freeze([
  'composer',
  'settings',
  'iconsPage',
  'picker',
]);

/** Default policy per surface: the composer animates, every list waits for interaction. */
export const DSHML_PLAYBACK_DEFAULTS: Readonly<DshmlPlayback> = Object.freeze({
  composer: 'always',
  settings: 'hover',
  iconsPage: 'hover',
  picker: 'hover',
});

/** A half-open sampling range, in milliseconds. */
export interface DshmlMotionRange {
  inMs: number;
  outMs: number;
}

/** Whether a value is one of the three playback modes. */
export function dshmlIsPlaybackMode(value: unknown): value is DshmlPlaybackMode {
  return value === 'always' || value === 'hover' || value === 'never';
}

/**
 * Normalize a persisted `playback` object, one surface at a time: an unknown or
 * missing value keeps that surface's default instead of disabling playback.
 * @param raw - value read from the settings document (host-shaped, so unknown).
 */
export function dshmlPlaybackOf(raw: unknown): DshmlPlayback {
  const out: DshmlPlayback = { ...DSHML_PLAYBACK_DEFAULTS };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const surface of DSHML_PLAYBACK_SURFACES) {
    const mode = record[surface];
    if (dshmlIsPlaybackMode(mode)) out[surface] = mode;
  }
  return out;
}

/**
 * The playback mode of one surface inside a persisted value.
 * @param raw - persisted `playback` value.
 * @param surface - surface to read.
 */
export function dshmlPlaybackModeOf(raw: unknown, surface: DshmlPlaybackSurface): DshmlPlaybackMode {
  return dshmlPlaybackOf(raw)[surface];
}

/** Whether the atlas `frames × frameWidth` fits the declared storage geometry. */
export function dshmlSpriteLayoutFits(frames: unknown, frameWidth: unknown): boolean {
  return (
    typeof frames === 'number' &&
    Number.isInteger(frames) &&
    frames >= DSHML_MOTION_MIN_FRAMES &&
    frames <= DSHML_MOTION_MAX_FRAMES &&
    typeof frameWidth === 'number' &&
    Number.isInteger(frameWidth) &&
    frameWidth >= DSHML_MOTION_MIN_FRAME_WIDTH &&
    frameWidth <= DSHML_MOTION_MAX_FRAME_WIDTH &&
    frames * frameWidth <= DSHML_MOTION_MAX_ATLAS_WIDTH
  );
}

/**
 * Pixel geometry of one atlas strip.
 * @param frames - sampled frame count.
 * @param frameWidth - square edge of one frame.
 */
export function dshmlSpriteLayout(frames: number, frameWidth: number): { width: number; height: number } {
  return { width: frames * frameWidth, height: frameWidth };
}

/** An atlas is stored only as a PNG / WebP base64 data URL. */
const MOTION_ATLAS = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;

/**
 * Validate one persisted `motion` record.
 *
 * Every invalid field drops the whole record (the caller then renders the
 * poster), which is the compatibility promise of the storage shape: a hand-edited
 * or corrupted atlas can never make the icon disappear.
 * @param raw - value read from the settings document.
 * @returns the normalized record, or null when it is not usable.
 */
export function dshmlNormalizeMotion(raw: unknown): CustomIconMotion | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const atlas = record['atlas'];
  const frames = record['frames'];
  const fps = record['fps'];
  const frameWidth = record['frameWidth'];
  if (typeof atlas !== 'string' || atlas.length > DSHML_MOTION_MAX_ATLAS_CHARS || !MOTION_ATLAS.test(atlas)) {
    return null;
  }
  if (!dshmlSpriteLayoutFits(frames, frameWidth)) return null;
  if (
    typeof fps !== 'number' ||
    !Number.isFinite(fps) ||
    fps < DSHML_MOTION_MIN_PLAYBACK_FPS ||
    fps > DSHML_MOTION_MAX_PLAYBACK_FPS
  ) {
    return null;
  }
  return {
    atlas,
    frames: frames as number,
    fps: Math.round(fps * 100) / 100,
    frameWidth: frameWidth as number,
  };
}

/** The valid motion record of one icon, or null. */
export function dshmlMotionOf(icon: Pick<CustomIcon, 'motion'> | null | undefined): CustomIconMotion | null {
  return icon !== null && icon !== undefined ? dshmlNormalizeMotion(icon.motion) : null;
}

/**
 * The sampled timestamps of one range, left-closed/right-open:
 * `t_i = in + i × (out − in) / count`, `i = 0 … count − 1`.
 *
 * Excluding the right endpoint keeps a looping icon from showing its first frame
 * twice in a row (the source frame at the out point is usually the one just
 * before the loop restart).
 * @param range - sampling range in milliseconds.
 * @param count - number of frames (clamped to a positive integer).
 */
export function dshmlSampleTimes(range: DshmlMotionRange, count: number): number[] {
  const inMs = range.inMs;
  const outMs = range.outMs;
  const frames = Math.floor(count);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs || frames < 1) return [];
  const span = outMs - inMs;
  const out: number[] = [];
  for (let index = 0; index < frames; index += 1) out.push(inMs + (index * span) / frames);
  return out;
}

/**
 * Effective frame rate of one sampling window: `frames / seconds`, clamped to
 * the playback range and rounded to two decimals for storage.
 * @param range - sampling range in milliseconds.
 * @param count - number of frames.
 */
export function dshmlEffectiveFps(range: DshmlMotionRange, count: number): number {
  const frames = Math.floor(count);
  const span = (range.outMs - range.inMs) / 1000;
  if (!Number.isFinite(span) || span <= 0 || frames < 1) return DSHML_MOTION_MIN_PLAYBACK_FPS;
  const fps = frames / span;
  const clamped = Math.min(DSHML_MOTION_MAX_PLAYBACK_FPS, Math.max(DSHML_MOTION_MIN_PLAYBACK_FPS, fps));
  return Math.round(clamped * 100) / 100;
}

/**
 * Initial frame count for one range: 12 fps, bounded to 4–24 (and never more
 * than the range can justify).
 * @param range - sampling range in milliseconds.
 */
export function dshmlInitialFrameCount(range: DshmlMotionRange): number {
  const seconds = (range.outMs - range.inMs) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return DSHML_MOTION_SAMPLE_MIN_FRAMES;
  const frames = Math.round(seconds * DSHML_MOTION_INITIAL_FPS);
  return Math.min(DSHML_MOTION_MAX_FRAMES, Math.max(DSHML_MOTION_SAMPLE_MIN_FRAMES, frames));
}

/**
 * Clamp one sampling range to the studio budget.
 *
 * `out` may not move further than {@link DSHML_MOTION_MAX_RANGE_MS} past `in`,
 * and the two ends always stay at least {@link DSHML_MOTION_MIN_RANGE_MS} apart.
 * The source duration caps both.
 * @param inMs - proposed in point.
 * @param outMs - proposed out point.
 * @param durationMs - source duration.
 */
export function dshmlClampRange(inMs: number, outMs: number, durationMs: number): DshmlMotionRange {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : DSHML_MOTION_MAX_RANGE_MS;
  const span = Math.min(duration, DSHML_MOTION_MAX_RANGE_MS);
  let start = Math.min(Math.max(0, Number.isFinite(inMs) ? inMs : 0), duration);
  let end = Number.isFinite(outMs) ? outMs : span;
  if (end - start < DSHML_MOTION_MIN_RANGE_MS) end = start + DSHML_MOTION_MIN_RANGE_MS;
  if (end - start > span) {
    end = start + span;
    if (end > duration) {
      end = duration;
      start = Math.max(0, end - span);
    }
  }
  if (start < 0) start = 0;
  if (end > duration) end = duration;
  if (end - start < DSHML_MOTION_MIN_RANGE_MS) {
    end = Math.min(duration, start + DSHML_MOTION_MIN_RANGE_MS);
    if (end - start < DSHML_MOTION_MIN_RANGE_MS) start = Math.max(0, end - DSHML_MOTION_MIN_RANGE_MS);
  }
  return { inMs: Math.round(start), outMs: Math.round(end) };
}

/** Seconds formatted for SMIL (`2s`, `1.75s`, `0.833s`). */
function dshmlDurationText(seconds: number): string {
  const rounded = Math.round(seconds * 1000) / 1000;
  return String(rounded).replace(/\.0+$/u, '') + 's';
}

/**
 * The playing SVG of one motion icon.
 *
 * One 24×24 `<svg>` clipped to the shared 6/24 rounded tile holds a nested square
 * viewport; the nested viewport holds a single `<image>` whose `x` attribute is
 * animated through the frames with `calcMode="discrete"`. The strip is
 * `24 × frames` wide inside the 24-unit canvas. No ids, scripts, event handlers
 * or external references — two icons can coexist without name collisions.
 *
 * The rounded clip sits on the **root** element on purpose. A percentage radius
 * on `clip-path` resolves against the clipped element's reference box: the
 * nested viewport's box is its content (`frames × 24` units wide), so
 * `round 25%` there becomes a capsule as wide as the whole atlas and visibly
 * shears every frame near the strip ends. The root `<svg>` is a CSS box whose
 * border box is the square mark, so 25% stays the 6/24 tile radius.
 * @param icon - stored icon carrying a `motion` record.
 * @returns the playing SVG, or `''` when the record is missing/invalid.
 */
export function dshmlAtlasSvg(icon: Pick<CustomIcon, 'motion'> | null | undefined): string {
  const motion = dshmlMotionOf(icon);
  if (motion === null) return '';
  const values: string[] = [];
  for (let index = 0; index < motion.frames; index += 1) values.push(String(-24 * index));
  const dur = dshmlDurationText(motion.frames / motion.fps);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" style="clip-path: inset(0 round 25%)">' +
    '<svg x="0" y="0" width="24" height="24" overflow="hidden">' +
    '<image href="' +
    escapeXml(motion.atlas) +
    '" x="0" y="0" width="' +
    24 * motion.frames +
    '" height="24" preserveAspectRatio="none">' +
    '<animate attributeName="x" values="' +
    values.join(';') +
    '" dur="' +
    dur +
    '" calcMode="discrete" repeatCount="indefinite"/>' +
    '</image>' +
    '</svg>' +
    '</svg>'
  );
}

/** The markup data the playback decision reads (structurally ModelMark / VendorMark). */
export interface DshmlPlayableMarkSource {
  svg: string | null;
  animatedSvg?: string | null;
}

/**
 * The markup one mark shows for one playback state.
 *
 * The decision tree every surface shares: draw the poster when the icon has no
 * atlas, when the policy is `never`, when the surface waits for interaction that
 * has not happened yet, or when the system asked for reduced motion. Otherwise
 * draw the playing atlas.
 * @param mark - poster + optional playing markup.
 * @param mode - the surface policy.
 * @param active - pointer is over / focus is inside the mark (only for `hover`).
 * @param reduced - the system requested reduced motion.
 */
export function dshmlPlayableMarkHtml(
  mark: DshmlPlayableMarkSource | null,
  mode: DshmlPlaybackMode,
  active: boolean,
  reduced: boolean,
): string {
  if (mark === null) return '';
  const animated = typeof mark.animatedSvg === 'string' ? mark.animatedSvg : '';
  const poster = typeof mark.svg === 'string' ? mark.svg : '';
  if (animated === '' || reduced || mode === 'never') return poster;
  if (mode === 'always' || (mode === 'hover' && active)) return animated;
  return poster;
}
