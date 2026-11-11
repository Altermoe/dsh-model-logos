/**
 * Brand matcher for model-logos.
 *
 * Two separate questions are answered here:
 *
 *  1. `matchModelLogo` — which model/brand mark belongs to a provider+model
 *     identity. Used by the composer label and the Settings model rows. This is
 *     the *heuristic*: it only chooses the initial icon, because a per-model
 *     override (stored in the user settings document) always wins in
 *     `resolveModelIcon`.
 *  2. `matchVendorLogo` — which vendor mark belongs to an *official channel*
 *     route id (the Settings → Models provider list and the add-provider
 *     dropdown). Hand-declared custom providers have no vendor mark.
 *
 * One ordered rule table maps a normalized provider/model description to a logo
 * key. Model-level evidence wins over provider-level evidence so an aggregator
 * (`openrouter`, `ollama`, …) shows the brand of the model it serves, while a
 * provider-only rule still covers catalog entries whose model ids are opaque.
 *
 * The matcher is pure: no network, no catalog import, no DOM. The client bundle
 * inlines this module, so it stays free of runtime imports.
 */
import type { ModelLabelInput } from './types';

/**
 * Logo keys the matcher or the picker can return; each one needs a mark in
 * `src/logos/`. Model marks and vendor marks are separate groups: a company
 * mark (Anthropic, Google, Alibaba) is not the same graphic as its model mark
 * (Claude, Gemini, Qwen), so the two tables below name both when they differ.
 */
export const LOGO_KEYS: readonly string[] = Object.freeze([
  // Model marks.
  'deepseek',
  'gpt',
  'claude',
  'gemini',
  'qwen',
  'glm',
  'kimi',
  'minimax',
  'mistral',
  'llama',
  'grok',
  'doubao',
  'ernie',
  'hunyuan',
  'command',
  'perplexity',
  'phi',
  'nemotron',
  'nova',
  'stepfun',
  'yi',
  'xiaomimimo',
  'antling',
  'hailuo',
  // Vendor / channel marks.
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

/**
 * Vendor marks that only exist in the picker.
 *
 * Some companies own a model family but have no shipped DSH provider route of
 * their own (ByteDance/Doubao, Baidu/ERNIE, Tencent/Hunyuan, Cohere/Command,
 * Microsoft/Phi). Their company mark is still real and belongs in the picker's
 * vendor group; no channel rule may return it because a custom provider should
 * never be decorated with a vendor mark it did not declare.
 *
 * Baidu Cloud is the same case one level further out: it is a real Baidu
 * product mark with its own name and its own tri-colour cube, but it is not the
 * model route either — a qianfan channel, if one ever ships, is served by
 * `baidu`/`ernie`, so nothing may map to `baiducloud` by pattern.
 *
 * Volcengine and LM Studio have no shipped DSH provider route: a user declares
 * them by hand (LM Studio as a local endpoint, Volcengine as an OpenAI-compatible
 * relay), so their vendor art is picker-only and no channel rule may infer it. A
 * `volcengine` route id therefore gets no *vendor* mark; the pre-existing model
 * heuristic still maps an opaque model under that route to the Doubao model mark,
 * which is about the model the channel serves, not the channel's own brand.
 */
export const PICKER_ONLY_KEYS: readonly string[] = Object.freeze([
  'baidu',
  'baiducloud',
  'bytedance',
  'cohere',
  'lmstudio',
  'microsoft',
  'tencent',
  'volcengine',
]);

/** Token boundary shared by the word-like rules. */
const B = '(?:^|[\\s/._:·-])';
/** End of token. */
const E = '(?:$|[\\s/._:·-])';

/**
 * Model-identity rules, in priority order: the first hit wins.
 *
 * The returned key is always a model mark (`gpt`, not `openai`; `llama`, not
 * `meta`) so the composer and the model rows show the model's own brand even
 * when the provider is the company channel.
 */
export const MODEL_RULES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['deepseek', /deepseek|deep[-\s]?seek/],
  ['claude', /claude|anthropic/],
  ['gpt', new RegExp(`${B}(?:gpt|chatgpt|codex|sora|whisper|davinci|o[1-9])(?:${E}|[-.\\d])`)],
  ['gemini', new RegExp(`gemini|gemma|${B}palm${E}`)],
  ['qwen', /qwen|qwq|qvq|tongyi|通义/],
  ['glm', new RegExp(`${B}(?:glm|chatglm|zhipu|z\\.ai)${E}|智谱`)],
  ['kimi', /kimi|moonshot|月之暗面/],
  ['hailuo', /hailuo|海螺/],
  ['minimax', /minimax|abab/],
  ['mistral', /mistral|mixtral|codestral|magistral|devstral/],
  ['llama', new RegExp(`llama|${B}meta${E}`)],
  ['grok', new RegExp(`${B}(?:grok|xai|x-ai)${E}`)],
  ['doubao', new RegExp(`doubao|豆包|bytedance|skylark|${B}seed${E}`)],
  ['ernie', /ernie|wenxin|文心|baidu/],
  ['hunyuan', /hunyuan|混元|tencent/],
  ['command', new RegExp(`cohere|${B}command[\\s-]?r${E}`)],
  ['perplexity', /perplexity|sonar/],
  ['phi', new RegExp(`microsoft|azure|${B}phi[\\s-]?\\d`)],
  ['nemotron', /nvidia|nemotron/],
  ['nova', new RegExp(`amazon|bedrock|${B}(?:nova|titan)${E}`)],
  ['huggingface', new RegExp(`hugging\\s?face|${B}hf${E}`)],
  ['ollama', /ollama/],
  ['groq', /groq/],
  ['openrouter', /openrouter/],
  ['stepfun', new RegExp(`stepfun|step[-\\s]?fun|阶跃|${B}step[-\\s]?\\d`)],
  ['yi', new RegExp(`${B}(?:yi|01\\.?ai|lingyi)${E}|零一`)],
  ['xiaomimimo', /mimo|小米|xiaomi/],
  ['antling', new RegExp(`${B}ling[-\\s]?(?:mini|flash|plus|pro)${E}|ant[-\\s]?ling|蚂蚁灵[光波]`)],
]);

/**
 * Provider-identity rules, used only when no model rule matched. These return
 * model marks as well: an opaque model served by Anthropic should still show
 * Claude, while the provider row itself shows the Anthropic company mark.
 */
export const PROVIDER_RULES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['deepseek', /deepseek/],
  ['claude', /anthropic|claude/],
  ['gpt', /openai/],
  ['gemini', /google|gemini|vertex/],
  ['glm', /zai|zhipu|glm|bigmodel|智谱/],
  ['kimi', /moonshot|kimi/],
  ['minimax', /minimax/],
  ['qwen', /qwen|dashscope|aliyun|alibaba|bailian|通义/],
  ['mistral', /mistral/],
  ['llama', /meta|llama/],
  ['grok', /xai|x-ai|grok/],
  ['doubao', /doubao|bytedance|volc|火山/],
  ['ernie', /baidu|ernie|qianfan|千帆/],
  ['hunyuan', /tencent|hunyuan|腾讯/],
  ['command', /cohere/],
  ['perplexity', /perplexity/],
  ['phi', /microsoft|azure/],
  ['nemotron', /nvidia/],
  ['nova', /amazon|aws|bedrock/],
  ['huggingface', new RegExp(`hugging\\s?face|${B}hf${E}`)],
  ['ollama', /ollama/],
  ['groq', /groq/],
  ['openrouter', /openrouter/],
  ['stepfun', /stepfun|阶跃/],
  ['yi', /01\.?ai|lingyi|零一/],
  ['baseten', /baseten/],
  ['cerebras', /cerebras/],
  ['cloudflare', /cloudflare/],
  ['fireworks', /fireworks/],
  ['github', /github|copilot/],
  ['opencode', /opencode/],
  ['radius', /radius/],
  ['together', /together/],
  ['typesafe', /typesafe/],
  ['vercel', /vercel/],
  ['xiaomimimo', /xiaomi|mimo|小米/],
  ['antling', /ant[-\s]?ling|蚂蚁灵[光波]/],
]);

/**
 * Official channel route ids → vendor logo key.
 *
 * This is the *complete* directory of shipped provider routes
 * (`@deepseek-ai/dsh-llm-pi-ai`'s generated catalog plus the two DeepSeek
 * adapters). A route id outside this table is either a hand-declared custom
 * provider (no vendor mark) or a newer channel the UI falls back to a letter
 * tile for.
 */
export const VENDOR_CHANNELS: Readonly<Record<string, string>> = Object.freeze({
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
});

/**
 * Ordered vendor rules (route id patterns, first hit wins). Kept as a rule list
 * so a future variant of an official channel (for example a new
 * `xiaomi-token-plan-*` region) still resolves without a table edit.
 */
export const VENDOR_RULES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['deepseek', /^(?:deepseek(?:-account|-official)?|llm-deepseek)$/],
  ['openai', /^openai(?:-codex)?$/],
  ['anthropic', /^anthropic$/],
  ['google', /^(?:google|google-vertex)$/],
  ['zhipu', /^z(?:ai|ai-coding-cn)$/],
  ['moonshot', /^(?:moonshotai|moonshotai-cn|kimi-coding)$/],
  ['minimax', /^minimax(?:-cn)?$/],
  ['alibaba', /^qwen-token-plan(?:-cn|-individual)?$/],
  ['xiaomi', /^xiaomi(?:-token-plan-(?:ams|cn|sgp))?$/],
  ['mistral', /^mistral$/],
  ['meta', /^meta$/],
  ['xai', /^xai$/],
  ['nvidia', /^nvidia$/],
  ['aws', /^(?:amazon-bedrock|aws)$/],
  ['azure', /^azure$/],
  ['baseten', /^baseten$/],
  ['cerebras', /^cerebras$/],
  ['cloudflare', /^cloudflare-/],
  ['fireworks', /^fireworks$/],
  ['github', /^github-copilot$/],
  ['opencode', /^opencode(?:-go)?$/],
  ['radius', /^radius$/],
  ['together', /^together$/],
  ['typesafe', /^typesafe$/],
  ['vercel', /^vercel-ai-gateway$/],
  ['antgroup', /^ant-ling$/],
]);

/** Lowercase and normalize separators so both id and display name are searchable. */
export function normalizeModelText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * Describe one label occurrence as the two searchable strings.
 */
export function labelTexts(input: ModelLabelInput | null | undefined): { model: string; provider: string } {
  const provider = input?.provider ?? {};
  const model = input?.model ?? {};
  return {
    model: normalizeModelText(`${model.id ?? ''} ${model.name ?? ''}`),
    provider: normalizeModelText(`${provider.id ?? ''} ${provider.name ?? ''}`),
  };
}

/**
 * Match one provider/model pair to a logo key.
 * @returns A key from {@link LOGO_KEYS}, or null when nothing matches.
 */
export function matchModelLogo(input: ModelLabelInput | null | undefined): string | null {
  const { model, provider } = labelTexts(input);
  if (model !== '') {
    for (const [key, pattern] of MODEL_RULES) {
      if (pattern.test(model)) return key;
    }
  }
  if (provider !== '') {
    for (const [key, pattern] of PROVIDER_RULES) {
      if (pattern.test(provider)) return key;
    }
  }
  return null;
}

/**
 * Match an official channel route id to its vendor logo key.
 *
 * Exact directory ids win first; the pattern list is the forward-compatible
 * fallback for channel variants. Hand-declared custom providers are not
 * official channels and must be filtered out by the caller before asking.
 * @param providerId - provider route id (`anthropic`, `xiaomi-token-plan-cn`, …).
 * @returns A key from {@link LOGO_KEYS}, or null when the id is not a known channel.
 */
export function matchVendorLogo(providerId: unknown): string | null {
  const id = normalizeModelText(providerId);
  if (id === '') return null;
  const exact = VENDOR_CHANNELS[id];
  if (exact !== undefined) return exact;
  for (const [key, pattern] of VENDOR_RULES) {
    if (pattern.test(id)) return key;
  }
  return null;
}

/**
 * Whether a route id is one of the shipped official channels.
 * @param providerId - provider route id.
 */
export function isOfficialVendorChannel(providerId: unknown): boolean {
  return matchVendorLogo(providerId) !== null;
}
