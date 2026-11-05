/**
 * Grouping and prominence tests: every brand mark belongs to exactly one picker
 * group, the generated ranking covers both groups with contiguous ranks, and the
 * aliases that reuse a parent mark keep the model title. The search helper is
 * pure, so the picker's filter/order rules are tested without a DOM.
 */
import { describe, expect, it } from 'vitest';

import { LOGOS, SHARED_VENDOR_MARKS, filterLogoGroups, groupLogoEntries } from '../src/logos';
import { LOGO_RANKS, RANKING_DATE } from '../src/logos/ranking';
import { LOGO_KEYS, VENDOR_CHANNELS } from '../src/match';
import { isKnownLogoKey } from '../src/resolve';

const VENDOR_KEYS = [
  'alibaba',
  'anthropic',
  'antgroup',
  'aws',
  'azure',
  'baidu',
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
  'xai',
  'xiaomi',
  'zhipu',
] as const;

const MODEL_KEYS = [
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
] as const;

const rankOf = (key: string): number => {
  const rank = LOGO_RANKS[key];
  if (typeof rank !== 'number') throw new Error(`missing rank for ${key}`);
  return rank;
};

describe('logo grouping', () => {
  it('puts every mark in exactly one group and covers the expected key sets', () => {
    const vendor = Object.keys(LOGOS)
      .filter((key) => LOGOS[key]?.group === 'vendor')
      .sort();
    const model = Object.keys(LOGOS)
      .filter((key) => LOGOS[key]?.group === 'model')
      .sort();
    expect(vendor).toEqual([...VENDOR_KEYS].sort());
    expect(model).toEqual([...MODEL_KEYS].sort());
    expect([...vendor, ...model].sort()).toEqual([...LOGO_KEYS].sort());
    expect(vendor.filter((key) => model.includes(key))).toEqual([]);
  });

  it('groups and sorts by prominence rank, then title', () => {
    const groups = groupLogoEntries(LOGOS, LOGO_RANKS);
    expect(groups.vendor.length).toBe(VENDOR_KEYS.length);
    expect(groups.model.length).toBe(MODEL_KEYS.length);
    for (const entries of [groups.vendor, groups.model]) {
      for (let index = 1; index < entries.length; index++) {
        const previous = entries[index - 1];
        const current = entries[index];
        if (previous === undefined || current === undefined) continue;
        expect(previous.rank).toBeLessThanOrEqual(current.rank);
      }
    }
  });

  it('filters both groups by key or title, case-insensitively', () => {
    const groups = groupLogoEntries(LOGOS, LOGO_RANKS);
    const qwen = filterLogoGroups(groups, '  QWEN ');
    expect(qwen.model.map((entry) => entry.key)).toContain('qwen');
    expect(qwen.vendor).toEqual([]);
    const openai = filterLogoGroups(groups, 'openai');
    expect(openai.vendor.map((entry) => entry.key)).toContain('openai');
    expect(openai.model).toEqual([]);
    expect(filterLogoGroups(groups, '').vendor.length).toBe(groups.vendor.length);
    expect(filterLogoGroups(groups, 'no-such-brand-xyz')).toEqual({ vendor: [], model: [] });
  });

  it('keeps every legacy override key valid', () => {
    for (const key of ['openai', 'zhipu', 'kimi', 'antling', 'xiaomi', 'meta', 'microsoft', 'nvidia', 'aws']) {
      expect(isKnownLogoKey(key), `${key} must stay a known key`).toBe(true);
    }
  });

  it('never maps an official vendor channel to a model-only mark by accident', () => {
    for (const key of Object.values(VENDOR_CHANNELS)) {
      const entry = LOGOS[key];
      expect(entry, `${key} needs artwork`).toBeDefined();
      if (entry === undefined) continue;
      const shared = SHARED_VENDOR_MARKS.includes(key);
      expect(entry.group === 'vendor' || shared, `${key} is neither vendor nor a shared mark`).toBe(true);
    }
  });
});

describe('logo prominence', () => {
  it('covers every key with contiguous, unique ranks inside each group', () => {
    expect(RANKING_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const [group, keys] of [
      ['vendor', VENDOR_KEYS],
      ['model', MODEL_KEYS],
    ] as const) {
      const ranks = keys.map(rankOf).sort((a, b) => a - b);
      expect(ranks, `${group} ranks`).toEqual(Array.from({ length: keys.length }, (_, index) => index + 1));
    }
    for (const key of Object.keys(LOGO_RANKS)) {
      expect(LOGO_KEYS.includes(key), `rank for unknown key ${key}`).toBe(true);
    }
  });

  it('keeps the famous model brands near the top and the niche ones near the bottom', () => {
    const modelRanks = MODEL_KEYS.map((key) => [key, rankOf(key)] as const).sort((a, b) => a[1] - b[1]);
    const top = new Set<string>(modelRanks.slice(0, 8).map(([key]) => key));
    const bottom = new Set<string>(modelRanks.slice(-8).map(([key]) => key));
    for (const key of ['gpt', 'claude', 'deepseek']) {
      expect(top.has(key), `${key} must be in the model top 8 (got ${rankOf(key)})`).toBe(true);
    }
    for (const key of ['yi', 'antling']) {
      expect(bottom.has(key), `${key} must be in the model bottom 8 (got ${rankOf(key)})`).toBe(true);
    }
    expect(rankOf('claude')).toBeLessThan(rankOf('yi'));
    expect(rankOf('gpt')).toBeLessThan(rankOf('antling'));
  });

  it('keeps the major vendors near the top and the niche ones near the bottom', () => {
    const vendorRanks = VENDOR_KEYS.map((key) => [key, rankOf(key)] as const).sort((a, b) => a[1] - b[1]);
    const top = new Set<string>(vendorRanks.slice(0, 10).map(([key]) => key));
    for (const key of ['openai', 'anthropic', 'google']) {
      expect(top.has(key), `${key} must be in the vendor top 10 (got ${rankOf(key)})`).toBe(true);
    }
    for (const key of ['radius', 'typesafe']) {
      expect(rankOf(key), `${key} must be near the vendor bottom (got ${rankOf(key)})`).toBeGreaterThan(20);
    }
  });

  it('reuses the parent mark for model aliases without a distinct official logo', () => {
    for (const [modelKey, vendorKey] of [
      ['gpt', 'openai'],
      ['llama', 'meta'],
      ['phi', 'microsoft'],
      ['nemotron', 'nvidia'],
      ['nova', 'aws'],
      ['ernie', 'baidu'],
    ] as const) {
      expect(LOGOS[modelKey]?.svg, `${modelKey} must reuse ${vendorKey}'s official glyph`).toBe(LOGOS[vendorKey]?.svg);
      expect(LOGOS[modelKey]?.title).not.toBe(LOGOS[vendorKey]?.title);
    }
  });
});
