/**
 * Brand-name i18n tests.
 *
 * The plugin's copy dictionary is pinned by the bundle tests (through the
 * rendered UI); brand names need their own gate because they carry a policy:
 * only names the brand owner itself publishes in Chinese may appear. The
 * reviewed set is duplicated here on purpose — `docs/brand-names.md` holds the
 * primary source for every entry, and adding a folk translation has to change
 * this list (and fail review) rather than slip in silently.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { DSHML_BRAND_NAMES, dshmlBrandName, dshmlBrandNameAliases, dshmlLang, dshmlSetLang } from '../src/i18n';
import { LOGOS } from '../src/logos';

/** The reviewed official Chinese names; every value needs a source in the doc. */
const OFFICIAL_ZH: Readonly<Record<string, string>> = {
  alibaba: '阿里巴巴',
  antgroup: '蚂蚁集团',
  antling: '蚂蚁百灵',
  aws: '亚马逊云科技',
  baidu: '百度',
  baiducloud: '百度智能云',
  bytedance: '字节跳动',
  doubao: '豆包',
  ernie: '文心',
  google: '谷歌',
  hailuo: '海螺',
  hunyuan: '混元',
  microsoft: '微软',
  moonshot: '月之暗面',
  nvidia: '英伟达',
  qwen: '千问',
  stepfun: '阶跃星辰',
  tencent: '腾讯',
  volcengine: '火山引擎',
  xiaomi: '小米',
  zhipu: '智谱',
};

/** Every test starts and ends with automatic language detection. */
afterEach(() => {
  dshmlSetLang(null);
});

describe('brand names', () => {
  it('ships exactly the reviewed official names and no English overrides', () => {
    expect(DSHML_BRAND_NAMES.zh).toEqual(OFFICIAL_ZH);
    expect(DSHML_BRAND_NAMES.en).toEqual({});
  });

  it('only names brands that have artwork, with a real Chinese name', () => {
    for (const [key, name] of Object.entries(OFFICIAL_ZH)) {
      const artwork = LOGOS[key];
      expect(artwork, `${key} must have artwork`).toBeDefined();
      if (artwork === undefined) continue;
      expect(name.trim(), `${key} must not have outer spaces`).toBe(name);
      expect(name, `${key} would be pointless if identical to the artwork title`).not.toBe(artwork.title);
      expect(/\p{Script=Han}/u.test(name), `${key} must contain an official Chinese name`).toBe(true);
    }
  });

  it('localizes in zh and keeps the official English title in en', () => {
    dshmlSetLang('en');
    expect(dshmlBrandName('qwen', 'Qwen')).toBe('Qwen');
    expect(dshmlBrandName('alibaba', 'Alibaba')).toBe('Alibaba');

    dshmlSetLang('zh');
    expect(dshmlBrandName('qwen', 'Qwen')).toBe('千问');
    expect(dshmlBrandName('alibaba', 'Alibaba')).toBe('阿里巴巴');
    expect(dshmlBrandName('antling', 'Ant Ling')).toBe('蚂蚁百灵');
    // No official Chinese name: the artwork title stays in both languages.
    for (const [key, title] of [
      ['claude', 'Claude'],
      ['anthropic', 'Anthropic'],
      ['gpt', 'GPT'],
      ['deepseek', 'DeepSeek'],
      ['glm', 'GLM'],
      ['kimi', 'Kimi'],
      ['lmstudio', 'LM Studio'],
    ] as const) {
      expect(dshmlBrandName(key, title), `${key} must stay official English`).toBe(title);
    }
    // Two Baidu marks, two Baidu names: the cloud business does not inherit the
    // search brand's short form, and vice versa.
    expect(dshmlBrandName('baidu', 'Baidu')).toBe('百度');
    expect(dshmlBrandName('baiducloud', 'BaiduCloud')).toBe('百度智能云');
    // Unknown or malformed keys never invent a name.
    expect(dshmlBrandName('no-such-brand', 'No Such Brand')).toBe('No Such Brand');
    expect(dshmlBrandName(null, 'Null Brand')).toBe('Null Brand');
  });

  it('offers the localized name as a cross-language search alias', () => {
    dshmlSetLang('en');
    expect(dshmlBrandNameAliases('qwen')).toEqual(['千问']);
    expect(dshmlBrandNameAliases('alibaba')).toEqual(['阿里巴巴']);
    dshmlSetLang('zh');
    expect(dshmlBrandNameAliases('qwen')).toEqual(['千问']);
    // The English title is not repeated: the picker filter already matches it.
    expect(dshmlBrandNameAliases('claude')).toEqual([]);
    expect(dshmlBrandNameAliases('no-such-brand')).toEqual([]);
    expect(dshmlBrandNameAliases(null)).toEqual([]);
  });

  it('follows the forced language and resets to auto-detection', () => {
    dshmlSetLang('zh');
    expect(dshmlLang()).toBe('zh');
    dshmlSetLang('en');
    expect(dshmlLang()).toBe('en');
    dshmlSetLang('fr');
    expect(['zh', 'en']).toContain(dshmlLang());
    dshmlSetLang(null);
    expect(['zh', 'en']).toContain(dshmlLang());
  });
});
