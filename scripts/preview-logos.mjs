/**
 * Render the logo set into a static HTML page and capture it with headless Edge.
 *
 * This is a design-iteration aid, not part of the shipped plugin: it imports the
 * artwork modules directly and screenshots them at shipped sizes (14/16px) plus
 * larger reference sizes, on light and dark surfaces, next to a mock of the
 * composer trigger and model menu (`--only-set vendors` swaps those for a mock
 * of the Settings → Models provider rows, where vendor marks actually appear).
 *
 * Usage:
 *   node scripts/preview-logos.mjs                          # full sheet -> .preview/logos.png
 *   node scripts/preview-logos.mjs --out docs/preview.png   # also copy the png to docs/
 *   node scripts/preview-logos.mjs --only openai            # one logo, large -> .preview/openai.png
 *   node scripts/preview-logos.mjs --only-set vendors       # vendor marks -> .preview/logos-vendors.png
 *   node scripts/preview-logos.mjs --no-shot                # only write the html
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = join(ROOT, '.preview');
mkdirSync(PREVIEW, { recursive: true });

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const setIndex = args.indexOf('--only-set');
const onlySet = setIndex >= 0 ? args[setIndex + 1] : null;
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const noShot = args.includes('--no-shot');
const numeric = (flag, fallback) => {
  const at = args.indexOf(flag);
  const value = at >= 0 ? Number(args[at + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const scale = numeric('--scale', only ? 2 : 1);
const forcedWidth = numeric('--width', null);
const forcedHeight = numeric('--height', null);

const [{ LOGOS: INTL }, { LOGOS: CN }, { LOGOS: VENDORS }, match, artwork] = await Promise.all([
  import('../src/logos-intl.mjs'),
  import('../src/logos-cn.mjs'),
  import('../src/logos-vendors.mjs'),
  import('../src/match.mjs'),
  import('../src/artwork.mjs'),
]);
const SETS = { intl: INTL, cn: CN, vendors: VENDORS };
if (onlySet !== null && !(onlySet in SETS)) {
  console.error(`error: unknown --only-set "${onlySet}" (expected: ${Object.keys(SETS).join(', ')})`);
  process.exit(1);
}
const LOGOS = { ...INTL, ...CN, ...VENDORS };
const allKeys = Object.keys(LOGOS).sort();
const keys = onlySet ? Object.keys(SETS[onlySet]).sort() : allKeys;
// Vendor marks are expected even before src/match.mjs lists their keys yet.
const expected = new Set([...match.LOGO_KEYS, ...Object.keys(VENDORS)]);
const missing = match.LOGO_KEYS.filter((key) => !(key in LOGOS));
const unused = allKeys.filter((key) => !expected.has(key));

if (missing.length > 0) console.warn('warning: matcher keys without artwork: ' + missing.join(', '));
if (unused.length > 0) console.warn('warning: artwork keys the matcher never returns: ' + unused.join(', '));

const SAMPLES = [
  ['deepseek', 'DeepSeek-V4.1-Flash'],
  ['deepseek', 'deepseek-chat'],
  ['openai', 'GPT-5.2'],
  ['claude', 'Claude Sonnet 4.5'],
  ['gemini', 'Gemini 3 Pro'],
  ['qwen', 'Qwen3-Max'],
  ['zhipu', 'GLM-5.3-Flash'],
  ['kimi', 'Kimi K2 Thinking'],
  ['meta', 'Llama 4 Maverick'],
  ['mistral', 'Mistral Large 3'],
  ['xai', 'Grok 4.1'],
  ['doubao', 'Doubao-Seed-1.8'],
  ['baidu', 'ERNIE 5.0'],
  ['tencent', 'Hunyuan-T1'],
  ['minimax', 'MiniMax-M2'],
  ['stepfun', 'Step-3'],
  ['yi', 'Yi-Large'],
  ['cohere', 'Command R+'],
  ['perplexity', 'Sonar Pro'],
  ['nvidia', 'Nemotron-4'],
  ['microsoft', 'Phi-4'],
  ['aws', 'Nova Pro'],
  ['huggingface', 'HF Inference'],
  ['ollama', 'Ollama'],
  ['groq', 'Groq'],
  ['openrouter', 'OpenRouter'],
];

/** Official channel rows, as they are titled in the provider directory. */
const PROVIDERS = [
  ['xiaomi', 'Xiaomi MiMo'],
  ['opencode', 'OpenCode Zen'],
  ['cerebras', 'Cerebras'],
  ['cloudflare', 'Cloudflare AI Gateway'],
  ['together', 'Together AI'],
  ['fireworks', 'Fireworks'],
  ['github', 'GitHub Copilot'],
  ['vercel', 'Vercel AI Gateway'],
  ['baseten', 'Baseten'],
  ['azure', 'Microsoft Azure'],
  ['antling', 'Ant Ling'],
  ['radius', 'Radius'],
  ['typesafe', 'TypeSafe'],
];

/** Names that exercise the deterministic letter-tile fallback (Latin + CJK). */
const LETTER_SAMPLES = ['Qwen3-Max', '通义千问', 'Claude Sonnet 4.5', 'llama-3.1-70b', 'kiro', 'OpenCode Zen', ''];

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mark = (key, size) => {
  const entry = LOGOS[key];
  if (!entry) return `<span class="missing">?</span>`;
  return `<span class="mark" style="width:${size}px;height:${size}px">${entry.svg}</span>`;
};

const composerMock = (theme) => `
<section class="mock mock-${theme}">
  <h3>${theme === 'light' ? 'Light surface' : 'Dark surface'} — composer trigger (13px text, 14px mark)</h3>
  <div class="trigger-row">
    ${SAMPLES.slice(0, 6)
      .map(
        ([key, name]) => `
      <span class="trigger">
        ${mark(key, 14)}
        <span class="trigger-label">${escape(name)}</span>
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`,
      )
      .join('')}
  </div>
  <h3>Model menu rows (13px text, 16px mark)</h3>
  <div class="menu">
    ${SAMPLES.slice(2, 12)
      .map(
        ([key, name], index) => `
      <div class="option">
        <span class="option-copy">${mark(key, 16)}<span class="option-name">${escape(name)}</span></span>
        <span class="check">${index === 1 ? '✓' : ''}</span>
      </div>`,
      )
      .join('')}
  </div>
</section>`;

const providerMock = (theme) => `
<section class="mock mock-${theme}">
  <h3>${theme === 'light' ? 'Light surface' : 'Dark surface'} — Settings → Models provider rows (14px text, 16px vendor mark)</h3>
  <div class="providers">
    ${PROVIDERS.map(
      ([key, name]) => `
    <div class="provider-row">
      ${mark(key, 16)}
      <span class="provider-name">${escape(name)}</span>
    </div>`,
    ).join('')}
  </div>
</section>`;

const letterMock = () => {
  const rows = LETTER_SAMPLES.map((name) => {
    const entry = artwork.letterTile(name);
    const svg = entry.svg;
    return `
    <div class="letter-row">
      <span class="mark" style="width:24px;height:24px">${svg}</span>
      <span class="mark" style="width:16px;height:16px">${svg}</span>
      <span class="letter-label">${escape(name || '(empty)')} → “${escape(entry.title)}”</span>
    </div>`;
  }).join('');
  return `
<section class="mock mock-light">
  <h3>Deterministic letter-tile fallback (src/artwork.mjs) — 24px + 16px</h3>
  <div class="letters">${rows}</div>
</section>`;
};

const artworkCard = (key) => {
  const entry = LOGOS[key];
  return `
  <figure class="card">
    <div class="sizes">
      <span class="on-light">${mark(key, 96)}</span>
      <span class="on-dark">${mark(key, 96)}</span>
    </div>
    <div class="small">
      ${[48, 24, 16, 14].map((size) => `<span class="on-light">${mark(key, size)}</span>`).join('')}
      ${[24, 16, 14].map((size) => `<span class="on-dark">${mark(key, size)}</span>`).join('')}
    </div>
    <figcaption><b>${escape(key)}</b><span>${escape(entry ? entry.title : 'MISSING')}</span></figcaption>
  </figure>`;
};

const sheetTitle = onlySet ? `${onlySet} artwork — ${keys.length} marks` : `Artwork sheet — ${keys.length} marks`;

const body = only
  ? `
${onlySet === 'vendors' ? providerMock('light') + providerMock('dark') + letterMock() : composerMock('light') + composerMock('dark')}
<section class="sheet"><h2>${escape(only)}</h2>${artworkCard(only)}</section>`
  : `
${onlySet === 'vendors' ? providerMock('light') + providerMock('dark') + letterMock() : composerMock('light') + composerMock('dark')}
<section class="sheet"><h2>${sheetTitle}</h2><div class="grid">${keys.map(artworkCard).join('')}</div></section>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>dsh-model-logos preview</title>
<style>
  :root { color-scheme: light dark; font-family: "Segoe UI", system-ui, sans-serif; }
  body { margin: 0; padding: 24px; background: #f3f4f7; color: #1b1f27; }
  h2 { font-size: 15px; margin: 26px 0 10px; font-weight: 600; }
  h3 { font-size: 12px; font-weight: 600; margin: 14px 0 8px; color: #5b6270; }
  .mock { border-radius: 14px; padding: 14px 16px 18px; margin-bottom: 16px; }
  .mock-light { background: #fff; border: 1px solid #e3e5ea; color: #1b1f27; }
  .mock-dark { background: #1b1f27; border: 1px solid #2c313c; color: #e8ebf2; }
  .mock-dark h3 { color: #a2a9b6; }
  .trigger-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .trigger { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 6px 0 8px;
    border-radius: 6px; font-size: 13px; line-height: 20px; }
  .mock-light .trigger { background: #f6f7f9; color: #3d4450; }
  .mock-dark .trigger { background: #262b35; color: #c9cfda; }
  .trigger-label { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { width: 16px; height: 16px; opacity: .55; }
  .menu { max-width: 330px; display: flex; flex-direction: column; gap: 2px;
    border-radius: 10px; padding: 4px; }
  .mock-light .menu { background: #fff; border: 1px solid #e3e5ea; box-shadow: 0 8px 24px rgba(20,24,32,.10); }
  .mock-dark .menu { background: #222731; border: 1px solid #2f3542; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  .option { display: flex; align-items: center; gap: 6px; min-height: 34px; padding: 5px 7px; border-radius: 8px; }
  .option-copy { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
  .option-name { font-size: 13px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .check { flex: 0 0 14px; opacity: .8; font-size: 12px; }
  .providers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; }
  .provider-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
  .provider-name { font-size: 14px; line-height: 22px; }
  .letters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; }
  .letter-row { display: flex; align-items: center; gap: 8px; }
  .letter-label { font-size: 12px; color: #5b6270; }
  .mark { display: inline-block; line-height: 0; flex: none; }
  .mark > svg { display: block; width: 100%; height: 100%; }
  .sheet { margin-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .card { margin: 0; border-radius: 12px; background: #fff; border: 1px solid #e3e5ea; padding: 12px; }
  .sizes { display: flex; align-items: center; gap: 10px; }
  .sizes .on-light, .sizes .on-dark { display: inline-flex; align-items: center; justify-content: center;
    width: 112px; height: 112px; border-radius: 10px; }
  .on-light { background: #fff; }
  .on-dark { background: #1b1f27; }
  .sizes .on-light { border: 1px solid #eceef2; }
  .small { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .small .on-light, .small .on-dark { display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border-radius: 8px; }
  figcaption { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; font-size: 12px; }
  figcaption b { font-size: 12px; }
  figcaption span { color: #7a8290; }
  .missing { color: #d64545; font-weight: 700; }
</style></head>
<body>${body}
<p style="font-size:11px;color:#8b93a1;margin-top:24px">Static preview of src/logos-*.mjs — shipped sizes are 14px (trigger/menu/settings text) and 16px (options).</p>
</body></html>`;

const suffix = only ? only : onlySet ? `logos-${onlySet}` : 'logos';
const htmlPath = join(PREVIEW, `${suffix}.html`);
writeFileSync(htmlPath, html);
console.log('wrote ' + htmlPath);

if (!noShot) {
  const edgeCandidates = [
    process.env.EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const edge = edgeCandidates.find((candidate) => existsSync(candidate));
  if (!edge) {
    console.error('error: Edge not found; set EDGE=<msedge.exe path>');
    process.exit(1);
  }
  const columns = 4;
  const rows = Math.ceil(keys.length / columns);
  const width = forcedWidth ?? (only ? 720 : 1280);
  const height = forcedHeight ?? (only ? 900 : 500 + Math.max(1, rows) * 340);
  const pngPath = join(PREVIEW, `${suffix}.png`);
  const profileDir = join(PREVIEW, `edge-profile-${process.pid}`);
  mkdirSync(profileDir, { recursive: true });
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  try {
    rmSync(pngPath, { force: true });
  } catch {
    // A missing file is the expected starting point.
  }
  try {
    execFileSync(
      edge,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--force-device-scale-factor=' + scale,
        `--user-data-dir=${profileDir}`,
        `--window-size=${width},${height}`,
        `--screenshot=${pngPath}`,
        fileUrl,
      ],
      { stdio: 'ignore', timeout: 120000 },
    );
  } catch (error) {
    console.error('error: headless Edge failed: ' + error.message);
    process.exit(1);
  }
  // Edge may hand the URL to an already-running browser process and return
  // before the screenshot lands, so wait for the artifact instead of trusting exit.
  const deadline = Date.now() + 20000;
  while (!existsSync(pngPath) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  if (!existsSync(pngPath)) {
    console.error('error: no screenshot produced');
    process.exit(1);
  }
  console.log(`wrote ${pngPath} (${statSync(pngPath).size} bytes)`);
  if (outFile) {
    const target = resolve(ROOT, outFile);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(pngPath, target);
    console.log(`copied to ${target} (${statSync(target).size} bytes)`);
  }
}
