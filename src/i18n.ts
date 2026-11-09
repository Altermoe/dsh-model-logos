/**
 * Plugin copy (Chinese / English).
 *
 * Copy dictionary for the plugin, inlined into the client bundle. The active
 * language follows the DSH locale service when it is mounted; otherwise the
 * browser language decides. `dshmlT(key, vars)` replaces `{name}` placeholders.
 *
 * Brand names are a second, deliberately narrower table. The artwork set carries
 * each brand's own official English title, so English needs no overrides; the
 * Chinese table only carries names the brand owner itself publishes in Chinese.
 * Community translations are excluded on principle — the source list and the
 * policy live in `docs/brand-names.md`, and a name without a primary source
 * simply keeps its English title.
 */

/** Languages the plugin ships copy for. */
type DshmlLang = 'zh' | 'en';

/** Copy dictionary: the same keys exist in every language. */
const DSHML_COPY: Readonly<Record<DshmlLang, Readonly<Record<string, string>>>> = {
  zh: {
    'picker.title': '选择模型图标',
    'picker.providerTitle': '选择厂商图标',
    'picker.search': '搜索图标',
    'picker.auto': '自动识别',
    'picker.autoHint': '根据模型名称自动匹配',
    'picker.autoProviderHint': '根据官方渠道自动匹配',
    'picker.letterProviderHint': '用提供方名称生成',
    'picker.none': '不使用图标',
    'picker.noneHint': '不显示任何图标',
    'picker.letter': '首字母图标',
    'picker.letterHint': '用模型名称生成',
    'picker.vendors': '厂商图标',
    'picker.models': '模型图标',
    'picker.current': '当前',
    'picker.noMatch': '没有匹配的图标',
    'picker.saving': '保存中…',
    'picker.saveFailed': '保存失败，请重试',
    'picker.unavailable': '图标设置不可用（宿主插件未加载）',
    'picker.close': '关闭',
    'picker.reset': '恢复自动识别',
    'picker.letterTitle': '首字母图标',
    'section.title': '模型图标',
    'section.intro': '为「提供方 + 模型」单独指定图标；不改动时使用自动识别。',
    'section.search': '搜索提供方或模型',
    'section.choose': '选择图标',
    'section.change': '更改图标',
    'section.reset': '恢复自动',
    'section.custom': '已自定义',
    'section.auto': '自动',
    'section.none': '不使用',
    'section.loading': '加载中…',
    'section.unavailable': '设置命名空间不可用，暂时无法保存图标。',
    'section.empty': '还没有可用的模型。',
    'section.emptySearch': '没有匹配的结果。',
    'section.manual': '手动指定',
    'section.manualHint': '输入提供方与模型 ID，可为目录外的模型指定图标。',
    'section.providerId': '提供方 ID',
    'section.modelId': '模型 ID',
    'section.openPicker': '打开选择器',
    'section.manualGroup': '手动设置',
    'section.overrides': '共 {n} 项自定义',
    'section.provider': '提供方',
    'section.model': '模型',
    'section.providerIcons': '提供方图标',
    'section.chooseProvider': '选择厂商图标',
    'section.changeProvider': '更改厂商图标',
    'section.resetProvider': '恢复厂商自动',
    'section.autoProvider': '自动识别官方渠道，自定义提供方默认不显示图标。',
    'section.unknownProvider': '未知提供方',
    'badge.provider': '厂商图标',
    'badge.model': '模型图标',
  },
  en: {
    'picker.title': 'Choose model icon',
    'picker.providerTitle': 'Choose vendor icon',
    'picker.search': 'Search icons',
    'picker.auto': 'Auto',
    'picker.autoHint': 'Matched from the model name',
    'picker.autoProviderHint': 'Matched from the official channel',
    'picker.letterProviderHint': 'Generated from the provider name',
    'picker.none': 'No icon',
    'picker.noneHint': 'Hide the icon entirely',
    'picker.letter': 'Letter icon',
    'picker.letterHint': 'Generated from the model name',
    'picker.vendors': 'Vendor icons',
    'picker.models': 'Model icons',
    'picker.current': 'Current',
    'picker.noMatch': 'No matching icons',
    'picker.saving': 'Saving…',
    'picker.saveFailed': 'Could not save — try again',
    'picker.unavailable': 'Icon settings unavailable (host plugin not loaded)',
    'picker.close': 'Close',
    'picker.reset': 'Reset to auto',
    'picker.letterTitle': 'Letter icon',
    'section.title': 'Model icons',
    'section.intro': 'Pick an icon for a provider + model pair. Unset pairs use auto-detection.',
    'section.search': 'Search providers or models',
    'section.choose': 'Choose icon',
    'section.change': 'Change icon',
    'section.reset': 'Reset to auto',
    'section.custom': 'Custom',
    'section.auto': 'Auto',
    'section.none': 'None',
    'section.loading': 'Loading…',
    'section.unavailable': 'Settings namespace unavailable — icon changes cannot be saved.',
    'section.empty': 'No models available yet.',
    'section.emptySearch': 'No matching results.',
    'section.manual': 'Manual pair',
    'section.manualHint': 'Enter a provider id and model id to iconise a model outside the catalog.',
    'section.providerId': 'Provider ID',
    'section.modelId': 'Model ID',
    'section.openPicker': 'Open picker',
    'section.manualGroup': 'Manual overrides',
    'section.overrides': '{n} manual overrides',
    'section.provider': 'Provider',
    'section.model': 'Model',
    'section.providerIcons': 'Provider icons',
    'section.chooseProvider': 'Choose vendor icon',
    'section.changeProvider': 'Change vendor icon',
    'section.resetProvider': 'Reset vendor to auto',
    'section.autoProvider': 'Auto follows the official channel; hand-declared providers show no icon.',
    'section.unknownProvider': 'Unknown provider',
    'badge.provider': 'Vendor logo',
    'badge.model': 'Model logo',
  },
};

/**
 * Every translation of one key, in dictionary order (de-duplicated).
 *
 * Used where a string the shell rendered has to be recognised in whichever
 * language it ended up in — for example the Settings nav row this plugin's own
 * section title appears on, which the shell renders from a locale-following thunk.
 * @param key - dictionary key (`section.title`, …).
 */
export function dshmlTAll(key: string): string[] {
  const values: string[] = [];
  for (const lang of Object.keys(DSHML_COPY) as DshmlLang[]) {
    const table = DSHML_COPY[lang];
    const value = table !== undefined ? table[key] : undefined;
    if (typeof value === 'string' && value.trim() !== '' && !values.includes(value)) values.push(value);
  }
  return values;
}

/** Language forced by the DSH locale service; null means auto-detect. */
let dshmlForcedLang: DshmlLang | null = null;

/** Detect the active copy language. */
export function dshmlLang(): DshmlLang {
  if (dshmlForcedLang === 'zh' || dshmlForcedLang === 'en') return dshmlForcedLang;
  try {
    const documentLang = typeof document !== 'undefined' ? document.documentElement?.lang : '';
    if (typeof documentLang === 'string' && documentLang.toLowerCase().startsWith('zh')) return 'zh';
    const browserLang = typeof navigator !== 'undefined' ? navigator.language : '';
    if (typeof browserLang === 'string' && browserLang.toLowerCase().startsWith('zh')) return 'zh';
  } catch {
    // A missing environment simply falls back to English copy.
  }
  return 'en';
}

/** Switch copy language from the DSH locale service. */
export function dshmlSetLang(value: unknown): void {
  dshmlForcedLang = value === 'zh' || value === 'en' ? value : null;
}

/**
 * Look up one copy string.
 * @param key - dictionary key (`picker.title`, …).
 * @param vars - `{name}` placeholders.
 */
export function dshmlT(key: string, vars?: Readonly<Record<string, string | number>> | null): string {
  const lang = dshmlLang();
  const table = DSHML_COPY[lang] ?? DSHML_COPY.en;
  let text = table[key] ?? DSHML_COPY.en[key] ?? key;
  if (vars !== undefined && vars !== null) {
    text = text.replace(/\{(\w+)\}/g, (match: string, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Brand names                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Official brand names per language, keyed by artwork key (`qwen`, `google`, …).
 *
 * `LOGOS[key].title` already is the brand's official English title, so the `en`
 * table stays empty: an override there would only duplicate the artwork and
 * drift from it. The `zh` table holds only vendors/models whose owner publishes
 * an official Chinese name; `docs/brand-names.md` records the primary source for
 * every entry. Anything else (and every community translation) stays English.
 */
export const DSHML_BRAND_NAMES: Readonly<Record<DshmlLang, Readonly<Record<string, string>>>> = Object.freeze({
  zh: Object.freeze({
    // Companies / channels whose owner publishes an official Chinese name.
    alibaba: '阿里巴巴',
    antgroup: '蚂蚁集团',
    aws: '亚马逊云科技',
    baidu: '百度',
    bytedance: '字节跳动',
    google: '谷歌',
    microsoft: '微软',
    moonshot: '月之暗面',
    nvidia: '英伟达',
    tencent: '腾讯',
    xiaomi: '小米',
    zhipu: '智谱',
    // Models whose vendor officially names the model itself in Chinese.
    // (`qwen` is 「千问」 since Alibaba's 2026 brand unification retired
    // 「通义千问」; `stepfun` is the official company name on a model-group mark.)
    antling: '蚂蚁百灵',
    doubao: '豆包',
    ernie: '文心',
    hailuo: '海螺',
    hunyuan: '混元',
    qwen: '千问',
    stepfun: '阶跃星辰',
  }),
  en: Object.freeze({}),
});

/** The localized name of a brand in one language, or undefined with no entry. */
function dshmlBrandNameIn(lang: DshmlLang, key: unknown): string | undefined {
  if (typeof key !== 'string') return undefined;
  const name = DSHML_BRAND_NAMES[lang]?.[key];
  return typeof name === 'string' && name.trim() !== '' ? name : undefined;
}

/**
 * The brand title to display: the official name in the active language, else
 * the artwork set's own official title.
 * @param key - artwork key (`qwen`, …); unknown keys always fall back.
 * @param officialTitle - the artwork entry's official English title.
 */
export function dshmlBrandName(key: unknown, officialTitle: string): string {
  return dshmlBrandNameIn(dshmlLang(), key) ?? officialTitle;
}

/**
 * Every localized name of a brand, for cross-language picker search.
 *
 * The artwork title is not repeated: the picker's filter already matches it, and
 * this list only adds the other languages' official names so a Chinese name
 * finds its mark while the UI is English and vice versa.
 * @param key - artwork key (`qwen`, …).
 */
export function dshmlBrandNameAliases(key: unknown): string[] {
  const aliases: string[] = [];
  for (const lang of Object.keys(DSHML_BRAND_NAMES) as DshmlLang[]) {
    const name = dshmlBrandNameIn(lang, key);
    if (name !== undefined && !aliases.includes(name)) aliases.push(name);
  }
  return aliases;
}
