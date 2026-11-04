/**
 * Letter-tile and escaping tests: `letterTile` must be a deterministic, safe,
 * self-contained 24×24 SVG mark derived from the given text, so exotic local
 * models always get a usable icon; the escape helpers keep every runtime-built
 * SVG safe to inline into HTML.
 */
import { describe, expect, it } from 'vitest';

import { escapeHtml, escapeXml, letterTile } from '../src/artwork';
import type { Logo } from '../src/types';

/** Structural and safety rules every generated tile must satisfy. */
const UNSAFE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\sid\s*=/, 'id attribute'],
  [/<script/i, 'script element'],
  [/\son[a-z]+\s*=/i, 'inline event handler'],
  [/https?:/i, 'external URL'],
  [/<image/i, 'embedded raster image'],
];

const assertSafeTile = (tile: Logo, label: string): void => {
  expect(tile !== null && typeof tile === 'object', `${label}: letterTile must return an object`).toBeTruthy();
  expect(typeof tile.title, `${label}: title must be a string`).toBe('string');
  expect(tile.title.trim() !== '', `${label}: title must not be empty`).toBeTruthy();
  expect(typeof tile.svg, `${label}: svg must be a string`).toBe('string');
  expect(tile.svg.trim().startsWith('<svg'), `${label}: svg must start with <svg`).toBeTruthy();
  expect(tile.svg.trim().endsWith('</svg>'), `${label}: svg must be closed`).toBeTruthy();
  expect(tile.svg, `${label}: the tile needs the rounded-square background`).toMatch(/<rect\b/);
  const withoutNamespace = tile.svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
  for (const [pattern, what] of UNSAFE) {
    expect(withoutNamespace, `${label}: no ${what}`).not.toMatch(pattern);
  }
};

/** The text the SVG actually draws, when the glyph is a <text> node. */
const drawnText = (tile: Logo): string =>
  tile.svg
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('artwork', () => {
  it('is deterministic for the same text and seed', () => {
    const first = letterTile('DeepSeek-V4.1');
    const second = letterTile('DeepSeek-V4.1');
    expect(first).toEqual(second);
    expect(first.svg).toBe(second.svg);
    // The default seed is the text itself.
    expect(letterTile('DeepSeek-V4.1', 'DeepSeek-V4.1').svg).toBe(first.svg);
  });

  it('produces a self-contained tile for brand names, ids and CJK text', () => {
    for (const text of ['DeepSeek', 'gpt-4o', 'qwen2.5:7b/coder', 'my-local-model', '月之暗面']) {
      const tile = letterTile(text);
      expect(tile, `${text}: letterTile must return a tile`).toBeTruthy();
      assertSafeTile(tile, text);
    }
  });

  it('derives the glyph from the text', () => {
    const alpha = letterTile('Alpha', 'shared-seed');
    const zulu = letterTile('Zulu', 'shared-seed');
    expect(alpha.svg, 'different text with the same seed must draw a different glyph').not.toBe(zulu.svg);
    // When the glyph is a <text> node it must be uppercased.
    const drawnGlyph = drawnText(alpha);
    if (drawnGlyph === '') return;
    expect(drawnGlyph, 'the glyph must be uppercased').toMatch(/A/);
  });

  it('stays CJK-safe instead of dropping the glyph', () => {
    const tile = letterTile('月之暗面');
    assertSafeTile(tile, '月之暗面');
    const haystack = `${drawnText(tile)} ${tile.title}`;
    expect(haystack, 'the generated glyph must come from the CJK text').toMatch(/[月之暗面]/);
  });

  it('different seeds can pick different tiles', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const tiles = new Set(seeds.map((seed) => letterTile('local-model', seed).svg));
    expect(tiles.size > 1, 'the seed must select among the palette instead of being ignored').toBeTruthy();
  });

  it('falls back safely for empty text', () => {
    const tile = letterTile('');
    assertSafeTile(tile, 'empty text');
    expect(
      (drawnText(tile) || tile.title).trim() !== '',
      'empty text still needs a visible fallback glyph',
    ).toBeTruthy();
  });

  it('escapeXml neutralizes the XML metacharacters', () => {
    const escaped = escapeXml('<tag attr="x">Tom & Jerry</tag>');
    expect(typeof escaped).toBe('string');
    expect(escaped, 'must escape <').toMatch(/&lt;/);
    expect(escaped, 'must escape >').toMatch(/&gt;/);
    expect(escaped, 'must escape &').toMatch(/&amp;/);
    expect(escaped, 'must not leave raw markup').not.toMatch(/<tag/);
    expect(escapeXml('plain text')).toBe('plain text');
    expect(typeof escapeXml(undefined)).toBe('string');
    expect(typeof escapeXml(null)).toBe('string');
  });

  it('escapeHtml neutralizes the HTML metacharacters', () => {
    const escaped = escapeHtml('<img src=x onerror="alert(1)"> & more');
    expect(typeof escaped).toBe('string');
    expect(escaped, 'must escape <').toMatch(/&lt;/);
    expect(escaped, 'must escape >').toMatch(/&gt;/);
    expect(escaped, 'must escape &').toMatch(/&amp;/);
    expect(escaped, 'must not leave raw markup').not.toMatch(/<img/);
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});
