/**
 * Derive and verify the artwork that is not sourced from the Lobe package.
 *
 * Three keys need a mark the pinned `@lobehub/icons-static-svg` set cannot give:
 * `zhipu` and `glm` share the official zai-org/GLM-5 black tile with the white Z,
 * and `gemini` keeps the official aurora colouring that the set only ships with
 * gradient definitions, which an inlined tile may not carry (no ids, no `url(`).
 *
 * The sources are committed verbatim under `reference/derived/` and pinned by
 * sha256 in `reference/derived/manifest.json`; this script reads only those files
 * (never the network), rebuilds the tiles, and either writes the generated module
 *
 *   src/logos/derived.generated.ts
 *
 * (default) or compares the committed module against the rebuild (`--check`).
 *
 * The Z tile is rebuilt analytically from the pinned vector: the plate fill is
 * read from the `.st15` rule, the three white `.st23` shapes are kept verbatim,
 * and the fit is computed from the plate path's own bounding box, with cubic
 * extrema solved exactly so the transform is not rounded by a control-point hull.
 *
 * The aurora tile is rebuilt from the pinned gradients without a browser: the
 * star outline is flattened (arcs and cubics included), the three opacity ramps
 * are composed over the base colour, and the silhouette is quantised into flat
 * cells that are filled with their own mean colour. Both derivations assert their
 * measured bounds here, so `--check` re-derives the shipped geometry from the
 * source instead of trusting the record.
 *
 * Usage (run from the repository root):
 *   pnpm exec tsx scripts/derive-marks.ts            # regenerate the module
 *   pnpm exec tsx scripts/derive-marks.ts --check    # verify it, offline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Pinned sources plus the recorded derivation, committed together. */
const DERIVED_DIR = resolve(ROOT, 'reference/derived');
const DERIVED_MANIFEST = resolve(DERIVED_DIR, 'manifest.json');
const DERIVED_TILES = resolve(DERIVED_DIR, 'tiles.json');
const GENERATED_FILE = resolve(ROOT, 'src/logos/derived.generated.ts');

/** Tile geometry shared with the rest of the artwork. */
const TILE_SIZE = 24;
const TILE_RADIUS = 6;
/** Formatter print width; generated lines must already respect it. */
const PRINT_WIDTH = 120;

/** A collected validation failure; all are reported before the script exits. */
type Problems = string[];

/* -------------------------------------------------------------------------- */
/* Pinned source verification                                                 */
/* -------------------------------------------------------------------------- */

/** One pinned upstream file and the marks derived from it. */
interface DerivedSource {
  readonly url: string;
  readonly licence: string;
  readonly sha256: string;
  readonly marks: readonly string[];
  readonly note: string;
}

/** One mark the derived tile carries, with the name and group it renders under. */
interface DerivedMark {
  readonly key: string;
  readonly title: string;
  readonly group: string;
}

/** The recorded derivation for one tile. */
interface DerivedTile {
  readonly marks: readonly DerivedMark[];
  readonly source: string;
  readonly sourceSha256: string;
  readonly recipe: string;
  readonly measures: Readonly<Record<string, unknown>>;
  readonly tile: string;
  /** Digest of `tile`, so a hand edit of the module is detectable offline. */
  readonly tileSha256: string;
}

interface DerivedManifest {
  readonly files: Readonly<Record<string, DerivedSource>>;
}

interface DerivedTiles {
  /** Mutable: write mode replaces an entry when its pinned source rebuilds differently. */
  tiles: Record<string, DerivedTile>;
}

/** Hash a UTF-8 string the way the manifest was pinned. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Read and structurally validate the pinned-source manifest. */
function readManifest(problems: Problems): DerivedManifest {
  const files: Record<string, DerivedSource> = {};
  if (!existsSync(DERIVED_MANIFEST)) {
    problems.push(`missing ${DERIVED_MANIFEST} — it pins every reference/derived source`);
    return { files };
  }
  const raw: unknown = JSON.parse(readFileSync(DERIVED_MANIFEST, 'utf8'));
  const record = raw as Record<string, unknown>;
  const entries = record['files'];
  if (entries === null || typeof entries !== 'object') {
    problems.push('reference/derived/manifest.json: "files" must be an object');
    return { files };
  }
  for (const [name, value] of Object.entries(entries as Record<string, unknown>)) {
    const entry = value as Record<string, unknown>;
    const digest = entry['sha256'];
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      problems.push(`reference/derived/manifest.json: "${name}" sha256 is not a hex digest`);
      continue;
    }
    const url = entry['url'];
    const licence = entry['licence'];
    const note = entry['note'];
    const marks = entry['marks'];
    if (typeof url !== 'string' || url.trim() === '') problems.push(`"${name}" needs a url`);
    if (typeof licence !== 'string' || licence.trim() === '') problems.push(`"${name}" needs a licence`);
    if (typeof note !== 'string' || note.trim() === '') problems.push(`"${name}" needs a note`);
    if (!Array.isArray(marks) || marks.some((mark) => typeof mark !== 'string')) {
      problems.push(`"${name}" marks must be a list of keys`);
      continue;
    }
    files[name] = {
      url: typeof url === 'string' ? url : '',
      licence: typeof licence === 'string' ? licence : '',
      sha256: digest,
      marks: marks as string[],
      note: typeof note === 'string' ? note : '',
    };
  }
  return { files };
}

/** Verify one committed source against its pin and return its text. */
function readPinnedSource(manifest: DerivedManifest, name: string, problems: Problems): string | null {
  const pin = manifest.files[name];
  if (pin === undefined) {
    problems.push(`reference/derived/${name} is not pinned in manifest.json`);
    return null;
  }
  const path = resolve(DERIVED_DIR, name);
  if (!existsSync(path)) {
    problems.push(`missing committed source reference/derived/${name}`);
    return null;
  }
  const text = readFileSync(path, 'utf8');
  const digest = sha256(text);
  if (digest !== pin.sha256) {
    problems.push(`reference/derived/${name} sha256 ${digest} does not match the pin ${pin.sha256}`);
    return null;
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Path geometry — exact bounding box of a rounded-rect plate                  */
/* -------------------------------------------------------------------------- */

/** Evaluate a cubic Bézier's extrema on one axis and return every turning value. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const values = [p0, p3];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  // derivative: 3*(a t^2 + b t + c)
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1)
        values.push((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3);
    }
    return values;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return values;
  for (const t of [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)]) {
    if (t > 0 && t < 1) {
      values.push((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3);
    }
  }
  return values;
}

/**
 * Measure the exact bounding box of one SVG path.
 *
 * Cubic segments contribute their real extrema rather than their control points,
 * so a path whose relative and absolute segments disagree by a rounding step (the
 * pinned plate does: `h19.03`/`v19.03` overshoot by 0.01 while the closing `C`
 * returns to 28.51) is measured as a renderer would draw it.
 * @param d - the path's `d` attribute.
 */
function pathBBox(d: string): { x: number; y: number; width: number; height: number } {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (px: number, py: number): void => {
    xs.push(px);
    ys.push(py);
  };
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/^[a-zA-Z]$/.test(token)) {
      command = token;
      i += 1;
      if (command === 'Z' || command === 'z') {
        x = startX;
        y = startY;
        continue;
      }
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case 'M': {
        const nx = num();
        const ny = num();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        startX = x;
        startY = y;
        push(x, y);
        // subsequent pairs are implicit lineto
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const nx = num();
        const ny = num();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        push(x, y);
        break;
      }
      case 'H': {
        const nx = num();
        x = relative ? x + nx : nx;
        push(x, y);
        break;
      }
      case 'V': {
        const ny = num();
        y = relative ? y + ny : ny;
        push(x, y);
        break;
      }
      case 'C': {
        const x1 = relative ? x + num() : num();
        const y1 = relative ? y + num() : num();
        const x2 = relative ? x + num() : num();
        const y2 = relative ? y + num() : num();
        const x3 = relative ? x + num() : num();
        const y3 = relative ? y + num() : num();
        for (const v of cubicExtrema(x, x1, x2, x3)) xs.push(v);
        for (const v of cubicExtrema(y, y1, y2, y3)) ys.push(v);
        x = x3;
        y = y3;
        break;
      }
      default:
        throw new Error(`pathBBox: unsupported path command "${command}"`);
    }
  }
  if (xs.length === 0 || ys.length === 0) throw new Error('pathBBox: empty path');
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/* -------------------------------------------------------------------------- */
/* Z tile derivation                                                          */
/* -------------------------------------------------------------------------- */

/** Round to four decimals without trailing zeros, matching the tile convention. */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Extract the plate fill and the white Z shapes from the pinned GLM-5 logo.
 *
 * The document defines ~195 CSS classes but only `.st15` (the plate) and `.st23`
 * (the white glyph) are ever referenced, so the class table is resolved here and
 * the shapes are re-emitted with explicit geometry — the `<style>` block, the
 * empty `图层_2` group and every `id` attribute are dropped, which is what lets
 * the result be inlined.
 * @param source - the pinned `zhipu-z.svg` text.
 */
function deriveZ(source: string): { tile: string; measures: Record<string, unknown> } {
  const classes: Record<string, string> = {};
  for (const match of source.matchAll(/\.(st\d+)\s*\{([^}]*)\}/g)) {
    const fill = /fill\s*:\s*([^;]+)/.exec(match[2] ?? '');
    if (fill !== null) classes[`.${match[1] ?? ''}`] = (fill[1] ?? '').trim();
  }
  const plateFill = classes['.st15'];
  if (plateFill === undefined) throw new Error('zhipu-z.svg: the .st15 plate fill was not found');

  const body = source
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');

  const shapes: string[] = [];
  let plateD = '';
  for (const match of body.matchAll(/<(path|polygon)\b([^>]*?)\/?>/g)) {
    const attributes = match[2] ?? '';
    const className = /class="([^"]*)"/.exec(attributes)?.[1] ?? '';
    const fill = classes[`.${className}`];
    if (match[1] === 'path' && className === 'st15') {
      plateD = /d="([^"]*)"/.exec(attributes)?.[1] ?? '';
      continue;
    }
    if (fill !== '#FFFFFF') continue;
    if (match[1] === 'polygon') {
      const points = (/points="([^"]*)"/.exec(attributes)?.[1] ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      let d = '';
      for (let index = 0; index + 1 < points.length; index += 2) {
        d += `${index === 0 ? 'M' : 'L'}${points[index]} ${points[index + 1]}`;
      }
      shapes.push(`<path d="${d}Z"/>`);
    } else {
      shapes.push(`<path d="${/d="([^"]*)"/.exec(attributes)?.[1] ?? ''}"/>`);
    }
  }
  if (plateD === '') throw new Error('zhipu-z.svg: the .st15 plate path was not found');
  if (shapes.length === 0) throw new Error('zhipu-z.svg: no .st23 white shapes were found');

  const plate = pathBBox(plateD);
  const scale = TILE_SIZE / plate.width;
  const transformX = formatNumber(-plate.x * scale);
  const transformY = formatNumber(-plate.y * scale);
  const transform = `translate(${transformX} ${transformY}) scale(${formatNumber(scale)})`;

  // The Z sits at the centre of the official plate. The pinned plate is not
  // perfectly square (27.03 × 27.02 — its `h19.03`/`v19.03` walk overshoot by a
  // hundredth while the closing curve returns to 28.51), so the translate is
  // solved from the glyph itself: the Z's mapped centre must land on (12,12).
  const glyph = pathBBox(shapes.map((shape) => /d="([^"]*)"/.exec(shape)?.[1] ?? '').join(' '));
  const centreOffsetX = TILE_SIZE / 2 - (glyph.x + glyph.width / 2) * scale;
  const centreOffsetY = TILE_SIZE / 2 - (glyph.y + glyph.height / 2) * scale;
  const fitX = formatNumber(centreOffsetX);
  const fitY = formatNumber(centreOffsetY);
  const fit = `translate(${fitX} ${fitY}) scale(${formatNumber(scale)})`;

  const mappedX = glyph.x * scale + Number(fitX);
  const mappedY = glyph.y * scale + Number(fitY);
  const mappedX2 = (glyph.x + glyph.width) * scale + Number(fitX);
  const mappedY2 = (glyph.y + glyph.height) * scale + Number(fitY);
  const glyphBox = {
    x: formatNumber(mappedX),
    y: formatNumber(mappedY),
    x2: formatNumber(mappedX2),
    y2: formatNumber(mappedY2),
  };
  const centreX = Number((glyph.x + glyph.width / 2).toFixed(6)) * Number(formatNumber(scale)) + Number(fitX);
  const centreY = Number((glyph.y + glyph.height / 2).toFixed(6)) * Number(formatNumber(scale)) + Number(fitY);
  if (Math.abs(centreX - TILE_SIZE / 2) > 0.005 || Math.abs(centreY - TILE_SIZE / 2) > 0.005) {
    throw new Error(`Z glyph is not centred on the tile: (${centreX}, ${centreY})`);
  }
  // The escape test reads the unrounded mapped box, so a value just past the
  // tile edge cannot hide behind the four-decimal recording format.
  if (mappedX < 0 || mappedY < 0 || mappedX2 > TILE_SIZE || mappedY2 > TILE_SIZE) {
    throw new Error(`Z glyph escapes the tile: ${JSON.stringify(glyphBox)}`);
  }
  // The two translate readings must agree: centring the glyph must not move it
  // away from where the plate's own origin places it.
  if (Math.abs(Number(fitX) - Number(transformX)) > 0.02 || Math.abs(Number(fitY) - Number(transformY)) > 0.02) {
    throw new Error(
      `Z fit disagrees with the plate origin: plate (${transformX}, ${transformY}) vs glyph (${fitX}, ${fitY})`,
    );
  }

  const tile =
    `<svg viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">` +
    `<rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}" fill="${plateFill}"/>` +
    `<g transform="${fit}" fill="#FFFFFF">${shapes.join('')}</g>` +
    '</svg>';

  return {
    tile,
    measures: {
      plateBBox: {
        x: formatNumber(plate.x),
        y: formatNumber(plate.y),
        width: formatNumber(plate.width),
        height: formatNumber(plate.height),
      },
      plateOriginTransform: transform,
      transform: fit,
      mappedGlyphBBox: glyphBox,
      mappedGlyphCentre: { x: Number(centreX.toFixed(4)), y: Number(centreY.toFixed(4)) },
      shapes: shapes.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Gemini derivation — flat quantisation of the official aurora               */
/* -------------------------------------------------------------------------- */

/** A point in the artwork's 24-unit space. */
interface ArtPoint {
  readonly x: number;
  readonly y: number;
}

/** One official linear ramp: a constant colour whose opacity falls to zero along an axis. */
interface AuroraRamp {
  readonly colour: readonly [number, number, number];
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Fraction of the axis at which the ramp reaches zero opacity. */
  readonly reach: number;
}

/** The composite recipe read from the pinned aurora. */
interface Aurora {
  readonly outline: readonly ArtPoint[];
  readonly ramps: readonly AuroraRamp[];
  readonly base: readonly [number, number, number];
}

/** One flat cell of the quantised aurora: a polygon and the colour it is painted. */
interface AuroraCell {
  readonly polygon: readonly ArtPoint[];
  readonly fill: readonly [number, number, number];
  readonly spread: number;
  readonly area: number;
}

/** Parse a `#RRGGBB` colour into 0..255 channels. */
function parseColourHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null || match[1] === undefined) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Format one 0..255 channel as two lowercase hex digits. */
function formatChannel(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');
}

/** Format 0..255 channels as the `#RRGGBB` tile fill. */
function formatColourHex(colour: readonly [number, number, number]): string {
  return `#${formatChannel(colour[0])}${formatChannel(colour[1])}${formatChannel(colour[2])}`.toUpperCase();
}

/** True for the separators an SVG path may use between its numbers. */
function isPathSeparator(ch: string): boolean {
  return ch === ' ' || ch === ',' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Flatten an SVG path into a polygon, sampling elliptical arcs at `tolerance`.
 *
 * The pinned aurora is one closed contour built from four large elliptical arcs
 * (the star's concave edges) plus two small corner arcs, so the walker only needs
 * M/L/H/V/C/A/Z — but it must read arc flags exactly: `a14.1 14.1 0 01-4.4-3`
 * writes the two flags back to back, which a number tokenizer would misread.
 * @param d - the path's `d` attribute.
 * @param tolerance - maximum chord error when flattening an arc, in user units.
 */
function flattenPath(d: string, tolerance: number): ArtPoint[] {
  const points: ArtPoint[] = [];
  let i = 0;
  const length = d.length;
  const skip = (): void => {
    while (i < length && isPathSeparator(d.charAt(i))) i += 1;
  };
  const readNumber = (): number => {
    skip();
    const start = i;
    const sign = d.charAt(i);
    if (sign === '+' || sign === '-') i += 1;
    while (i < length && d.charAt(i) >= '0' && d.charAt(i) <= '9') i += 1;
    if (d.charAt(i) === '.') {
      i += 1;
      while (i < length && d.charAt(i) >= '0' && d.charAt(i) <= '9') i += 1;
    }
    const exponent = d.charAt(i);
    if (exponent === 'e' || exponent === 'E') {
      i += 1;
      const exponentSign = d.charAt(i);
      if (exponentSign === '+' || exponentSign === '-') i += 1;
      while (i < length && d.charAt(i) >= '0' && d.charAt(i) <= '9') i += 1;
    }
    const text = d.slice(start, i);
    const value = Number(text);
    if (text === '' || Number.isNaN(value)) throw new Error(`artwork path: expected a number at ${start}: "${text}"`);
    return value;
  };
  const readFlag = (): number => {
    skip();
    const ch = d.charAt(i);
    if (ch !== '0' && ch !== '1') throw new Error(`artwork path: expected an arc flag at ${i}: "${ch}"`);
    i += 1;
    return ch === '1' ? 1 : 0;
  };

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  while (i < length) {
    skip();
    if (i >= length) break;
    const ch = d.charAt(i);
    if (/[A-Za-z]/.test(ch)) {
      command = ch;
      i += 1;
      if (command === 'Z' || command === 'z') {
        x = startX;
        y = startY;
        continue;
      }
    } else if (command === '') {
      throw new Error(`artwork path: numbers before any command at ${i}`);
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case 'M': {
        const nx = readNumber();
        const ny = readNumber();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        startX = x;
        startY = y;
        points.push({ x, y });
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const nx = readNumber();
        const ny = readNumber();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        points.push({ x, y });
        break;
      }
      case 'H': {
        const nx = readNumber();
        x = relative ? x + nx : nx;
        points.push({ x, y });
        break;
      }
      case 'V': {
        const ny = readNumber();
        y = relative ? y + ny : ny;
        points.push({ x, y });
        break;
      }
      case 'C': {
        const control1X = readNumber();
        const control1Y = readNumber();
        const control2X = readNumber();
        const control2Y = readNumber();
        const endX = readNumber();
        const endY = readNumber();
        const c1x = relative ? x + control1X : control1X;
        const c1y = relative ? y + control1Y : control1Y;
        const c2x = relative ? x + control2X : control2X;
        const c2y = relative ? y + control2Y : control2Y;
        const x3 = relative ? x + endX : endX;
        const y3 = relative ? y + endY : endY;
        const steps = Math.max(
          2,
          Math.min(
            256,
            Math.ceil(
              Math.sqrt(
                (6 *
                  Math.max(
                    Math.hypot(x - 2 * c1x + c2x, y - 2 * c1y + c2y),
                    Math.hypot(c1x - 2 * c2x + x3, c1y - 2 * c2y + y3),
                  )) /
                  tolerance,
              ),
            ),
          ),
        );
        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const u = 1 - t;
          points.push({
            x: u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x3,
            y: u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y3,
          });
        }
        x = x3;
        y = y3;
        break;
      }
      case 'A': {
        const rx = readNumber();
        const ry = readNumber();
        const rotation = readNumber();
        const largeArc = readFlag();
        const sweep = readFlag();
        const nx = readNumber();
        const ny = readNumber();
        const endX = relative ? x + nx : nx;
        const endY = relative ? y + ny : ny;
        for (const point of arcPoints(x, y, rx, ry, rotation, largeArc, sweep, endX, endY, tolerance))
          points.push(point);
        x = endX;
        y = endY;
        break;
      }
      default:
        throw new Error(`artwork path: unsupported command "${command}"`);
    }
  }
  if (points.length < 3) throw new Error('artwork path: fewer than three points');
  return points;
}

/** Signed angle between two 2D vectors, used by the arc parameterisation. */
function arcAngle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/** Sample an SVG elliptical arc (endpoint parameterisation) into points after the start. */
function arcPoints(
  x1: number,
  y1: number,
  rxInput: number,
  ryInput: number,
  rotationDegrees: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
  tolerance: number,
): ArtPoint[] {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ x: x2, y: y2 }];
  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const sign = largeArc !== sweep ? 1 : -1;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const startAngle = arcAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaAngle = arcAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  if (sweep === 1 && deltaAngle < 0) deltaAngle += 2 * Math.PI;
  const radius = Math.min(rx, ry);
  const step = radius <= tolerance ? Math.PI / 4 : 2 * Math.acos(Math.max(0, 1 - tolerance / radius));
  const segments = Math.max(2, Math.min(256, Math.ceil(Math.abs(deltaAngle) / step)));
  const points: ArtPoint[] = [];
  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + (deltaAngle * index) / segments;
    const px = rx * Math.cos(angle);
    const py = ry * Math.sin(angle);
    points.push({ x: cosPhi * px - sinPhi * py + cx, y: sinPhi * px + cosPhi * py + cy });
  }
  const last = points[points.length - 1];
  if (last !== undefined) points[points.length - 1] = { x: x2, y: y2 };
  return points;
}

/** Read the aurora's outline and its three opacity ramps from the pinned file. */
function parseAurora(source: string): Aurora {
  const gradients = new Map<string, AuroraRamp>();
  for (const block of source.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)) {
    const attributes = block[1] ?? '';
    const id = /id="([^"]*)"/.exec(attributes)?.[1];
    const x1 = Number(/x1="([^"]*)"/.exec(attributes)?.[1]);
    const y1 = Number(/y1="([^"]*)"/.exec(attributes)?.[1]);
    const x2 = Number(/x2="([^"]*)"/.exec(attributes)?.[1]);
    const y2 = Number(/y2="([^"]*)"/.exec(attributes)?.[1]);
    const stops = [...(block[2] ?? '').matchAll(/<stop\b([^>]*)\/?>/g)].map((stop) => stop[1] ?? '');
    if (id === undefined || stops.length < 2) throw new Error('gemini-aurora.svg: a gradient is missing stops');
    const colour = /stop-color="([^"]*)"/.exec(stops[0] ?? '')?.[1] ?? '';
    const endOpacity = /stop-opacity="([^"]*)"/.exec(stops[1] ?? '');
    const endOffset = /offset="([^"]*)"/.exec(stops[1] ?? '');
    // A two-stop ramp from full opacity to zero: the second stop's offset is the
    // fraction of the axis over which the colour fades out.
    if (endOpacity === null || Number(endOpacity[1]) !== 0) {
      throw new Error(`gemini-aurora.svg: gradient "${id}" is not a fade-to-transparent ramp`);
    }
    const reach = endOffset === null ? 1 : Number(endOffset[1]);
    gradients.set(id, { colour: parseColourHex(colour), x1, y1, x2, y2, reach });
    if (!(reach > 0) || [x1, y1, x2, y2].some((value) => Number.isNaN(value))) {
      throw new Error(`gemini-aurora.svg: gradient "${id}" has a malformed axis`);
    }
  }

  const paths = [...source.matchAll(/<path\b([^>]*)>/g)].map((path) => path[1] ?? '');
  if (paths.length < 2) throw new Error('gemini-aurora.svg: expected a base path and gradient overlays');
  const baseAttributes = paths[0] ?? '';
  const baseHex = /fill="(#[0-9A-Fa-f]{6})"/.exec(baseAttributes)?.[1];
  const outlineD = /d="([^"]*)"/.exec(baseAttributes)?.[1];
  if (baseHex === undefined || outlineD === undefined) throw new Error('gemini-aurora.svg: the base path is malformed');

  const ramps: AuroraRamp[] = [];
  for (const attributes of paths.slice(1)) {
    const gradientId = /fill="url\(#([^)]*)\)"/.exec(attributes)?.[1];
    if (gradientId === undefined) continue;
    const ramp = gradients.get(gradientId);
    if (ramp === undefined) throw new Error(`gemini-aurora.svg: no definition for gradient "${gradientId}"`);
    ramps.push(ramp);
  }
  if (ramps.length !== 3) throw new Error(`gemini-aurora.svg: expected three ramps, found ${ramps.length}`);
  return { outline: flattenPath(outlineD, 0.01), ramps, base: parseColourHex(baseHex) };
}

/** Composite the official ramps over the base colour at one point (sRGB src-over). */
function compositeAt(aurora: Aurora, x: number, y: number): [number, number, number] {
  let colour: [number, number, number] = [...aurora.base];
  for (const ramp of aurora.ramps) {
    const dx = ramp.x2 - ramp.x1;
    const dy = ramp.y2 - ramp.y1;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : ((x - ramp.x1) * dx + (y - ramp.y1) * dy) / span;
    const alpha = Math.max(0, Math.min(1, 1 - t / ramp.reach));
    colour = [
      alpha * ramp.colour[0] + (1 - alpha) * colour[0],
      alpha * ramp.colour[1] + (1 - alpha) * colour[1],
      alpha * ramp.colour[2] + (1 - alpha) * colour[2],
    ];
  }
  return colour;
}

/** Signed area of a polygon (shoelace); the sign gives the winding. */
function polygonArea(polygon: readonly ArtPoint[]): number {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    if (current === undefined || next === undefined) continue;
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

/** Point-in-polygon test (ray casting), used for sampling and coverage checks. */
function pointInPolygon(polygon: readonly ArtPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a === undefined || b === undefined) continue;
    const crosses = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Clip a polygon to an axis-aligned rectangle (Sutherland–Hodgman, convex clip). */
function clipToRectangle(polygon: readonly ArtPoint[], x0: number, y0: number, x1: number, y1: number): ArtPoint[] {
  const clip = (
    subject: readonly ArtPoint[],
    keep: (point: ArtPoint) => boolean,
    cut: (from: ArtPoint, to: ArtPoint) => ArtPoint,
  ): ArtPoint[] => {
    const output: ArtPoint[] = [];
    let previous = subject[subject.length - 1];
    if (previous === undefined) return output;
    for (const current of subject) {
      const currentInside = keep(current);
      const previousInside = keep(previous);
      if (currentInside) {
        if (!previousInside) output.push(cut(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(cut(previous, current));
      }
      previous = current;
    }
    return output;
  };
  const vertical =
    (value: number) =>
    (from: ArtPoint, to: ArtPoint): ArtPoint => {
      const t = (value - from.x) / (to.x - from.x);
      return { x: value, y: from.y + (to.y - from.y) * t };
    };
  const horizontal =
    (value: number) =>
    (from: ArtPoint, to: ArtPoint): ArtPoint => {
      const t = (value - from.y) / (to.y - from.y);
      return { x: from.x + (to.x - from.x) * t, y: value };
    };
  let result = [...polygon];
  result = clip(result, (point) => point.x >= x0, vertical(x0));
  result = clip(result, (point) => point.x <= x1, vertical(x1));
  result = clip(result, (point) => point.y >= y0, horizontal(y0));
  result = clip(result, (point) => point.y <= y1, horizontal(y1));
  return result;
}

/** Sample the official composite on a grid inset in one cell rectangle. */
function sampleCell(
  aurora: Aurora,
  polygon: readonly ArtPoint[],
  bounds: readonly [number, number, number, number],
): [number, number, number][] {
  const [x0, y0, x1, y1] = bounds;
  const samples: [number, number, number][] = [];
  const steps = 7;
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x = x0 + ((column + 0.5) * (x1 - x0)) / steps;
      const y = y0 + ((row + 0.5) * (y1 - y0)) / steps;
      if (pointInPolygon(polygon, x, y)) samples.push(compositeAt(aurora, x, y));
    }
  }
  return samples;
}

/** Mean colour of the samples. */
function meanColour(samples: readonly (readonly [number, number, number])[]): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  for (const sample of samples) {
    total[0] += sample[0];
    total[1] += sample[1];
    total[2] += sample[2];
  }
  const count = Math.max(1, samples.length);
  return [total[0] / count, total[1] / count, total[2] / count];
}

/** Euclidean distance in 0..255 RGB space. */
function colourDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Ramer–Douglas–Peucker simplification, so a cell records corners rather than samples. */
function simplify(points: readonly ArtPoint[], tolerance: number): ArtPoint[] {
  if (points.length <= 3) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [...points];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  let index = 0;
  let worst = 0;
  for (let at = 1; at < points.length - 1; at += 1) {
    const point = points[at];
    if (point === undefined) continue;
    const distance =
      length === 0
        ? Math.hypot(point.x - first.x, point.y - first.y)
        : Math.abs(dy * point.x - dx * point.y + last.x * first.y - last.y * first.x) / length;
    if (distance > worst) {
      worst = distance;
      index = at;
    }
  }
  if (worst <= tolerance) return [first, last];
  const head = simplify(points.slice(0, index + 1), tolerance);
  const tail = simplify(points.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/** Name the hue family a flat fill belongs to (near-grey fills are `grey`). */
function colourFamily(colour: readonly [number, number, number]): string {
  const max = Math.max(...colour);
  const min = Math.min(...colour);
  const delta = max - min;
  if (max === 0 || delta === 0) return 'grey';
  let hue = 0;
  if (max === colour[0]) hue = 60 * (((colour[1] - colour[2]) / delta) % 6);
  else if (max === colour[1]) hue = 60 * ((colour[2] - colour[0]) / delta + 2);
  else hue = 60 * ((colour[0] - colour[1]) / delta + 4);
  if (hue < 0) hue += 360;
  if (delta / max < 0.18) return 'grey';
  if (hue < 22 || hue >= 330) return 'red';
  if (hue < 70) return 'yellow';
  if (hue < 185) return 'green';
  if (hue < 265) return 'blue';
  return 'violet';
}

/** Quantise the aurora into flat cells that partition the official silhouette. */
function deriveGemini(source: string): { tile: string; measures: Record<string, unknown> } {
  const aurora = parseAurora(source);
  const glyph = aurora.outline;
  const xs = glyph.map((point) => point.x);
  const ys = glyph.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  // Cells overlap by a hair so the seams between them cannot show the white plate
  // through: adjacent fills are close enough that the doubled edge is invisible,
  // while the outer silhouette still follows the official outline exactly.
  const SEAM = 0.06;
  const cellFor = (x0: number, y0: number, x1: number, y1: number): AuroraCell | null => {
    const clipped = clipToRectangle(glyph, x0 - SEAM, y0 - SEAM, x1 + SEAM, y1 + SEAM);
    if (clipped.length < 3) return null;
    const area = Math.abs(polygonArea(clipped));
    if (area < 0.004) return null;
    const samples = sampleCell(aurora, clipped, [x0, y0, x1, y1]);
    if (samples.length === 0) return null;
    const fill = meanColour(samples);
    let spread = 0;
    for (const sample of samples) spread = Math.max(spread, colourDistance(sample, fill));
    return { polygon: clipped, fill, spread, area };
  };

  const root = cellFor(minX, minY, maxX, maxY);
  if (root === null) throw new Error('gemini-aurora.svg: the outline produced no cells');
  let cells: AuroraCell[] = [root];
  // Split the cell whose colour varies most, so the extra edges land where the
  // official composite actually changes rather than on a uniform grid.
  while (cells.length < 40) {
    let target = -1;
    let score = 0;
    for (const [index, cell] of cells.entries()) {
      const value = cell.spread * Math.sqrt(cell.area);
      if (value > score) {
        score = value;
        target = index;
      }
    }
    if (target < 0 || score < 6) break;
    const cell = cells[target];
    if (cell === undefined) break;
    const current = cell.polygon;
    const boxMinX = Math.min(...current.map((point) => point.x));
    const boxMinY = Math.min(...current.map((point) => point.y));
    const boxMaxX = Math.max(...current.map((point) => point.x));
    const boxMaxY = Math.max(...current.map((point) => point.y));
    const midX = (boxMinX + boxMaxX) / 2;
    const midY = (boxMinY + boxMaxY) / 2;
    const pieces = [
      cellFor(boxMinX, boxMinY, midX, midY),
      cellFor(midX, boxMinY, boxMaxX, midY),
      cellFor(boxMinX, midY, midX, boxMaxY),
      cellFor(midX, midY, boxMaxX, boxMaxY),
    ].filter((piece): piece is AuroraCell => piece !== null);
    if (pieces.length === 0) break;
    cells = [...cells.slice(0, target), ...cells.slice(target + 1), ...pieces];
  }

  // Deterministic paint order: top-to-bottom, left-to-right.
  cells.sort((a, b) => {
    const aMinY = Math.min(...a.polygon.map((point) => point.y));
    const bMinY = Math.min(...b.polygon.map((point) => point.y));
    if (aMinY !== bMinY) return aMinY - bMinY;
    const aMinX = Math.min(...a.polygon.map((point) => point.x));
    const bMinX = Math.min(...b.polygon.map((point) => point.x));
    return aMinX - bMinX;
  });

  const paths: string[] = [];
  let vertices = 0;
  for (const cell of cells) {
    const outline = simplify(cell.polygon, 0.008);
    const kept = outline.length;
    vertices += kept;
    const commands = outline
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${formatNumber(point.x)} ${formatNumber(point.y)}`)
      .join('');
    paths.push(`<path fill="${formatColourHex(cell.fill)}" d="${commands}Z"/>`);
  }

  // Measure the reconstruction against the official composite on a 0.05-unit grid:
  // every covered sample must land in exactly one cell, and the average per-channel
  // error is the fidelity bound the tile is allowed to claim.
  const steps = 480;
  const families: Record<string, number> = { red: 0, yellow: 0, green: 0, blue: 0, violet: 0, grey: 0 };
  let samples = 0;
  let error = 0;
  let uncovered = 0;
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x = ((column + 0.5) * TILE_SIZE) / steps;
      const y = ((row + 0.5) * TILE_SIZE) / steps;
      if (!pointInPolygon(glyph, x, y)) continue;
      samples += 1;
      const expected = compositeAt(aurora, x, y);
      const cell = cells.find((candidate) => pointInPolygon(candidate.polygon, x, y));
      if (cell === undefined) {
        uncovered += 1;
        continue;
      }
      error += colourDistance(expected, cell.fill) / Math.sqrt(3);
      families[colourFamily(cell.fill)] = (families[colourFamily(cell.fill)] ?? 0) + 1;
    }
  }
  const meanAbsRgb = samples === 0 ? Number.NaN : error / samples;
  if (uncovered > 0) throw new Error(`Gemini cells leave ${uncovered}/${samples} silhouette samples uncovered`);
  if (!Number.isFinite(meanAbsRgb) || meanAbsRgb > 12) {
    throw new Error(
      `Gemini reconstruction is too far from the official composite: mean |ΔRGB| ${meanAbsRgb.toFixed(2)}`,
    );
  }
  for (const family of ['red', 'yellow', 'green', 'blue'] as const) {
    if ((families[family] ?? 0) / samples < 0.02) {
      throw new Error(`Gemini reconstruction lost the ${family} family: ${families[family] ?? 0}/${samples} samples`);
    }
  }

  const transform = `translate(${formatNumber(TILE_SIZE / 2 - (TILE_SIZE / 2) * 0.8)} ${formatNumber(
    TILE_SIZE / 2 - (TILE_SIZE / 2) * 0.8,
  )}) scale(0.8)`;
  const tile =
    `<svg viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">` +
    `<rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}" fill="#FFFFFF"/>` +
    `<g transform="${transform}">${paths.join('')}</g>` +
    '</svg>';

  return {
    tile,
    measures: {
      transform,
      outlineBBox: {
        x: formatNumber(minX),
        y: formatNumber(minY),
        width: formatNumber(maxX - minX),
        height: formatNumber(maxY - minY),
      },
      ramps: aurora.ramps.map(
        (ramp) =>
          `${formatColourHex(ramp.colour)} (${ramp.x1},${ramp.y1})->(${ramp.x2},${ramp.y2}) fades out over ${ramp.reach}`,
      ),
      cells: cells.length,
      vertices,
      meanAbsRgb: Number(meanAbsRgb.toFixed(2)),
      coverage: 1,
      sampleGrid: `${steps}x${steps} at 0.05 units`,
      colourFamilies: families,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Recorded tiles and module rendering                                        */
/* -------------------------------------------------------------------------- */

/** Read the recorded derivation of every derived tile. */
function readTiles(problems: Problems): DerivedTiles {
  const tiles: Record<string, DerivedTile> = {};
  if (!existsSync(DERIVED_TILES)) {
    problems.push(`missing ${DERIVED_TILES} — it records every derived tile`);
    return { tiles };
  }
  const raw: unknown = JSON.parse(readFileSync(DERIVED_TILES, 'utf8'));
  const entries = (raw as Record<string, unknown>)['tiles'];
  if (entries === null || typeof entries !== 'object') {
    problems.push('reference/derived/tiles.json: "tiles" must be an object');
    return { tiles };
  }
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    const entry = value as Record<string, unknown>;
    const tile = entry['tile'];
    if (typeof tile !== 'string' || !tile.startsWith('<svg')) {
      problems.push(`reference/derived/tiles.json: "${key}" needs an svg tile`);
      continue;
    }
    const marks = entry['marks'];
    if (!Array.isArray(marks) || marks.length === 0) {
      problems.push(`reference/derived/tiles.json: "${key}" needs a non-empty marks list`);
      continue;
    }
    // Each mark is named individually: two keys can share a tile (`zhipu` and
    // `glm`) yet render under different titles and picker groups.
    const parsed: DerivedMark[] = [];
    for (const markValue of marks as unknown[]) {
      const mark = markValue as Record<string, unknown>;
      const markKey = mark['key'];
      const title = mark['title'];
      const group = mark['group'];
      if (typeof markKey !== 'string' || markKey.trim() === '') {
        problems.push(`reference/derived/tiles.json: "${key}" has a mark without a key`);
        continue;
      }
      if (typeof title !== 'string' || title.trim() === '') {
        problems.push(`reference/derived/tiles.json: mark "${markKey}" needs a title`);
        continue;
      }
      if (group !== 'vendor' && group !== 'model') {
        problems.push(`reference/derived/tiles.json: mark "${markKey}" needs a group of vendor or model`);
        continue;
      }
      parsed.push({ key: markKey, title, group });
    }
    if (parsed.length === 0) continue;
    tiles[key] = {
      marks: parsed,
      source: String(entry['source'] ?? ''),
      sourceSha256: String(entry['sourceSha256'] ?? ''),
      recipe: String(entry['recipe'] ?? ''),
      measures: (entry['measures'] ?? {}) as Record<string, unknown>,
      tile,
      tileSha256: sha256(tile),
    };
  }
  return { tiles };
}

/**
 * Validate the recorded tiles against the artwork contract and their own pins.
 * @param manifest - the pinned-source manifest.
 * @param record - the recorded derivation.
 */
function validateTiles(manifest: DerivedManifest, record: DerivedTiles, problems: Problems): void {
  for (const [key, entry] of Object.entries(record.tiles)) {
    if (entry.recipe.trim() === '') problems.push(`derived tile "${key}" needs a recipe`);
    const sourceSha = /^[0-9a-f]{64}$/.test(entry.sourceSha256);
    if (!sourceSha) problems.push(`derived tile "${key}" needs a source sha256`);
    const pin = manifest.files[entry.source];
    if (pin === undefined) {
      problems.push(`derived tile "${key}" names an unpinned source "${entry.source}"`);
    } else if (pin.sha256 !== entry.sourceSha256) {
      problems.push(
        `derived tile "${key}" records source sha256 ${entry.sourceSha256} but reference/derived/manifest.json pins ${pin.sha256}`,
      );
    }
    if (entry.tile.includes(' id="') || /\sid=/.test(entry.tile)) {
      problems.push(`derived tile "${key}" must not use id attributes`);
    }
    if (/\burl\s*\(|<defs|<linearGradient|<mask|<clipPath|<image|<style|<script|\son[a-z]+\s*=/i.test(entry.tile)) {
      problems.push(`derived tile "${key}" must stay self-contained and gradient-free`);
    }
    if (/https?:/i.test(entry.tile.replace(/\sxmlns[^=]*="[^"]*"/gi, ''))) {
      problems.push(`derived tile "${key}" must not reference external resources`);
    }
  }
}

/** Render the deterministic TypeScript module for the recorded tiles. */
function renderModule(record: DerivedTiles): string {
  const byKey = new Map<string, { title: string; group: string; tile: string }>();
  for (const entry of Object.values(record.tiles)) {
    for (const mark of entry.marks) byKey.set(mark.key, { title: mark.title, group: mark.group, tile: entry.tile });
  }
  const keys = [...byKey.keys()].toSorted();
  const constants = new Map<string, string>();
  for (const entry of Object.values(record.tiles)) {
    constants.set(entry.tile, `${entry.marks[0]?.key.toUpperCase() ?? 'MARK'}_SVG`);
  }

  const lines: string[] = [
    '/**',
    ' * Generated by scripts/derive-marks.ts from reference/derived/manifest.json and',
    ' * reference/derived/tiles.json — do not edit.',
    ' *',
    ' * These marks are not in the pinned Lobe package. Their sources are committed',
    ' * verbatim under `reference/derived/` and sha256-pinned, and the tiles below are',
    ' * rebuilt from those files, so a mark can only change by changing its source.',
    ' * `src/logos/manual.ts` re-exports each mark below next to its hand-authored',
    ' * exceptions, and this module also collects them into `LOGOS` on its own.',
    ' *',
    ' * Regenerate: pnpm exec tsx scripts/derive-marks.ts',
    ' * Verify:     pnpm exec tsx scripts/derive-marks.ts --check',
    ' */',
    "import type { BrandLogo, LogoSet } from '../types';",
    '',
  ];
  for (const [tile, name] of constants) {
    const aliases = Object.values(record.tiles)
      .filter((entry) => entry.tile === tile)
      .flatMap((entry) => entry.marks.map((mark) => mark.key.toUpperCase()))
      .join(', ');
    lines.push(`/** Derived tile, used by ${aliases}. */`);
    const quoted = `'${tile.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const oneLine = `const ${name} = ${quoted};`;
    if (oneLine.length > PRINT_WIDTH) lines.push(`const ${name} =`, `  ${quoted};`);
    else lines.push(oneLine);
    lines.push('');
  }
  // Each mark is exported by name so `manual.ts` can re-export it with its exact
  // `BrandLogo` type; a string-keyed `LogoSet` would widen every lookup back to
  // `BrandLogo | undefined` under `noUncheckedIndexedAccess`.
  for (const key of keys) {
    const entry = byKey.get(key);
    if (entry === undefined) continue;
    const constant = constants.get(entry.tile) ?? '';
    const exported = key.toUpperCase();
    lines.push(`/** Derived mark "${key}": ${entry.title}, group ${entry.group}. */`);
    lines.push(`export const ${exported}: BrandLogo = {`);
    lines.push(`  title: '${entry.title.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);
    lines.push(`  group: '${entry.group}',`);
    lines.push(`  svg: ${constant},`);
    lines.push('};');
    lines.push('');
  }
  lines.push('export const LOGOS: LogoSet = {');
  for (const key of keys) {
    if (byKey.has(key)) lines.push(`  ${key}: ${key.toUpperCase()},`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/**
 * Rewrite `reference/derived/tiles.json` after a Z rebuild, preserving the file's
 * order and its leading commentary so the record stays hand-readable.
 * @param record - the tiles to persist.
 */
function writeTiles(record: DerivedTiles): void {
  const raw = existsSync(DERIVED_TILES) ? JSON.parse(readFileSync(DERIVED_TILES, 'utf8')) : {};
  const output = {
    ...raw,
    tiles: Object.fromEntries(
      Object.entries(record.tiles).map(([key, entry]) => [
        key,
        {
          marks: entry.marks,
          source: entry.source,
          sourceSha256: entry.sourceSha256,
          recipe: entry.recipe,
          measures: entry.measures,
          tile: entry.tile,
        },
      ]),
    ),
  };
  writeFileSync(DERIVED_TILES, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

/** Collect every validation failure before reporting, so one run shows them all. */
function report(problems: Problems): void {
  for (const problem of problems) console.error(`error: ${problem}`);
  if (problems.length > 0) process.exitCode = 1;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/** Run the requested mode; throws with a readable message on a structural failure. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((argument) => argument !== '--check');
  if (unknown.length > 0) {
    console.error(`error: unknown argument(s): ${unknown.join(', ')} (expected --check)`);
    process.exitCode = 1;
    return;
  }
  const checkOnly = args.includes('--check');

  const problems: Problems = [];
  const manifest = readManifest(problems);
  const record = readTiles(problems);

  // Every pinned source must match its sha256, and every recorded tile must name
  // the source digest actually on disk.
  for (const name of Object.keys(manifest.files)) readPinnedSource(manifest, name, problems);
  validateTiles(manifest, record, problems);

  // Both derived tiles are rebuilt from their pinned sources on every run, so the
  // committed module cannot drift from the artwork it claims to come from. Write
  // mode adopts the rebuild (the source is authoritative); check mode requires a
  // match.
  const REBUILDS: ReadonlyArray<{
    key: string;
    source: string;
    derive: (text: string) => { tile: string; measures: Record<string, unknown> };
  }> = [
    { key: 'zhipu', source: 'zhipu-z.svg', derive: deriveZ },
    { key: 'gemini', source: 'gemini-aurora.svg', derive: deriveGemini },
  ];
  let adopted = false;
  for (const rebuild of REBUILDS) {
    const pin = manifest.files[rebuild.source];
    if (pin === undefined) {
      problems.push(`reference/derived/${rebuild.source} is not pinned, so "${rebuild.key}" cannot be rebuilt`);
      continue;
    }
    const entry = record.tiles[rebuild.key];
    const text = readPinnedSource(manifest, rebuild.source, problems);
    if (entry === undefined || text === null) continue;
    try {
      const derived = rebuild.derive(text);
      if (derived.tile !== entry.tile) {
        if (checkOnly) {
          problems.push(
            `reference/derived/tiles.json: the ${rebuild.key} tile drifted from its pinned source — run ` +
              '`pnpm exec tsx scripts/derive-marks.ts`',
          );
        } else {
          record.tiles[rebuild.key] = { ...entry, tile: derived.tile, measures: derived.measures };
          adopted = true;
        }
      }
    } catch (error) {
      problems.push(`${rebuild.key} derivation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (problems.length > 0) {
    report(problems);
    return;
  }

  if (adopted) writeTiles(record);

  const text = renderModule(record);

  if (checkOnly) {
    if (!existsSync(GENERATED_FILE)) {
      console.error('error: missing src/logos/derived.generated.ts — run `pnpm exec tsx scripts/derive-marks.ts`');
      process.exitCode = 1;
      return;
    }
    const committed = readFileSync(GENERATED_FILE, 'utf8');
    if (committed !== text) {
      console.error('error: src/logos/derived.generated.ts is stale — run `pnpm exec tsx scripts/derive-marks.ts`');
      process.exitCode = 1;
      return;
    }
    console.log(
      `derived artwork is up to date: ${Object.keys(manifest.files).length} pinned sources → ` +
        `${Object.values(record.tiles).flatMap((entry) => entry.marks).length} marks ` +
        `(${Object.values(record.tiles)
          .map((entry) => entry.marks.map((mark) => mark.key).join('+'))
          .join(', ')}); sources verified offline`,
    );
    return;
  }

  writeFileSync(GENERATED_FILE, text, 'utf8');
  console.log(
    `wrote src/logos/derived.generated.ts: ${Object.keys(record.tiles).length} tiles, ` +
      `${Object.values(record.tiles).flatMap((entry) => entry.marks).length} marks, ${text.length} bytes`,
  );
}

await main();
