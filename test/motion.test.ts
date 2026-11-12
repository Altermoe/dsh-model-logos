/**
 * Motion-domain tests: sampling maths, initial frame count, sprite geometry,
 * persisted-record validation, the playing SVG and the per-surface playback
 * policy. Everything here is pure, so the browser sampling pipeline only has to
 * prove that it calls these functions with the values the studio collected.
 */
import { describe, expect, it } from 'vitest';

import type { CustomIconMotion } from '../src/types';
import {
  DSHML_MOTION_MAX_ATLAS_WIDTH,
  DSHML_MOTION_MAX_FRAMES,
  DSHML_MOTION_MAX_PLAYBACK_FPS,
  DSHML_MOTION_MIN_PLAYBACK_FPS,
  DSHML_MOTION_SAMPLE_MIN_FRAMES,
  DSHML_PLAYBACK_DEFAULTS,
  dshmlAtlasSvg,
  dshmlClampRange,
  dshmlEffectiveFps,
  dshmlInitialFrameCount,
  dshmlIsPlaybackMode,
  dshmlMotionOf,
  dshmlNormalizeMotion,
  dshmlPlaybackModeOf,
  dshmlPlaybackOf,
  dshmlPlayableMarkHtml,
  dshmlSampleTimes,
  dshmlSpriteLayout,
  dshmlSpriteLayoutFits,
} from '../src/motion';

/** A tiny but syntactically valid WebP data URL (content is irrelevant here). */
const ATLAS = 'data:image/webp;base64,UklGRg==';

/** One valid persisted motion record. */
function motion(overrides: Partial<CustomIconMotion> = {}): CustomIconMotion {
  return { atlas: ATLAS, frames: 4, fps: 12, frameWidth: 128, ...overrides };
}

describe('sampling times', () => {
  it('spreads N frames over a left-closed / right-open range', () => {
    expect(dshmlSampleTimes({ inMs: 0, outMs: 2000 }, 4)).toEqual([0, 500, 1000, 1500]);
    expect(dshmlSampleTimes({ inMs: 200, outMs: 1800 }, 4)).toEqual([200, 600, 1000, 1400]);
    const times = dshmlSampleTimes({ inMs: 0, outMs: 2000 }, 24);
    expect(times).toHaveLength(24);
    expect(times[0]).toBe(0);
    expect(times[23]).toBeCloseTo(1916.6667, 3);
    // The out endpoint itself is never sampled: a loop must not repeat frame 0.
    expect(times).not.toContain(2000);
  });

  it('returns no samples for an unusable range or count', () => {
    expect(dshmlSampleTimes({ inMs: 100, outMs: 100 }, 4)).toEqual([]);
    expect(dshmlSampleTimes({ inMs: 200, outMs: 100 }, 4)).toEqual([]);
    expect(dshmlSampleTimes({ inMs: 0, outMs: 1000 }, 0)).toEqual([]);
    expect(dshmlSampleTimes({ inMs: Number.NaN, outMs: 1000 }, 4)).toEqual([]);
  });

  it('derives the effective frame rate and clamps it to the playback range', () => {
    expect(dshmlEffectiveFps({ inMs: 0, outMs: 2000 }, 24)).toBe(12);
    expect(dshmlEffectiveFps({ inMs: 0, outMs: 1000 }, 4)).toBe(4);
    expect(dshmlEffectiveFps({ inMs: 0, outMs: 120 }, 4)).toBe(30);
    expect(dshmlEffectiveFps({ inMs: 0, outMs: 8000 }, 4)).toBe(0.5);
    expect(dshmlEffectiveFps({ inMs: 0, outMs: 2000 }, 24)).toBeLessThanOrEqual(DSHML_MOTION_MAX_PLAYBACK_FPS);
    expect(dshmlEffectiveFps({ inMs: 0, outMs: 2000 }, 24)).toBeGreaterThanOrEqual(DSHML_MOTION_MIN_PLAYBACK_FPS);
  });
});

describe('initial frame count', () => {
  it('uses 12 fps in the 4–24 frame window', () => {
    expect(dshmlInitialFrameCount({ inMs: 0, outMs: 200 })).toBe(DSHML_MOTION_SAMPLE_MIN_FRAMES);
    expect(dshmlInitialFrameCount({ inMs: 0, outMs: 1500 })).toBe(18);
    expect(dshmlInitialFrameCount({ inMs: 0, outMs: 2000 })).toBe(DSHML_MOTION_MAX_FRAMES);
    expect(dshmlInitialFrameCount({ inMs: 0, outMs: 10_000 })).toBe(DSHML_MOTION_MAX_FRAMES);
    expect(dshmlInitialFrameCount({ inMs: 0, outMs: 0 })).toBe(DSHML_MOTION_SAMPLE_MIN_FRAMES);
  });
});

describe('range clamping', () => {
  it('caps the clip at two seconds, pushes the other edge and keeps a real span', () => {
    expect(dshmlClampRange(0, 5000, 10_000)).toEqual({ inMs: 0, outMs: 2000 });
    expect(dshmlClampRange(9000, 9500, 10_000)).toEqual({ inMs: 9000, outMs: 9500 });
    expect(dshmlClampRange(9000, 12_000, 10_000)).toEqual({ inMs: 8000, outMs: 10_000 });
    expect(dshmlClampRange(0, 30, 10_000)).toEqual({ inMs: 0, outMs: 120 });
    expect(dshmlClampRange(-50, 500, 1000)).toEqual({ inMs: 0, outMs: 500 });
  });
});

describe('sprite geometry', () => {
  it('describes a horizontal strip without storing width/height twice', () => {
    expect(dshmlSpriteLayout(24, 128)).toEqual({ width: 3072, height: 128 });
    expect(dshmlSpriteLayout(4, 96)).toEqual({ width: 384, height: 96 });
    expect(dshmlSpriteLayout(24, 128).width).toBeLessThanOrEqual(DSHML_MOTION_MAX_ATLAS_WIDTH);
  });

  it('rejects frame counts or edges that would exceed the atlas budget', () => {
    expect(dshmlSpriteLayoutFits(4, 128)).toBe(true);
    expect(dshmlSpriteLayoutFits(24, 128)).toBe(true);
    expect(dshmlSpriteLayoutFits(1, 128)).toBe(false);
    expect(dshmlSpriteLayoutFits(25, 128)).toBe(false);
    expect(dshmlSpriteLayoutFits(4, 64)).toBe(false);
    expect(dshmlSpriteLayoutFits(4, 257)).toBe(false);
    expect(dshmlSpriteLayoutFits(24, 256)).toBe(false);
    expect(dshmlSpriteLayoutFits(4.5, 128)).toBe(false);
  });
});

describe('motion record validation', () => {
  it('normalizes a valid record and rounds the rate', () => {
    expect(dshmlNormalizeMotion(motion({ fps: 12.345 }))).toEqual({ ...motion(), fps: 12.35 });
    expect(dshmlNormalizeMotion(motion())).toEqual(motion());
    expect(dshmlMotionOf({ motion: motion() })).toEqual(motion());
    expect(dshmlMotionOf({})).toBe(null);
  });

  it('drops the whole record on any invalid field', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'motion',
      [],
      motion({ atlas: '' }),
      motion({ atlas: 'data:image/gif;base64,R0lGODlh' }),
      motion({ atlas: 'https://example.test/atlas.webp' }),
      motion({ atlas: 'data:image/webp;base64,' + 'A'.repeat(128 * 1024) }),
      motion({ frames: 1 }),
      motion({ frames: 25 }),
      motion({ frames: 4.5 }),
      motion({ frameWidth: 64 }),
      motion({ frameWidth: 24, frames: 200 }),
      motion({ fps: Number.NaN }),
      motion({ fps: 0.4 }),
      motion({ fps: 31 }),
    ];
    for (const raw of bad) {
      expect(dshmlNormalizeMotion(raw), String(JSON.stringify(raw) ?? raw).slice(0, 80)).toBe(null);
    }
  });
});

describe('playing SVG', () => {
  it('animates one image x through every frame with calcMode=discrete', () => {
    const svg = dshmlAtlasSvg({ motion: motion() });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
    expect(svg).toContain('width="96"');
    expect(svg).toContain('height="24"');
    expect(svg).toContain('values="0;-24;-48;-72"');
    expect(svg).toContain('dur="0.333s"');
    expect(svg).toContain('calcMode="discrete"');
    expect(svg).toContain('repeatCount="indefinite"');
    expect(svg).toContain('style="clip-path: inset(0 round 25%)"');
    expect(svg).toContain('preserveAspectRatio="none"');
  });

  it('derives the values length and duration from the stored rate', () => {
    const svg = dshmlAtlasSvg({ motion: motion({ frames: 24, fps: 12 }) });
    const values = /values="([^"]*)"/u.exec(svg)?.[1]?.split(';') ?? [];
    expect(values).toHaveLength(24);
    expect(values[0]).toBe('0');
    expect(values[23]).toBe(String(-24 * 23));
    expect(svg).toContain('dur="2s"');
  });

  it('stays self-contained and returns empty without a valid record', () => {
    const svg = dshmlAtlasSvg({ motion: motion() });
    const withoutNamespace = svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/giu, '');
    expect(svg).not.toMatch(/\sid\s*=/u);
    expect(svg).not.toMatch(/<script/iu);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/iu);
    expect(withoutNamespace).not.toMatch(/https?:/iu);
    expect(dshmlAtlasSvg(null)).toBe('');
    expect(dshmlAtlasSvg({})).toBe('');
    expect(dshmlAtlasSvg({ motion: motion({ frames: 1 }) })).toBe('');
  });
});

describe('playback policy', () => {
  it('ships the documented defaults', () => {
    expect(DSHML_PLAYBACK_DEFAULTS).toEqual({
      composer: 'always',
      settings: 'hover',
      iconsPage: 'hover',
      picker: 'hover',
    });
    expect(dshmlPlaybackOf(undefined)).toEqual(DSHML_PLAYBACK_DEFAULTS);
    expect(dshmlPlaybackOf({})).toEqual(DSHML_PLAYBACK_DEFAULTS);
  });

  it('overrides one surface at a time and ignores unknown values', () => {
    expect(dshmlPlaybackOf({ composer: 'never', picker: 'always' })).toEqual({
      ...DSHML_PLAYBACK_DEFAULTS,
      composer: 'never',
      picker: 'always',
    });
    expect(dshmlPlaybackOf({ composer: 'loud', settings: 7, iconsPage: null })).toEqual(DSHML_PLAYBACK_DEFAULTS);
    expect(dshmlPlaybackModeOf({ settings: 'always' }, 'settings')).toBe('always');
    expect(dshmlPlaybackModeOf(null, 'settings')).toBe('hover');
    for (const value of ['always', 'hover', 'never']) expect(dshmlIsPlaybackMode(value)).toBe(true);
    for (const value of ['Always', '', null, 1, undefined]) expect(dshmlIsPlaybackMode(value)).toBe(false);
  });
});

describe('playback markup', () => {
  const poster = '<svg id="poster"/>';
  const animated = '<svg id="animated"><animate attributeName="x" values="0;-24" dur="0.5s"/></svg>';
  const mark = { svg: poster, animatedSvg: animated };

  it('plays immediately under always, unless reduced motion intervenes', () => {
    expect(dshmlPlayableMarkHtml(mark, 'always', false, false)).toBe(animated);
    expect(dshmlPlayableMarkHtml(mark, 'always', true, false)).toBe(animated);
    expect(dshmlPlayableMarkHtml(mark, 'always', false, true)).toBe(poster);
  });

  it('waits for interaction under hover', () => {
    expect(dshmlPlayableMarkHtml(mark, 'hover', false, false)).toBe(poster);
    expect(dshmlPlayableMarkHtml(mark, 'hover', true, false)).toBe(animated);
    expect(dshmlPlayableMarkHtml(mark, 'hover', true, true)).toBe(poster);
  });

  it('never plays under never, even when active', () => {
    expect(dshmlPlayableMarkHtml(mark, 'never', false, false)).toBe(poster);
    expect(dshmlPlayableMarkHtml(mark, 'never', true, false)).toBe(poster);
  });

  it('falls back to the poster when the animation or the mark is absent', () => {
    expect(dshmlPlayableMarkHtml({ svg: poster }, 'always', false, false)).toBe(poster);
    expect(dshmlPlayableMarkHtml({ svg: poster, animatedSvg: '' }, 'always', false, false)).toBe(poster);
    expect(dshmlPlayableMarkHtml(null, 'always', false, false)).toBe('');
    expect(dshmlPlayableMarkHtml({ svg: null, animatedSvg: animated }, 'never', false, false)).toBe('');
    expect(dshmlPlayableMarkHtml({ svg: poster, animatedSvg: null }, 'always', false, false)).toBe(poster);
  });
});
