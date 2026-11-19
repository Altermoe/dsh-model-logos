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
 * Sampling is split into four stages with one cache each, because the studio
 * re-samples on every debounced change and the stages cost wildly different
 * amounts:
 *
 *   decode  (source.drawFrame)  keyed by the source frame identity
 *   crop    (drawImage → 128px) keyed by the sampling window + crop rectangle
 *   compose (atlas strip)       keyed by the cropped frames + frame edge
 *   encode  (async WebP)        keyed by the atlas + quality
 *
 * Dragging the crop box therefore re-runs crop → compose → encode, never a
 * decode; changing the frame edge only re-composes; changing the quality only
 * re-encodes. Decoded frames live in a bounded LRU at
 * {@link DSHML_MOTION_DECODE_PX} (see that constant for the resolution trade),
 * the composed and encoded entries are small and capped in count.
 *
 * Nothing here touches the settings document: it returns data URLs and byte
 * counts, and the editor decides whether to store them.
 */
import {
  DSHML_CUSTOM_MAX_DATA_URL,
  DSHML_CUSTOM_MAX_POSTER,
  dshmlBudgetPlan,
  dshmlClampCropRect,
} from './custom-icons';
import type { DshmlBudgetVerdict, DshmlCropPixels } from './custom-icons';
import { dshmlEncodeCanvasDataUrl } from './canvas-encode';
import { DshmlMediaError } from './media-source';
import type { DshmlMediaSource } from './media-source';
import {
  DSHML_MOTION_DECODE_CACHE,
  DSHML_MOTION_DECODE_PX,
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

/** Composed atlases one cache keeps (a few frame counts × two frame edges). */
const ATLAS_CACHE_LIMIT = 6;

/** Encoded atlases one cache keeps (each is a data URL, so the count stays low). */
const ENCODE_CACHE_LIMIT = 8;

/** Cropped frame sets one cache keeps (the current window plus the ladder's). */
const CROP_CACHE_LIMIT = 8;

/** One rendered frame sequence plus its distinct-frame count. */
interface DshmlFrameSet {
  frames: HTMLCanvasElement[];
  distinct: number;
}

/** One encoded data URL and its character count. */
interface DshmlEncodedChunk {
  data: string;
  chars: number;
}

/** One encoded poster (the quality ladder remembers which step won). */
interface DshmlEncodedPoster extends DshmlEncodedChunk {
  quality: number;
}

/**
 * The sampling cache of one open source.
 *
 * The studio creates one per imported file and passes it to every encode and
 * slimming run, which is what keeps the crop interactive: the decoded frames,
 * the cropped 128 px frames, the composed atlases and the encoded data URLs all
 * survive the next call. A cache is only valid for the source it was created
 * for; {@link dshmlSampleCacheFor} enforces that.
 */
export interface DshmlSampleCache {
  /** The source the cached pixels belong to. */
  readonly source: DshmlMediaSource;
  /** Decoded source frames, keyed by {@link DshmlMediaSource.frameKeyAt}. */
  readonly decoded: Map<string, HTMLCanvasElement>;
  /** Cropped 128 px frames, keyed by sampling window + crop. */
  readonly cropped: Map<string, DshmlFrameSet>;
  /** Composed atlas canvases, keyed by cropped frames + frame edge. */
  readonly atlases: Map<string, HTMLCanvasElement>;
  /** Encoded atlases, keyed by atlas + quality. */
  readonly encoded: Map<string, DshmlEncodedChunk>;
  /** Encoded posters, keyed by the cropped frame set. */
  readonly posters: Map<string, DshmlEncodedPoster>;
}

/**
 * A fresh sampling cache for one source. The caller keeps it for the lifetime of
 * the imported file and drops it together with the source.
 * @param source - the opened media source.
 */
export function dshmlCreateSampleCache(source: DshmlMediaSource): DshmlSampleCache {
  return {
    source,
    decoded: new Map(),
    cropped: new Map(),
    atlases: new Map(),
    encoded: new Map(),
    posters: new Map(),
  };
}

/**
 * The cache to use for this source: the given one when it belongs to the same
 * source, a fresh one otherwise (and when none was given). The studio keeps one
 * cache per imported file, so a stale handle can never mix two clips.
 * @param source - the source about to be sampled.
 * @param cache - the studio's cache handle, when it has one.
 */
export function dshmlSampleCacheFor(source: DshmlMediaSource, cache?: DshmlSampleCache | null): DshmlSampleCache {
  if (cache !== undefined && cache !== null && cache.source === source) return cache;
  return dshmlCreateSampleCache(source);
}

/** Insert into a bounded map, evicting the oldest entry once it is full. */
function dshmlRemember<K, V>(map: Map<K, V>, key: K, value: V, limit: number): V {
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done === true) break;
    map.delete(oldest.value);
  }
  return value;
}

/** Read a map entry and mark it as the most recently used. */
function dshmlRecall<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}

/** The crop box of one source, defaulting to the centred maximal square. */
export function dshmlMotionCrop(source: DshmlMediaSource, raw: DshmlCropPixels | null): DshmlCropPixels {
  const clamped = dshmlClampCropRect(raw, source.width, source.height);
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

/** Size of the decoded-frame cache canvas: the work aspect, long edge ≤ cache px. */
function dshmlCacheSize(source: DshmlMediaSource): { width: number; height: number } {
  const longest = Math.max(1, Math.max(source.width, source.height));
  const scale = Math.min(1, DSHML_MOTION_DECODE_PX / longest);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/** Decode one source frame into the bounded cache (or reuse the cached canvas). */
async function dshmlDecodeFrame(
  cache: DshmlSampleCache,
  ms: number,
  isCancelled: (() => boolean) | undefined,
): Promise<HTMLCanvasElement> {
  const key = cache.source.frameKeyAt(ms);
  const cached = dshmlRecall(cache.decoded, key);
  if (cached !== undefined) return cached;
  dshmlCheckCancel(isCancelled);
  const size = dshmlCacheSize(cache.source);
  const frame = document.createElement('canvas');
  frame.width = size.width;
  frame.height = size.height;
  await cache.source.drawFrame(ms, frame);
  dshmlCheckCancel(isCancelled);
  return dshmlRemember(cache.decoded, key, frame, DSHML_MOTION_DECODE_CACHE);
}

/** Key of one cropped frame set: the sampling window plus the crop rectangle. */
function dshmlCropKey(range: DshmlMotionRange, count: number, crop: DshmlCropPixels): string {
  return range.inMs + ':' + range.outMs + ':' + count + '|' + crop.sx + ':' + crop.sy + ':' + crop.sw + ':' + crop.sh;
}

/**
 * Render the requested sampling times as square frame canvases.
 *
 * Frames are always rendered at {@link RENDER_PX} so a later size-ladder step
 * (128 → 112 → 96) can reuse them without another decode. The decode itself
 * comes from the shared cache, and only the crop rectangle is applied here — so
 * a new crop reuses every decoded frame of the same clip.
 */
async function dshmlRenderFrames(
  cache: DshmlSampleCache,
  times: readonly number[],
  crop: DshmlCropPixels,
  progress: DshmlSampleProgress | undefined,
  isCancelled: (() => boolean) | undefined,
): Promise<DshmlFrameSet> {
  const source = cache.source;
  const cacheSize = dshmlCacheSize(source);
  // The crop rectangle is in work-canvas pixels; the decoded frames may be
  // smaller, so the source rectangle is scaled into cache pixels.
  const scale = cacheSize.width / Math.max(1, source.width);
  const sx = crop.sx * scale;
  const sy = crop.sy * scale;
  const sw = Math.max(1, crop.sw * scale);
  const sh = Math.max(1, crop.sh * scale);
  const frames: HTMLCanvasElement[] = [];
  for (let index = 0; index < times.length; index += 1) {
    dshmlCheckCancel(isCancelled);
    const time = times[index] ?? 0;
    const decoded = await dshmlDecodeFrame(cache, time, isCancelled);
    dshmlCheckCancel(isCancelled);
    const frame = document.createElement('canvas');
    frame.width = RENDER_PX;
    frame.height = RENDER_PX;
    // D2: these 128 px frames are painted once and then only read by the
    // distinct-frame check. A CPU-backed context avoids a GPU→CPU readback for
    // every `getImageData` on a composited canvas.
    const context = frame.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new DshmlMediaError('decode-failed', 'canvas unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded, sx, sy, sw, sh, 0, 0, RENDER_PX, RENDER_PX);
    frames.push(frame);
    progress?.(index + 1, times.length);
  }
  if (frames.length === 0) throw new DshmlMediaError('no-frames');
  return { frames, distinct: dshmlDistinctFrames(frames) };
}

/** The cropped frame set of one sampling window, from the cache when possible. */
async function dshmlCroppedFrames(
  cache: DshmlSampleCache,
  options: DshmlEncodeOptions,
  crop: DshmlCropPixels,
  progress: DshmlSampleProgress | undefined,
  isCancelled: (() => boolean) | undefined,
): Promise<{ frames: DshmlFrameSet; key: string }> {
  const key = dshmlCropKey(options.range, options.frames, crop);
  const cached = dshmlRecall(cache.cropped, key);
  if (cached !== undefined) return { frames: cached, key };
  const times = dshmlSampleTimes(options.range, options.frames);
  if (times.length === 0) throw new DshmlMediaError('no-frames');
  const rendered = await dshmlRenderFrames(cache, times, crop, progress, isCancelled);
  dshmlRemember(cache.cropped, key, rendered, CROP_CACHE_LIMIT);
  return { frames: rendered, key };
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

/** The atlas of one frame set at one frame edge, from the cache when possible. */
function dshmlAtlasCanvas(
  cache: DshmlSampleCache,
  cropKey: string,
  frames: DshmlFrameSet,
  frameWidth: number,
): { atlas: HTMLCanvasElement; key: string } {
  const key = cropKey + '|' + frameWidth;
  const cached = dshmlRecall(cache.atlases, key);
  if (cached !== undefined) return { atlas: cached, key };
  const atlas = dshmlComposeAtlas(frames.frames, frameWidth);
  dshmlRemember(cache.atlases, key, atlas, ATLAS_CACHE_LIMIT);
  return { atlas, key };
}

/**
 * The encoded atlas of one canvas at one quality, from the cache when possible.
 *
 * The encode itself is asynchronous (worker / `toBlob`, see
 * `src/canvas-encode.ts`): the composed atlas and the encoded cache entry are
 * separate, so a quality-only change still re-encodes without recomposing.
 */
async function dshmlEncodedAtlas(
  cache: DshmlSampleCache,
  atlasKey: string,
  atlas: HTMLCanvasElement,
  quality: number,
): Promise<DshmlEncodedChunk> {
  const key = atlasKey + '|' + quality;
  const cached = dshmlRecall(cache.encoded, key);
  if (cached !== undefined) return cached;
  const encoded = await dshmlEncodeCanvasDataUrl(atlas, quality);
  return dshmlRemember(cache.encoded, key, encoded, ENCODE_CACHE_LIMIT);
}

/** Encode the poster, lowering WebP quality until it fits the 32 KiB cap. */
async function dshmlEncodePoster(frame: HTMLCanvasElement): Promise<DshmlEncodedPoster> {
  let best = await dshmlEncodeCanvasDataUrl(frame, POSTER_QUALITIES[0] ?? 0.8);
  let quality = POSTER_QUALITIES[0] ?? 0.8;
  if (best.chars <= DSHML_CUSTOM_MAX_POSTER) return { ...best, quality };
  for (const candidate of POSTER_QUALITIES.slice(1)) {
    const encoded = await dshmlEncodeCanvasDataUrl(frame, candidate);
    quality = candidate;
    best = encoded;
    if (encoded.chars <= DSHML_CUSTOM_MAX_POSTER) break;
  }
  return { ...best, quality };
}

/** The poster of one cropped frame set, from the cache when possible. */
async function dshmlPoster(
  cache: DshmlSampleCache,
  cropKey: string,
  frames: DshmlFrameSet,
): Promise<DshmlEncodedPoster> {
  const cached = dshmlRecall(cache.posters, cropKey);
  if (cached !== undefined) return cached;
  const first = frames.frames[0];
  if (first === undefined) throw new DshmlMediaError('no-frames');
  const encoded = await dshmlEncodePoster(first);
  return dshmlRemember(cache.posters, cropKey, encoded, CROP_CACHE_LIMIT);
}

/** Whether two same-length pixel buffers describe different frames. */
function dshmlPixelsDiffer(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
  if (left.length !== right.length) return true;
  // Sampling every 7th pixel (4 channels each) is enough to spot a duplicated
  // source frame without scanning 24 × 128² pixels on every debounce.
  for (let index = 0; index < left.length; index += 28) {
    if (left[index] !== right[index] || left[index + 1] !== right[index + 1] || left[index + 2] !== right[index + 2]) {
      return true;
    }
  }
  return false;
}

/** One frame's pixels, or null when the canvas has no 2D context. */
function dshmlFramePixels(frame: HTMLCanvasElement): Uint8ClampedArray | null {
  const context = frame.getContext('2d');
  if (context === null) return null;
  return context.getImageData(0, 0, frame.width, frame.height).data;
}

/**
 * Count adjacent-render differences in one sampled sequence.
 *
 * D1: the previous pairwise walk read both sides of every pair — 46
 * `getImageData` calls and 46 × 64 KB allocations for 24 frames. Walking in one
 * direction keeps the previous frame's pixels and reads each frame once (24
 * reads, ~1.5 MB), which is half the readback cost on a GPU-composited canvas.
 * The sampled pixel stride (every 7th pixel) and the result are unchanged.
 */
function dshmlDistinctFrames(frames: readonly HTMLCanvasElement[]): number {
  if (frames.length === 0) return 0;
  const first = frames[0];
  if (first === undefined) return 0;
  let previous = dshmlFramePixels(first);
  let distinct = 1;
  for (let index = 1; index < frames.length; index += 1) {
    const current = frames[index];
    if (current === undefined) continue;
    const pixels = dshmlFramePixels(current);
    // A canvas without a context cannot be compared: treat it as different, which
    // is what the pairwise implementation did.
    if (previous === null || pixels === null) distinct += 1;
    else if (dshmlPixelsDiffer(previous, pixels)) distinct += 1;
    previous = pixels;
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

/** Encode one already-cropped frame set at one quality/frame edge. */
async function dshmlEncodeAttempt(
  cache: DshmlSampleCache,
  options: DshmlEncodeOptions,
  frames: DshmlFrameSet,
  cropKey: string,
): Promise<DshmlEncodedMotion> {
  const { atlas, key } = dshmlAtlasCanvas(cache, cropKey, frames, options.frameWidth);
  const encodedAtlas = await dshmlEncodedAtlas(cache, key, atlas, options.quality);
  const poster = await dshmlPoster(cache, cropKey, frames);
  return {
    atlas: encodedAtlas.data,
    poster: poster.data,
    frames: options.frames,
    fps: dshmlEffectiveFps(options.range, options.frames),
    frameWidth: options.frameWidth,
    quality: options.quality,
    atlasChars: encodedAtlas.chars,
    posterChars: poster.chars,
    distinctFrames: frames.distinct,
    verdict: dshmlBudgetPlan(encodedAtlas.chars, poster.chars),
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
 * @param cache - the studio's sampling cache for this source (decodes are reused).
 */
export async function dshmlEncodeMotionIcon(
  source: DshmlMediaSource,
  options: DshmlEncodeOptions,
  progress?: DshmlSampleProgress,
  isCancelled?: () => boolean,
  cache?: DshmlSampleCache | null,
): Promise<DshmlEncodedMotion> {
  dshmlCheckOptions(source, options);
  const store = dshmlSampleCacheFor(source, cache);
  const crop = dshmlMotionCrop(source, options.crop);
  const { frames, key } = await dshmlCroppedFrames(store, options, crop, progress, isCancelled);
  return await dshmlEncodeAttempt(store, options, frames, key);
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
 * @param cache - the studio's sampling cache for this source.
 */
export async function dshmlFitMotionBudget(
  source: DshmlMediaSource,
  options: DshmlEncodeOptions,
  progress?: DshmlSampleProgress,
  isCancelled?: () => boolean,
  cache?: DshmlSampleCache | null,
): Promise<{ encoded: DshmlEncodedMotion; changes: DshmlSlimChange[] }> {
  dshmlCheckOptions(source, options);
  const store = dshmlSampleCacheFor(source, cache);
  const crop = dshmlMotionCrop(source, options.crop);
  const changes: DshmlSlimChange[] = [];
  const record = function record(kind: DshmlSlimChange['kind'], from: number, to: number): void {
    if (from !== to) changes.push({ kind, from, to });
  };
  // Each count needs its own sampled timeline; the crop cache hands back the
  // frame set it already produced, so a repeated count never re-renders.
  const getFrames = async function getFrames(count: number): Promise<{ frames: DshmlFrameSet; key: string }> {
    return dshmlCroppedFrames(store, { ...options, frames: count }, crop, progress, isCancelled);
  };
  const first = await getFrames(options.frames);

  // 1. Quality: re-encode the same atlas canvas.
  const qualityLadder = DSHML_MOTION_QUALITY_LADDER.includes(options.quality)
    ? DSHML_MOTION_QUALITY_LADDER.slice(DSHML_MOTION_QUALITY_LADDER.indexOf(options.quality))
    : [options.quality, ...DSHML_MOTION_QUALITY_LADDER];
  let last: DshmlEncodedMotion | null = null;
  for (const quality of qualityLadder) {
    last = await dshmlEncodeAttempt(store, { ...options, quality }, first.frames, first.key);
    if (last.verdict !== 'over') {
      record('quality', options.quality, quality);
      return { encoded: last, changes };
    }
  }
  record('quality', options.quality, DSHML_MOTION_SLIM_QUALITY);

  // 2. Frame count: each count needs its own sampled timeline.
  const currentWidth = Math.min(options.frameWidth, DSHML_MOTION_DEFAULT_FRAME_WIDTH);
  for (let frames = options.frames - 2; frames >= 4; frames -= 2) {
    const rendered = await getFrames(frames);
    last = await dshmlEncodeAttempt(
      store,
      { ...options, frames, frameWidth: currentWidth, quality: DSHML_MOTION_SLIM_QUALITY },
      rendered.frames,
      rendered.key,
    );
    if (last.verdict !== 'over') {
      record('frames', options.frames, frames);
      return { encoded: last, changes };
    }
  }
  record('frames', options.frames, 4);

  // 3. Frame edge: reuse the 4-frame render, only re-compose at the smaller edge.
  const smallest = await getFrames(4);
  for (const frameWidth of DSHML_MOTION_FRAME_PX_LADDER) {
    if (frameWidth >= currentWidth) continue;
    last = await dshmlEncodeAttempt(
      store,
      { ...options, frames: 4, frameWidth, quality: DSHML_MOTION_SLIM_QUALITY },
      smallest.frames,
      smallest.key,
    );
    if (last.verdict !== 'over') {
      record('size', currentWidth, frameWidth);
      return { encoded: last, changes };
    }
  }
  record('size', currentWidth, DSHML_MOTION_FRAME_PX_LADDER[DSHML_MOTION_FRAME_PX_LADDER.length - 1] ?? 96);
  if (last === null) {
    last = await dshmlEncodeAttempt(
      store,
      { ...options, frames: 4, frameWidth: 96, quality: DSHML_MOTION_SLIM_QUALITY },
      smallest.frames,
      smallest.key,
    );
  }
  return { encoded: last, changes };
}

/** The storage caps the studio's meter is allowed to mention. */
export const DSHML_SPRITE_ATLAS_LIMIT = DSHML_CUSTOM_MAX_DATA_URL;
export const DSHML_SPRITE_POSTER_LIMIT = DSHML_CUSTOM_MAX_POSTER;

/** Defaults the studio starts from when the user has not overridden them. */
export const DSHML_SPRITE_DEFAULT_OPTIONS: Pick<DshmlEncodeOptions, 'frameWidth' | 'quality'> = Object.freeze({
  frameWidth: DSHML_MOTION_DEFAULT_FRAME_WIDTH,
  quality: DSHML_MOTION_DEFAULT_QUALITY,
});
