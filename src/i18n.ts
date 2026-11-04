/**
 * Plugin copy (Chinese / English).
 *
 * Copy dictionary for the plugin, inlined into the client bundle. The active
 * language follows the DSH locale service when it is mounted; otherwise the
 * browser language decides. `dshmlT(key, vars)` replaces `{name}` placeholders.
 */

/** Languages the plugin ships copy for. */
type DshmlLang = 'zh' | 'en';

/** Copy dictionary: the same keys exist in every language. */
const DSHML_COPY: Readonly<Record<DshmlLang, Readonly<Record<string, string>>>> = {
  zh: {
    'picker.title': '选择模型图标',
    'picker.search': '搜索图标',
    'picker.auto': '自动识别',
    'picker.autoHint': '根据模型名称自动匹配',
    'picker.none': '不使用图标',
    'picker.noneHint': '不显示任何图标',
    'picker.letter': '首字母图标',
    'picker.letterHint': '用模型名称生成',
    'picker.brands': '品牌图标',
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
    'section.unknownProvider': '未知提供方',
    'badge.provider': '厂商图标',
    'badge.model': '模型图标',
  },
  en: {
    'picker.title': 'Choose model icon',
    'picker.search': 'Search icons',
    'picker.auto': 'Auto',
    'picker.autoHint': 'Matched from the model name',
    'picker.none': 'No icon',
    'picker.noneHint': 'Hide the icon entirely',
    'picker.letter': 'Letter icon',
    'picker.letterHint': 'Generated from the model name',
    'picker.brands': 'Brand marks',
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
    'section.unknownProvider': 'Unknown provider',
    'badge.provider': 'Vendor logo',
    'badge.model': 'Model logo',
  },
};

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
