/**
 * Build `client.js` — the browser module for this bundle.
 *
 * Inputs:
 *   src/logos-intl.mjs + src/logos-cn.mjs + src/logos-vendors.mjs  artwork
 *   src/match.mjs                                                  pure matcher
 *   src/artwork.mjs                                                letter tiles
 *   src/resolve.mjs                                                override resolution
 *   src/i18n.js, src/overrides.js, src/ui-css.js,                  browser fragments
 *   src/picker.js, src/decorate.js, src/section.js, src/label.js
 *
 * Output: one self-contained module registered with the browser module loader.
 * The pure `.mjs` modules are inlined with their exports stripped and their
 * local imports removed; the fragments are appended in dependency order inside
 * the same factory closure.
 *
 * `--check` compares the generated text with the committed artifact and exits 1
 * when stale, so a shipped client.js can never silently drift from its sources.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'client.js');

const problems = [];
const warnings = [];

/** The pure modules inlined in this order. */
const PURE_MODULES = ['src/match.mjs', 'src/artwork.mjs', 'src/resolve.mjs'];

/** The browser fragments appended in this order. */
const FRAGMENTS = [
  'src/i18n.js',
  'src/overrides.js',
  'src/ui-css.js',
  'src/picker.js',
  'src/decorate.js',
  'src/section.js',
  'src/label.js',
];

/** Merge the artwork sets, validating the shape every logo must satisfy. */
async function loadLogos(allowMissingArtwork) {
  const sets = [
    { file: 'src/logos-intl.mjs', name: 'logos-intl' },
    { file: 'src/logos-cn.mjs', name: 'logos-cn' },
    { file: 'src/logos-vendors.mjs', name: 'logos-vendors' },
  ];
  const merged = {};
  for (const set of sets) {
    // Development builds may run before the vendor artwork module exists.
    if (allowMissingArtwork && !existsSync(resolve(ROOT, set.file))) {
      warnings.push(`${set.file}: missing (build allowed by --allow-missing-artwork)`);
      continue;
    }
    let mod;
    try {
      mod = await import(new URL('file://' + resolve(ROOT, set.file).replace(/\\/g, '/')));
    } catch (error) {
      problems.push(`${set.file}: cannot import (${error.message})`);
      continue;
    }
    const logos = mod.LOGOS;
    if (logos === null || typeof logos !== 'object' || Array.isArray(logos)) {
      problems.push(`${set.file}: must export LOGOS as an object`);
      continue;
    }
    for (const [key, value] of Object.entries(logos)) {
      if (key in merged) {
        problems.push(`${set.file}: duplicate logo key "${key}"`);
        continue;
      }
      if (value === null || typeof value !== 'object') {
        problems.push(`${set.file}: logo "${key}" must be an object`);
        continue;
      }
      if (typeof value.title !== 'string' || value.title.trim() === '') {
        problems.push(`${set.file}: logo "${key}" needs a non-empty title`);
      }
      if (typeof value.svg !== 'string' || !value.svg.trim().startsWith('<svg')) {
        problems.push(`${set.file}: logo "${key}" needs an svg string starting with <svg`);
        continue;
      }
      const svg = value.svg;
      // The XML namespace declaration is inert when the svg is inlined into HTML;
      // strip it before rejecting genuine external references.
      const withoutNamespace = svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
      if (/\sid\s*=/.test(svg)) problems.push(`${set.file}: logo "${key}" must not use id attributes (inlined DOM would collide)`);
      if (/<script/i.test(svg)) problems.push(`${set.file}: logo "${key}" must not contain scripts`);
      if (/\son[a-z]+\s*=/i.test(svg)) problems.push(`${set.file}: logo "${key}" must not contain event handlers`);
      if (/https?:/i.test(withoutNamespace)) problems.push(`${set.file}: logo "${key}" must not reference external resources`);
      merged[key] = { title: value.title.trim(), svg: svg.trim() };
    }
  }
  return merged;
}

/** Read one source file; report a problem instead of throwing. */
function readSource(file) {
  try {
    return readFileSync(resolve(ROOT, file), 'utf8');
  } catch (error) {
    problems.push(`${file}: cannot read (${error.message})`);
    return '';
  }
}

/** Inline a pure module: strip ESM exports and local imports. */
function inlinePureModule(file) {
  const source = readSource(file);
  if (source === '') return '';
  let body = source.replace(/^import\s[^;]*;\s*$/gm, '');
  body = body.replace(/^export\s+(const|function|class|let)\s/gm, '$1 ');
  if (/^\s*export\s/m.test(body)) problems.push(`${file}: unsupported export form`);
  if (/^\s*import\s/m.test(body)) problems.push(`${file}: unsupported import form (only single-line local imports)`);
  return `// ---- ${file} ----\n${body}`;
}

/** Inline a browser fragment, rejecting module syntax. */
function inlineFragment(file) {
  const source = readSource(file);
  if (source === '') return '';
  if (/^\s*(?:import|export)\s/m.test(source)) problems.push(`${file}: fragments must not use import/export`);
  return `// ---- ${file} ----\n${source}`;
}

/** Validate that every logo key is reachable and every reachable key has artwork. */
async function validateCoverage(logos, allowMissingArtwork) {
  let match;
  try {
    match = await import(new URL('file://' + resolve(ROOT, 'src/match.mjs').replace(/\\/g, '/')));
  } catch (error) {
    problems.push(`src/match.mjs: cannot import (${error.message})`);
    return;
  }
  const keys = match.LOGO_KEYS;
  if (!Array.isArray(keys)) {
    problems.push('src/match.mjs: LOGO_KEYS must be an array');
    return;
  }
  for (const key of keys) {
    if (logos[key] === undefined) {
      const message = `logo key "${key}" has no artwork`;
      if (allowMissingArtwork) warnings.push(message);
      else problems.push(message);
    }
  }
  for (const key of Object.keys(logos)) {
    if (!keys.includes(key)) warnings.push(`logo "${key}" is never returned by a rule`);
  }
  if (Array.isArray(match.VENDOR_RULES)) {
    for (const [key] of match.VENDOR_RULES) {
      if (!keys.includes(key)) problems.push(`vendor rule key "${key}" is not in LOGO_KEYS`);
    }
  } else {
    problems.push('src/match.mjs: VENDOR_RULES must be an array');
  }
  // The letter-tile helper is part of the shipped runtime; validate it here so a
  // broken generator fails the build instead of a user's settings page.
  try {
    const artwork = await import(new URL('file://' + resolve(ROOT, 'src/artwork.mjs').replace(/\\/g, '/')));
    if (typeof artwork.letterTile !== 'function') problems.push('src/artwork.mjs: letterTile must be a function');
    else {
      const sample = artwork.letterTile('测试');
      if (sample === null || typeof sample !== 'object' || typeof sample.svg !== 'string' || !sample.svg.startsWith('<svg')) {
        problems.push('src/artwork.mjs: letterTile must return { title, svg }');
      } else {
        if (/\sid\s*=/.test(sample.svg)) problems.push('src/artwork.mjs: letterTile svg must not use id attributes');
        if (/<script|\son[a-z]+\s*=|https?:/i.test(sample.svg.replace(/\sxmlns[^=]*="[^"]*"/gi, ''))) {
          problems.push('src/artwork.mjs: letterTile svg must stay self-contained');
        }
      }
    }
  } catch (error) {
    problems.push(`src/artwork.mjs: cannot import (${error.message})`);
  }
}

function build(logos) {
  const pure = PURE_MODULES.map(inlinePureModule).join('\n');
  const fragments = FRAGMENTS.map(inlineFragment).join('\n');
  return `// Generated by scripts/build-client.mjs from src/*.mjs and src/*.js — do not edit.
window.__ModuleLoader__.load({
  id: 'dsh-model-logos',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const createRoot = (() => {
      try {
        const client = require('react-dom/client');
        return client !== null && client !== undefined ? client.createRoot : null;
      } catch (error) {
        return null;
      }
    })();
    const LOGOS = ${JSON.stringify(logos, null, 2).split('\n').join('\n    ')};

${pure}
${fragments}
    return { inject: INJECT, apply: apply };
  },
});
`;
}

const allowMissingArtwork = process.argv.includes('--allow-missing-artwork');
const logos = await loadLogos(allowMissingArtwork);
await validateCoverage(logos, allowMissingArtwork);
const generated = build(logos);

if (problems.length > 0) {
  for (const problem of problems) console.error('error: ' + problem);
  process.exit(1);
}
for (const warning of warnings) console.warn('warning: ' + warning);

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== generated) {
    console.error('error: client.js is stale — run `node scripts/build-client.mjs`');
    process.exit(1);
  }
  console.log(`client.js is up to date (${Object.keys(logos).length} logos, ${generated.length} bytes)`);
  process.exit(0);
}

writeFileSync(OUT, generated);
console.log(`wrote client.js: ${Object.keys(logos).length} logos, ${generated.length} bytes`);
