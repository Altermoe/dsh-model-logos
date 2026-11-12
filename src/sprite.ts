/**
 * Sprite encoding for motion icons.
 *
 * The studio hands over a decoded source (one `drawFrame(ms)` call per sampled
 * time); this module renders the cropped frames, composes the horizontal atlas,
 * encodes WebP (PNG when the browser refuses the quality argument) and derives
 * the poster from the first frame. It also owns the fixed automatic-slimming
 * ladder — quality, then frame count, then frame edge — so the UI only has to
 * present the changes the ladder reports.
 *
 * Decoding is the expensive step, so one call renders each distinct frame count
 * once (and each frame once): the quality ladder re-encodes the same atlas canvas
 * and the size ladder re-composes from the same 128 px frames. Nothing here
 * touches the settings document: it returns data URLs and byte counts, and the
 * editor decides whether to store them.
 */
import { DSHML_CUSTOM_MAX_DATA_URL, DSHML_CUSTOM_MAX_POSTER, dshmlBudgetPlan, dshmlCropRect } from './custom-icons';
import type { DshmlBudgetVerdict, DshmlCropPixels } from './custom-icons';
import { DshmlMediaError } from './media-source';
import type { DshmlMediaSource } from './media-source';
import {
  DSHML_MOTION_DEFAULT_FRAME_WIDTH,
  DSHML_MOTION_DEFAULT_QUALITY,
  DSHML_MOTION_FRAME_PX_LADDER,
  DSHML_MOTION_MAX_RANGE_MS,
  DSHML_MOTION_QUALITY_LADDER,
  DSHML_MOTION_SLIM_QUALITY,
  dshmlEffectiveFps,
  dshmlSampleTimes,
} from './motion';
import type { DshmlMotionRange } from './motion';

/** One encoded motion payload, ready for `dshmlCreateCustomIcon`. */
export interface DshmlEncodedMotion {
  /** Horizontal sprite atlas data URL. */
  atlas: string;
  /** First-frame poster data URL. */
  poster: string;
  frames: number;
  /** Playback rate (frames / clip seconds), rounded to two decimals. */
  fps: number;
  frameWidth: number;
  /** WebP quality the winning atlas used (informational). */
  quality: number;
  atlasChars: number;
  posterChars: number;
  /** Adjacent samples that differ; equal frames are reported, never dropped. */
  distinctFrames: number;
  verdict: DshmlBudgetVerdict;
}

/** One stage of the automatic-slimming ladder. */
export interface DshmlSlimChange {
  kind: 'quality' | 'frames' | 'size';
  from: number;
  to: number;
}

/** Inputs of one encode / slimming run. */
export interface DshmlEncodeOptions {
  range: DshmlMotionRange;
  frames: number;
  frameWidth: number;
  quality: number;
  /** Crop rectangle in work-canvas pixels; null means the centred square. */
  crop: DshmlCropPixels | null;
}

/** Progress callback: frames rendered so far out of the current attempt. */
export type DshmlSampleProgress = (done: number, total: number) => void;

/** Atlas frames are rendered at this edge even when the atlas is smaller, so the
 * poster and the size ladder can reuse one decode per frame. */
const RENDER_PX = 128;

/** Poster encoding qualities, best first. */
const POSTER_QUALITIES: readonly number[] = Object.freeze([0.8, 0.7, 0.6, 0.5, 0.4]);

/** The crop box of one source, defaulting to the centred maximal square. */
export function dshmlMotionCrop(source: DshmlMediaSource, raw: DshmlCropPixels | null): DshmlCropPixels {
  const clamped = dshmlCropRect(raw, source.width, source.height);
  if (clamped !== null) return clamped;
  const side = Math.min(source.width, source.height);
  return {
    sx: Math.round((source.width - side) / 2),
    sy: Math.round((source.height - side) / 2),
    sw: side,
    sh: side,
  };
}

/** Cancel check that turns into the typed error the studio already localizes. */
function dshmlCheckCancel(isCancelled: (() => boolean) | undefined): void {
  if (isCancelled !== undefined && isCancelled()) throw new DshmlMediaError('cancelled');
}

/** One rendered frame sequence plus its distinct-frame count. */
interface DshmlFrameSet {
  frames: HTMLCanvasElement[];
  distinct: number;
}

/**
 * Render the requested sampling times as square frame canvases.
 *
 * Frames are always rendered at {@link RENDER_PX} so a later size-ladder step
 * (128 → 112 → 96) can reuse them without another decode.
 */
async function dshmlRenderFrames(
  source: DshmlMediaSource,
  times: readonly number[],
  crop: DshmlCropPixels,
  progress: DshmlSampleProgress | undefined,
  isCancelled: (() => boolean) | undefined,
): Promise<DshmlFrameSet> {
  const work = document.createElement('canvas');
  work.width = source.width;
  work.height = source.height;
  const frames: HTMLCanvasElement[] = [];
  for (let index = 0; index < times.length; index += 1) {
    dshmlCheckCancel(isCancelled);
    const time = times[index] ?? 0;
    await source.drawFrame(time, work);
    dshmlCheckCancel(isCancelled);
    const frame = document.createElement('canvas');
    frame.width = RENDER_PX;
    frame.height = RENDER_PX;
    const context = frame.getContext('2d');
    if (context === null) throw new DshmlMediaError('decode-failed', 'canvas unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(work, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, RENDER_PX, RENDER_PX);
    frames.push(frame);
    progress?.(index + 1, times.length);
  }
  if (frames.length === 0) throw new DshmlMediaError('no-frames');
  return { frames, distinct: dshmlDistinctFrames(frames) };
}

/** Compose one atlas strip, scaling each {@link RENDER_PX} frame to `frameWidth`. */
function dshmlComposeAtlas(frames: readonly HTMLCanvasElement[], frameWidth: number): HTMLCanvasElement {
  const atlas = document.createElement('canvas');
  atlas.width = frames.length * frameWidth;
  atlas.height = frameWidth;
  const context = atlas.getContext('2d');
  if (context === null) throw new DshmlMediaError('decode-failed', 'canvas unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, atlas.width, atlas.height);
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    context.drawImage(frame, index * frameWidth, 0, frameWidth, frameWidth);
  }
  return atlas;
}

/** Encode one canvas as WebP, falling back to PNG when the quality argument is ignored. */
function dshmlEncodeCanvas(canvas: HTMLCanvasElement, quality: number): { data: string; chars: number } {
  let data = canvas.toDataURL('image/webp', quality);
  if (!data.startsWith('data:image/webp;base64,')) data = canvas.toDataURL('image/png');
  return { data, chars: data.length };
}

/** Encode the poster, lowering WebP quality until it fits the 32 KiB cap. */
function dshmlEncodePoster(frame: HTMLCanvasElement): { data: string; chars: number; quality: number } {
  let best = dshmlEncodeCanvas(frame, POSTER_QUALITIES[0] ?? 0.8);
  let quality = POSTER_QUALITIES[0] ?? 0.8;
  if (best.chars <= DSHML_CUSTOM_MAX_POSTER) return { data: best.data, chars: best.chars, quality };
  for (const candidate of POSTER_QUALITIES.slice(1)) {
    const encoded = dshmlEncodeCanvas(frame, candidate);
    quality = candidate;
    best = encoded;
    if (encoded.chars <= DSHML_CUSTOM_MAX_POSTER) break;
  }
  return { data: best.data, chars: best.chars, quality };
}

/** Whether two rendered frames differ (a sampled frame may repeat a source one). */
function dshmlFramesDiffer(left: HTMLCanvasElement, right: HTMLCanvasElement): boolean {
  const leftContext = left.getContext('2d');
  const rightContext = right.getContext('2d');
  if (leftContext === null || rightContext === null) return true;
  const a = leftContext.getImageData(0, 0, left.width, left.height).data;
  const b = rightContext.getImageData(0, 0, right.width, right.height).data;
  if (a.length !== b.length) return true;
  // Sampling every 7th pixel (4 channels each) is enough to spot a duplicated
  // source frame without scanning 24 × 128² pixels on every debounce.
  for (let index = 0; index < a.length; index += 28) {
    if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2]) return true;
  }
  return false;
}

/** Count adjacent-render differences in one sampled sequence. */
function dshmlDistinctFrames(frames: readonly HTMLCanvasElement[]): number {
  if (frames.length === 0) return 0;
  let distinct = 1;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous !== undefined && current !== undefined && dshmlFramesDiffer(previous, current)) distinct += 1;
  }
  return distinct;
}

/** Validate studio inputs before touching the source. */
function dshmlCheckOptions(source: DshmlMediaSource, options: DshmlEncodeOptions): void {
  if (!Number.isFinite(source.durationMs) || source.durationMs <= 0) {
    throw new DshmlMediaError('decode-failed', 'empty source');
  }
  const range = options.range;
  if (
    !Number.isFinite(range.inMs) ||
    !Number.isFinite(range.outMs) ||
    range.outMs <= range.inMs ||
    range.outMs - range.inMs > DSHML_MOTION_MAX_RANGE_MS + 1
  ) {
    throw new DshmlMediaError('no-frames');
  }
  if (!Number.isInteger(options.frames) || options.frames < 2 || options.frames > 24) {
    throw new DshmlMediaError('no-frames');
  }
  if (!Number.isInteger(options.frameWidth) || options.frameWidth < 96 || options.frameWidth > 128) {
    throw new DshmlMediaError('no-frames');
  }
}

/** The shareable result of one encode attempt. */
interface DshmlEncodedAttempt {
  encoded: DshmlEncodedMotion;
  frames: DshmlFrameSet;
}

/** Render one frame sequence and encode it at one quality/frame edge. */
function dshmlEncodeAttempt(
  options: DshmlEncodeOptions,
  frames: DshmlFrameSet,
  poster: { data: string; chars: number; quality: number },
): DshmlEncodedAttempt {
  const atlas = dshmlComposeAtlas(frames.frames, options.frameWidth);
  const encodedAtlas = dshmlEncodeCanvas(atlas, options.quality);
  const verdict = dshmlBudgetPlan(encodedAtlas.chars, poster.chars);
  return {
    frames,
    encoded: {
      atlas: encodedAtlas.data,
      poster: poster.data,
      frames: options.frames,
      fps: dshmlEffectiveFps(options.range, options.frames),
      frameWidth: options.frameWidth,
      quality: options.quality,
      atlasChars: encodedAtlas.chars,
      posterChars: poster.chars,
      distinctFrames: frames.distinct,
      verdict,
    },
  };
}

/**
 * Sample and encode one motion icon at the requested settings.
 *
 * This is the normal path: the studio calls it for every debounced change and
 * only turns to {@link dshmlFitMotionBudget} when the user asks for slimming.
 * @param source - opened media source.
 * @param options - range, frame count, frame edge, quality and crop.
 * @param progress - optional frame-progress callback.
 * @param isCancelled - polled between frames; a superseded run aborts early.
 */
export async function dshmlEncodeMotionIcon(
  source: DshmlMediaSource,
  options: DshmlEncodeOptions,
  progress?: DshmlSampleProgress,
  isCancelled?: () => boolean,
): Promise<DshmlEncodedMotion> {
  dshmlCheckOptions(source, options);
  const times = dshmlSampleTimes(options.range, options.frames);
  if (times.length === 0) throw new DshmlMediaError('no-frames');
  const crop = dshmlMotionCrop(source, options.crop);
  const frames = await dshmlRenderFrames(source, times, crop, progress, isCancelled);
  const first = frames.frames[0];
  if (first === undefined) throw new DshmlMediaError('no-frames');
  return dshmlEncodeAttempt(options, frames, dshmlEncodePoster(first)).encoded;
}

/**
 * Walk the fixed slimming ladder until the payload fits:
 * quality → frame count (−2 down to 4) → frame edge (128 → 112 → 96).
 *
 * A stage that already produced a fitting result stops the ladder; when nothing
 * fits, the smallest attempt is returned with `verdict: 'over'` so the UI can
 * keep the save button disabled and explain why.
 * @param source - opened media source.
 * @param options - user's current settings.
 * @param progress - frame-progress callback.
 * @param isCancelled - polled between frames.
 */
export async function dshmlFitMotionBudget(
  source: DshmlMediaSource,
  options: DshmlEncodeOptions,
  progress?: DshmlSampleProgress,
  isCancelled?: () => boolean,
): Promise<{ encoded: DshmlEncodedMotion; changes: DshmlSlimChange[] }> {
  dshmlCheckOptions(source, options);
  const crop = dshmlMotionCrop(source, options.crop);
  const changes: DshmlSlimChange[] = [];
  const record = function record(kind: DshmlSlimChange['kind'], from: number, to: number): void {
    if (from !== to) changes.push({ kind, from, to });
  };
  const cache = new Map<number, DshmlFrameSet>();
  const getFrames = async function getFrames(count: number): Promise<DshmlFrameSet> {
    const cached = cache.get(count);
    if (cached !== undefined) return cached;
    const times = dshmlSampleTimes(options.range, count);
    if (times.length === 0) throw new DshmlMediaError('no-frames');
    const rendered = await dshmlRenderFrames(source, times, crop, progress, isCancelled);
    cache.set(count, rendered);
    return rendered;
  };
  const firstFrames = await getFrames(options.frames);
  const firstFrame = firstFrames.frames[0];
  if (firstFrame === undefined) throw new DshmlMediaError('no-frames');
  const poster = dshmlEncodePoster(firstFrame);

  // 1. Quality: re-encode the same atlas canvas.
  const qualityLadder = DSHML_MOTION_QUALITY_LADDER.includes(options.quality)
    ? DSHML_MOTION_QUALITY_LADDER.slice(DSHML_MOTION_QUALITY_LADDER.indexOf(options.quality))
    : [options.quality, ...DSHML_MOTION_QUALITY_LADDER];
  let last: DshmlEncodedAttempt | null = null;
  for (const quality of qualityLadder) {
    last = dshmlEncodeAttempt({ ...options, quality }, firstFrames, poster);
    if (last.encoded.verdict !== 'over') {
      record('quality', options.quality, quality);
      return { encoded: last.encoded, changes };
    }
  }
  record('quality', options.quality, DSHML_MOTION_SLIM_QUALITY);

  // 2. Frame count: each count needs its own sampled timeline.
  const currentWidth = Math.min(options.frameWidth, DSHML_MOTION_DEFAULT_FRAME_WIDTH);
  for (let frames = options.frames - 2; frames >= 4; frames -= 2) {
    const rendered = await getFrames(frames);
    last = dshmlEncodeAttempt(
      { ...options, frames, frameWidth: currentWidth, quality: DSHML_MOTION_SLIM_QUALITY },
      rendered,
      poster,
    );
    if (last.encoded.verdict !== 'over') {
      record('frames', options.frames, frames);
      return { encoded: last.encoded, changes };
    }
  }
  record('frames', options.frames, 4);

  // 3. Frame edge: reuse the 4-frame render, only re-compose at the smaller edge.
  const smallestFrames = await getFrames(4);
  for (const frameWidth of DSHML_MOTION_FRAME_PX_LADDER) {
    if (frameWidth >= currentWidth) continue;
    last = dshmlEncodeAttempt(
      { ...options, frames: 4, frameWidth, quality: DSHML_MOTION_SLIM_QUALITY },
      smallestFrames,
      poster,
    );
    if (last.encoded.verdict !== 'over') {
      record('size', currentWidth, frameWidth);
      return { encoded: last.encoded, changes };
    }
  }
  record('size', currentWidth, DSHML_MOTION_FRAME_PX_LADDER[DSHML_MOTION_FRAME_PX_LADDER.length - 1] ?? 96);
  if (last === null) {
    last = dshmlEncodeAttempt(
      { ...options, frames: 4, frameWidth: 96, quality: DSHML_MOTION_SLIM_QUALITY },
      smallestFrames,
      poster,
    );
  }
  return { encoded: last.encoded, changes };
}

/** The storage caps the studio's meter is allowed to mention. */
export const DSHML_SPRITE_ATLAS_LIMIT = DSHML_CUSTOM_MAX_DATA_URL;
export const DSHML_SPRITE_POSTER_LIMIT = DSHML_CUSTOM_MAX_POSTER;

/** Defaults the studio starts from when the user has not overridden them. */
export const DSHML_SPRITE_DEFAULT_OPTIONS: Pick<DshmlEncodeOptions, 'frameWidth' | 'quality'> = Object.freeze({
  frameWidth: DSHML_MOTION_DEFAULT_FRAME_WIDTH,
  quality: DSHML_MOTION_DEFAULT_QUALITY,
});
