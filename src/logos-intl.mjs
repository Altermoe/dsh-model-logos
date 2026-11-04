/**
 * Brand marks for international model families.
 *
 * Contract for every entry:
 *   key   — a key returned by src/match.mjs
 *   { title, svg } where svg is one self-contained 24x24 <svg> string.
 *
 * Artwork rules (they keep 14-16px rendering legible and inlining safe):
 *   - rounded-square brand tile, flat fills only: no <defs>, no gradient, no id
 *     attributes, no <text>, no external references, no scripts or event handlers;
 *   - white/near-white glyph centred in the tile, strokes >= 1.6 units wide;
 *   - brand-coloured tile so the mark reads by colour + silhouette at 14px.
 *
 * The marks below are hand-drawn vector reconstructions of each brand's official
 * logo, redrawn for an offline, dependency-free bundle. Replace any entry with an
 * official asset when one is available under a redistribution-friendly licence.
 * Exception: Mistral's pixel-block "M" is the official single-colour outline
 * from `@lobehub/icons-static-svg` 1.101.0 (MIT), fitted into the shared tile.
 * Mistral's official mark is a yellow-to-red five-band gradient; the glyph here
 * is the flat white single-colour variant so it survives 14 px rendering.
 *
 * Keys owned here: openai, claude, gemini, meta, mistral, xai, microsoft, nvidia,
 * aws, cohere, perplexity, huggingface, ollama, groq, openrouter.
 */

/** One 24x24 mark: rounded brand tile plus the glyph drawn on top of it. */
const mark = (fill, glyph) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="${fill}"/>${glyph}</svg>`;

/**
 * Repeat a glyph centred on the canvas centre, `count` times, `step` degrees apart.
 * Used for the radially symmetric marks (OpenAI rosette, Claude sun).
 */
const radial = (count, step, glyph) =>
  `<g fill="#FFFFFF">${Array.from(
    { length: count },
    (_, index) => `<path transform="translate(12 12) rotate(${index * step})" d="${glyph}"/>`,
  ).join('')}</g>`;

/** OpenAI blade, drawn pointing up around the canvas centre. */
const OPENAI_BLADE =
  'M-2.7-6.3Q-2.7-7.3-1.7-7.3L1.6-7.3Q2.6-7.3 2.5-6.3L1.55-2.1Q1.4-1.6 0.9-1.65L-0.75-1.85Q-1.25-1.9-1.35-2.4Z';

/** One tapered Claude ray, drawn pointing up around the canvas centre. */
const CLAUDE_RAY = 'M-1.8-1.2L-0.55-7.7Q0-8.1 0.55-7.7L1.8-1.2Z';

/** Cohere ring: five unequal annular sectors (breaks of 14-16 degrees). */
const COHERE_SEGMENTS = [
  'M19.08 12.5A7.1 7.1 0 0 1 15.11 18.38L13.53 15.15A3.5 3.5 0 0 0 15.49 12.24Z',
  'M13.23 18.99A7.1 7.1 0 0 1 7.83 17.74L9.94 14.83A3.5 3.5 0 0 0 12.61 15.45Z',
  'M6.41 16.37A7.1 7.1 0 0 1 4.94 11.26L8.52 11.63A3.5 3.5 0 0 0 9.24 14.15Z',
  'M5.42 9.34A7.1 7.1 0 0 1 10.04 5.18L11.04 8.64A3.5 3.5 0 0 0 8.75 10.69Z',
  'M12 4.9A7.1 7.1 0 0 1 17.89 8.03L14.9 10.04A3.5 3.5 0 0 0 12 8.5Z',
];

/** @type {Record<string, { title: string, svg: string }>} */
export const LOGOS = {
  // Six-fold interlocking rosette: six rounded blades around a small hexagonal
  // centre void; brand mark is monochrome, so a near-black tile carries it.
  openai: {
    title: 'OpenAI',
    svg: mark('#0B0B0C', radial(6, 60, OPENAI_BLADE)),
  },

  // Claude's twelve-ray tapered sunburst.
  claude: {
    title: 'Claude',
    svg: mark('#D97757', radial(12, 30, CLAUDE_RAY)),
  },

  // Gemini's four-point sparkle with concave sides.
  gemini: {
    title: 'Gemini',
    svg: mark(
      '#1A73E8',
      '<path d="M12 3.4C12.8 7.9 16.1 11.2 20.6 12C16.1 12.8 12.8 16.1 12 20.6C11.2 16.1 7.9 12.8 3.4 12C7.9 11.2 11.2 7.9 12 3.4Z" fill="#FFFFFF"/>',
    ),
  },

  // Meta's infinity loop: one closed ribbon crossing itself in the middle.
  meta: {
    title: 'Meta',
    svg: mark(
      '#0064E0',
      '<path d="M4.8 12C4.8 8.2 7.7 7.6 9.9 9.8L14.1 14.2C16.3 16.4 19.2 15.8 19.2 12C19.2 8.2 16.3 7.6 14.1 9.8L9.9 14.2C7.7 16.4 4.8 15.8 4.8 12Z" fill="none" stroke="#FFFFFF" stroke-width="2.4"/>',
    ),
  },

  // Mistral: the official pixel-block "M" — a 7×5 grid of 3.43-unit squares with
  // the notched shoulders and split feet. The official mark colours the blocks
  // with its warm yellow-to-red bands; flattened to the white-glyph tile
  // convention here, like the other multicolour marks, so the stepped silhouette
  // still reads at 14 px instead of dissolving into coloured noise.
  mistral: {
    title: 'Mistral',
    svg: mark(
      '#FA520F',
      '<g transform="translate(1.8 1.824) scale(0.85)" fill="#FFFFFF">' +
        '<path d="M3.428 3.4h3.429v3.428h3.429v3.429h-.002 3.431V6.828h3.427V3.4h3.43v13.714H24v3.429H13.714v-3.428h-3.428v-3.429h-3.43v3.428h3.43v3.429H0v-3.429h3.428V3.4zm10.286 13.715h3.428v-3.429h-3.427v3.429z"/>' +
        '</g>',
    ),
  },

  // xAI's bold slashed "X": one full diagonal, the other broken at the centre.
  xai: {
    title: 'xAI',
    svg: mark(
      '#0B0B0C',
      '<g fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="miter"><path d="M5 5.2L19 19"/><path d="M19 5.2L13.4 10.8"/><path d="M10.6 13.6L5 19"/></g>',
    ),
  },

  // Microsoft's four coloured squares (the squares are the glyph, on a light tile).
  microsoft: {
    title: 'Microsoft',
    svg: mark(
      '#F5F5F7',
      '<rect x="4.78" y="4.78" width="6.8" height="6.8" fill="#F25022"/>' +
        '<rect x="12.42" y="4.78" width="6.8" height="6.8" fill="#7FBA00"/>' +
        '<rect x="4.78" y="12.42" width="6.8" height="6.8" fill="#00A4EF"/>' +
        '<rect x="12.42" y="12.42" width="6.8" height="6.8" fill="#FFB900"/>',
    ),
  },

  // NVIDIA's eye: a white almond with the swirl cut into it.
  nvidia: {
    title: 'NVIDIA',
    svg: mark(
      '#76B900',
      '<path d="M4.5 13.1C7.5 8.4 15.4 7.6 19.5 10.4C16.4 15.8 8.4 16.9 4.5 13.1Z" fill="#FFFFFF"/>' +
        '<path d="M18.4 10.9C14.4 8.9 10.2 10.1 8.7 12.7C7.8 14.2 8.8 15.4 10.6 15.2C12.2 15 13.1 13.9 12.7 12.7C12.3 11.6 10.9 11.4 9.9 12.1" fill="none" stroke="#76B900" stroke-width="1.6" stroke-linecap="round"/>',
    ),
  },

  // AWS's orange smile-arrow on the dark navy tile.
  aws: {
    title: 'AWS',
    svg: mark(
      '#232F3E',
      '<path d="M5.4 10.5C7.6 15.7 14.8 16.5 17.8 11.8" fill="none" stroke="#FF9900" stroke-width="2.5" stroke-linecap="round"/>' +
        '<path d="M19.6 8.5L19.5 13.1L16 10.4Z" fill="#FF9900"/>',
    ),
  },

  // Cohere's segmented circular monogram: five thick broken rings.
  cohere: {
    title: 'Cohere',
    svg: mark(
      '#39594D',
      `<g fill="#FFFFFF">${COHERE_SEGMENTS.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    ),
  },

  // Perplexity's geometric square knot (a square-cut spiral).
  perplexity: {
    title: 'Perplexity',
    svg: mark(
      '#20808D',
      '<path d="M17.7 6.3H6.3V17.7H15.9V9.7H9.9V14.3H13.7" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter"/>',
    ),
  },

  // Hugging Face's hugging smiley: dark-brown face and hands on the yellow tile.
  huggingface: {
    title: 'Hugging Face',
    svg: mark(
      '#FFD21E',
      '<g fill="#4A3500">' +
        '<ellipse cx="6" cy="14.6" rx="1.7" ry="2.2" transform="rotate(-20 6 14.6)"/>' +
        '<ellipse cx="18" cy="14.6" rx="1.7" ry="2.2" transform="rotate(20 18 14.6)"/>' +
        '</g>' +
        '<circle cx="12" cy="12.2" r="5.3" fill="none" stroke="#4A3500" stroke-width="1.9"/>' +
        '<circle cx="10.1" cy="11.2" r="0.95" fill="#4A3500"/>' +
        '<circle cx="13.9" cy="11.2" r="0.95" fill="#4A3500"/>' +
        '<path d="M9.7 14C10.5 15.4 13.5 15.4 14.3 14" fill="none" stroke="#4A3500" stroke-width="1.7" stroke-linecap="round"/>',
    ),
  },

  // Ollama's llama head in profile, facing left, with the eye punched out.
  ollama: {
    title: 'Ollama',
    svg: mark(
      '#0B0B0C',
      '<path d="M9.9 19.7V15.4C7.3 14.8 5.6 13.6 5.3 12C5 10.4 6.3 9.3 8.3 9.4L8.6 7.4L9.7 4.6L11.1 7.4L11.3 7.8L12.3 4.7L13.9 7.7C15 8.6 15.5 9.9 15.5 11.4V19.7Z" fill="#FFFFFF"/>' +
        '<circle cx="10.2" cy="10.2" r="0.95" fill="#0B0B0C"/>',
    ),
  },

  // Groq's angular G with a lightning-style cut across the top-right corner.
  groq: {
    title: 'Groq',
    svg: mark(
      '#F55036',
      '<path d="M18.6 6H7.4V18H18.6V12.2H12.8" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="miter"/>' +
        '<path d="M17.2 3.2L21 7L21 3.2Z" fill="#F55036"/>',
    ),
  },

  // OpenRouter's branching route: one node splitting into two arms.
  openrouter: {
    title: 'OpenRouter',
    svg: mark(
      '#6467F2',
      '<g fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 18.4V13.6"/>' +
        '<path d="M12 13.6C12 10.8 10.4 9.2 7.6 9.2"/>' +
        '<path d="M12 13.6C12 10.8 13.6 9.2 16.4 9.2"/>' +
        '</g>' +
        '<g fill="#FFFFFF">' +
        '<circle cx="12" cy="18.9" r="1.35"/>' +
        '<circle cx="12" cy="13.6" r="1.7"/>' +
        '<circle cx="6.6" cy="9.2" r="1.5"/>' +
        '<circle cx="17.4" cy="9.2" r="1.5"/>' +
        '</g>',
    ),
  },
};
