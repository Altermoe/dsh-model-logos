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
    'picker.custom': '自定义图标',
    'picker.customHint': '你创建的本地图标',
    'picker.createShort': '新建',
    'picker.createCustom': '新建自定义图标',
    'picker.createHint': '上传图片并裁剪成方形图标',
    'picker.editCustom': '重命名',
    'picker.editCustomTitle': '重命名自定义图标',
    'picker.back': '返回',
    'picker.save': '保存',
    'picker.cancel': '取消',
    'picker.delete': '删除',
    'picker.deleteConfirmTitle': '删除自定义图标',
    'picker.deleteConfirm': '确定删除「{name}」？使用该图标的模型会恢复为自动识别。',
    'picker.name': '图标名称',
    'picker.namePlaceholder': '例如：我的本地模型',
    'picker.nameEmpty': '请输入图标名称',
    'picker.nameTooLong': '名称最多 {n} 个字符',
    'picker.nameDuplicate': '已存在同名图标',
    'picker.kind': '图标类型',
    'picker.kindImage': '静态图片',
    'picker.kindAnimated': '动图',
    'picker.kindVideo': '视频',
    'picker.comingSoon': '即将实现',
    'picker.upload': '选择图片',
    'picker.uploadHint': 'PNG / JPEG / WebP，最大 12 MB',
    'picker.uploadChange': '更换图片',
    'picker.zoom': '缩放',
    'picker.crop': '裁剪',
    'picker.imageEmpty': '请先选择图片',
    'picker.imageType': '不支持该图片格式，请选择 PNG / JPEG / WebP',
    'picker.imageSize': '图片文件过大（最大 12 MB）',
    'picker.imageRead': '无法读取该图片',
    'picker.imageEncode': '无法生成图标，请换一张图片',
    'picker.imageTooBig': '裁剪后的图标仍然过大，请换一张更简单的图片',
    'picker.iconLimit': '自定义图标数量已达上限（{n} 个）',
    'picker.kindMotion': '动态',
    'picker.motionDrop': '拖入动图或视频，或点击选择',
    'picker.motionDropHint': 'GIF / WebP / APNG / AVIF / MP4 / WebM，采样片段最长 2 秒',
    'picker.motionReading': '正在读取素材…',
    'picker.motionUnsupported': '不支持这种文件，请换动图或 MP4 / WebM 视频',
    'picker.motionTooLargeImage': '动图文件过大（最大 24 MB）',
    'picker.motionTooLargeVideo': '视频文件过大（最大 64 MB）',
    'picker.motionDecoderUnavailable': '此浏览器不支持动图解码，请改用视频或静态图片',
    'picker.motionDecodeFailed': '无法解码这份素材，请换成 H.264 的 MP4 或 GIF / WebP',
    'picker.motionSingleFrame': '这张图只有一帧，请改用静态图片',
    'picker.motionNoFrames': '没有可采样的帧',
    'picker.motionTooLong': '这段素材太长，建议先剪短或换个片段',
    'picker.motionError': '无法完成采样，请重试',
    'picker.motionSwitchStatic': '改用静态图片',
    'picker.motionNeedSource': '请先选择动图或视频',
    'picker.motionMonitor': '监视器',
    'picker.motionBaked': '成品',
    'picker.motionOriginal': '原片',
    'picker.motionPlay': '播放',
    'picker.motionPause': '暂停',
    'picker.motionToIn': '跳到入点',
    'picker.motionToOut': '跳到出点',
    'picker.motionReduced': '系统开启了减少动态效果，默认暂停。',
    'picker.motionFraming': '取景',
    'picker.motionCenter': '居中',
    'picker.motionCropHint': '裁剪应用到全部 {n} 帧',
    'picker.motionTimeline': '素材',
    'picker.motionIn': '入点',
    'picker.motionOut': '出点',
    'picker.motionRangeLimit': '片段最长 2 秒',
    'picker.motionFrames': '采样帧数',
    'picker.motionFramesValue': '{n} 帧，约 {fps} 帧每秒',
    'picker.motionLowFps': '帧率偏低，动作会偏跳',
    'picker.motionSampling': '正在采样第 {done}/{total} 帧…',
    'picker.motionDistinct': '有效帧 {n}/{m}',
    'picker.motionVolume': '体积',
    'picker.motionBudget': '{used} / {max}',
    'picker.motionEstimate': '预计 {n} 帧 · {fps}fps',
    'picker.motionSlim': '自动瘦身',
    'picker.motionSlimming': '正在瘦身…',
    'picker.motionSlimQuality': '已把画质从 {from} 降到 {to}，以适配体积',
    'picker.motionSlimFrames': '已从 {from} 帧降到 {to} 帧，以适配体积',
    'picker.motionSlimSize': '已把单帧边长从 {from}px 降到 {to}px，以适配体积',
    'picker.motionUndo': '恢复我的设置',
    'picker.motionOverBudget': '体积超出预算，请自动瘦身或降低帧数',
    'picker.motionActualSize': '实际尺寸',
    'picker.motionChange': '更换素材',
    'picker.motionRenameHint': '动态图标不支持重新采样；需要调整请新建一个图标',
    'picker.motionTotalBudget': '自定义图标总容量已满，请删除一些图标',
    'picker.motionBadge': '动',
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
    'section.playbackTitle': '动态图标播放',
    'section.playbackHint': '系统开启「减少动态效果」时，以上一律静止。',
    'section.playbackComposer': '会话输入框',
    'section.playbackSettings': '设置 · 模型',
    'section.playbackIconsPage': '模型图标页',
    'section.playbackPicker': '图标选择器',
    'section.playbackAlways': '始终播放',
    'section.playbackHover': '仅交互',
    'section.playbackNever': '关闭',
    'section.playbackAria': '动态图标播放',
    'section.playbackFailed': '播放设置保存失败，请重试',
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
    'picker.custom': 'Custom icons',
    'picker.customHint': 'Icons you created locally',
    'picker.createShort': 'New',
    'picker.createCustom': 'Create custom icon',
    'picker.createHint': 'Upload an image and crop it to a square icon',
    'picker.editCustom': 'Rename',
    'picker.editCustomTitle': 'Rename custom icon',
    'picker.back': 'Back',
    'picker.save': 'Save',
    'picker.cancel': 'Cancel',
    'picker.delete': 'Delete',
    'picker.deleteConfirmTitle': 'Delete custom icon',
    'picker.deleteConfirm': 'Delete "{name}"? Models using it fall back to auto.',
    'picker.name': 'Icon name',
    'picker.namePlaceholder': 'For example: My local model',
    'picker.nameEmpty': 'Enter an icon name',
    'picker.nameTooLong': 'The name is limited to {n} characters',
    'picker.nameDuplicate': 'An icon with this name already exists',
    'picker.kind': 'Icon type',
    'picker.kindImage': 'Image',
    'picker.kindAnimated': 'Animated',
    'picker.kindVideo': 'Video',
    'picker.comingSoon': 'Coming soon',
    'picker.upload': 'Choose an image',
    'picker.uploadHint': 'PNG / JPEG / WebP, up to 12 MB',
    'picker.uploadChange': 'Change image',
    'picker.zoom': 'Zoom',
    'picker.crop': 'Crop',
    'picker.imageEmpty': 'Choose an image first',
    'picker.imageType': 'Unsupported image type — choose PNG / JPEG / WebP',
    'picker.imageSize': 'The image is too large (12 MB max)',
    'picker.imageRead': 'Could not read that image',
    'picker.imageEncode': 'Could not produce the icon — try another image',
    'picker.imageTooBig': 'The cropped icon is still too large — try a simpler image',
    'picker.iconLimit': 'The custom icon limit is reached ({n})',
    'picker.kindMotion': 'Motion',
    'picker.motionDrop': 'Drop an animated image or video, or choose one',
    'picker.motionDropHint': 'GIF / WebP / APNG / AVIF / MP4 / WebM; up to 2 seconds are sampled',
    'picker.motionReading': 'Reading the source…',
    'picker.motionUnsupported': 'Unsupported file — choose an animated image or an MP4 / WebM video',
    'picker.motionTooLargeImage': 'The animated image is too large (24 MB max)',
    'picker.motionTooLargeVideo': 'The video is too large (64 MB max)',
    'picker.motionDecoderUnavailable': 'This browser cannot decode animated images — use a video or a still image',
    'picker.motionDecodeFailed': 'Could not decode this file — try an H.264 MP4 or a GIF / WebP',
    'picker.motionSingleFrame': 'This image has only one frame — use the still-image tab',
    'picker.motionNoFrames': 'No frames to sample',
    'picker.motionTooLong': 'This source is too long — trim it or choose a shorter clip',
    'picker.motionError': 'Could not sample this source — try again',
    'picker.motionSwitchStatic': 'Use a still image',
    'picker.motionNeedSource': 'Choose an animated image or video first',
    'picker.motionMonitor': 'Monitor',
    'picker.motionBaked': 'Result',
    'picker.motionOriginal': 'Source',
    'picker.motionPlay': 'Play',
    'picker.motionPause': 'Pause',
    'picker.motionToIn': 'Go to in point',
    'picker.motionToOut': 'Go to out point',
    'picker.motionReduced': 'Reduced motion is on; playback starts paused.',
    'picker.motionFraming': 'Framing',
    'picker.motionCenter': 'Centre',
    'picker.motionCropHint': 'The crop applies to all {n} frames',
    'picker.motionTimeline': 'Source',
    'picker.motionIn': 'In point',
    'picker.motionOut': 'Out point',
    'picker.motionRangeLimit': 'The clip is limited to 2 seconds',
    'picker.motionFrames': 'Frames',
    'picker.motionFramesValue': '{n} frames, about {fps} fps',
    'picker.motionLowFps': 'Low frame rate — motion may look jumpy',
    'picker.motionSampling': 'Sampling frame {done}/{total}…',
    'picker.motionDistinct': 'Distinct frames {n}/{m}',
    'picker.motionVolume': 'Size',
    'picker.motionBudget': '{used} / {max}',
    'picker.motionEstimate': '{n} frames · {fps} fps',
    'picker.motionSlim': 'Shrink automatically',
    'picker.motionSlimming': 'Shrinking…',
    'picker.motionSlimQuality': 'Quality lowered from {from} to {to} to fit the budget',
    'picker.motionSlimFrames': 'Frames reduced from {from} to {to} to fit the budget',
    'picker.motionSlimSize': 'Frame edge reduced from {from}px to {to}px to fit the budget',
    'picker.motionUndo': 'Restore my settings',
    'picker.motionOverBudget': 'Over the size budget — shrink automatically or reduce the frames',
    'picker.motionActualSize': 'Actual size',
    'picker.motionChange': 'Change source',
    'picker.motionRenameHint': 'A motion icon cannot be re-sampled — create a new one to change it',
    'picker.motionTotalBudget': 'The custom-icon storage is full — delete some icons',
    'picker.motionBadge': 'Motion',
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
    'section.playbackTitle': 'Motion playback',
    'section.playbackHint': 'When the system asks for reduced motion, every surface stays still.',
    'section.playbackComposer': 'Composer',
    'section.playbackSettings': 'Settings · Models',
    'section.playbackIconsPage': 'Model icons page',
    'section.playbackPicker': 'Icon picker',
    'section.playbackAlways': 'Always',
    'section.playbackHover': 'On interaction',
    'section.playbackNever': 'Off',
    'section.playbackAria': 'Motion playback',
    'section.playbackFailed': 'Could not save the playback setting — try again',
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
    baiducloud: '百度智能云',
    bytedance: '字节跳动',
    google: '谷歌',
    microsoft: '微软',
    moonshot: '月之暗面',
    nvidia: '英伟达',
    tencent: '腾讯',
    volcengine: '火山引擎',
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
