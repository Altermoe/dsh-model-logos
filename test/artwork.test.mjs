/**
 * Letter-tile and escaping tests: `letterTile` must be a deterministic, safe,
 * self-contained 24×24 SVG mark derived from the given text, so exotic local
 * models always get a usable icon; the escape helpers keep every runtime-built
 * SVG safe to inline into HTML.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml, escapeXml, letterTile } from '../src/artwork.mjs';

/** Structural and safety rules every generated tile must satisfy. */
const UNSAFE = [
  [/\sid\s*=/, 'id attribute'],
  [/<script/i, 'script element'],
  [/\son[a-z]+\s*=/i, 'inline event handler'],
  [/https?:/i, 'external URL'],
  [/<image/i, 'embedded raster image'],
];

const assertSafeTile = (tile, label) => {
  assert.ok(tile !== null && typeof tile === 'object', `${label}: letterTile must return an object`);
  assert.equal(typeof tile.title, 'string', `${label}: title must be a string`);
  assert.ok(tile.title.trim() !== '', `${label}: title must not be empty`);
  assert.equal(typeof tile.svg, 'string', `${label}: svg must be a string`);
  assert.ok(tile.svg.trim().startsWith('<svg'), `${label}: svg must start with <svg`);
  assert.ok(tile.svg.trim().endsWith('</svg>'), `${label}: svg must be closed`);
  assert.match(tile.svg, /<rect\b/, `${label}: the tile needs the rounded-square background`);
  const withoutNamespace = tile.svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
  for (const [pattern, what] of UNSAFE) {
    assert.doesNotMatch(withoutNamespace, pattern, `${label}: no ${what}`);
  }
};

/** The text the SVG actually draws, when the glyph is a <text> node. */
const drawnText = (tile) => tile.svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('is deterministic for the same text and seed', () => {
  const first = letterTile('DeepSeek-V4.1');
  const second = letterTile('DeepSeek-V4.1');
  assert.deepEqual(first, second);
  assert.equal(first.svg, second.svg);
  // The default seed is the text itself.
  assert.equal(letterTile('DeepSeek-V4.1', 'DeepSeek-V4.1').svg, first.svg);
});

test('produces a self-contained tile for brand names, ids and CJK text', () => {
  for (const text of ['DeepSeek', 'gpt-4o', 'qwen2.5:7b/coder', 'my-local-model', '月之暗面']) {
    assertSafeTile(letterTile(text), text);
  }
});

test('derives the glyph from the text', () => {
  const alpha = letterTile('Alpha', 'shared-seed');
  const zulu = letterTile('Zulu', 'shared-seed');
  assert.notEqual(alpha.svg, zulu.svg, 'different text with the same seed must draw a different glyph');
  // When the glyph is a <text> node it must be uppercased.
  const drawnGlyph = drawnText(alpha);
  if (drawnGlyph !== '') assert.match(drawnGlyph, /A/, 'the glyph must be uppercased');
});

test('stays CJK-safe instead of dropping the glyph', () => {
  const tile = letterTile('月之暗面');
  assertSafeTile(tile, '月之暗面');
  const haystack = `${drawnText(tile)} ${tile.title}`;
  assert.match(haystack, /[月之暗面]/, 'the generated glyph must come from the CJK text');
});

test('different seeds can pick different tiles', () => {
  const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const tiles = new Set(seeds.map((seed) => letterTile('local-model', seed).svg));
  assert.ok(tiles.size > 1, 'the seed must select among the palette instead of being ignored');
});

test('falls back safely for empty text', () => {
  const tile = letterTile('');
  assertSafeTile(tile, 'empty text');
  assert.ok((drawnText(tile) || tile.title).trim() !== '', 'empty text still needs a visible fallback glyph');
});

test('escapeXml neutralizes the XML metacharacters', () => {
  const escaped = escapeXml('<tag attr="x">Tom & Jerry</tag>');
  assert.equal(typeof escaped, 'string');
  assert.match(escaped, /&lt;/, 'must escape <');
  assert.match(escaped, /&gt;/, 'must escape >');
  assert.match(escaped, /&amp;/, 'must escape &');
  assert.doesNotMatch(escaped, /<tag/, 'must not leave raw markup');
  assert.equal(escapeXml('plain text'), 'plain text');
  assert.equal(typeof escapeXml(undefined), 'string');
  assert.equal(typeof escapeXml(null), 'string');
});

test('escapeHtml neutralizes the HTML metacharacters', () => {
  const escaped = escapeHtml('<img src=x onerror="alert(1)"> & more');
  assert.equal(typeof escaped, 'string');
  assert.match(escaped, /&lt;/, 'must escape <');
  assert.match(escaped, /&gt;/, 'must escape >');
  assert.match(escaped, /&amp;/, 'must escape &');
  assert.doesNotMatch(escaped, /<img/, 'must not leave raw markup');
  assert.equal(escapeHtml('plain text'), 'plain text');
});
