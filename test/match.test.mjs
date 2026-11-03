/**
 * Matcher regression tests: the provider/model pairs this plugin must classify,
 * including aggregator providers where the model brand wins over the host brand,
 * plus the official-channel vendor table used by Settings → Models.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOGO_KEYS,
  MODEL_RULES,
  PROVIDER_RULES,
  VENDOR_CHANNELS,
  VENDOR_RULES,
  matchModelLogo,
  matchVendorLogo,
  normalizeModelText,
} from '../src/match.mjs';

const pair = (providerId, modelId, modelName = modelId) => ({
  provider: { id: providerId, name: providerId },
  model: { id: modelId, name: modelName },
});

const cases = [
  // The providers configured in this profile.
  [pair('deepseek-account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'), 'deepseek'],
  [pair('zai-coding-cn', 'glm-5.3-flash', 'GLM-5.3-Flash'), 'zhipu'],
  // Model-level brands on aggregator/opaque providers.
  [pair('openrouter', 'anthropic/claude-sonnet-4.5'), 'claude'],
  [pair('openrouter', 'openai/gpt-5.2'), 'openai'],
  [pair('openrouter', 'google/gemini-3-pro'), 'gemini'],
  [pair('ollama', 'llama3.1:70b', 'Llama 3.1'), 'meta'],
  [pair('ollama', 'qwen3:32b', 'Qwen3'), 'qwen'],
  [pair('custom', 'deepseek-reasoner'), 'deepseek'],
  [pair('custom', 'Qwen3-Max'), 'qwen'],
  [pair('custom', 'kimi-k2-thinking'), 'kimi'],
  [pair('custom', 'MiniMax-M2'), 'minimax'],
  [pair('custom', 'mistral-large-latest'), 'mistral'],
  [pair('custom', 'grok-4.1'), 'xai'],
  [pair('custom', 'doubao-seed-1.8'), 'doubao'],
  [pair('custom', 'ERNIE-5.0'), 'baidu'],
  [pair('custom', 'hunyuan-t1'), 'tencent'],
  [pair('custom', 'command-r-plus'), 'cohere'],
  [pair('custom', 'sonar-pro'), 'perplexity'],
  [pair('custom', 'Phi-4-mini'), 'microsoft'],
  [pair('custom', 'Nemotron-4-340B'), 'nvidia'],
  [pair('custom', 'amazon-nova-pro'), 'aws'],
  [pair('custom', 'huggingface/foo'), 'huggingface'],
  [pair('custom', 'groq/compound'), 'groq'],
  [pair('custom', 'step-2-mini'), 'stepfun'],
  [pair('custom', 'yi-large'), 'yi'],
  // Model-level brands added with the vendor artwork.
  [pair('custom', 'MiMo-VL-7B', 'MiMo-VL-7B'), 'xiaomi'],
  [pair('custom', 'Ling-mini-2.0', 'Ling-mini-2.0'), 'antling'],
  // Provider-level fallbacks for opaque model ids.
  [pair('deepseek-official', 'chat'), 'deepseek'],
  [pair('google-vertex', 'default'), 'gemini'],
  [pair('azure-openai-east', 'deployment-1'), 'openai'],
  [pair('moonshot-ai', 'chat'), 'kimi'],
  [pair('nvidia-nim', 'default'), 'nvidia'],
  [pair('xiaomi-token-plan-cn', 'opaque-model-1'), 'xiaomi'],
  // Unknown stays unmarked.
  [pair('acme-llm', 'acme-chat-1', 'Acme Chat 1'), null],
  [pair('custom', 'internal-model-v0'), null],
];

test('classifies configured providers and aggregator model families', () => {
  for (const [input, expected] of cases) {
    assert.equal(matchModelLogo(input), expected, `${input.provider.id}/${input.model.id}`);
  }
});

test('every rule key has an entry in LOGO_KEYS', () => {
  const keys = new Set();
  for (const [key] of MODEL_RULES) keys.add(key);
  for (const [key] of PROVIDER_RULES) keys.add(key);
  for (const key of keys) assert.ok(LOGO_KEYS.includes(key), `missing logo key: ${key}`);
  for (const key of LOGO_KEYS) assert.ok(keys.has(key), `LOGO_KEYS entry without a rule: ${key}`);
});

test('normalizes ids and display names uniformly', () => {
  assert.equal(normalizeModelText('  Claude_Sonnet   4.5 '), 'claude sonnet 4.5');
});

test('tolerates missing provider or model data', () => {
  assert.equal(matchModelLogo(null), null);
  assert.equal(matchModelLogo({}), null);
  assert.equal(matchModelLogo({ provider: { id: 'openai' } }), 'openai');
  assert.equal(matchModelLogo({ model: { id: 'gpt-4o' } }), 'openai');
});

/**
 * Every provider route id in the shipped catalog
 * (`@deepseek-ai/dsh-llm-pi-ai`'s generated providers + the DeepSeek account /
 * official adapters) and the vendor mark it must show.
 */
const OFFICIAL_CHANNEL_KEYS = {
  'amazon-bedrock': 'aws',
  'ant-ling': 'antling',
  anthropic: 'claude',
  azure: 'azure',
  baseten: 'baseten',
  cerebras: 'cerebras',
  'cloudflare-ai-gateway': 'cloudflare',
  'cloudflare-workers-ai': 'cloudflare',
  deepseek: 'deepseek',
  'deepseek-account': 'deepseek',
  'deepseek-official': 'deepseek',
  fireworks: 'fireworks',
  'github-copilot': 'github',
  google: 'gemini',
  'google-vertex': 'gemini',
  groq: 'groq',
  huggingface: 'huggingface',
  'kimi-coding': 'kimi',
  meta: 'meta',
  minimax: 'minimax',
  'minimax-cn': 'minimax',
  mistral: 'mistral',
  moonshotai: 'kimi',
  'moonshotai-cn': 'kimi',
  nvidia: 'nvidia',
  openai: 'openai',
  'openai-codex': 'openai',
  opencode: 'opencode',
  'opencode-go': 'opencode',
  openrouter: 'openrouter',
  'qwen-token-plan': 'qwen',
  'qwen-token-plan-cn': 'qwen',
  'qwen-token-plan-individual': 'qwen',
  radius: 'radius',
  together: 'together',
  typesafe: 'typesafe',
  'vercel-ai-gateway': 'vercel',
  xai: 'xai',
  xiaomi: 'xiaomi',
  'xiaomi-token-plan-ams': 'xiaomi',
  'xiaomi-token-plan-cn': 'xiaomi',
  'xiaomi-token-plan-sgp': 'xiaomi',
  zai: 'zhipu',
  'zai-coding-cn': 'zhipu',
};

test('maps every official channel id to its vendor mark', () => {
  for (const [providerId, expected] of Object.entries(OFFICIAL_CHANNEL_KEYS)) {
    assert.equal(matchVendorLogo(providerId), expected, providerId);
  }
});

test('the exported channel directory agrees with the expected table', () => {
  assert.deepEqual({ ...VENDOR_CHANNELS }, OFFICIAL_CHANNEL_KEYS);
});

test('custom / hand-declared providers get no vendor mark', () => {
  for (const providerId of ['volcengine', 'acme', 'acme-llm', 'my-local-provider', 'openai-compatible']) {
    assert.equal(matchVendorLogo(providerId), null, providerId);
  }
  assert.equal(matchVendorLogo(''), null);
  assert.equal(matchVendorLogo(null), null);
  assert.equal(matchVendorLogo(undefined), null);
});

test('normalizes whitespace and letter case in route ids', () => {
  assert.equal(matchVendorLogo('  OpenAI  '), 'openai');
  assert.equal(matchVendorLogo('DeepSeek-Account'), 'deepseek');
  assert.equal(matchVendorLogo('XIAOMI-TOKEN-PLAN-CN'), 'xiaomi');
});

test('every vendor rule and directory value is a logo key', () => {
  for (const [key] of VENDOR_RULES) {
    assert.ok(LOGO_KEYS.includes(key), `VENDOR_RULES key without artwork key: ${key}`);
  }
  for (const key of Object.values(VENDOR_CHANNELS)) {
    assert.ok(LOGO_KEYS.includes(key), `VENDOR_CHANNELS value without artwork key: ${key}`);
  }
});

/** Load the hand-drawn artwork sets (vendors are authored in their own module). */
async function loadArtwork() {
  const sets = ['logos-intl.mjs', 'logos-cn.mjs', 'logos-vendors.mjs'];
  const logos = {};
  for (const set of sets) {
    const module = await import(new URL(`../src/${set}`, import.meta.url));
    assert.ok(module.LOGOS && typeof module.LOGOS === 'object', `${set} must export LOGOS`);
    for (const [key, value] of Object.entries(module.LOGOS)) {
      assert.equal(logos[key], undefined, `duplicate logo key across artwork sets: ${key}`);
      logos[key] = value;
    }
  }
  return logos;
}

test('every logo key has inlinable artwork, including the vendor marks', async () => {
  const logos = await loadArtwork();
  for (const key of LOGO_KEYS) {
    const entry = logos[key];
    assert.ok(entry !== undefined, `LOGO_KEYS entry has no artwork: ${key}`);
    assert.equal(typeof entry.title, 'string', `${key}.title must be a string`);
    assert.ok(entry.title.trim() !== '', `${key}.title must not be empty`);
    assert.equal(typeof entry.svg, 'string', `${key}.svg must be a string`);
    assert.ok(entry.svg.trim().startsWith('<svg'), `${key}.svg must start with <svg`);
    const withoutNamespace = entry.svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
    assert.doesNotMatch(entry.svg, /\sid\s*=/, `${key}.svg must not use id attributes`);
    assert.doesNotMatch(entry.svg, /<script/i, `${key}.svg must not contain scripts`);
    assert.doesNotMatch(entry.svg, /\son[a-z]+\s*=/i, `${key}.svg must not contain event handlers`);
    assert.doesNotMatch(withoutNamespace, /https?:/i, `${key}.svg must not reference external resources`);
  }
});
