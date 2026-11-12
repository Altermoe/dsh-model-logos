/**
 * Frame access for the motion sampling studio.
 *
 * Animated images and videos are opened through one interface — a work-resolution
 * `drawFrame(ms)` plus a duration and a preview URL — so the studio, the sampler
 * and the sprite encoder never branch on the source format. Two browser-only
 * paths sit behind it:
 *
 *  - animated images use `ImageDecoder` (WebCodecs). The decoder is probed for
 *    `frameCount`, every frame timestamp is recorded once, and frames are decoded
 *    on demand at the timestamp nearest the requested time;
 *  - videos use a detached muted `<video>` (blob URL) and seek to each sample.
 *
 * Nothing here is stored: the original file is read once, the work canvas is
 * capped at {@link DSHML_MOTION_WORK_PX} on its long edge (so a 4K video never
 * decodes at full size), and the object URL dies with {@link DshmlMediaSource.dispose}.
 */
import {
  DSHML_MOTION_MAX_IMAGE_BYTES,
  DSHML_MOTION_MAX_SOURCE_FRAMES,
  DSHML_MOTION_MAX_VIDEO_BYTES,
  DSHML_MOTION_WORK_PX,
} from './motion';

/** Why a media file could not be opened. */
export type DshmlMediaErrorCode =
  | 'unsupported-type'
  | 'too-large'
  | 'decode-unavailable'
  | 'decode-failed'
  | 'single-frame'
  | 'no-frames'
  | 'too-long'
  | 'cancelled';

/** Typed failure the studio turns into one actionable line of copy. */
export class DshmlMediaError extends Error {
  readonly code: DshmlMediaErrorCode;

  constructor(code: DshmlMediaErrorCode, detail?: string) {
    super(detail === undefined ? code : code + ': ' + detail);
    this.name = 'DshmlMediaError';
    this.code = code;
  }
}

/** One opened source, in work-canvas coordinates. */
export interface DshmlMediaSource {
  kind: 'animated' | 'video';
  /** Full source duration in milliseconds. */
  durationMs: number;
  /** Work-canvas width (≤ {@link DSHML_MOTION_WORK_PX}). */
  width: number;
  /** Work-canvas height. */
  height: number;
  /** Animated images only; videos report null. */
  frameCount: number | null;
  /** Blob URL of the original file, for the "original" monitor. */
  previewUrl: string;
  /** Draw the frame at `ms` into a target canvas of `width × height`. */
  drawFrame(ms: number, target: HTMLCanvasElement): Promise<void>;
  /** Release the decoder / video element and revoke the object URL. */
  dispose(): void;
}

/** What `dshmlOpenMediaSource` decides from a File. */
export type DshmlMediaKind = 'animated' | 'video';

/** Accept list for the dynamic file input. */
export const DSHML_MEDIA_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,image/apng,video/mp4,video/webm';

/** Image formats that may carry animation (PNG is APNG when it has frames). */
const ANIMATED_IMAGE_TYPES = new Set([
  'image/png',
  'image/apng',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/jpeg',
]);

/** Video formats the studio offers; other video codecs may still decode. */
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']);

/** Extension fallback for a File whose type the browser left empty. */
const EXTENSION_TYPES: Readonly<Record<string, string>> = Object.freeze({
  png: 'image/png',
  apng: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
});

/** The media type of a File (declared type first, extension second). */
export function dshmlMediaTypeOf(file: File): string {
  const raw = typeof file.type === 'string' ? file.type.split(';')[0] : '';
  const declared = raw !== undefined ? raw.trim().toLowerCase() : '';
  if (declared !== '') return declared;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1) : '';
  return EXTENSION_TYPES[extension] ?? '';
}

/**
 * Classify a File as an animated-image or video source, or null when the type is
 * not one the studio reads.
 * @param file - picked/dropped/pasted file.
 */
export function dshmlMediaKindOf(file: File): DshmlMediaKind | null {
  const type = dshmlMediaTypeOf(file);
  if (type.startsWith('video/')) return VIDEO_TYPES.has(type) ? 'video' : null;
  if (type.startsWith('image/')) return ANIMATED_IMAGE_TYPES.has(type) ? 'animated' : null;
  return null;
}

/** Map any thrown value to a media error code, or null for a foreign error. */
export function dshmlMediaErrorCode(error: unknown): DshmlMediaErrorCode | null {
  return error instanceof DshmlMediaError ? error.code : null;
}

/** One decoded image frame as much of the WebCodecs shape as we use. */
interface DshmlDecodedFrame {
  close(): void;
  timestamp: number;
  displayWidth: number;
  displayHeight: number;
}

/** `ImageDecoder`'s track shape (not in the TypeScript DOM lib yet). */
interface DshmlDecoderTrack {
  frameCount?: number;
  animated?: boolean;
}

/** `ImageDecoder`'s constructor shape. */
interface DshmlImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack?: DshmlDecoderTrack | null };
  decode(options: { frameIndex: number }): Promise<{ image: DshmlDecodedFrame }>;
  close(): void;
}

/** The global `ImageDecoder` constructor when the browser has it. */
type DshmlImageDecoderCtor = new (init: { data: ArrayBuffer; type: string }) => DshmlImageDecoderLike;

/** Read the browser's `ImageDecoder`, or null on a platform without WebCodecs. */
function dshmlImageDecoder(): DshmlImageDecoderCtor | null {
  try {
    const ctor = (globalThis as { ImageDecoder?: unknown }).ImageDecoder;
    return typeof ctor === 'function' ? (ctor as DshmlImageDecoderCtor) : null;
  } catch {
    return null;
  }
}

/** Scale source dimensions into the work canvas (long edge ≤ WORK_PX). */
function dshmlWorkSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const scale = Math.min(1, DSHML_MOTION_WORK_PX / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The source frame whose timestamp is nearest but not after `ms`. */
function dshmlNearestFrame(timestamps: readonly number[], ms: number): number {
  if (timestamps.length === 0) return 0;
  const target = ms * 1000;
  let low = 0;
  let high = timestamps.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const stamp = timestamps[middle] ?? 0;
    if (stamp <= target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Draw one decoded frame into a work canvas and close it immediately. */
function dshmlPaintFrame(frame: DshmlDecodedFrame, target: HTMLCanvasElement, width: number, height: number): void {
  try {
    const context = target.getContext('2d');
    if (context === null) throw new DshmlMediaError('decode-failed', 'canvas unavailable');
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(frame as unknown as CanvasImageSource, 0, 0, width, height);
  } finally {
    frame.close();
  }
}

/**
 * Open an animated image through `ImageDecoder`.
 *
 * The first pass records every frame timestamp (and the frame count) so sampling
 * can map a requested time to a source frame; the decode itself only happens for
 * the N frames the studio actually samples.
 */
async function dshmlOpenAnimatedImage(file: File, isCancelled: (() => boolean) | undefined): Promise<DshmlMediaSource> {
  if (file.size > DSHML_MOTION_MAX_IMAGE_BYTES) throw new DshmlMediaError('too-large', 'image');
  const ctor = dshmlImageDecoder();
  if (ctor === null) throw new DshmlMediaError('decode-unavailable');
  // `image/apng` is not a decoder type Chromium accepts; APNG is decoded as PNG.
  const type = dshmlMediaTypeOf(file) === 'image/apng' ? 'image/png' : dshmlMediaTypeOf(file);
  let decoder: DshmlImageDecoderLike;
  try {
    const data = await file.arrayBuffer();
    decoder = new ctor({ data, type });
    await decoder.tracks.ready;
  } catch (error) {
    throw new DshmlMediaError('decode-failed', error instanceof Error ? error.message : String(error));
  }
  const track = decoder.tracks.selectedTrack ?? null;
  const declaredFrames = track !== null && typeof track.frameCount === 'number' ? track.frameCount : null;
  if (declaredFrames !== null && declaredFrames <= 1) {
    decoder.close();
    throw new DshmlMediaError('single-frame');
  }
  if (declaredFrames !== null && declaredFrames > DSHML_MOTION_MAX_SOURCE_FRAMES) {
    decoder.close();
    throw new DshmlMediaError('too-long', String(declaredFrames));
  }
  const startedAt = Date.now();
  const timestamps: number[] = [];
  let width = 0;
  let height = 0;
  const limit = declaredFrames !== null ? declaredFrames : DSHML_MOTION_MAX_SOURCE_FRAMES;
  try {
    for (let index = 0; index < limit; index += 1) {
      if (isCancelled !== undefined && isCancelled()) throw new DshmlMediaError('cancelled');
      if (Date.now() - startedAt > 15_000) throw new DshmlMediaError('too-long', 'decode timeout');
      let decoded: { image: DshmlDecodedFrame };
      try {
        decoded = await decoder.decode({ frameIndex: index });
      } catch (error) {
        // `ImageDecoder` rejects with a typed error when the frame index is out
        // of range. An unknown frame count therefore ends the scan instead of
        // failing the file.
        if (declaredFrames === null && index > 0) break;
        throw error;
      }
      const frame = decoded.image;
      timestamps.push(frame.timestamp);
      if (width === 0) {
        width = frame.displayWidth;
        height = frame.displayHeight;
      }
      frame.close();
      if (declaredFrames === null && timestamps.length >= DSHML_MOTION_MAX_SOURCE_FRAMES) {
        throw new DshmlMediaError('too-long', String(timestamps.length));
      }
    }
  } catch (error) {
    decoder.close();
    if (error instanceof DshmlMediaError) throw error;
    throw new DshmlMediaError('decode-failed', error instanceof Error ? error.message : String(error));
  }
  if (timestamps.length <= 1) {
    decoder.close();
    throw new DshmlMediaError('single-frame');
  }
  let durationUs = 0;
  const last = timestamps[timestamps.length - 1] ?? 0;
  const beforeLast = timestamps[timestamps.length - 2] ?? last - 100_000;
  const lastDelta = Math.max(1, last - beforeLast);
  durationUs = last + lastDelta;
  const work = dshmlWorkSize(width, height);
  const previewUrl = URL.createObjectURL(file);
  let disposed = false;
  let chain: Promise<void> = Promise.resolve();
  const run = async (ms: number, target: HTMLCanvasElement): Promise<void> => {
    if (disposed) throw new DshmlMediaError('cancelled');
    const index = dshmlNearestFrame(timestamps, ms);
    let decoded: { image: DshmlDecodedFrame };
    try {
      decoded = await decoder.decode({ frameIndex: index });
    } catch (error) {
      throw new DshmlMediaError('decode-failed', error instanceof Error ? error.message : String(error));
    }
    if (disposed) {
      decoded.image.close();
      throw new DshmlMediaError('cancelled');
    }
    dshmlPaintFrame(decoded.image, target, work.width, work.height);
  };
  return {
    kind: 'animated',
    durationMs: durationUs / 1000,
    width: work.width,
    height: work.height,
    frameCount: timestamps.length,
    previewUrl,
    drawFrame(ms: number, target: HTMLCanvasElement): Promise<void> {
      chain = chain.then(
        () => run(ms, target),
        () => run(ms, target),
      );
      return chain;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        decoder.close();
      } catch {
        /* already closed */
      }
      URL.revokeObjectURL(previewUrl);
    },
  };
}

/** Wait for one event on a media element, or reject with a media error. */
function dshmlMediaEvent(
  element: HTMLVideoElement,
  success: string,
  failure: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>(function executor(resolve, reject) {
    const cleanup = function cleanup() {
      element.removeEventListener(success, onSuccess);
      element.removeEventListener(failure, onFailure);
      clearTimeout(timer);
    };
    const onSuccess = function onSuccess() {
      cleanup();
      resolve();
    };
    const onFailure = function onFailure() {
      cleanup();
      reject(new DshmlMediaError('decode-failed', element.error?.message ?? failure));
    };
    const timer = setTimeout(function onTimeout() {
      cleanup();
      reject(new DshmlMediaError('decode-failed', 'timeout'));
    }, timeoutMs);
    element.addEventListener(success, onSuccess);
    element.addEventListener(failure, onFailure);
  });
}

/** Seek a detached video and resolve once the frame at `seconds` is ready. */
async function dshmlSeekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  video.currentTime = seconds;
  await dshmlMediaEvent(video, 'seeked', 'error', 10_000);
}

/** Open a video through a detached muted element. */
async function dshmlOpenVideo(file: File, isCancelled: (() => boolean) | undefined): Promise<DshmlMediaSource> {
  if (file.size > DSHML_MOTION_MAX_VIDEO_BYTES) throw new DshmlMediaError('too-large', 'video');
  const previewUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = previewUrl;
  try {
    await dshmlMediaEvent(video, 'loadedmetadata', 'error', 15_000);
  } catch (error) {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
  if (isCancelled !== undefined && isCancelled()) {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(previewUrl);
    throw new DshmlMediaError('cancelled');
  }
  const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
  if (durationMs <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(previewUrl);
    throw new DshmlMediaError('decode-failed', 'no metadata');
  }
  const work = dshmlWorkSize(video.videoWidth, video.videoHeight);
  let disposed = false;
  let chain: Promise<void> = Promise.resolve();
  let lastSeek = Number.NaN;
  const run = async (ms: number, target: HTMLCanvasElement): Promise<void> => {
    if (disposed) throw new DshmlMediaError('cancelled');
    const seconds = Math.min(Math.max(0, ms / 1000), Math.max(0, durationMs / 1000 - 0.001));
    try {
      if (!Number.isFinite(lastSeek) || Math.abs(seconds - lastSeek) > 0.0005) {
        await dshmlSeekVideo(video, seconds);
        lastSeek = seconds;
      }
    } catch (error) {
      throw error instanceof DshmlMediaError
        ? error
        : new DshmlMediaError('decode-failed', error instanceof Error ? error.message : String(error));
    }
    if (disposed) throw new DshmlMediaError('cancelled');
    const context = target.getContext('2d');
    if (context === null) throw new DshmlMediaError('decode-failed', 'canvas unavailable');
    context.clearRect(0, 0, work.width, work.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, 0, 0, work.width, work.height);
  };
  return {
    kind: 'video',
    durationMs,
    width: work.width,
    height: work.height,
    frameCount: null,
    previewUrl,
    drawFrame(ms: number, target: HTMLCanvasElement): Promise<void> {
      chain = chain.then(
        () => run(ms, target),
        () => run(ms, target),
      );
      return chain;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* the element may already be detached */
      }
      URL.revokeObjectURL(previewUrl);
    },
  };
}

/**
 * Open one picked file as a sampling source.
 * @param file - animated image or video file.
 * @param isCancelled - polled between frames so a superseded import stops early.
 */
export async function dshmlOpenMediaSource(file: File, isCancelled?: () => boolean): Promise<DshmlMediaSource> {
  const kind = dshmlMediaKindOf(file);
  if (kind === null) throw new DshmlMediaError('unsupported-type');
  if (kind === 'video') return dshmlOpenVideo(file, isCancelled);
  return dshmlOpenAnimatedImage(file, isCancelled);
}

/**
 * Read a file as a data URL (used to hand a single-frame image over to the
 * static crop tab instead of making the user pick it again).
 * @param file - image file.
 */
export function dshmlReadFileDataUrl(file: File): Promise<string> {
  return new Promise<string>(function executor(resolve, reject) {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      function onLoad() {
        const result = reader.result;
        if (typeof result === 'string' && result !== '') resolve(result);
        else reject(new DshmlMediaError('decode-failed', 'empty data url'));
      },
      { once: true },
    );
    reader.addEventListener(
      'error',
      function onError() {
        reject(new DshmlMediaError('decode-failed', reader.error?.message ?? 'file read failed'));
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}
