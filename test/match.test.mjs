/**
 * Matcher regression tests: the provider/model pairs this plugin must classify,
 * including aggregator providers where the model brand wins over the host brand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LOGO_KEYS, MODEL_RULES, PROVIDER_RULES, matchModelLogo, normalizeModelText } from '../src/match.mjs';

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
  // Provider-level fallbacks for opaque model ids.
  [pair('deepseek-official', 'chat'), 'deepseek'],
  [pair('google-vertex', 'default'), 'gemini'],
  [pair('azure-openai-east', 'deployment-1'), 'openai'],
  [pair('moonshot-ai', 'chat'), 'kimi'],
  [pair('nvidia-nim', 'default'), 'nvidia'],
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
