/**
 * Generate the official artwork module from the committed upstream reference
 * files, or verify that the committed module still matches them.
 *
 * `reference/official/manifest.json` pins every upstream file and its sha256; the
 * files themselves are the exact `@lobehub/icons-static-svg` 1.102.0 SVGs saved
 * by `scripts/fetch-official-logos.ts`. This script never touches the network:
 * it re-reads those files, rebuilds the 24×24 tile SVGs in memory, and either
 * writes `src/logos/official.generated.ts` (default) or compares the committed
 * module against the rebuilt entries (`--check`, whitespace-insensitive).
 *
 * The generated module and the hand-authored `src/logos/manual.ts` together must
 * cover the required 56 keys exactly once, each in exactly one picker group; the
 * script validates that merged coverage in both modes.
 *
 * Usage (run from the repository root):
 *   pnpm exec tsx scripts/import-logos.ts            # regenerate the module
 *   pnpm exec tsx scripts/import-logos.ts --check    # verify it, offline
 *   pnpm exec tsx scripts/import-logos.ts --fetch    # re-fetch upstream, regenerate
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogoGroup } from '../src/types';
import { LOGOS as MANUAL_LOGOS } from '../src/logos/manual';
import {
  MANIFEST_FILE,
  MANUAL_MARKS,
  OFFICIAL_ICON_BASE,
  OFFICIAL_LICENSE,
  OFFICIAL_PACKAGE,
  OFFICIAL_VERSION,
  REFERENCE_DIR,
  REQUIRED_MODEL_KEYS,
  REQUIRED_VENDOR_KEYS,
  SOURCE_MARKS,
  fetchOfficialLogos,
  requiredGroup,
  sha256,
} from './fetch-official-logos';

/** Committed generated module this script owns. */
const GENERATED_FILE = resolve(REFERENCE_DIR, '../../src/logos/official.generated.ts');

/** Tile geometry shared with the hand-authored marks. */
const TILE_SIZE = 24;
const TILE_RADIUS = 6;

/** Formatter print width; generated lines must already respect it (.oxfmtrc.json). */
const PRINT_WIDTH = 120;

/** Elements an upstream glyph may contain after the `<title>` is dropped. */
const ALLOWED_ELEMENTS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'g']);

/** Manifest entry shape, validated before use. */
interface ManifestAlias {
  readonly key: string;
  readonly title: string;
  readonly group: LogoGroup;
}

interface ManifestMark {
  readonly title: string;
  readonly group: LogoGroup;
  readonly slug: string;
  readonly file: string;
  readonly sha256: string;
  readonly mode: 'mono' | 'color';
  readonly tile: string;
  readonly glyph: string;
  readonly scale: number;
  readonly aliases: readonly ManifestAlias[];
}

/** One manifest-declared manual exception (no upstream file to verify). */
interface ManifestManualMark {
  readonly key: string;
  readonly title: string;
  readonly group: LogoGroup;
  readonly reason: string;
}

interface Manifest {
  readonly package: string;
  readonly version: string;
  readonly license: string;
  readonly source: string;
  readonly viewBox: string;
  readonly tile: { readonly size: number; readonly radius: number };
  readonly marks: Readonly<Record<string, ManifestMark>>;
  readonly manual: readonly ManifestManualMark[];
}

/** One render-ready artwork entry, before it becomes the exported module. */
interface ExpectedLogo {
  readonly title: string;
  readonly group: LogoGroup;
  readonly svg: string;
}

/** A collected validation failure; all are reported before the script exits. */
type Problems = string[];

/* -------------------------------------------------------------------------- */
/* Manifest and reference-file validation                                     */
/* -------------------------------------------------------------------------- */

/** Throw unless `value` is a non-empty string. */
function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

/** Throw unless `value` is a picker group. */
function assertGroup(value: unknown, label: string): LogoGroup {
  if (value !== 'vendor' && value !== 'model') throw new Error(`${label} must be "vendor" or "model"`);
  return value;
}

/** Throw unless `value` is a `#RRGGBB` colour. */
function assertColour(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9A-F]{6}$/i.test(value)) {
    throw new Error(`${label} must be a #RRGGBB colour`);
  }
  return value;
}

/** Parse and structurally validate the committed manifest. */
function readManifest(): Manifest {
  if (!existsSync(MANIFEST_FILE)) {
    throw new Error(
      `missing ${MANIFEST_FILE} — run \`pnpm exec tsx scripts/fetch-official-logos.ts\` first (needs the proxy env)`,
    );
  }
  const raw: unknown = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  if (raw === null || typeof raw !== 'object') throw new Error('manifest root must be an object');
  const record = raw as Record<string, unknown>;
  if (record['package'] !== OFFICIAL_PACKAGE) throw new Error(`manifest package must be ${OFFICIAL_PACKAGE}`);
  if (record['version'] !== OFFICIAL_VERSION) throw new Error(`manifest version must be ${OFFICIAL_VERSION}`);
  if (record['license'] !== OFFICIAL_LICENSE) throw new Error(`manifest license must be ${OFFICIAL_LICENSE}`);
  if (record['source'] !== OFFICIAL_ICON_BASE) throw new Error(`manifest source must be ${OFFICIAL_ICON_BASE}`);
  if (record['viewBox'] !== '0 0 24 24') throw new Error('manifest viewBox must be "0 0 24 24"');
  const tile = record['tile'];
  if (tile === null || typeof tile !== 'object') throw new Error('manifest tile must be an object');
  const tileRecord = tile as Record<string, unknown>;
  if (tileRecord['size'] !== TILE_SIZE || tileRecord['radius'] !== TILE_RADIUS) {
    throw new Error(`manifest tile must be size ${TILE_SIZE} and radius ${TILE_RADIUS}`);
  }
  const marks = record['marks'];
  if (marks === null || typeof marks !== 'object' || Array.isArray(marks)) {
    throw new Error('manifest marks must be an object');
  }

  const validated: Record<string, ManifestMark> = {};
  for (const [key, value] of Object.entries(marks as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9]*$/.test(key)) throw new Error(`manifest mark key "${key}" is not lowercase alphanumeric`);
    if (value === null || typeof value !== 'object') throw new Error(`manifest mark "${key}" must be an object`);
    const markRecord = value as Record<string, unknown>;
    const slug = assertString(markRecord['slug'], `manifest mark "${key}" slug`);
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error(`manifest mark "${key}" slug "${slug}" is invalid`);
    const file = assertString(markRecord['file'], `manifest mark "${key}" file`);
    if (file !== `${slug}.svg`) throw new Error(`manifest mark "${key}" file must be ${slug}.svg`);
    const digest = assertString(markRecord['sha256'], `manifest mark "${key}" sha256`);
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`manifest mark "${key}" sha256 is not a hex digest`);
    const mode = markRecord['mode'];
    if (mode !== 'mono' && mode !== 'color') throw new Error(`manifest mark "${key}" mode must be mono or color`);
    const glyph = assertString(markRecord['glyph'], `manifest mark "${key}" glyph`);
    if (mode === 'mono') assertColour(glyph, `manifest mark "${key}" glyph`);
    else if (glyph !== 'official') throw new Error(`manifest mark "${key}" must use glyph "official" in color mode`);
    const scale = markRecord['scale'];
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 1) {
      throw new Error(`manifest mark "${key}" scale must be in (0, 1]`);
    }
    const group = assertGroup(markRecord['group'], `manifest mark "${key}" group`);
    if (requiredGroup(key) !== group) throw new Error(`manifest mark "${key}" is in the wrong group`);

    const rawAliases = markRecord['aliases'];
    if (!Array.isArray(rawAliases)) throw new Error(`manifest mark "${key}" aliases must be an array`);
    const aliases: ManifestAlias[] = [];
    for (const rawAlias of rawAliases) {
      if (rawAlias === null || typeof rawAlias !== 'object') {
        throw new Error(`manifest mark "${key}" has a non-object alias`);
      }
      const aliasRecord = rawAlias as Record<string, unknown>;
      const aliasKey = assertString(aliasRecord['key'], `alias of "${key}" key`);
      if (!/^[a-z][a-z0-9]*$/.test(aliasKey)) throw new Error(`alias key "${aliasKey}" is invalid`);
      const aliasGroup = assertGroup(aliasRecord['group'], `alias "${aliasKey}" group`);
      if (requiredGroup(aliasKey) !== aliasGroup) throw new Error(`alias "${aliasKey}" is in the wrong group`);
      aliases.push({
        key: aliasKey,
        title: assertString(aliasRecord['title'], `alias "${aliasKey}" title`),
        group: aliasGroup,
      });
    }

    validated[key] = {
      title: assertString(markRecord['title'], `manifest mark "${key}" title`),
      group,
      slug,
      file,
      sha256: digest,
      mode,
      tile: assertColour(markRecord['tile'], `manifest mark "${key}" tile`),
      glyph,
      scale,
      aliases,
    };
  }

  const rawManual = record['manual'];
  if (!Array.isArray(rawManual)) throw new Error('manifest manual must be an array');
  const manual: ManifestManualMark[] = [];
  for (const rawMark of rawManual) {
    if (rawMark === null || typeof rawMark !== 'object') throw new Error('manifest manual entry must be an object');
    const manualRecord = rawMark as Record<string, unknown>;
    const manualKey = assertString(manualRecord['key'], 'manifest manual key');
    if (!/^[a-z][a-z0-9]*$/.test(manualKey)) throw new Error(`manifest manual key "${manualKey}" is invalid`);
    const manualGroup = assertGroup(manualRecord['group'], `manifest manual "${manualKey}" group`);
    if (requiredGroup(manualKey) !== manualGroup) {
      throw new Error(`manifest manual "${manualKey}" is in the wrong group`);
    }
    manual.push({
      key: manualKey,
      title: assertString(manualRecord['title'], `manifest manual "${manualKey}" title`),
      group: manualGroup,
      reason: assertString(manualRecord['reason'], `manifest manual "${manualKey}" reason`),
    });
  }

  return {
    package: OFFICIAL_PACKAGE,
    version: OFFICIAL_VERSION,
    license: OFFICIAL_LICENSE,
    source: OFFICIAL_ICON_BASE,
    viewBox: '0 0 24 24',
    tile: { size: TILE_SIZE, radius: TILE_RADIUS },
    marks: validated,
    manual,
  };
}

/**
 * Assert the manifest is exactly the metadata `SOURCE_MARKS` declares. The fetch
 * script writes both, so a mismatch means the config changed without a re-fetch.
 */
function assertManifestMatchesConfig(manifest: Manifest): void {
  const manifestKeys = Object.keys(manifest.marks).toSorted();
  const configKeys = SOURCE_MARKS.map((mark) => mark.key).toSorted();
  if (manifestKeys.join(',') !== configKeys.join(',')) {
    throw new Error('manifest marks do not match SOURCE_MARKS — re-run the fetch script');
  }
  for (const mark of SOURCE_MARKS) {
    const entry = manifest.marks[mark.key];
    if (entry === undefined) throw new Error(`manifest is missing mark "${mark.key}"`);
    const expected = {
      title: mark.title,
      group: mark.group,
      slug: mark.slug,
      file: `${mark.slug}.svg`,
      mode: mark.mode,
      tile: mark.tile,
      glyph: mark.glyph,
      scale: mark.scale,
      aliases: (mark.aliases ?? [])
        .toSorted((a, b) => a.key.localeCompare(b.key))
        .map((item) => ({ key: item.key, title: item.title, group: item.group })),
    };
    const actual = {
      title: entry.title,
      group: entry.group,
      slug: entry.slug,
      file: entry.file,
      mode: entry.mode,
      tile: entry.tile,
      glyph: entry.glyph,
      scale: entry.scale,
      aliases: entry.aliases.map((item) => ({ key: item.key, title: item.title, group: item.group })),
    };
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(`manifest mark "${mark.key}" drifted from SOURCE_MARKS — re-run the fetch script`);
    }
  }

  const expectedManual = MANUAL_MARKS.toSorted((a, b) => a.key.localeCompare(b.key)).map((mark) => ({
    key: mark.key,
    title: mark.title,
    group: mark.group,
    reason: mark.reason,
  }));
  const actualManual = manifest.manual.map((mark) => ({
    key: mark.key,
    title: mark.title,
    group: mark.group,
    reason: mark.reason,
  }));
  if (JSON.stringify(expectedManual) !== JSON.stringify(actualManual)) {
    throw new Error('manifest manual exceptions drifted from MANUAL_MARKS — re-run the fetch script');
  }
}

/** Read and sha256-verify one committed upstream file. */
function readReferenceFile(manifest: Manifest, key: string): string {
  const mark = manifest.marks[key];
  if (mark === undefined) throw new Error(`manifest has no mark "${key}"`);
  const path = resolve(REFERENCE_DIR, mark.file);
  if (!existsSync(path)) throw new Error(`missing committed reference file reference/official/${mark.file}`);
  const text = readFileSync(path, 'utf8');
  const digest = sha256(text);
  if (digest !== mark.sha256) {
    throw new Error(`reference/official/${mark.file} sha256 ${digest} does not match manifest ${mark.sha256}`);
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Upstream SVG inspection and tile rendering                                 */
/* -------------------------------------------------------------------------- */

/** Reject inactive content and external references in an upstream SVG body. */
function assertSafeMarkup(source: string, key: string): void {
  // The root <svg> attributes are dropped when the glyph is fitted, so inspect
  // only the body (this also ignores the inert xmlns/style wrapper attributes).
  const body = source.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const withoutNamespace = body.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
  const checks: ReadonlyArray<readonly [RegExp, string]> = [
    [/\sid\s*=/i, 'id attribute'],
    [/\son[a-z]+\s*=/i, 'event handler'],
    [/\sstyle\s*=/i, 'inline style'],
    [/\b(?:href|xlink:href)\s*=/i, 'link reference'],
    [/\burl\s*\(/i, 'url() reference'],
    [/<script\b/i, 'script'],
    [
      /<(?:defs|linearGradient|radialGradient|mask|clipPath|filter|use|image|foreignObject|pattern|symbol|marker|text|animate|set)\b/i,
      'unsupported element',
    ],
    [/<\?/i, 'XML declaration'],
    [/https?:/i, 'external URL'],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(withoutNamespace)) {
      throw new Error(`reference/official/${key}: upstream SVG contains a forbidden ${label}`);
    }
  }
}

/**
 * Strip the upstream wrapper and `<title>`, keep the glyph markup, and enforce
 * the tile contract (whitelisted elements, safe attributes, colour mode rules).
 */
function extractGlyph(source: string, mark: ManifestMark, key: string): { glyph: string; evenOdd: boolean } {
  assertSafeMarkup(source, key);
  const match = source.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (match === null) throw new Error(`reference/official/${key}: not a single <svg> document`);
  const rootAttributes = match[1] ?? '';
  const inner = (match[2] ?? '').replace(/<title>[\s\S]*?<\/title>/gi, '').trim();
  if (inner === '') throw new Error(`reference/official/${key}: empty glyph`);

  for (const tagMatch of inner.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)) {
    const name = tagMatch[1] ?? '';
    if (!ALLOWED_ELEMENTS.has(name)) {
      throw new Error(`reference/official/${key}: unsupported <${name}> element`);
    }
  }

  if (mark.mode === 'mono') {
    if (!rootAttributes.includes('fill="currentColor"')) {
      throw new Error(`reference/official/${key}: mono source must declare fill="currentColor"`);
    }
    for (const fillMatch of inner.matchAll(/\bfill="([^"]*)"/g)) {
      const value = fillMatch[1] ?? '';
      if (value !== 'currentColor' && value !== 'none') {
        throw new Error(`reference/official/${key}: mono source has a hard-coded fill "${value}"`);
      }
    }
    for (const strokeMatch of inner.matchAll(/\bstroke="([^"]*)"/g)) {
      const value = strokeMatch[1] ?? '';
      if (value !== 'currentColor' && value !== 'none') {
        throw new Error(`reference/official/${key}: mono source has a hard-coded stroke "${value}"`);
      }
    }
  } else {
    if (inner.includes('currentColor')) {
      throw new Error(`reference/official/${key}: multi-colour source must not use currentColor`);
    }
    if (!/\bfill="#[0-9A-Fa-f]{3,8}"/.test(inner)) {
      throw new Error(`reference/official/${key}: multi-colour source has no explicit fills`);
    }
  }

  return { glyph: inner, evenOdd: rootAttributes.includes('fill-rule="evenodd"') };
}

/** Format a transform number deterministically (no exponent, no trailing zeros). */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Fit one upstream glyph into the shared 24×24 rounded-square tile. */
function renderLogo(mark: ManifestMark, source: string, key: string): string {
  const { glyph, evenOdd } = extractGlyph(source, mark, key);
  const pad = formatNumber((TILE_SIZE - TILE_SIZE * mark.scale) / 2);
  const transform = `translate(${pad} ${pad}) scale(${formatNumber(mark.scale)})`;
  const fill = mark.mode === 'mono' ? ` fill="${mark.glyph}"` : '';
  const fillRule = evenOdd ? ' fill-rule="evenodd"' : '';
  return (
    `<svg viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">` +
    `<rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}" fill="${mark.tile}"/>` +
    `<g transform="${transform}"${fill}${fillRule}>${glyph}</g>` +
    '</svg>'
  );
}

/* -------------------------------------------------------------------------- */
/* Expected entries and coverage                                              */
/* -------------------------------------------------------------------------- */

/** Rebuild every generated entry (source marks plus their alias keys). */
function buildExpected(manifest: Manifest): Map<string, ExpectedLogo> {
  const expected = new Map<string, ExpectedLogo>();
  for (const key of Object.keys(manifest.marks).toSorted()) {
    const mark = manifest.marks[key];
    if (mark === undefined) continue;
    const source = readReferenceFile(manifest, key);
    const svg = renderLogo(mark, source, key);
    expected.set(key, { title: mark.title, group: mark.group, svg });
    for (const alias of mark.aliases) {
      expected.set(alias.key, { title: alias.title, group: alias.group, svg });
    }
  }
  return expected;
}

/** Validate one rendered SVG against the inline-safety contract. */
function assertRenderedSvg(svg: string, label: string, problems: Problems): void {
  if (!svg.startsWith('<svg viewBox="0 0 24 24"')) problems.push(`${label}: svg must start with a 24x24 <svg>`);
  if (/\sid\s*=/.test(svg)) problems.push(`${label}: svg must not use id attributes`);
  // The XML namespace declaration is inert when inlined into HTML.
  const withoutNamespace = svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
  if (/<script|\son[a-z]+\s*=|https?:/i.test(withoutNamespace)) {
    problems.push(`${label}: svg must stay self-contained`);
  }
}

/** Validate the merged generated + manual coverage against the required key set. */
function validateCoverage(expected: Map<string, ExpectedLogo>, problems: Problems): void {
  const merged = new Map<string, ExpectedLogo & { origin: string }>();
  for (const [key, entry] of expected) {
    assertRenderedSvg(entry.svg, `generated "${key}"`, problems);
    merged.set(key, { ...entry, origin: 'generated' });
  }

  const manualKeys = Object.keys(MANUAL_LOGOS).toSorted();
  const declaredManualKeys = MANUAL_MARKS.map((mark) => mark.key).toSorted();
  if (manualKeys.join(',') !== declaredManualKeys.join(',')) {
    problems.push(`manual.ts keys must be exactly ${declaredManualKeys.join(', ')} (got ${manualKeys.join(', ')})`);
  }
  for (const declared of MANUAL_MARKS) {
    const entry = MANUAL_LOGOS[declared.key];
    if (entry === undefined) {
      problems.push(`manual.ts is missing the declared manual mark "${declared.key}"`);
      continue;
    }
    if (entry.title !== declared.title || entry.group !== declared.group) {
      problems.push(`manual.ts "${declared.key}" must be titled "${declared.title}" in group "${declared.group}"`);
    }
    assertRenderedSvg(entry.svg, `manual "${declared.key}"`, problems);
    if (merged.has(declared.key)) problems.push(`key "${declared.key}" is declared by both artwork modules`);
    merged.set(declared.key, { title: entry.title, group: entry.group, svg: entry.svg, origin: 'manual' });
  }

  const required = [...REQUIRED_VENDOR_KEYS, ...REQUIRED_MODEL_KEYS];
  for (const key of required) {
    const entry = merged.get(key);
    if (entry === undefined) {
      problems.push(`required key "${key}" has no artwork`);
      continue;
    }
    const group = requiredGroup(key);
    if (entry.group !== group) problems.push(`key "${key}" must be in group "${group ?? 'unknown'}"`);
  }
  for (const key of merged.keys()) {
    if (!required.includes(key)) problems.push(`artwork key "${key}" is outside the required 56-key set`);
  }
  const generatedCount = expected.size;
  const manualCount = MANUAL_MARKS.length;
  if (generatedCount + manualCount !== required.length) {
    problems.push(`generated ${generatedCount} + manual ${manualCount} marks must equal ${required.length} keys`);
  }
}

/* -------------------------------------------------------------------------- */
/* Module rendering and verification                                          */
/* -------------------------------------------------------------------------- */

/** Quote a value as a single-quoted TypeScript string literal. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

/** Render the deterministic TypeScript module for the expected entries. */
function renderModule(expected: Map<string, ExpectedLogo>, manifest: Manifest): string {
  const entries = [...expected.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  const parents = Object.keys(manifest.marks)
    .filter((key) => (manifest.marks[key]?.aliases.length ?? 0) > 0)
    .toSorted();

  const lines: string[] = [
    '/**',
    ' * Generated by scripts/import-logos.ts from reference/official/manifest.json — do not edit.',
    ' *',
    ` * Official artwork from ${OFFICIAL_PACKAGE} ${OFFICIAL_VERSION} (${OFFICIAL_LICENSE}): ${SOURCE_MARKS.length}`,
    ' * upstream `<slug>.svg` files are committed verbatim under `reference/official/` and',
    ' * fitted here into the shared 24×24 rounded-square tile. Multi-colour marks keep',
    ' * the official fills; monochrome marks are recoloured. Model aliases without a',
    ' * distinct official mark reuse their parent glyph. The manual exceptions',
    ` * (${MANUAL_MARKS.map((mark) => mark.key).join(', ')}) live in \`src/logos/manual.ts\`.`,
    ' *',
    ' * Regenerate: pnpm exec tsx scripts/import-logos.ts',
    ' * Verify:     pnpm exec tsx scripts/import-logos.ts --check',
    ' */',
    "import type { LogoSet } from '../types';",
    '',
  ];

  for (const key of parents) {
    const mark = manifest.marks[key];
    if (mark === undefined) continue;
    const reuse = mark.aliases.map((alias) => alias.title.toUpperCase()).join(', ');
    lines.push(`/** ${mark.title} mark, reused by the ${reuse} alias. */`);
    const quoted = quote(expected.get(key)?.svg ?? '');
    const oneLine = `const ${constName(key)} = ${quoted};`;
    if (oneLine.length > PRINT_WIDTH) {
      // oxfmt wraps an over-long assignment after `=`; generate that shape so a
      // regeneration stays byte-identical to the formatter's output.
      lines.push(`const ${constName(key)} =`, `  ${quoted};`);
    } else {
      lines.push(oneLine);
    }
    lines.push('');
  }

  lines.push('export const LOGOS: LogoSet = {');
  for (const [key, entry] of entries) {
    const shared = parents.find((parent) => manifest.marks[parent]?.aliases.some((alias) => alias.key === key));
    const svgExpression = shared === undefined ? quote(entry.svg) : constName(shared);
    lines.push(`  ${key}: {`);
    lines.push(`    title: ${quote(entry.title)},`);
    lines.push(`    group: '${entry.group}',`);
    lines.push(`    svg: ${svgExpression},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/** SCREAMING_SNAKE constant name for a mark key (`openai` → `OPENAI_SVG`). */
function constName(key: string): string {
  return `${key.toUpperCase()}_SVG`;
}

/** Normalised SVG comparison: whitespace differences are not drift. */
function normalizeSvg(svg: string): string {
  return svg.replace(/\s+/g, '');
}

/** Parse whatever the committed module exports into validated entries. */
function parseGenerated(value: unknown): Map<string, ExpectedLogo> {
  if (value === null || typeof value !== 'object') throw new Error('generated module does not export a LOGOS object');
  const entries = new Map<string, ExpectedLogo>();
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') throw new Error(`generated "${key}" must be an object`);
    const record = raw as Record<string, unknown>;
    const title = assertString(record['title'], `generated "${key}" title`);
    const group = assertGroup(record['group'], `generated "${key}" group`);
    const svg = assertString(record['svg'], `generated "${key}" svg`);
    entries.set(key, { title, group, svg });
  }
  return entries;
}

/** Compare the committed module against the rebuilt entries. */
async function checkGenerated(expected: Map<string, ExpectedLogo>): Promise<Problems> {
  const problems: Problems = [];
  if (!existsSync(GENERATED_FILE)) {
    problems.push(`missing src/logos/official.generated.ts — run \`pnpm exec tsx scripts/import-logos.ts\``);
    return problems;
  }
  const module: unknown = await import(pathToFileURL(GENERATED_FILE).href);
  const actual = parseGenerated((module as { LOGOS?: unknown }).LOGOS);
  const expectedKeys = [...expected.keys()].toSorted();
  const actualKeys = [...actual.keys()].toSorted();
  const missing = expectedKeys.filter((key) => !actual.has(key));
  const extra = actualKeys.filter((key) => !expected.has(key));
  if (missing.length > 0) problems.push(`generated module is missing keys: ${missing.join(', ')}`);
  if (extra.length > 0) problems.push(`generated module has unexpected keys: ${extra.join(', ')}`);
  for (const key of expectedKeys) {
    const want = expected.get(key);
    const got = actual.get(key);
    if (want === undefined || got === undefined) continue;
    if (want.title !== got.title) problems.push(`generated "${key}" title drifted ("${got.title}" ≠ "${want.title}")`);
    if (want.group !== got.group) problems.push(`generated "${key}" group drifted ("${got.group}" ≠ "${want.group}")`);
    if (normalizeSvg(want.svg) !== normalizeSvg(got.svg)) {
      problems.push(`generated "${key}" svg drifted from reference/official/${key}`);
    }
    assertRenderedSvg(got.svg, `generated "${key}"`, problems);
  }
  return problems;
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
  const known = new Set(['--check', '--fetch']);
  const unknown = args.filter((argument) => !known.has(argument));
  if (unknown.length > 0) {
    console.error(`error: unknown argument(s): ${unknown.join(', ')} (expected --check or --fetch)`);
    process.exitCode = 1;
    return;
  }
  const checkOnly = args.includes('--check');
  const fetchFirst = args.includes('--fetch');
  if (checkOnly && fetchFirst) {
    console.error('error: --check and --fetch cannot be combined');
    process.exitCode = 1;
    return;
  }

  if (fetchFirst) await fetchOfficialLogos();

  const manifest = readManifest();
  assertManifestMatchesConfig(manifest);
  const expected = buildExpected(manifest);
  const problems: Problems = [];
  validateCoverage(expected, problems);

  if (checkOnly) {
    problems.push(...(await checkGenerated(expected)));
    report(problems);
    if (problems.length > 0) return;
    const sourceCount = SOURCE_MARKS.length;
    const aliasCount = expected.size - sourceCount;
    console.log(
      `official artwork is up to date: ${sourceCount} upstream files + ${aliasCount} aliases → ` +
        `${expected.size} generated marks, ${MANUAL_MARKS.length} manual marks, ` +
        `${expected.size + MANUAL_MARKS.length} keys; reference/official verified offline`,
    );
    return;
  }

  report(problems);
  if (problems.length > 0) return;
  const text = renderModule(expected, manifest);
  writeFileSync(GENERATED_FILE, text, 'utf8');
  const sourceCount = SOURCE_MARKS.length;
  const parents = Object.keys(manifest.marks).filter((key) => (manifest.marks[key]?.aliases.length ?? 0) > 0);
  console.log(
    `wrote src/logos/official.generated.ts: ${expected.size} marks ` +
      `(${sourceCount} upstream files, ${expected.size - sourceCount} aliases, ` +
      `${parents.length} shared glyph constants), ${text.length} bytes; ` +
      `manual.ts adds ${MANUAL_MARKS.length} keys → ${expected.size + MANUAL_MARKS.length} total`,
  );
}

await main();
