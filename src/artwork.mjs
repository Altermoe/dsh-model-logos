/**
 * Runtime SVG helpers shared by every plugin surface.
 *
 * This module is pure: no DOM, no imports, no randomness, no side effects. The
 * client build inlines it with the `export` keywords stripped, so only
 * `export const` / `export function` forms are allowed here.
 *
 * `letterTile(text, seed)` is the deterministic fallback mark for providers and
 * models the hand-drawn artwork does not cover. It returns the same
 * `{ title, svg }` shape as the entries in `src/logos-*.mjs`:
 *
 *   - 24x24 rounded-square tile with a flat colour from `LETTER_PALETTE`,
 *     chosen by a stable FNV-1a hash of `seed` (defaults to `text`);
 *   - one or two glyphs derived from `text` and uppercased: two word initials
 *     for multi-word Latin names ("Claude Sonnet" → "CS"), the first two
 *     characters for a single Latin word ("Qwen" → "QW"), and the first
 *     character for non-Latin names such as Chinese ("通义千问" → "通").
 *
 * The glyph is painted as SVG <text> with a system font stack rather than as a
 * hand-drawn path, because the input is arbitrary user/model text and must
 * still render CJK, accented and other non-Latin names sensibly. The tile keeps
 * the same inline-safety rules as the brand marks: no ids, no scripts, no
 * event handlers and no external references — all user text is XML-escaped.
 */

/**
 * Fixed letter-tile palette: dark, saturated hues so the white glyph keeps a
 * comfortable contrast ratio at 14px on both light and dark surfaces.
 */
const LETTER_PALETTE = Object.freeze([
  '#3730A3',
  '#1E40AF',
  '#1D4ED8',
  '#312E81',
  '#5B21B6',
  '#7E22CE',
  '#86198F',
  '#9F1239',
  '#B91C1C',
  '#9A3412',
  '#92400E',
  '#8B5A00',
  '#7C2D12',
  '#4A5568',
  '#374151',
  '#1C1917',
  '#166534',
  '#3F6212',
  '#0F766E',
  '#0E7490',
]);

/** System font stack for tile glyphs (multi-word families may stay unquoted). */
const LETTER_FONT =
  'Segoe UI, Microsoft YaHei, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Noto Sans SC, sans-serif';

/** Unicode word runs: letters and digits in any script (CJK included). */
const LETTER_WORDS = /[\p{L}\p{N}]+/gu;

/** Characters that count as "Latin/digit evidence" for glyph selection. */
const LETTER_ASCII = /[A-Za-z0-9]/;

/** Control characters and lone surrogates that are invalid in XML/HTML text. */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/** The five text-significant characters escaped by both helpers. */
const XML_SPECIAL = /[&<>"']/g;

/** Entity table shared by the XML and HTML escapers. */
const SAFE_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * Escape a value for interpolation into XML/SVG text or attribute content.
 * Drops characters XML 1.0 cannot represent instead of emitting them raw.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(XML_INVALID, '')
    .replace(XML_SPECIAL, (character) => SAFE_ENTITIES[character]);
}

/**
 * Escape a value for interpolation into HTML text or attribute content.
 * Same character set and entity spellings as {@link escapeXml}.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(XML_INVALID, '')
    .replace(XML_SPECIAL, (character) => SAFE_ENTITIES[character]);
}

/**
 * Stable 32-bit FNV-1a hash over the code points of `seed`. Deterministic on
 * every JS engine and independent of the tile text, so renaming a label keeps
 * its colour when callers pass an explicit seed.
 * @param {string} seed
 * @returns {number} Unsigned 32-bit hash.
 */
const letterHash = (seed) => {
  let hash = 0x811c9dc5;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** First ASCII letter/digit of a word run, or '' when it has none. */
const letterFirstAscii = (token) => {
  for (const character of token) {
    if (LETTER_ASCII.test(character)) return character;
  }
  return '';
};

/** Every ASCII letter/digit of a word run, in order. */
const letterAsciiChars = (token) =>
  Array.from(token).filter((character) => LETTER_ASCII.test(character));

/**
 * Pick the 1-2 glyphs rendered inside the tile.
 * @param {unknown} text
 * @returns {string}
 */
const letterGlyphs = (text) => {
  const tokens = String(text ?? '').match(LETTER_WORDS) ?? [];
  const latin = tokens.filter((token) => LETTER_ASCII.test(token));
  if (latin.length >= 2) {
    return (letterFirstAscii(latin[0]) + letterFirstAscii(latin[1])).toUpperCase();
  }
  if (latin.length === 1) {
    return letterAsciiChars(latin[0]).slice(0, 2).join('').toUpperCase();
  }
  if (tokens.length > 0) {
    return Array.from(tokens[0])[0] ?? '?';
  }
  const fallback = Array.from(String(text ?? '').trim())[0];
  return fallback ?? '?';
};

/**
 * Build the deterministic fallback mark for an arbitrary name.
 * @param {unknown} text   Display text the glyphs come from.
 * @param {unknown} [seed] Colour seed; defaults to `text`.
 * @returns {{ title: string, svg: string }}
 */
export function letterTile(text, seed = text) {
  const title = String(text ?? '').trim() || 'Model';
  const glyphs = Array.from(letterGlyphs(text));
  const fill = LETTER_PALETTE[letterHash(String(seed ?? '')) % LETTER_PALETTE.length];
  // Two glyphs need a smaller size to stay inside the tile; CJK glyphs are
  // full-width, so a single one is already optically large at 13.2 units.
  const fontSize = glyphs.length > 1 ? 11.4 : 13.2;
  return {
    title,
    svg:
      '<svg viewBox="0 0 24 24">' +
      `<rect width="24" height="24" rx="6" fill="${fill}"/>` +
      `<text x="12" y="12" text-anchor="middle" dominant-baseline="central"` +
      ` font-family="${LETTER_FONT}" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">` +
      escapeXml(glyphs.join('')) +
      '</text></svg>',
  };
}
