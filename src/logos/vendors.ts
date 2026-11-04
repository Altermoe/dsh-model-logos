/**
 * Brand marks for the provider / vendor channels in Settings → Models.
 *
 * Contract for every entry:
 *   key   — a key returned by `matchVendorLogo` (src/match.ts) and listed in
 *           `LOGO_KEYS`;
 *   { title, svg } where svg is one self-contained 24x24 <svg> string.
 *
 * Artwork rules (they keep 14-16px rendering legible and inlining safe):
 *   - rounded-square brand tile, flat fills only: no <defs>, no gradient, no id
 *     attributes, no <text>, no external references, no scripts or event
 *     handlers;
 *   - white/near-white glyph centred in the tile, strokes >= 1.6 units wide;
 *   - brand-coloured tile so the mark reads by colour + silhouette at 14px.
 *
 * Sources — the outlines are official single-colour vectorisations, fitted into
 * the shared tile convention:
 *   - opencode, cerebras, cloudflare, together, fireworks, baseten, ling
 *     (Ant Ling) and typesafeai: `@lobehub/icons-static-svg` 1.101.0, MIT
 *     (https://github.com/lobehub/lobe-icons);
 *   - github, vercel, microsoftazure: Simple Icons, CC0 1.0
 *     (https://simpleicons.org);
 *   - xiaomi: the Simple Icons Xiaomi mark, with the rounded-square body
 *     replaced by the orange tile and only the knocked-out "mi" kept, so the
 *     mark matches the official orange Mi logo;
 *   - radius: hand-drawn letterform fallback (no official mark found).
 *
 * Keys owned here: xiaomi, opencode, cerebras, cloudflare, together, fireworks,
 * github, vercel, baseten, azure, antling, radius, typesafe.
 */
import type { LogoSet } from '../types';

/** One 24x24 mark: rounded brand tile plus the glyph drawn on top of it. */
const tile = (fill: string, glyph: string): string =>
  `<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${fill}"/>${glyph}</svg>`;

/**
 * Glyph outlines are drawn in the official 24-unit box. `fit` scales one into
 * the tile and centres it: `scale` 0.7 leaves 3.6 units of padding per side,
 * 0.8 leaves 2.4.
 */
const fit = (paths: readonly string[], fill = '#FFFFFF', scale = 0.7): string => {
  const pad = ((24 - 24 * scale) / 2).toFixed(1);
  return `<g transform="translate(${pad} ${pad}) scale(${scale})" fill="${fill}">${paths.join('')}</g>`;
};

/** One <path>; `evenOdd` keeps counter shapes as holes inside the silhouette. */
const path = (d: string, evenOdd = false): string => `<path d="${d}"${evenOdd ? ' fill-rule="evenodd"' : ''}/>`;

/** Xiaomi's "mi" counters, lifted out of the rounded-square Simple Icons mark. */
const XIAOMI_MI =
  'M4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15' +
  '.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.1' +
  '51.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.' +
  '15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10' +
  '.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .1' +
  '52-.147Z';

/** OpenCode Zen: square frame monogram. */
const OPENCODE = 'M16 6H8v12h8V6zm4 16H4V2h16v20z';

/** Cerebras: wafer made of nested C-shaped rings around the centre letter. */
const CEREBRAS_RINGS =
  'M14.121 2.701a9.299 9.299 0 000 18.598V22.7c-5.91 0-10.7-4.791-10.7-10.701S8.21 1.299 14.12 1.299V2.7zm4.752 3' +
  '.677A7.353 7.353 0 109.42 17.643l-.901 1.074a8.754 8.754 0 01-1.08-12.334 8.755 8.755 0 0112.335-1.08l-.901 1.' +
  '075zm-2.255.844a5.407 5.407 0 00-5.048 9.563l-.656 1.24a6.81 6.81 0 016.358-12.043l-.654 1.24zM14.12 8.539a3.4' +
  '6 3.46 0 100 6.922v1.402a4.863 4.863 0 010-9.726v1.402z';
const CEREBRAS_C =
  'M15.407 10.836a2.24 2.24 0 00-.51-.409 1.084 1.084 0 00-.544-.152c-.255 0-.483.047-.684.14a1.58 1.58 0 00-.84.' +
  '912c-.074.203-.11.416-.11.631 0 .218.036.43.11.631a1.594 1.594 0 00.84.913c.2.093.43.14.684.14.216 0 .417-.046' +
  '.602-.135.188-.09.35-.225.475-.392l.928 1.006c-.14.14-.3.261-.482.363a3.367 3.367 0 01-1.083.38c-.17.026-.317.' +
  '04-.44.04a3.315 3.315 0 01-1.182-.21 2.825 2.825 0 01-.961-.597 2.816 2.816 0 01-.644-.929 2.987 2.987 0 01-.2' +
  '38-1.21c0-.444.08-.847.238-1.21.15-.35.368-.666.643-.929.278-.261.605-.464.962-.596a3.315 3.315 0 011.182-.21c' +
  '.355 0 .712.068 1.072.204.361.138.685.36.944.649l-.962.97z';

/** Cloudflare: the cloud plus the flare tail on its right. */
const CLOUDFLARE_CLOUD =
  'M16.493 17.4c.135-.52.08-.983-.161-1.338-.215-.328-.592-.519-1.05-.519l-8.663-.109a.148.148 0 01-.135-.082c-.0' +
  '27-.054-.027-.109-.027-.163.027-.082.108-.164.189-.164l8.744-.11c1.05-.054 2.153-.9 2.556-1.937l.511-1.31c.027' +
  '-.055.027-.11.027-.164C17.92 8.91 15.66 7 12.942 7c-2.503 0-4.628 1.638-5.381 3.903a2.432 2.432 0 00-1.803-.49' +
  '1c-1.21.109-2.153 1.092-2.287 2.32-.027.328 0 .628.054.9C1.56 13.688 0 15.326 0 17.319c0 .19.027.355.027.545 0' +
  ' .082.08.137.161.137h15.983c.08 0 .188-.055.215-.164l.107-.437';
const CLOUDFLARE_FLARE =
  'M19.238 11.75h-.242c-.054 0-.108.054-.135.109l-.35 1.2c-.134.52-.08.983.162 1.338.215.328.592.518 1.05.518l1.8' +
  '55.11c.054 0 .108.027.135.082.027.054.027.109.027.163-.027.082-.108.164-.188.164l-1.91.11c-1.05.054-2.153.9-2.' +
  '557 1.937l-.134.355c-.027.055.026.137.107.137h6.592c.081 0 .162-.055.162-.137.107-.41.188-.846.188-1.31-.027-2' +
  '.62-2.153-4.777-4.762-4.777';

/** Together AI: three interlocking rounded nodes (brand gradient colours). */
const TOGETHER_TOP =
  'M23.197 4.503A6 6 0 0015 2.307a5.973 5.973 0 00-2.995 4.933l5.996.008v.515h-5.996c.039.937.298 1.87.8 2.74a6 6' +
  ' 0 1010.39-6z';
const TOGETHER_LEFT =
  'M.805 4.5A6 6 0 003 12.697a5.972 5.972 0 005.77.127L5.779 7.627l.446-.257 2.997 5.192A6 6 0 10.804 4.5z';
const TOGETHER_BOTTOM =
  'M12 23.894a6 6 0 005.999-6c0-2.13-1.1-3.996-2.775-5.06l-3.005 5.189-.444-.258 2.997-5.192A6 6 0 1012 23.894z';

/** Fireworks: the three-pronged spark. */
const FIREWORKS =
  'M14.8 5l-2.801 6.795L9.195 5H7.397l3.072 7.428a1.64 1.64 0 003.038.002L16.598 5H14.8zm1.196 10.352l5.124-5.244' +
  '-.699-1.669-5.596 5.739a1.664 1.664 0 00-.343 1.807 1.642 1.642 0 001.516 1.012L16 17l8-.02-.699-1.669-7.303.0' +
  '41h-.002zM2.88 10.104l.699-1.669 5.596 5.739c.468.479.603 1.189.343 1.807a1.643 1.643 0 01-1.516 1.012l-8-.018' +
  '-.002.002.699-1.669 7.303.042-5.122-5.246z';

/** GitHub: octocat mark. */
const GITHUB =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04' +
  '-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.8' +
  '38 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5' +
  '.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 ' +
  '1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.' +
  '22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.5' +
  '65 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

/** Vercel: the triangle. */
const VERCEL = 'm12 1.608 12 20.784H0Z';

/** Baseten: the stepped-block "b". */
const BASETEN =
  'M2.316 4.8h14.682v4.8H7.31a.302.302 0 00-.308.3v4.2c0 .171.14.3.308.3h9.688v4.8h-4.686a.302.302 0 00-.308.3v4.' +
  '2c0 .171.141.3.308.3h4.378a.297.297 0 00.308-.3v-4.5h4.694a.302.302 0 00.308-.3v-4.2c0-.171-.14-.3-.308-.3h-4.' +
  '694V9.6h4.694A.302.302 0 0022 9.3V5.1c0-.171-.14-.3-.308-.3h-4.694V.3c0-.171-.14-.3-.308-.3H2.316A.31.31 0 002' +
  ' .3v4.2c0 .171.14.3.316.3z';

/** Azure: the two-piece "A". */
const AZURE =
  'M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14v.002L17.35 1.76A1.62 1.62 0 0 0 15.816.657H8.184A1.62 1.62 0 0 0 6.6' +
  '5 1.76L.086 21.204a1.62 1.62 0 0 0 1.536 2.139h4.741a1.62 1.62 0 0 0 1.535-1.103l.977-2.892 4.947 3.675c.28.20' +
  '8.618.32.966.32m-3.084-12.531 3.624 10.739a.54.54 0 0 1-.51.713v-.001h-.03a.54.54 0 0 1-.322-.106l-9.287-6.9h4' +
  '.853m6.313 7.006c.116-.326.13-.694.007-1.058L9.79 1.76a1.722 1.722 0 0 0-.007-.02h6.034a.54.54 0 0 1 .512.366l' +
  '6.562 19.445a.54.54 0 0 1-.338.684';

/** Ant Ling: the lark-inspired swirl. */
const LING =
  'M9.561 0.074a0.46 0.46 0 0 1 0.517 0.011l2.848 1.357a0.222 0.222 0 0 1-0.033 0.374C9.008 3.93 6.663 5.994 5.43' +
  ' 7.997c-0.798 1.296-2.264 4.83-0.937 8.02 1.375 3.301 4.49 4.493 6.797 4.493 1.743 0 2.927-0.522 4.13-1.334 3.' +
  '262-2.204 3.638-6.503 1.21-9.46a10 10 0 0 1 2.2 2.902 6.5 6.5 0 0 0-0.72-1.664c-0.72-1.176-1.688-2.163-3.056-2' +
  '.849-3.045-1.526-9.397-0.79-10.397 5.78 0.1-4.557 3.127-7.416 5.868-8.3a9.7 9.7 0 0 1 4.654-0.314c2.029-1.639 ' +
  '4.272-2.376 5.075-2.601a0.53 0.53 0 0 1 0.522 0.137c0.23 0.23 0.63 0.632 1.142 1.135h0.003c0.152 0.15 0.073 0.' +
  '41-0.138 0.45-1.974 0.38-3.322 0.755-4.746 1.412 1.727 0.698 3.206 1.92 4.108 3.606a0.367 0.367 0 0 1-0.199 0.' +
  '52l-1.207 0.437c1.061 1.8 1.334 4.006 0.813 6.266-0.884 3.843-3.845 6.562-7.626 7.209a9.5 9.5 0 0 1-1.756 0.15' +
  '7 0.37 0.37 0 0 1-0.363-0.341 0.36 0.36 0 0 1-0.043-0.245l0.231-1.295c-1.055-0.074-2.045-0.248-3.036-0.648C2.0' +
  '77 19.094 1.46 13.297 2.304 9.785 3.4 5.23 6.766 1.78 9.561 0.074';

/** TypeSafe AI: isometric stacked-cube monogram. */
const TYPESAFE =
  'M16.512 2.928L16.512 7.067 20.242 9.487 20.243 18.652 12 24 7.489 21.073 7.489 16.82 3.756 14.399 3.756 5.35 4' +
  '.111 5.118 12 0ZM9.697 20.65L11.998 22.144 18.032 18.227 15.732 16.735ZM12.779 10.332L12.779 14.4 9.046 16.822' +
  ' 9.046 19.216 14.953 15.383 14.953 8.921ZM16.512 15.384L18.684 16.794 18.684 10.332 16.512 8.922ZM5.966 13.976' +
  'L8.268 15.47 10.569 13.976 8.268 12.485ZM5.316 6.193L5.316 12.544 7.487 11.134 7.487 7.066 11.221 4.643 11.221' +
  ' 2.36 5.316 6.193ZM9.047 11.132L11.22 12.542 11.22 10.332 9.049 8.921 9.049 11.132ZM9.697 7.487L12 8.981 14.3 ' +
  '7.488 12 5.994ZM12.78 4.643L14.953 6.054 14.953 3.774 12.78 2.359Z';

export const LOGOS: LogoSet = {
  // Xiaomi MiMo channels: orange tile, white "mi" counters.
  xiaomi: {
    title: 'Xiaomi',
    svg: tile('#FF6900', `<path d="${XIAOMI_MI}" fill="#FFFFFF"/>`),
  },

  // OpenCode Zen: near-black tile, white frame monogram.
  opencode: {
    title: 'OpenCode',
    svg: tile('#0B0B0C', fit([path(OPENCODE)], '#FFFFFF', 0.8)),
  },

  // Cerebras: orange tile, white wafer rings + centre C.
  cerebras: {
    title: 'Cerebras',
    svg: tile('#F15A29', fit([path(CEREBRAS_RINGS, true), path(CEREBRAS_C)])),
  },

  // Cloudflare: orange tile, white cloud + flare.
  cloudflare: {
    title: 'Cloudflare',
    svg: tile('#F38020', fit([path(CLOUDFLARE_CLOUD), path(CLOUDFLARE_FLARE)])),
  },

  // Together AI: near-black tile, three nodes in the brand gradient colours
  // (orange → magenta → periwinkle) rather than a flat white silhouette.
  together: {
    title: 'Together AI',
    svg: tile(
      '#010120',
      '<g transform="translate(3.6 3.6) scale(0.7)">' +
        `<path d="${TOGETHER_TOP}" fill="#FF8A4C"/>` +
        `<path d="${TOGETHER_LEFT}" fill="#EF2CC1"/>` +
        `<path d="${TOGETHER_BOTTOM}" fill="#5380DE"/>` +
        '</g>',
    ),
  },

  // Fireworks: electric-violet tile, white spark.
  fireworks: {
    title: 'Fireworks',
    svg: tile('#6720FF', fit([path(FIREWORKS, true)])),
  },

  // GitHub: near-black tile, white octocat mark.
  github: {
    title: 'GitHub',
    svg: tile('#181717', fit([path(GITHUB)])),
  },

  // Vercel: black tile, white triangle.
  vercel: {
    title: 'Vercel',
    svg: tile('#000000', fit([path(VERCEL)])),
  },

  // Baseten: near-black tile, brand-green stepped "b".
  baseten: {
    title: 'Baseten',
    svg: tile('#0B0F0C', fit([path(BASETEN, true)], '#17D465')),
  },

  // Azure: Azure-blue tile, white "A".
  azure: {
    title: 'Microsoft Azure',
    svg: tile('#0078D4', fit([path(AZURE)])),
  },

  // Ant Ling: black tile, white lark swirl.
  antling: {
    title: 'Ant Ling',
    svg: tile('#0B0B0C', fit([path(LING)])),
  },

  // Radius: hand-drawn "R" letterform on an indigo tile.
  radius: {
    title: 'Radius',
    svg: tile(
      '#312E81',
      '<g fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round">' +
        '<path d="M8.2 18.4V5.6"/>' +
        '<path d="M8.2 5.6h4.9a3.9 3.9 0 0 1 0 7.8H8.2"/>' +
        '<path d="M12.2 13.4 17 18.5"/>' +
        '</g>',
    ),
  },

  // TypeSafe AI: teal tile, white isometric cube stack.
  typesafe: {
    title: 'TypeSafe',
    svg: tile('#0F766E', fit([path(TYPESAFE)])),
  },
};
