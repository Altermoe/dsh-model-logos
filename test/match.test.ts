/**
 * Matcher regression tests: the provider/model pairs this plugin must classify,
 * including aggregator providers where the model brand wins over the host brand,
 * plus the official-channel vendor table used by Settings → Models.
 */
import { describe, expect, it } from 'vitest';

import { LOGOS } from '../src/logos';
import {
  LOGO_KEYS,
  MODEL_RULES,
  PICKER_ONLY_KEYS,
  PROVIDER_RULES,
  VENDOR_CHANNELS,
  VENDOR_RULES,
  matchModelLogo,
  matchVendorLogo,
  normalizeModelText,
} from '../src/match';
import type { BrandLogo } from '../src/types';

/** A provider/model pair as the composer slot and model rows pass it. */
interface PairInput {
  provider: { id: string; name: string };
  model: { id: string; name: string };
}

const pair = (providerId: string, modelId: string, modelName = modelId): PairInput => ({
  provider: { id: providerId, name: providerId },
  model: { id: modelId, name: modelName },
});

describe('match', () => {
  const cases: ReadonlyArray<readonly [PairInput, string | null]> = [
    // The providers configured in this profile.
    [pair('deepseek-account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'), 'deepseek'],
    [pair('zai-coding-cn', 'glm-5.3-flash', 'GLM-5.3-Flash'), 'glm'],
    // Model-level brands on aggregator/opaque providers.
    [pair('openrouter', 'anthropic/claude-sonnet-4.5'), 'claude'],
    [pair('openrouter', 'openai/gpt-5.2'), 'gpt'],
    [pair('openrouter', 'google/gemini-3-pro'), 'gemini'],
    [pair('ollama', 'llama3.1:70b', 'Llama 3.1'), 'llama'],
    [pair('ollama', 'qwen3:32b', 'Qwen3'), 'qwen'],
    [pair('custom', 'deepseek-reasoner'), 'deepseek'],
    [pair('custom', 'Qwen3-Max'), 'qwen'],
    [pair('custom', 'kimi-k2-thinking'), 'kimi'],
    [pair('custom', 'MiniMax-M2'), 'minimax'],
    [pair('custom', 'Hailuo-02'), 'hailuo'],
    [pair('custom', 'mistral-large-latest'), 'mistral'],
    [pair('custom', 'grok-4.1'), 'grok'],
    [pair('custom', 'doubao-seed-1.8'), 'doubao'],
    [pair('custom', 'ERNIE-5.0'), 'ernie'],
    [pair('custom', 'hunyuan-t1'), 'hunyuan'],
    [pair('custom', 'command-r-plus'), 'command'],
    [pair('custom', 'sonar-pro'), 'perplexity'],
    [pair('custom', 'Phi-4-mini'), 'phi'],
    [pair('custom', 'Nemotron-4-340B'), 'nemotron'],
    [pair('custom', 'amazon-nova-pro'), 'nova'],
    [pair('custom', 'huggingface/foo'), 'huggingface'],
    [pair('custom', 'groq/compound'), 'groq'],
    [pair('custom', 'step-2-mini'), 'stepfun'],
    [pair('custom', 'yi-large'), 'yi'],
    // Model-level brands added with the vendor artwork.
    [pair('custom', 'MiMo-VL-7B', 'MiMo-VL-7B'), 'xiaomimimo'],
    [pair('custom', 'Ling-mini-2.0', 'Ling-mini-2.0'), 'antling'],
    // Provider-level fallbacks for opaque model ids.
    [pair('deepseek-official', 'chat'), 'deepseek'],
    [pair('google-vertex', 'default'), 'gemini'],
    [pair('azure-openai-east', 'deployment-1'), 'gpt'],
    [pair('moonshot-ai', 'chat'), 'kimi'],
    [pair('nvidia-nim', 'default'), 'nemotron'],
    [pair('xiaomi-token-plan-cn', 'opaque-model-1'), 'xiaomimimo'],
    // Unknown stays unmarked.
    [pair('acme-llm', 'acme-chat-1', 'Acme Chat 1'), null],
    [pair('custom', 'internal-model-v0'), null],
  ];

  it('classifies configured providers and aggregator model families', () => {
    for (const [input, expected] of cases) {
      expect(matchModelLogo(input), `${input.provider.id}/${input.model.id}`).toBe(expected);
    }
  });

  it('every rule key has an entry in LOGO_KEYS', () => {
    const keys = new Set<string>();
    for (const [key] of MODEL_RULES) keys.add(key);
    for (const [key] of PROVIDER_RULES) keys.add(key);
    for (const [key] of VENDOR_RULES) keys.add(key);
    for (const key of Object.values(VENDOR_CHANNELS)) keys.add(key);
    for (const key of PICKER_ONLY_KEYS) keys.add(key);
    for (const key of keys) expect(LOGO_KEYS.includes(key), `missing logo key: ${key}`).toBeTruthy();
    for (const key of LOGO_KEYS) expect(keys.has(key), `LOGO_KEYS entry without a rule: ${key}`).toBeTruthy();
  });

  it('normalizes ids and display names uniformly', () => {
    expect(normalizeModelText('  Claude_Sonnet   4.5 ')).toBe('claude sonnet 4.5');
  });

  it('tolerates missing provider or model data', () => {
    expect(matchModelLogo(null)).toBe(null);
    expect(matchModelLogo({})).toBe(null);
    expect(matchModelLogo({ provider: { id: 'openai' } })).toBe('gpt');
    expect(matchModelLogo({ model: { id: 'gpt-4o' } })).toBe('gpt');
  });

  /**
   * Every provider route id in the shipped catalog
   * (`@deepseek-ai/dsh-llm-pi-ai`'s generated providers + the DeepSeek account /
   * official adapters) and the vendor mark it must show.
   */
  const OFFICIAL_CHANNEL_KEYS = {
    'amazon-bedrock': 'aws',
    'ant-ling': 'antgroup',
    anthropic: 'anthropic',
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
    google: 'google',
    'google-vertex': 'google',
    groq: 'groq',
    huggingface: 'huggingface',
    'kimi-coding': 'moonshot',
    meta: 'meta',
    minimax: 'minimax',
    'minimax-cn': 'minimax',
    mistral: 'mistral',
    moonshotai: 'moonshot',
    'moonshotai-cn': 'moonshot',
    nvidia: 'nvidia',
    openai: 'openai',
    'openai-codex': 'openai',
    opencode: 'opencode',
    'opencode-go': 'opencode',
    openrouter: 'openrouter',
    'qwen-token-plan': 'alibaba',
    'qwen-token-plan-cn': 'alibaba',
    'qwen-token-plan-individual': 'alibaba',
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

  it('maps every official channel id to its vendor mark', () => {
    for (const [providerId, expected] of Object.entries(OFFICIAL_CHANNEL_KEYS)) {
      expect(matchVendorLogo(providerId), `${providerId}`).toBe(expected);
    }
  });

  it('the exported channel directory agrees with the expected table', () => {
    expect({ ...VENDOR_CHANNELS }).toEqual(OFFICIAL_CHANNEL_KEYS);
  });

  it('custom / hand-declared providers get no vendor mark', () => {
    for (const providerId of ['volcengine', 'acme', 'acme-llm', 'my-local-provider', 'openai-compatible']) {
      expect(matchVendorLogo(providerId), `${providerId}`).toBe(null);
    }
    expect(matchVendorLogo('')).toBe(null);
    expect(matchVendorLogo(null)).toBe(null);
    expect(matchVendorLogo(undefined)).toBe(null);
  });

  it('normalizes whitespace and letter case in route ids', () => {
    expect(matchVendorLogo('  OpenAI  ')).toBe('openai');
    expect(matchVendorLogo('DeepSeek-Account')).toBe('deepseek');
    expect(matchVendorLogo('XIAOMI-TOKEN-PLAN-CN')).toBe('xiaomi');
  });

  it('every vendor rule and directory value is a logo key', () => {
    for (const [key] of VENDOR_RULES) {
      expect(LOGO_KEYS.includes(key), `VENDOR_RULES key without artwork key: ${key}`).toBeTruthy();
    }
    for (const key of Object.values(VENDOR_CHANNELS)) {
      expect(LOGO_KEYS.includes(key), `VENDOR_CHANNELS value without artwork key: ${key}`).toBeTruthy();
    }
  });

  it('every logo key has inlinable artwork and a picker group', () => {
    const logos: Readonly<Record<string, BrandLogo>> = LOGOS;
    for (const key of LOGO_KEYS) {
      const entry = logos[key];
      expect(entry, `LOGO_KEYS entry has no artwork: ${key}`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.group === 'vendor' || entry.group === 'model', `${key}.group must be vendor or model`).toBeTruthy();
      expect(typeof entry.title, `${key}.title must be a string`).toBe('string');
      expect(entry.title.trim() !== '', `${key}.title must not be empty`).toBeTruthy();
      expect(typeof entry.svg, `${key}.svg must be a string`).toBe('string');
      expect(entry.svg.trim().startsWith('<svg'), `${key}.svg must start with <svg`).toBeTruthy();
      const withoutNamespace = entry.svg.replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/gi, '');
      expect(entry.svg, `${key}.svg must not use id attributes`).not.toMatch(/\sid\s*=/);
      expect(entry.svg, `${key}.svg must not contain scripts`).not.toMatch(/<script/i);
      expect(entry.svg, `${key}.svg must not contain event handlers`).not.toMatch(/\son[a-z]+\s*=/i);
      expect(withoutNamespace, `${key}.svg must not reference external resources`).not.toMatch(/https?:/i);
    }
  });

  it('keeps Baidu Cloud a picker-only vendor mark no channel rule can return', () => {
    // A company mark with no shipped DSH provider route: it must be reachable
    // from the picker, never from a matcher rule.
    expect(LOGO_KEYS).toContain('baiducloud');
    expect(PICKER_ONLY_KEYS).toContain('baiducloud');
    const ruleKeys = new Set<string>([
      ...MODEL_RULES.map(([key]) => key),
      ...PROVIDER_RULES.map(([key]) => key),
      ...VENDOR_RULES.map(([key]) => key),
      ...Object.values(VENDOR_CHANNELS),
    ]);
    expect(ruleKeys.has('baiducloud'), 'baiducloud must not be a rule target').toBe(false);
    // No picker-only key is ever a channel answer: the table must stay silent for
    // all of them, including the new one.
    for (const key of PICKER_ONLY_KEYS) expect(matchVendorLogo(key), `${key} must be picker-only`).toBe(null);
    expect(matchVendorLogo('baiducloud')).toBe(null);
    expect(matchVendorLogo('baidu-cloud')).toBe(null);
    expect(matchVendorLogo('bce')).toBe(null);
    // The model matcher never returns a picker-only key either.
    expect(matchModelLogo(pair('baiducloud', 'baiducloud', 'Baidu Cloud'))).not.toBe('baiducloud');
    // Baidu Cloud keeps its own group and title: the vendor group, next to Baidu.
    const artwork = LOGOS['baiducloud'];
    expect(artwork?.group).toBe('vendor');
    expect(artwork?.title).toBe('BaiduCloud');

    // Picker-only artwork still obeys the flat-tile contract: no inlined DOM id,
    // no external reference and no gradient/<defs> machinery, because the tile is
    // inlined six times over and its markup is compared for write-idempotence.
    const svg = artwork?.svg ?? '';
    expect(svg).not.toMatch(/\sid\s*=/);
    expect(svg).not.toMatch(/url\(/i);
    expect(svg).not.toMatch(/<(?:defs|linearGradient|radialGradient|clipPath|mask|filter|style|script)\b/i);
  });

  it('resolves GLM and Zhipu to the same official Z tile but keeps their own titles', () => {
    // The correction: Zhipu's mark is the official black-tile white Z, and GLM
    // (its model) now uses the same glyph — like `ernie` reusing `baidu`.
    expect(matchVendorLogo('zai')).toBe('zhipu');
    expect(matchVendorLogo('zai-coding-cn')).toBe('zhipu');
    expect(matchModelLogo(pair('zai-coding-cn', 'glm-5.3-flash', 'GLM-5.3-Flash'))).toBe('glm');
    const zhipu = LOGOS['zhipu'];
    const glm = LOGOS['glm'];
    expect(glm?.svg, 'glm must reuse the Zhipu official glyph').toBe(zhipu?.svg);
    expect(glm?.title).not.toBe(zhipu?.title);
    expect(zhipu?.group).toBe('vendor');
    expect(glm?.group).toBe('model');
  });
});
