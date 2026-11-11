/**
 * Fetch the pinned official icon set into `reference/official/`.
 *
 * Source of truth: `@lobehub/icons-static-svg` 1.102.0 (MIT). Every URL below is
 * immutable for that version, so a re-fetch reproduces the committed tree
 * byte-for-byte. The files are stored verbatim (`reference/official/<slug>.svg`)
 * and the companion `manifest.json` records, per source mark, the upstream file,
 * sha256, display title, picker group, tile/glyph colours, scale, mode and any
 * alias keys that reuse the same glyph. `scripts/import-logos.ts` turns that
 * manifest into the TypeScript artwork module; it never touches the network.
 *
 * Network access uses Node's built-in fetch with environment proxy support. A
 * machine that needs a proxy must pass it through the environment and never
 * commit it:
 *
 *   $env:NODE_USE_ENV_PROXY='1'
 *   $env:HTTPS_PROXY='http://127.0.0.1:10090'
 *   pnpm exec tsx scripts/fetch-official-logos.ts
 *
 * Usage (run from the repository root):
 *   pnpm exec tsx scripts/fetch-official-logos.ts          # refresh every file
 *   pnpm exec tsx scripts/import-logos.ts --fetch          # fetch, then generate
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LogoGroup } from '../src/types';

/** Upstream package identity; pinned so the committed files stay reproducible. */
export const OFFICIAL_PACKAGE = '@lobehub/icons-static-svg';
export const OFFICIAL_VERSION = '1.102.0';
export const OFFICIAL_LICENSE = 'MIT';
export const OFFICIAL_REPOSITORY = 'https://github.com/lobehub/lobe-icons';
export const OFFICIAL_PACKAGE_URL = `https://unpkg.com/${OFFICIAL_PACKAGE}@${OFFICIAL_VERSION}`;
export const OFFICIAL_ICON_BASE = `${OFFICIAL_PACKAGE_URL}/icons/`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Committed upstream artwork directory; also the importer's offline input. */
export const REFERENCE_DIR = resolve(ROOT, 'reference/official');
/** Manifest the importer reads; regenerated on every fetch. */
export const MANIFEST_FILE = resolve(REFERENCE_DIR, 'manifest.json');

/** Compression mode: a one-colour glyph, or the official multi-colour fills. */
export type MarkMode = 'mono' | 'color';

/** One alias key that reuses its parent mark's glyph under a model title. */
export interface AliasSpec {
  readonly key: string;
  readonly title: string;
  readonly group: LogoGroup;
}

/** One upstream icon and how the importer fits it into the shared tile. */
export interface SourceMark {
  /** Artwork key the matcher returns. */
  readonly key: string;
  /** Upstream file name (`<slug>.svg`) in the Lobe icon package. */
  readonly slug: string;
  /** Human-readable brand name used as the rendered `title`. */
  readonly title: string;
  /** Picker group; every key belongs to exactly one. */
  readonly group: LogoGroup;
  /** `mono` recolours the glyph; `color` preserves the upstream fills. */
  readonly mode: MarkMode;
  /** Rounded-square tile fill behind the glyph. */
  readonly tile: string;
  /** Glyph fill for `mono` marks; `official` for multi-colour marks. */
  readonly glyph: string;
  /** Glyph scale around the 24×24 canvas centre (`0 < scale <= 1`). */
  readonly scale: number;
  /** Alias keys rendered with this same glyph and a model-group title. */
  readonly aliases?: readonly AliasSpec[];
}

/** Model-key alias reusing a parent mark's glyph (all aliases are models). */
const alias = (key: string, title: string): AliasSpec => ({ key, title, group: 'model' });

/**
 * Build a monochrome source mark: the upstream silhouette is filled with the
 * glyph colour on a flat brand tile.
 */
const mono = (
  key: string,
  slug: string,
  title: string,
  group: LogoGroup,
  tile: string,
  extra: Partial<SourceMark> = {},
): SourceMark => ({ key, slug, title, group, mode: 'mono', tile, glyph: '#FFFFFF', scale: 0.8, ...extra });

/**
 * Build a multi-colour source mark: the upstream fills are preserved on a
 * neutral tile that keeps the official colours readable.
 */
const color = (
  key: string,
  slug: string,
  title: string,
  group: LogoGroup,
  tile: string,
  extra: Partial<SourceMark> = {},
): SourceMark => ({ key, slug, title, group, mode: 'color', tile, glyph: 'official', scale: 0.8, ...extra });

/**
 * Every key whose artwork comes from the Lobe package, in this order:
 * vendor marks, then model marks. Aliases are attached to their parent.
 */
export const SOURCE_MARKS: readonly SourceMark[] = [
  mono('alibaba', 'alibaba', 'Alibaba', 'vendor', '#FF6003'),
  mono('anthropic', 'anthropic', 'Anthropic', 'vendor', '#CC785C'),
  mono('antgroup', 'antgroup', 'Ant Group', 'vendor', '#1677FF'),
  mono('azure', 'azure', 'Microsoft Azure', 'vendor', '#0078D4'),
  mono('baidu', 'baidu', 'Baidu', 'vendor', '#2932E1', { aliases: [alias('ernie', 'ERNIE')] }),
  color('baiducloud', 'baiducloud-color', 'BaiduCloud', 'vendor', '#FFFFFF'),
  mono('baseten', 'baseten', 'Baseten', 'vendor', '#0B0F0C', { glyph: '#17D465' }),
  mono('bytedance', 'bytedance', 'ByteDance', 'vendor', '#325AB4'),
  mono('cerebras', 'cerebras', 'Cerebras', 'vendor', '#F15A29'),
  mono('cloudflare', 'cloudflare', 'Cloudflare', 'vendor', '#F38020'),
  mono('cohere', 'cohere', 'Cohere', 'vendor', '#39594D'),
  mono('fireworks', 'fireworks', 'Fireworks', 'vendor', '#6720FF'),
  mono('github', 'github', 'GitHub', 'vendor', '#181717', { scale: 0.74 }),
  color('google', 'google-color', 'Google', 'vendor', '#FFFFFF', { scale: 0.84 }),
  mono('groq', 'groq', 'Groq', 'vendor', '#F55036'),
  color('huggingface', 'huggingface-color', 'Hugging Face', 'vendor', '#FFFFFF', { scale: 0.82 }),
  mono('lmstudio', 'lmstudio', 'LM Studio', 'vendor', '#5B3FD6'),
  mono('meta', 'meta', 'Meta', 'vendor', '#0064E0', { aliases: [alias('llama', 'Llama')] }),
  color('microsoft', 'microsoft-color', 'Microsoft', 'vendor', '#F5F5F7', {
    scale: 0.86,
    aliases: [alias('phi', 'Phi')],
  }),
  mono('moonshot', 'moonshot', 'Moonshot AI', 'vendor', '#12161F'),
  mono('nvidia', 'nvidia', 'NVIDIA', 'vendor', '#76B900', { aliases: [alias('nemotron', 'Nemotron')] }),
  mono('ollama', 'ollama', 'Ollama', 'vendor', '#0B0B0C'),
  mono('openai', 'openai', 'OpenAI', 'vendor', '#0B0B0C', { aliases: [alias('gpt', 'GPT')] }),
  mono('opencode', 'opencode', 'OpenCode', 'vendor', '#0B0B0C', { scale: 0.9 }),
  mono('openrouter', 'openrouter', 'OpenRouter', 'vendor', '#6467F2'),
  mono('tencent', 'tencent', 'Tencent', 'vendor', '#0052D9'),
  color('together', 'together-color', 'Together AI', 'vendor', '#010120'),
  mono('typesafe', 'typesafeai', 'TypeSafe', 'vendor', '#0F766E'),
  mono('vercel', 'vercel', 'Vercel', 'vendor', '#000000'),
  mono('xai', 'xai', 'xAI', 'vendor', '#0B0B0C'),

  mono('antling', 'ling', 'Ant Ling', 'model', '#0B0B0C'),
  mono('claude', 'claude', 'Claude', 'model', '#D97757'),
  mono('command', 'commanda', 'Command', 'model', '#39594D'),
  mono('doubao', 'doubao', 'Doubao', 'model', '#2A64FF'),
  mono('grok', 'grok', 'Grok', 'model', '#0B0B0C'),
  mono('hailuo', 'hailuo', 'Hailuo', 'model', '#0B0B0C'),
  mono('hunyuan', 'hunyuan', 'Hunyuan', 'model', '#0055E9'),
  mono('kimi', 'kimi', 'Kimi', 'model', '#12161F'),
  mono('minimax', 'minimax', 'MiniMax', 'model', '#E2167E'),
  mono('mistral', 'mistral', 'Mistral', 'model', '#FA520F'),
  mono('perplexity', 'perplexity', 'Perplexity', 'model', '#20808D'),
  mono('qwen', 'qwen', 'Qwen', 'model', '#6B57FF'),
  mono('stepfun', 'stepfun', 'StepFun', 'model', '#1E7BFF'),
  mono('xiaomimimo', 'xiaomimimo', 'Xiaomi MiMo', 'model', '#FF6900'),
  mono('yi', 'yi', 'Yi', 'model', '#111318'),
];

/** One hand-authored mark that is deliberately not sourced from the Lobe set. */
export interface ManualMark {
  readonly key: string;
  readonly title: string;
  readonly group: LogoGroup;
  /** Why this key is manual instead of an official Lobe import. */
  readonly reason: string;
}

/**
 * Manual exceptions, also declared in `src/logos/manual.ts`.
 *
 * `aws`/`nova`: the Lobe AWS asset is the full wordmark, illegible at 14px, so
 * the official smile symbol is kept (nova has no distinct official model mark
 * and reuses the AWS glyph). `deepseek`: the official whale path from
 * `reference/deepseek-whale.svg`. `radius`: no official mark, hand-drawn "R".
 * `xiaomi`: the Simple Icons "mi" counters on the official orange tile.
 * `zhipu`/`glm`: the Lobe `zhipu.svg` swirl reads as a few white dots and
 * `glmv.svg` as a small animal, so both keep the official zai-org/GLM-5 vector
 * (the black tile with the white "Z") from `reference/derived/zhipu-z.svg`.
 * `gemini`: an inlined tile may not carry ids or gradient definitions, so the
 * Lobe `gemini-color.svg` aurora is flattened into id-free colour bands.
 * `volcengine`: the official two-blue mountain mark from the site header
 * (`reference/volcengine.svg`); the Lobe colour file carries older brand hexes.
 */
export const MANUAL_MARKS: readonly ManualMark[] = [
  {
    key: 'aws',
    title: 'AWS',
    group: 'vendor',
    reason: 'the Lobe AWS asset is a wordmark that is illegible at 14px; keep the official smile symbol',
  },
  {
    key: 'deepseek',
    title: 'DeepSeek',
    group: 'model',
    reason: 'the official whale path in reference/deepseek-whale.svg is the canonical mark',
  },
  {
    key: 'gemini',
    title: 'Gemini',
    group: 'model',
    reason:
      'a flat reconstruction of the official Lobe gemini-color.svg aurora: inlined tiles may not carry ids or gradient definitions',
  },
  {
    key: 'glm',
    title: 'GLM',
    group: 'model',
    reason: 'the Lobe glmv.svg reads as a small animal; reuses the official zai-org/GLM-5 Z mark shared with zhipu',
  },
  {
    key: 'nova',
    title: 'Nova',
    group: 'model',
    reason: 'no distinct official model mark; reuses the AWS glyph',
  },
  {
    key: 'radius',
    title: 'Radius',
    group: 'vendor',
    reason: 'no official mark found; hand-drawn letterform fallback',
  },
  {
    key: 'volcengine',
    title: 'Volcengine',
    group: 'vendor',
    reason:
      'the official two-blue mountain mark from reference/volcengine.svg; the Lobe volcengine-color.svg still uses older brand hexes',
  },
  {
    key: 'xiaomi',
    title: 'Xiaomi',
    group: 'vendor',
    reason: 'the Simple Icons "mi" counters on the official orange tile',
  },
  {
    key: 'zhipu',
    title: 'Zhipu AI',
    group: 'vendor',
    reason:
      'the Lobe zhipu.svg swirl reads as several dots; keep the official zai-org/GLM-5 black tile with the white Z',
  },
];

/** Required vendor keys, in the task's order. */
export const REQUIRED_VENDOR_KEYS: readonly string[] = Object.freeze([
  'alibaba',
  'anthropic',
  'antgroup',
  'aws',
  'azure',
  'baidu',
  'baiducloud',
  'baseten',
  'bytedance',
  'cerebras',
  'cloudflare',
  'cohere',
  'fireworks',
  'github',
  'google',
  'groq',
  'huggingface',
  'lmstudio',
  'meta',
  'microsoft',
  'moonshot',
  'nvidia',
  'ollama',
  'openai',
  'opencode',
  'openrouter',
  'radius',
  'tencent',
  'together',
  'typesafe',
  'vercel',
  'volcengine',
  'xai',
  'xiaomi',
  'zhipu',
]);

/** Required model keys, in the task's order. */
export const REQUIRED_MODEL_KEYS: readonly string[] = Object.freeze([
  'antling',
  'claude',
  'command',
  'deepseek',
  'doubao',
  'ernie',
  'gemini',
  'glm',
  'gpt',
  'grok',
  'hailuo',
  'hunyuan',
  'kimi',
  'llama',
  'minimax',
  'mistral',
  'nemotron',
  'nova',
  'perplexity',
  'phi',
  'qwen',
  'stepfun',
  'xiaomimimo',
  'yi',
]);

/** Picker group for a required key, or `null` when the key is not part of the set. */
export function requiredGroup(key: string): LogoGroup | null {
  if (REQUIRED_VENDOR_KEYS.includes(key)) return 'vendor';
  if (REQUIRED_MODEL_KEYS.includes(key)) return 'model';
  return null;
}

/** Throw when a source-mark value is not a valid hex colour. */
function assertHexColour(value: string, label: string): void {
  if (!/^#[0-9A-F]{6}$/i.test(value)) throw new Error(`${label} must be a #RRGGBB colour, got "${value}"`);
}

/** Throw when a source mark's declared metadata cannot drive the importer. */
function assertSourceMark(mark: SourceMark): void {
  if (!/^[a-z][a-z0-9]*$/.test(mark.key)) throw new Error(`source mark key "${mark.key}" is not kebab-free lowercase`);
  if (!/^[a-z][a-z0-9-]*$/.test(mark.slug)) throw new Error(`source mark slug "${mark.slug}" is not a Lobe slug`);
  if (mark.title.trim() === '') throw new Error(`source mark "${mark.key}" needs a title`);
  if (requiredGroup(mark.key) !== mark.group) throw new Error(`source mark "${mark.key}" has the wrong picker group`);
  if (!Number.isFinite(mark.scale) || mark.scale <= 0 || mark.scale > 1) {
    throw new Error(`source mark "${mark.key}" scale must be in (0, 1]`);
  }
  assertHexColour(mark.tile, `source mark "${mark.key}" tile`);
  if (mark.mode === 'mono') {
    assertHexColour(mark.glyph, `source mark "${mark.key}" glyph`);
  } else if (mark.glyph !== 'official') {
    throw new Error(`multi-colour source mark "${mark.key}" must declare glyph "official"`);
  }
}

/**
 * Assert the configuration covers exactly the required 59 keys: every source
 * mark, every alias and every manual exception, each in exactly one group.
 */
export function assertConfigCoverage(): void {
  const seen = new Map<string, { group: LogoGroup; origin: string }>();
  const add = (key: string, group: LogoGroup, origin: string): void => {
    const previous = seen.get(key);
    if (previous !== undefined) throw new Error(`key "${key}" declared twice (${previous.origin} and ${origin})`);
    seen.set(key, { group, origin });
  };

  for (const mark of SOURCE_MARKS) {
    assertSourceMark(mark);
    add(mark.key, mark.group, 'source mark');
    for (const item of mark.aliases ?? []) {
      if (item.title.trim() === '') throw new Error(`alias "${item.key}" needs a title`);
      add(item.key, item.group, `alias of "${mark.key}"`);
    }
  }
  for (const mark of MANUAL_MARKS) add(mark.key, mark.group, 'manual mark');

  const required = [...REQUIRED_VENDOR_KEYS, ...REQUIRED_MODEL_KEYS];
  const missing = required.filter((key) => !seen.has(key));
  const extra = [...seen.keys()].filter((key) => !required.includes(key));
  if (missing.length > 0) throw new Error(`required keys without artwork config: ${missing.join(', ')}`);
  if (extra.length > 0) throw new Error(`artwork config declares keys outside the required set: ${extra.join(', ')}`);
  if (seen.size !== required.length) throw new Error(`config covers ${seen.size} keys, expected ${required.length}`);
  for (const key of required) {
    const entry = seen.get(key);
    const group = requiredGroup(key);
    if (entry === undefined || group === null || entry.group !== group) {
      throw new Error(`key "${key}" must be in group "${group ?? 'unknown'}"`);
    }
  }
}

/** Sleep helper for retry backoff. */
const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Fetch a URL as text, retrying transient failures with linear backoff. */
async function fetchText(url: string, attempt = 1): Promise<string> {
  const attempts = 4;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    if (attempt >= attempts) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `failed to fetch ${url}: ${message} — set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY to this machine's proxy`,
        { cause: error },
      );
    }
    await sleep(400 * attempt);
    return fetchText(url, attempt + 1);
  }
}

/** Assert an upstream file is a self-contained 24×24 `<svg>` we can transform. */
function assertUpstreamSvg(url: string, text: string): void {
  if (!/^<svg\b[\s\S]*<\/svg>\s*$/.test(text)) throw new Error(`${url} is not a single <svg> document`);
  if (!text.includes('viewBox="0 0 24 24"')) throw new Error(`${url} is not a 24x24 icon`);
  if (!text.includes('<title>')) throw new Error(`${url} has no <title> metadata`);
}

/** Verify the pinned package really declares the manifest's license. */
async function assertPackageLicense(): Promise<void> {
  const url = `${OFFICIAL_PACKAGE_URL}/package.json`;
  const text = await fetchText(url);
  const metadata = JSON.parse(text) as { license?: unknown; version?: unknown };
  if (metadata.license !== OFFICIAL_LICENSE) {
    throw new Error(`${url} license is ${String(metadata.license)}, expected ${OFFICIAL_LICENSE}`);
  }
  if (metadata.version !== OFFICIAL_VERSION) {
    throw new Error(`${url} version is ${String(metadata.version)}, expected ${OFFICIAL_VERSION}`);
  }
}

/** One manifest entry: the upstream file plus the tile/fitting recipe. */
interface ManifestMark {
  title: string;
  group: LogoGroup;
  slug: string;
  file: string;
  sha256: string;
  mode: MarkMode;
  tile: string;
  glyph: string;
  scale: number;
  aliases: AliasSpec[];
}

/** The committed manifest the importer reads. */
export interface OfficialManifest {
  package: string;
  version: string;
  license: string;
  repository: string;
  source: string;
  viewBox: string;
  tile: { size: number; radius: number };
  marks: Record<string, ManifestMark>;
  /** Keys deliberately kept out of the Lobe import (documented in manual.ts). */
  manual: ManualMark[];
}

/** Hash one committed reference file exactly as it will be re-read offline. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Download every source icon, write the reference tree and the manifest. */
export async function fetchOfficialLogos(): Promise<void> {
  assertConfigCoverage();
  await assertPackageLicense();
  mkdirSync(REFERENCE_DIR, { recursive: true });

  const texts = new Map<string, string>();
  let cursor = 0;
  // Each worker drains the shared cursor recursively, so the requests run
  // concurrently without an `await` inside a loop.
  const worker = async (): Promise<void> => {
    const mark = SOURCE_MARKS[cursor];
    cursor += 1;
    if (mark === undefined) return;
    const url = `${OFFICIAL_ICON_BASE}${mark.slug}.svg`;
    const text = await fetchText(url);
    assertUpstreamSvg(url, text);
    texts.set(mark.key, text);
    console.log(`fetched ${mark.slug}.svg (${text.length} bytes)`);
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(6, SOURCE_MARKS.length) }, worker));

  const expectedFiles = new Set<string>();
  for (const mark of SOURCE_MARKS) {
    const text = texts.get(mark.key);
    if (text === undefined) throw new Error(`no upstream text collected for "${mark.key}"`);
    const file = `${mark.slug}.svg`;
    expectedFiles.add(file);
    writeFileSync(resolve(REFERENCE_DIR, file), text, 'utf8');
  }

  // Prune icons that no longer belong to the pinned set, so the reference tree
  // can never disagree with the manifest.
  for (const name of readdirSync(REFERENCE_DIR)) {
    if (name.endsWith('.svg') && !expectedFiles.has(name)) {
      unlinkSync(resolve(REFERENCE_DIR, name));
      console.log(`pruned stale reference/${name}`);
    }
  }

  const marks: Record<string, ManifestMark> = {};
  for (const mark of SOURCE_MARKS.toSorted((a, b) => a.key.localeCompare(b.key))) {
    const text = texts.get(mark.key);
    if (text === undefined) throw new Error(`no upstream text collected for "${mark.key}"`);
    marks[mark.key] = {
      title: mark.title,
      group: mark.group,
      slug: mark.slug,
      file: `${mark.slug}.svg`,
      sha256: sha256(text),
      mode: mark.mode,
      tile: mark.tile,
      glyph: mark.glyph,
      scale: mark.scale,
      aliases: (mark.aliases ?? [])
        .toSorted((a, b) => a.key.localeCompare(b.key))
        .map((item) => ({ key: item.key, title: item.title, group: item.group })),
    };
  }

  const manifest: OfficialManifest = {
    package: OFFICIAL_PACKAGE,
    version: OFFICIAL_VERSION,
    license: OFFICIAL_LICENSE,
    repository: OFFICIAL_REPOSITORY,
    source: OFFICIAL_ICON_BASE,
    viewBox: '0 0 24 24',
    tile: { size: 24, radius: 6 },
    marks,
    manual: MANUAL_MARKS.toSorted((a, b) => a.key.localeCompare(b.key)).map((mark) => ({
      key: mark.key,
      title: mark.title,
      group: mark.group,
      reason: mark.reason,
    })),
  };
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const aliasCount = SOURCE_MARKS.reduce((total, mark) => total + (mark.aliases?.length ?? 0), 0);
  console.log(
    `wrote reference/official: ${SOURCE_MARKS.length} SVG files, ${SOURCE_MARKS.length} manifest marks, ` +
      `${aliasCount} aliases, ${MANUAL_MARKS.length} manual exceptions`,
  );
}

/** `true` when this module is the process entry point (not imported). */
function isDirectRun(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) await fetchOfficialLogos();
