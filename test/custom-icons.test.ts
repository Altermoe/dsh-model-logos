/**
 * Custom-icon data layer tests: id/override sentinel parsing, name validation,
 * persisted-document hardening, crop geometry and the SVG tile that carries the
 * raster payload.
 */
import { describe, expect, it } from 'vitest';

import type { CustomIconDocument } from '../src/types';
import {
  DSHML_CUSTOM_MAX_DATA_URL,
  DSHML_CUSTOM_MAX_ICONS,
  DSHML_CUSTOM_MAX_NAME,
  DSHML_CUSTOM_MAX_POSTER,
  DSHML_CUSTOM_MAX_TOTAL_DATA_URL,
  dshmlBudgetPlan,
  dshmlCleanCustomName,
  dshmlCustomDataChars,
  dshmlCustomFitsTotalBudget,
  dshmlCustomMarkFor,
  dshmlIsCustomPosterDataUrl,
  dshmlCropRect,
  dshmlCustomIconIdOf,
  dshmlCustomIconKey,
  dshmlCustomIconList,
  dshmlCustomIconsOf,
  dshmlCustomMarkSvg,
  dshmlIsAcceptedImageType,
  dshmlIsCustomIconId,
  dshmlIsCustomImageDataUrl,
  dshmlNewCustomIconId,
  dshmlValidateCustomName,
} from '../src/custom-icons';

/** A minimal valid PNG data URL (content is irrelevant to the validators). */
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

/** A tiny but syntactically valid WebP atlas data URL. */
const ATLAS = 'data:image/webp;base64,UklGRg==';

/** One persisted icon with every field. */
function icon(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Acme Icon', kind: 'image', image: IMAGE, createdAt: 12, ...overrides };
}

describe('custom icon sentinels', () => {
  it('round-trips one generated id through the custom: namespace', () => {
    const id = dshmlNewCustomIconId(1_700_000_000_000);
    expect(dshmlIsCustomIconId(id), id).toBe(true);
    expect(dshmlCustomIconKey(id)).toBe('custom:' + id);
    expect(dshmlCustomIconIdOf('custom:' + id)).toBe(id);
  });

  it('rejects ids outside the path-safe character set or over 64 characters', () => {
    for (const value of ['', 'a b', 'a/b', 'a.b', 'a:b', 'a'.repeat(65), 42, null, undefined, {}]) {
      expect(dshmlIsCustomIconId(value), String(value)).toBe(false);
    }
    expect(dshmlIsCustomIconId('c-1d2f-abcdef')).toBe(true);
    expect(dshmlIsCustomIconId('A_b-9')).toBe(true);
  });

  it('only parses well-formed custom override values', () => {
    expect(dshmlCustomIconIdOf('custom:c-demo')).toBe('c-demo');
    expect(dshmlCustomIconIdOf('  custom:c-demo  ')).toBe('c-demo');
    for (const value of ['custom:', 'custom:bad id', 'custom:c/demo', 'none', 'letter', 'qwen', '', null, 7]) {
      expect(dshmlCustomIconIdOf(value), String(value)).toBe(null);
    }
  });

  it('generates unique-looking ids on repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => dshmlNewCustomIconId()));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(dshmlIsCustomIconId(id)).toBe(true);
  });
});

describe('custom icon names', () => {
  it('collapses whitespace and trims', () => {
    expect(dshmlCleanCustomName('  My \n Local\tModel  ')).toBe('My Local Model');
    expect(dshmlCleanCustomName(42)).toBe('');
    expect(dshmlCleanCustomName(null)).toBe('');
  });

  it('validates emptiness, length and case-insensitive uniqueness', () => {
    const icons: CustomIconDocument = {
      'c-1': { id: 'c-1', name: 'Acme Model', kind: 'image', image: IMAGE, createdAt: 1 },
    };
    expect(dshmlValidateCustomName('   ', icons)).toEqual({ ok: false, problem: 'empty' });
    expect(dshmlValidateCustomName('a'.repeat(DSHML_CUSTOM_MAX_NAME + 1), icons)).toEqual({
      ok: false,
      problem: 'too-long',
    });
    expect(dshmlValidateCustomName('  ACME model ', icons)).toEqual({ ok: false, problem: 'duplicate' });
    expect(dshmlValidateCustomName('Second', icons)).toEqual({ ok: true, name: 'Second' });
  });

  it('lets a rename keep its own name', () => {
    const icons: CustomIconDocument = {
      'c-1': { id: 'c-1', name: 'Acme Model', kind: 'image', image: IMAGE, createdAt: 1 },
    };
    expect(dshmlValidateCustomName('Acme Model', icons, 'c-1')).toEqual({ ok: true, name: 'Acme Model' });
    expect(dshmlValidateCustomName('ACME MODEL', icons, 'c-1')).toEqual({ ok: true, name: 'ACME MODEL' });
    // A different icon with the same name is still a duplicate.
    const other: CustomIconDocument = {
      'c-1': { id: 'c-1', name: 'Acme Model', kind: 'image', image: IMAGE, createdAt: 1 },
      'c-2': { id: 'c-2', name: 'Other Model', kind: 'image', image: IMAGE, createdAt: 2 },
    };
    expect(dshmlValidateCustomName('Acme Model', other, 'c-2')).toEqual({ ok: false, problem: 'duplicate' });
  });
});

describe('custom icon payloads', () => {
  it('accepts only the three raster data-URL families within the payload budget', () => {
    expect(dshmlIsCustomImageDataUrl(IMAGE)).toBe(true);
    expect(dshmlIsCustomImageDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(dshmlIsCustomImageDataUrl('data:image/webp;base64,UklGRg==')).toBe(true);
    for (const value of [
      'data:image/gif;base64,R0lGODlh',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,',
      'data:image/png;base64,abc def',
      'iVBORw0KGgo=',
      '',
      42,
      null,
    ]) {
      expect(dshmlIsCustomImageDataUrl(value), String(value)).toBe(false);
    }
    const oversized = 'data:image/png;base64,' + 'A'.repeat(DSHML_CUSTOM_MAX_DATA_URL);
    expect(dshmlIsCustomImageDataUrl(oversized)).toBe(false);
  });

  it('matches browser-declared media types case-insensitively and ignores parameters', () => {
    expect(dshmlIsAcceptedImageType('image/png')).toBe(true);
    expect(dshmlIsAcceptedImageType('IMAGE/JPEG')).toBe(true);
    expect(dshmlIsAcceptedImageType('image/webp; charset=binary')).toBe(true);
    expect(dshmlIsAcceptedImageType('image/gif')).toBe(false);
    expect(dshmlIsAcceptedImageType('image/svg+xml')).toBe(false);
    expect(dshmlIsAcceptedImageType('')).toBe(false);
    expect(dshmlIsAcceptedImageType(null)).toBe(false);
  });

  it('parses a persisted dictionary and skips invalid entries', () => {
    const parsed = dshmlCustomIconsOf({
      'c-good': icon(),
      'bad id': icon(),
      'c-name': icon({ name: '   ' }),
      'c-image': icon({ image: 'data:image/gif;base64,R0lGODlh' }),
      'c-kind': icon({ kind: 'animated' }),
      'c-shape': 'not an object',
    });
    expect(Object.keys(parsed)).toEqual(['c-good']);
    expect(parsed['c-good']).toEqual({ id: 'c-good', name: 'Acme Icon', kind: 'image', image: IMAGE, createdAt: 12 });

    // A hand-edited document cannot pollute Object.prototype through a
    // `__proto__` entry: it is either an own icon key or skipped, never a write
    // to the checked object's prototype.
    const hostile = JSON.parse('{"__proto__":{"name":"evil","image":"' + IMAGE + '"}}') as Record<string, unknown>;
    const safe = dshmlCustomIconsOf(hostile);
    expect(({} as { polluted?: unknown }).polluted).toBe(undefined);
    expect(Object.getPrototypeOf(safe)).toBe(Object.prototype);
  });

  it('normalizes missing or invalid timestamps and defaults', () => {
    const parsed = dshmlCustomIconsOf({
      'c-a': { name: 'A', image: IMAGE },
      'c-b': { name: 'B', image: IMAGE, createdAt: -5 },
      'c-c': { name: 'C', image: IMAGE, createdAt: Number.NaN },
    });
    expect(parsed['c-a']?.createdAt).toBe(0);
    expect(parsed['c-b']?.createdAt).toBe(0);
    expect(parsed['c-c']?.createdAt).toBe(0);
    expect(parsed['c-a']?.kind).toBe('image');
  });

  it('returns []/{} for hostile shapes', () => {
    for (const raw of [null, undefined, [], 'icons', 7, true]) {
      expect(dshmlCustomIconsOf(raw)).toEqual({});
      expect(dshmlCustomIconList(dshmlCustomIconsOf(raw))).toEqual([]);
    }
  });

  it('lists icons by creation time, then id', () => {
    const list = dshmlCustomIconList({
      'c-b': { id: 'c-b', name: 'B', kind: 'image', image: IMAGE, createdAt: 5 },
      'c-c': { id: 'c-c', name: 'C', kind: 'image', image: IMAGE, createdAt: 1 },
      'c-a': { id: 'c-a', name: 'A', kind: 'image', image: IMAGE, createdAt: 5 },
    });
    expect(list.map((entry) => entry.id)).toEqual(['c-c', 'c-a', 'c-b']);
    expect(list.length).toBeLessThanOrEqual(DSHML_CUSTOM_MAX_ICONS);
  });
});

describe('crop geometry', () => {
  it('clamps a fractional crop rectangle into the bitmap', () => {
    expect(dshmlCropRect({ x: 10.4, y: 20.6, width: 50.2, height: 40.5 }, 100, 100)).toEqual({
      sx: 10,
      sy: 21,
      sw: 50,
      sh: 41,
    });
  });

  it('clamps an oversized or off-edge rectangle instead of reading outside the bitmap', () => {
    expect(dshmlCropRect({ x: 80, y: 90, width: 100, height: 100 }, 100, 100)).toEqual({
      sx: 80,
      sy: 90,
      sw: 20,
      sh: 10,
    });
    expect(dshmlCropRect({ x: 99.6, y: 0, width: 0.2, height: 10 }, 100, 100)).toEqual({
      sx: 99,
      sy: 0,
      sw: 1,
      sh: 10,
    });
  });

  it('rejects unusable geometry', () => {
    const bad = [
      null,
      'crop',
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 0, y: -1, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 0, y: 0, width: 10, height: 0 },
      { x: Number.NaN, y: 0, width: 10, height: 10 },
    ];
    for (const area of bad) expect(dshmlCropRect(area, 100, 100), JSON.stringify(area)).toBe(null);
    expect(dshmlCropRect({ x: 0, y: 0, width: 10, height: 10 }, 0, 100)).toBe(null);
    expect(dshmlCropRect({ x: 0, y: 0, width: 10, height: 10 }, 100, Number.POSITIVE_INFINITY)).toBe(null);
  });
});

describe('custom mark tile', () => {
  it('wraps the data URL in one self-contained 24×24 SVG', () => {
    const svg = dshmlCustomMarkSvg({ image: IMAGE });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
    expect(svg).toContain('href="' + IMAGE + '"');
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg, 'the raster tile keeps the shared 6/24 rounded corners').toContain(
      'style="clip-path: inset(0 round 25%)"',
    );
    expect(svg).not.toMatch(/\sid\s*=/);
    expect(svg).not.toMatch(/<script/);
  });

  it('escapes attribute-significant characters in a hostile image value', () => {
    const svg = dshmlCustomMarkSvg({ image: 'data:image/png;base64,A"B<C&D' });
    expect(svg).toContain('href="data:image/png;base64,A&quot;B&lt;C&amp;D"');
    expect(svg).not.toContain('A"B');
  });

  it('renders an empty tile for a missing image instead of throwing', () => {
    expect(dshmlCustomMarkSvg(null)).toContain('<image href=""');
    expect(dshmlCustomMarkSvg(undefined)).toMatch(/^<svg/);
  });
});

describe('motion records', () => {
  it('keeps a valid motion record next to the poster', () => {
    const parsed = dshmlCustomIconsOf({
      'c-moving': icon({ motion: { atlas: ATLAS, frames: 4, fps: 12, frameWidth: 128 } }),
    });
    expect(parsed['c-moving']?.image).toBe(IMAGE);
    expect(parsed['c-moving']?.motion).toEqual({ atlas: ATLAS, frames: 4, fps: 12, frameWidth: 128 });
  });

  it('drops only the motion record when the atlas or geometry is invalid', () => {
    const badMotions: unknown[] = [
      { atlas: 'data:image/gif;base64,R0lGODlh', frames: 4, fps: 4, frameWidth: 128 },
      { atlas: ATLAS, frames: 1, fps: 4, frameWidth: 128 },
      { atlas: ATLAS, frames: 4, fps: Number.NaN, frameWidth: 128 },
      { atlas: ATLAS, frames: 24, fps: 4, frameWidth: 256 },
      { atlas: ATLAS, frames: '4', fps: 4, frameWidth: 128 },
      'motion',
    ];
    for (const motion of badMotions) {
      const parsed = dshmlCustomIconsOf({ 'c-moving': icon({ motion }) });
      expect(parsed['c-moving'], JSON.stringify(motion)).toBeDefined();
      expect(parsed['c-moving']?.motion).toBe(undefined);
      expect(parsed['c-moving']?.image).toBe(IMAGE);
    }
  });

  it('builds both the poster mark and the playing mark', () => {
    const icons = dshmlCustomIconsOf({
      'c-moving': icon({ motion: { atlas: ATLAS, frames: 4, fps: 12, frameWidth: 128 } }),
    });
    const mark = dshmlCustomMarkFor(icons, 'custom:c-moving');
    expect(mark?.title).toBe('Acme Icon');
    expect(mark?.svg).toContain('<image href="' + IMAGE + '"');
    expect(mark?.animatedSvg).toContain('<animate attributeName="x"');
    expect(mark?.animatedSvg).toContain(ATLAS);
    // A static icon has no playing form, but still renders.
    const staticMark = dshmlCustomMarkFor(dshmlCustomIconsOf({ 'c-static': icon() }), 'custom:c-static');
    expect(staticMark?.svg).toContain('<image');
    expect(staticMark?.animatedSvg).toBe(undefined);
  });

  it('caps the poster at 32 KiB for motion icons while keeping the 128 KiB static bound', () => {
    expect(DSHML_CUSTOM_MAX_POSTER).toBe(32 * 1024);
    expect(dshmlIsCustomPosterDataUrl(IMAGE)).toBe(true);
    expect(dshmlIsCustomPosterDataUrl('data:image/webp;base64,UklGRg==')).toBe(true);
    expect(dshmlIsCustomPosterDataUrl('data:image/png;base64,' + 'A'.repeat(DSHML_CUSTOM_MAX_POSTER))).toBe(false);
    expect(dshmlIsCustomPosterDataUrl('data:image/gif;base64,R0lGODlh')).toBe(false);
    expect(dshmlIsCustomImageDataUrl('data:image/png;base64,' + 'A'.repeat(40 * 1024))).toBe(true);
  });

  it('sums poster + atlas characters and enforces the 3 MiB document budget', () => {
    const base = dshmlCustomIconsOf({
      'c-a': icon({ motion: { atlas: ATLAS, frames: 4, fps: 12, frameWidth: 128 } }),
    });
    const withIcon = base['c-a'];
    expect(withIcon).toBeDefined();
    if (withIcon === undefined) return;
    expect(dshmlCustomDataChars(withIcon)).toBe(IMAGE.length + ATLAS.length);
    expect(dshmlCustomFitsTotalBudget(base, { image: IMAGE })).toBe(true);
    expect(DSHML_CUSTOM_MAX_TOTAL_DATA_URL).toBe(3 * 1024 * 1024);
    const huge = 'data:image/png;base64,' + 'A'.repeat(DSHML_CUSTOM_MAX_TOTAL_DATA_URL);
    expect(dshmlCustomFitsTotalBudget(base, { image: huge })).toBe(false);
    // Re-saving an existing icon does not count its own payload twice.
    const ceiling = {
      ...withIcon,
      image: 'data:image/png;base64,' + 'A'.repeat(DSHML_CUSTOM_MAX_TOTAL_DATA_URL - ATLAS.length - 30),
    };
    expect(dshmlCustomFitsTotalBudget(base, ceiling, 'c-a')).toBe(true);
    expect(dshmlCustomFitsTotalBudget(base, ceiling)).toBe(false);
  });

  it('gives the studio a three-state budget verdict', () => {
    const kb = 1024;
    expect(dshmlBudgetPlan(40 * kb, 8 * kb)).toBe('ok');
    expect(dshmlBudgetPlan(110 * kb, 8 * kb)).toBe('warn');
    expect(dshmlBudgetPlan(40 * kb, 30 * kb)).toBe('warn');
    expect(dshmlBudgetPlan(129 * kb, 8 * kb)).toBe('over');
    expect(dshmlBudgetPlan(40 * kb, 33 * kb)).toBe('over');
    expect(dshmlBudgetPlan(Number.NaN, -1)).toBe('ok');
  });
});
