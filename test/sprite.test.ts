/**
 * Sprite pipeline tests: the four-stage sampling cache.
 *
 * The studio re-samples on every debounced change, so the contract this file
 * pins is *which* stage each kind of change may re-run:
 *
 *   crop change        → crop → compose → encode, **no decode**
 *   frame-edge change  → compose → encode,        **no crop, no decode**
 *   quality change     → encode only,             **no compose, no crop, no decode**
 *   frame-count change → reuse every source frame both counts share
 *
 * The browser half of the pipeline only needs `document.createElement('canvas')`
 * and a `DshmlMediaSource`, so a recording canvas stand-in gives exact call
 * counts without a real canvas implementation: `drawFrame` counts decodes,
 * `drawImage` counts crop/compose work and `toDataURL` counts encodes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DshmlMediaSource } from '../src/media-source';
import {
  dshmlCreateSampleCache,
  dshmlEncodeMotionIcon,
  dshmlFitMotionBudget,
  dshmlSampleCacheFor,
} from '../src/sprite';
import type { DshmlEncodeOptions } from '../src/sprite';
import { DSHML_MOTION_DECODE_PX } from '../src/motion';

/** Counters every fake canvas reports into. */
interface Counters {
  decode: number;
  draw: number;
  encode: number;
  read: number;
}

let counters: Counters = { decode: 0, draw: 0, encode: 0, read: 0 };

/** One 2D-context stub that records the draws it receives. */
interface FakeContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: FakeCanvas): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

/** A canvas stand-in: size, the frame "ink" it holds, and the encode length. */
interface FakeCanvas {
  width: number;
  height: number;
  /** Which source frame was painted into this canvas (0 for a composite). */
  ink: number;
  getContext(kind: string): FakeContext | null;
  toDataURL(type?: string, quality?: number): string;
}

/**
 * The encoded length model: proportional to pixels × quality × {@link inkScale},
 * so the size ladder can be driven from a test without a real encoder.
 */
let inkScale = 0.4;

/** Create one recording canvas. */
function createCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 1,
    height: 1,
    ink: 0,
    getContext(kind: string): FakeContext | null {
      if (kind !== '2d') return null;
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        clearRect: function clearRect() {},
        drawImage: function drawImage(image: FakeCanvas) {
          counters.draw += 1;
          canvas.ink = image.ink;
          // A composite strip keeps the ink of its first frame so the poster and
          // the distinct-frame check stay deterministic.
          if (image.width > 128 && canvas.width <= image.width) return;
        },
        getImageData: function getImageData(_x: number, _y: number, width: number, height: number) {
          counters.read += 1;
          const data = new Uint8ClampedArray(width * height * 4);
          data[0] = canvas.ink & 0xff;
          data[1] = (canvas.ink >> 8) & 0xff;
          data[3] = 255;
          return { data };
        },
      };
    },
    toDataURL: function toDataURL(_type?: string, quality?: number) {
      counters.encode += 1;
      const chars = Math.max(16, Math.round(canvas.width * canvas.height * (quality ?? 1) * inkScale));
      return 'data:image/webp;base64,' + 'A'.repeat(chars);
    },
  };
  return canvas;
}

/** Install the canvas stand-in for the duration of one test. */
function installCanvas(): void {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: function createElement(tag: string) {
      return tag === 'canvas' ? createCanvas() : {};
    },
  };
}

/** Remove the stand-in again so other suites see a clean global. */
function uninstallCanvas(): void {
  delete (globalThis as { document?: unknown }).document;
}

/** A source of `frames` distinct frames over one second. */
function fakeSource(frames: number): DshmlMediaSource {
  const durationMs = 1000;
  const indexAt = (ms: number): number => Math.min(frames - 1, Math.max(0, Math.floor((ms / durationMs) * frames)));
  return {
    kind: 'animated',
    durationMs,
    width: 1024,
    height: 1024,
    frameCount: frames,
    frameRate: frames,
    drawFrame: async function drawFrame(ms: number, target: HTMLCanvasElement) {
      counters.decode += 1;
      const canvas = target as unknown as FakeCanvas;
      canvas.ink = indexAt(ms);
    },
    frameKeyAt: function frameKeyAt(ms: number) {
      return 'f' + String(indexAt(ms));
    },
    dispose: function dispose() {},
  };
}

/** The studio's default settings over the whole (short) clip. */
function options(frames: number, overrides: Partial<DshmlEncodeOptions> = {}): DshmlEncodeOptions {
  return { range: { inMs: 0, outMs: 1000 }, frames, frameWidth: 128, quality: 0.92, crop: null, ...overrides };
}

beforeEach(() => {
  counters = { decode: 0, draw: 0, encode: 0, read: 0 };
  inkScale = 0.4;
  installCanvas();
});

afterEach(() => {
  uninstallCanvas();
});

describe('sampling cache', () => {
  it('creates one cache per source and refuses a foreign handle', () => {
    const first = fakeSource(8);
    const second = fakeSource(8);
    const cache = dshmlCreateSampleCache(first);
    expect(dshmlSampleCacheFor(first, cache)).toBe(cache);
    // A handle from another import must never mix the two clips' pixels.
    const other = dshmlSampleCacheFor(second, cache);
    expect(other).not.toBe(cache);
    expect(other.source).toBe(second);
    expect(dshmlSampleCacheFor(first, null)).not.toBe(cache);
  });

  it('never caches two different sources into one cache', async () => {
    const first = fakeSource(8);
    const second = fakeSource(8);
    const cache = dshmlCreateSampleCache(first);
    await dshmlEncodeMotionIcon(first, options(4), undefined, undefined, cache);
    const decodesAfterFirst = counters.decode;
    await dshmlEncodeMotionIcon(second, options(4), undefined, undefined, cache);
    // The second run decoded its own frames instead of reusing the first's.
    expect(counters.decode).toBe(decodesAfterFirst * 2);
  });
});

describe('stage reuse', () => {
  it('decodes every sampled frame once per sampling window', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    const encoded = await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    expect(counters.decode).toBe(4);
    expect(encoded.frames).toBe(4);
    expect(encoded.frameWidth).toBe(128);
    expect(encoded.fps).toBe(4);
    // One compose of four frames plus four crops.
    expect(counters.draw).toBe(8);
    // Poster + atlas.
    expect(counters.encode).toBe(2);
  });

  it('reuses the decode when only the crop changes', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    const decodes = counters.decode;
    const encodes = counters.encode;
    const draws = counters.draw;

    await dshmlEncodeMotionIcon(
      source,
      options(4, { crop: { sx: 100, sy: 100, sw: 300, sh: 300 } }),
      undefined,
      undefined,
      cache,
    );

    // The whole point of the cache: a crop drag must not re-decode the clip.
    expect(counters.decode).toBe(decodes);
    // Crop + compose re-ran (4 crops + 4 composed frames), poster + atlas re-encoded.
    expect(counters.draw).toBe(draws + 8);
    expect(counters.encode).toBe(encodes + 2);
  });

  it('reuses the crop when only the frame edge changes', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    const decodes = counters.decode;
    const draws = counters.draw;
    const encodes = counters.encode;

    const encoded = await dshmlEncodeMotionIcon(source, options(4, { frameWidth: 112 }), undefined, undefined, cache);

    expect(encoded.frameWidth).toBe(112);
    expect(counters.decode).toBe(decodes);
    // Only the composition re-ran: four frames drawn into the smaller strip.
    expect(counters.draw).toBe(draws + 4);
    expect(counters.encode).toBe(encodes + 1);
  });

  it('reuses the composition when only the quality changes', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    const decodes = counters.decode;
    const draws = counters.draw;
    const encodes = counters.encode;

    const encoded = await dshmlEncodeMotionIcon(source, options(4, { quality: 0.5 }), undefined, undefined, cache);

    expect(encoded.quality).toBe(0.5);
    expect(counters.decode).toBe(decodes);
    expect(counters.draw).toBe(draws);
    expect(counters.encode).toBe(encodes + 1);
  });

  it('reuses shared source frames when the frame count changes', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(8), undefined, undefined, cache);
    expect(counters.decode).toBe(8);
    const decodes = counters.decode;

    // Six samples over the same window land on a subset of the eight frames.
    await dshmlEncodeMotionIcon(source, options(6), undefined, undefined, cache);
    // Sample windows: 0,125…875 (8) and 0,166…833 (6) → the six times all map
    // to already decoded indices, so nothing is decoded again.
    expect(counters.decode).toBe(decodes);
    expect(cache.decoded.size).toBe(8);
  });

  it('keeps the decoded cache bounded', async () => {
    const source = fakeSource(64);
    const cache = dshmlCreateSampleCache(source);
    for (let frames = 4; frames <= 24; frames += 2) {
      await dshmlEncodeMotionIcon(source, options(frames), undefined, undefined, cache);
    }
    expect(cache.decoded.size).toBeLessThanOrEqual(32);
  });
});

describe('decode resolution', () => {
  it('decodes into a cache canvas bounded by the sampling edge', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    const decoded = [...cache.decoded.values()][0];
    expect(decoded?.width).toBe(DSHML_MOTION_DECODE_PX);
    expect(decoded?.height).toBe(DSHML_MOTION_DECODE_PX);
  });

  it('keeps a source smaller than the sampling edge at its own size', async () => {
    const source = { ...fakeSource(8), width: 128, height: 96 };
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    const decoded = [...cache.decoded.values()][0];
    expect(decoded?.width).toBe(128);
    expect(decoded?.height).toBe(96);
  });
});

describe('distinct frames', () => {
  it('reads each rendered frame once, not twice per adjacent pair', async () => {
    const source = fakeSource(24);
    const cache = dshmlCreateSampleCache(source);
    await dshmlEncodeMotionIcon(source, options(24), undefined, undefined, cache);
    // D1: N frames = N getImageData reads (the old pairwise walk did 2(N−1)).
    expect(counters.read).toBe(24);
  });

  it('counts adjacent differences, not unique frames', async () => {
    const source = fakeSource(4);
    const cache = dshmlCreateSampleCache(source);
    // 12 samples over four source frames: 9 of the 12 steps repeat a frame.
    const encoded = await dshmlEncodeMotionIcon(source, options(12), undefined, undefined, cache);
    expect(encoded.distinctFrames).toBeLessThanOrEqual(12);
    expect(encoded.distinctFrames).toBeGreaterThan(1);
    const smooth = await dshmlEncodeMotionIcon(source, options(4), undefined, undefined, cache);
    expect(smooth.distinctFrames).toBe(4);
  });
});

describe('slimming ladder', () => {
  it('stops at the first quality that fits and reports only that step', async () => {
    const source = fakeSource(12);
    const cache = dshmlCreateSampleCache(source);
    const result = await dshmlFitMotionBudget(source, options(24), undefined, undefined, cache);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({ kind: 'quality', from: 0.92, to: 0.82 });
    expect(result.encoded.verdict).not.toBe('over');
    expect(result.encoded.quality).toBe(0.82);
  });

  it('walks to the frame count when no quality fits, and reuses decoded frames', async () => {
    const source = fakeSource(12);
    const cache = dshmlCreateSampleCache(source);
    inkScale = 0.9;
    const result = await dshmlFitMotionBudget(source, options(24), undefined, undefined, cache);
    expect(result.changes.map((change) => change.kind)).toContain('frames');
    // The 24-frame window was decoded once; the ladder's smaller counts reuse it.
    expect(counters.decode).toBeLessThanOrEqual(24);
    expect(result.encoded.verdict).not.toBe('over');
  });

  it('reuses the caller cache so a second run does no decode at all', async () => {
    const source = fakeSource(8);
    const cache = dshmlCreateSampleCache(source);
    const first = await dshmlFitMotionBudget(source, options(24), undefined, undefined, cache);
    const decodes = counters.decode;
    expect(decodes).toBeGreaterThan(0);
    expect(first.changes).toHaveLength(1);
    const again = await dshmlFitMotionBudget(source, options(24), undefined, undefined, cache);
    expect(counters.decode).toBe(decodes);
    expect(again.changes).toEqual(first.changes);
    expect(again.encoded.atlasChars).toBe(first.encoded.atlasChars);
  });
});

describe('input validation', () => {
  it('rejects unusable options before touching the source', async () => {
    const source = fakeSource(8);
    const bad: DshmlEncodeOptions[] = [
      options(4, { range: { inMs: 500, outMs: 500 } }),
      options(4, { range: { inMs: 0, outMs: 4000 } }),
      options(1),
      options(25),
      options(4, { frameWidth: 64 }),
      options(4, { frameWidth: 129 }),
    ];
    for (const candidate of bad) {
      await expect(dshmlEncodeMotionIcon(source, candidate)).rejects.toMatchObject({ code: 'no-frames' });
    }
    expect(counters.decode).toBe(0);
  });

  it('reports a cancelled run as a cancelled media error', async () => {
    const source = fakeSource(8);
    await expect(
      dshmlEncodeMotionIcon(source, options(8), undefined, () => true, dshmlCreateSampleCache(source)),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
