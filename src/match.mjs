/**
 * Heuristic brand matcher for model labels.
 *
 * One ordered rule table maps a normalized provider/model description to a logo
 * key. Model-level evidence wins over provider-level evidence so an aggregator
 * (`openrouter`, `ollama`, …) shows the brand of the model it serves, while a
 * provider-only rule still covers catalog entries whose model ids are opaque.
 *
 * The matcher is pure: no network, no catalog import, no DOM. The client bundle
 * inlines this module, so it must stay free of imports and of `export` forms
 * other than the ones the build strips (`export const`, `export function`).
 */

/** Logo keys the matcher can return; each one needs a mark in `src/logos-*.mjs`. */
export const LOGO_KEYS = Object.freeze([
  'deepseek',
  'openai',
  'claude',
  'gemini',
  'qwen',
  'zhipu',
  'kimi',
  'minimax',
  'mistral',
  'meta',
  'xai',
  'doubao',
  'baidu',
  'tencent',
  'cohere',
  'perplexity',
  'microsoft',
  'nvidia',
  'aws',
  'huggingface',
  'ollama',
  'groq',
  'openrouter',
  'stepfun',
  'yi',
]);

/** Token boundary shared by the word-like rules. */
const B = '(?:^|[\\s/._:·-])';
/** End of token. */
const E = '(?:$|[\\s/._:·-])';

/**
 * Model-identity rules, in priority order: the first hit wins.
 * @type {ReadonlyArray<readonly [string, RegExp]>}
 */
export const MODEL_RULES = Object.freeze([
  ['deepseek', /deepseek|deep[-\s]?seek/],
  ['claude', /claude|anthropic/],
  ['openai', new RegExp(`${B}(?:gpt|chatgpt|codex|sora|whisper|davinci|o[1-9])(?:${E}|[-.\\d])`)],
  ['gemini', new RegExp(`gemini|gemma|${B}palm${E}`)],
  ['qwen', /qwen|qwq|qvq|tongyi|通义/],
  ['zhipu', new RegExp(`${B}(?:glm|chatglm|zhipu|z\\.ai)${E}|智谱`)],
  ['kimi', /kimi|moonshot|月之暗面/],
  ['minimax', /minimax|abab|hailuo|海螺/],
  ['mistral', /mistral|mixtral|codestral|magistral|devstral/],
  ['meta', new RegExp(`llama|${B}meta${E}`)],
  ['xai', new RegExp(`${B}(?:grok|xai|x-ai)${E}`)],
  ['doubao', new RegExp(`doubao|豆包|bytedance|skylark|${B}seed${E}`)],
  ['baidu', /ernie|wenxin|文心|baidu/],
  ['tencent', /hunyuan|混元|tencent/],
  ['cohere', new RegExp(`cohere|${B}command[\\s-]?r${E}`)],
  ['perplexity', /perplexity|sonar/],
  ['microsoft', new RegExp(`microsoft|azure|${B}phi[\\s-]?\\d`)],
  ['nvidia', /nvidia|nemotron/],
  ['aws', new RegExp(`amazon|bedrock|${B}(?:nova|titan)${E}`)],
  ['huggingface', new RegExp(`hugging\\s?face|${B}hf${E}`)],
  ['ollama', /ollama/],
  ['groq', /groq/],
  ['openrouter', /openrouter/],
  ['stepfun', new RegExp(`stepfun|step[-\\s]?fun|阶跃|${B}step[-\\s]?\\d`)],
  ['yi', new RegExp(`${B}(?:yi|01\\.?ai|lingyi)${E}|零一`)],
]);

/**
 * Provider-identity rules, used only when no model rule matched.
 * @type {ReadonlyArray<readonly [string, RegExp]>}
 */
export const PROVIDER_RULES = Object.freeze([
  ['deepseek', /deepseek/],
  ['claude', /anthropic|claude/],
  ['openai', /openai/],
  ['gemini', /google|gemini|vertex/],
  ['zhipu', /zai|zhipu|glm|bigmodel|智谱/],
  ['kimi', /moonshot|kimi/],
  ['minimax', /minimax/],
  ['qwen', /qwen|dashscope|aliyun|alibaba|bailian|通义/],
  ['mistral', /mistral/],
  ['meta', /meta|llama/],
  ['xai', /xai|x-ai|grok/],
  ['doubao', /doubao|bytedance|volc|火山/],
  ['baidu', /baidu|ernie|qianfan|千帆/],
  ['tencent', /tencent|hunyuan|腾讯/],
  ['cohere', /cohere/],
  ['perplexity', /perplexity/],
  ['microsoft', /microsoft|azure/],
  ['nvidia', /nvidia/],
  ['aws', /amazon|aws|bedrock/],
  ['huggingface', new RegExp(`hugging\\s?face|${B}hf${E}`)],
  ['ollama', /ollama/],
  ['groq', /groq/],
  ['openrouter', /openrouter/],
  ['stepfun', /stepfun|阶跃/],
  ['yi', /01\.?ai|lingyi|零一/],
]);

/** Lowercase and normalize separators so both id and display name are searchable. */
export function normalizeModelText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * Describe one label occurrence as the two searchable strings.
 * @param {{ provider?: { id?: string, name?: string }, model?: { id?: string, name?: string } }} input
 * @returns {{ model: string, provider: string }}
 */
export function labelTexts(input) {
  const provider = input?.provider ?? {};
  const model = input?.model ?? {};
  return {
    model: normalizeModelText(`${model.id ?? ''} ${model.name ?? ''}`),
    provider: normalizeModelText(`${provider.id ?? ''} ${provider.name ?? ''}`),
  };
}

/**
 * Match one provider/model pair to a logo key.
 * @param {{ provider?: { id?: string, name?: string }, model?: { id?: string, name?: string } }} input
 * @returns {string | null} A key from {@link LOGO_KEYS}, or null when nothing matches.
 */
export function matchModelLogo(input) {
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
