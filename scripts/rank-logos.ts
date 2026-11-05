/**
 * Visibility-ranking snapshot generator.
 *
 * The icon picker lists its two groups by measured online prominence, not
 * alphabetically. That order is a checked-in snapshot, produced by this script:
 *
 *   tsx scripts/rank-logos.ts --collect   # network refresh: rewrite all three outputs
 *   tsx scripts/rank-logos.ts --check     # offline: recompute and compare, never fetch
 *
 * `--collect` queries five independent signals per brand key and writes
 *
 *   reference/rankings.json   raw values, handles, URLs and provenance (big)
 *   src/logos/ranking.ts      LOGO_RANKS / RANKING_DATE / RANKING_SOURCES (tiny, bundled)
 *   docs/rankings.md          the method plus one table per group (generated)
 *
 * Network requests go through Node's built-in fetch. When a proxy is required,
 * set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` in the environment; neither is
 * hardcoded here. Requests are sequential, retried with backoff on 429/412/5xx,
 * and cached per UTC collection day under `.cache/ranking/<date>/` so a rerun
 * after a handle fix does not refetch successful responses.
 *
 * Scoring: every raw metric is `log10(1 + value)` and then percentile-ranked
 * across all keys that have that signal. The per-key score is the weighted mean
 * over the signals it has (weights renormalised over the available ones). A key
 * needs at least two signals for a normal rank; keys with fewer are
 * low-confidence and sorted after the normal keys of their group. Ranks are per
 * group, contiguous and 1-based.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Every provider is queried sequentially and with backoff on purpose: parallel
// fan-out trips GitHub's secondary limits and Wikipedia/Bilibili rate limiting.
/* oxlint-disable no-await-in-loop */

/* -------------------------------------------------------------------------- */
/* Paths and constants                                                        */
/* -------------------------------------------------------------------------- */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_PATH = resolve(ROOT, 'reference/rankings.json');
const RANKING_TS_PATH = resolve(ROOT, 'src/logos/ranking.ts');
const DOCS_PATH = resolve(ROOT, 'docs/rankings.md');
const CACHE_ROOT = resolve(ROOT, '.cache/ranking');

/** Groups the picker shows, in snapshot order. */
const GROUPS = ['vendor', 'model'] as const;
type Group = (typeof GROUPS)[number];

/** The five collected signals. */
const SOURCE_IDS = ['github', 'npm', 'wikipedia', 'huggingface', 'bilibili'] as const;
type SourceId = (typeof SOURCE_IDS)[number];

/** Signal weights (they sum to 1; missing signals are renormalised away). */
const WEIGHTS: Readonly<Record<SourceId, number>> = Object.freeze({
  github: 0.2,
  npm: 0.2,
  wikipedia: 0.25,
  huggingface: 0.2,
  bilibili: 0.15,
});

/** Human labels shared by the snapshot, the generated module and the docs. */
const SOURCE_LABELS: Readonly<Record<SourceId, string>> = Object.freeze({
  github: 'GitHub organisation followers',
  npm: 'npm weekly downloads',
  wikipedia: 'Wikipedia pageviews (en + zh)',
  huggingface: 'Hugging Face model likes + downloads',
  bilibili: 'Bilibili search results + top-20 plays',
});

/** Wikipedia pageview window: the six full months ending 2026-10-31. */
const WINDOW = Object.freeze({ start: '2026-05-01', end: '2026-10-31' });
const WIKI_START = '20260501';
const WIKI_END = '20261031';

/** Bilibili's search API caps its result count at 1000. */
const BILIBILI_RESULT_CAP = 1000;

/** Base delay between network requests of one signal, per provider policy. */
const BASE_DELAYS: Readonly<Record<SourceId, number>> = Object.freeze({
  github: 900,
  npm: 120,
  wikipedia: 300,
  huggingface: 250,
  bilibili: 700,
});

/** Retry budget and backoff for one request. */
const MAX_ATTEMPTS = 6;
const MAX_DELAY_MS = 8000;

/** User agent sent with every request (GitHub rejects requests without one). */
const USER_AGENT = 'dsh-model-logos-ranking/1.0 (+https://github.com/Altermoe/dsh-model-logos)';

/**
 * Bilibili only issues its session cookies to a browser-shaped user agent; the
 * plain tool user agent is answered with a page that sets no `buvid3` cookie.
 */
const BILIBILI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Sanity expectations from the task: the data must place these brands here. */
const SANITY = Object.freeze({
  modelTop: { count: 8, keys: ['gpt', 'claude', 'deepseek'] },
  modelBottom: { count: 8, keys: ['yi', 'antling'] },
  vendorTop: { count: 10, keys: ['openai', 'anthropic', 'google'] },
  vendorBottom: { count: 8, keys: ['radius', 'typesafe'] },
});

/* -------------------------------------------------------------------------- */
/* Snapshot types                                                             */
/* -------------------------------------------------------------------------- */

interface GithubSource {
  value: number;
  handle: string;
  url: string;
  inheritedFrom?: string;
}

interface NpmSource {
  value: number;
  handle: string;
  url: string;
  inheritedFrom?: string;
}

interface WikiDetail {
  title: string;
  views: number;
}

interface WikipediaSource {
  value: number;
  handle: string;
  url: string;
  detail: { en?: WikiDetail; zh?: WikiDetail };
  inheritedFrom?: string;
}

interface HuggingFaceSource {
  value: number;
  likes: number;
  downloads: number;
  handle: string;
  url: string;
  inheritedFrom?: string;
}

interface BilibiliSource {
  value: number;
  numResults: number;
  sumTop20Plays: number;
  handle: string;
  url: string;
  inheritedFrom?: string;
}

/** Per-key raw metrics; an absent signal was not available. */
interface KeySources {
  github?: GithubSource;
  npm?: NpmSource;
  wikipedia?: WikipediaSource;
  huggingface?: HuggingFaceSource;
  bilibili?: BilibiliSource;
}

interface KeyDocument {
  key: string;
  title: string;
  group: Group;
  rank: number;
  score: number;
  lowConfidence: boolean;
  inherited: SourceId[];
  missing: SourceId[];
  sources: KeySources;
}

interface RankingsDocument {
  schemaVersion: 1;
  collectedAt: string;
  window: { start: string; end: string };
  weights: Record<SourceId, number>;
  sources: Array<{ id: SourceId; label: string; weight: number }>;
  keys: KeyDocument[];
}

/** One collected key before scoring. */
interface RawKey {
  key: string;
  title: string;
  group: Group;
  sources: KeySources;
  inherited: SourceId[];
}

/** Scoring result for one key. */
interface ComputedKey {
  score: number;
  lowConfidence: boolean;
  available: number;
}

/* -------------------------------------------------------------------------- */
/* Catalog: the exact 56 keys, their groups and per-source query handles      */
/* -------------------------------------------------------------------------- */

/** Handles for one signal of one key. */
interface SourceHandles {
  github?: string;
  npm?: readonly string[];
  wikipedia?: { en?: string; zh?: string };
  huggingface?: { author: string; search?: string };
  bilibili?: string;
}

interface CatalogEntry {
  key: string;
  title: string;
  group: Group;
  /** Parent key whose handles fill in this key's missing signals. */
  parent?: string;
  sources: SourceHandles;
}

/** Titles match `src/logos/official.generated.ts` / `manual.ts` exactly. */
const CATALOG: readonly CatalogEntry[] = [
  /* ------------------------------- vendor -------------------------------- */
  {
    key: 'alibaba',
    title: 'Alibaba',
    group: 'vendor',
    sources: {
      github: 'alibaba',
      npm: ['ali-oss', '@alicloud/tea-util'],
      wikipedia: { en: 'Alibaba_Group', zh: '阿里巴巴集团' },
      huggingface: { author: 'Alibaba-NLP' },
      bilibili: '阿里巴巴',
    },
  },
  {
    key: 'anthropic',
    title: 'Anthropic',
    group: 'vendor',
    sources: {
      github: 'anthropics',
      npm: ['@anthropic-ai/sdk', '@anthropic-ai/claude-code'],
      wikipedia: { en: 'Anthropic', zh: 'Anthropic' },
      huggingface: { author: 'anthropic' },
      bilibili: 'Anthropic',
    },
  },
  {
    key: 'antgroup',
    title: 'Ant Group',
    group: 'vendor',
    sources: {
      github: 'antgroup',
      wikipedia: { en: 'Ant_Group', zh: '蚂蚁集团' },
      huggingface: { author: 'inclusionAI' },
      bilibili: '蚂蚁集团',
    },
  },
  {
    key: 'aws',
    title: 'AWS',
    group: 'vendor',
    sources: {
      github: 'aws',
      npm: ['@aws-sdk/client-bedrock-runtime'],
      wikipedia: { en: 'Amazon_Web_Services', zh: '亚马逊云计算服务' },
      huggingface: { author: 'amazon' },
      bilibili: 'AWS',
    },
  },
  {
    key: 'azure',
    title: 'Microsoft Azure',
    group: 'vendor',
    parent: 'microsoft',
    sources: {
      github: 'Azure',
      npm: ['@azure/openai'],
      wikipedia: { en: 'Microsoft_Azure', zh: 'Microsoft_Azure' },
      bilibili: 'Azure',
    },
  },
  {
    key: 'baidu',
    title: 'Baidu',
    group: 'vendor',
    sources: {
      github: 'baidu',
      npm: ['baidu-aip-sdk'],
      wikipedia: { en: 'Baidu', zh: '百度' },
      huggingface: { author: 'baidu' },
      bilibili: '百度',
    },
  },
  {
    key: 'baseten',
    title: 'Baseten',
    group: 'vendor',
    sources: {
      github: 'basetenlabs',
      huggingface: { author: 'baseten' },
      bilibili: 'Baseten',
    },
  },
  {
    key: 'bytedance',
    title: 'ByteDance',
    group: 'vendor',
    sources: {
      github: 'bytedance',
      wikipedia: { en: 'ByteDance', zh: '字节跳动' },
      huggingface: { author: 'ByteDance' },
      bilibili: '字节跳动',
    },
  },
  {
    key: 'cerebras',
    title: 'Cerebras',
    group: 'vendor',
    sources: {
      github: 'Cerebras',
      npm: ['@cerebras/cerebras_cloud_sdk'],
      wikipedia: { en: 'Cerebras' },
      huggingface: { author: 'cerebras' },
      bilibili: 'Cerebras',
    },
  },
  {
    key: 'cloudflare',
    title: 'Cloudflare',
    group: 'vendor',
    sources: {
      github: 'cloudflare',
      npm: ['wrangler'],
      wikipedia: { en: 'Cloudflare', zh: 'Cloudflare' },
      huggingface: { author: 'cloudflare' },
      bilibili: 'Cloudflare',
    },
  },
  {
    key: 'cohere',
    title: 'Cohere',
    group: 'vendor',
    sources: {
      github: 'cohere-ai',
      npm: ['cohere-ai'],
      wikipedia: { en: 'Cohere' },
      huggingface: { author: 'CohereLabs' },
      bilibili: 'Cohere',
    },
  },
  {
    key: 'fireworks',
    title: 'Fireworks',
    group: 'vendor',
    sources: {
      github: 'fireworks-ai',
      wikipedia: { en: 'Fireworks_AI' },
      huggingface: { author: 'fireworks-ai' },
      bilibili: 'Fireworks AI',
    },
  },
  {
    key: 'github',
    title: 'GitHub',
    group: 'vendor',
    sources: {
      github: 'github',
      npm: ['@octokit/rest'],
      wikipedia: { en: 'GitHub', zh: 'GitHub' },
      huggingface: { author: 'github' },
      bilibili: 'GitHub',
    },
  },
  {
    key: 'google',
    title: 'Google',
    group: 'vendor',
    sources: {
      github: 'google',
      npm: ['@google/genai'],
      wikipedia: { en: 'Google', zh: '谷歌' },
      huggingface: { author: 'google' },
      bilibili: '谷歌',
    },
  },
  {
    key: 'groq',
    title: 'Groq',
    group: 'vendor',
    sources: {
      github: 'groq',
      npm: ['groq-sdk'],
      wikipedia: { en: 'Groq', zh: 'Groq' },
      huggingface: { author: 'groq' },
      bilibili: 'Groq',
    },
  },
  {
    key: 'huggingface',
    title: 'Hugging Face',
    group: 'vendor',
    sources: {
      github: 'huggingface',
      npm: ['@huggingface/transformers', '@huggingface/inference'],
      wikipedia: { en: 'Hugging_Face', zh: 'Hugging_Face' },
      huggingface: { author: 'huggingface' },
      bilibili: 'Hugging Face',
    },
  },
  {
    key: 'meta',
    title: 'Meta',
    group: 'vendor',
    sources: {
      // `facebook` is a near-empty legacy org; Meta's active GitHub profile is `meta`.
      github: 'meta',
      wikipedia: { en: 'Meta_Platforms', zh: 'Meta_Platforms' },
      huggingface: { author: 'meta-llama' },
      bilibili: 'Meta AI',
    },
  },
  {
    key: 'microsoft',
    title: 'Microsoft',
    group: 'vendor',
    sources: {
      github: 'microsoft',
      npm: ['botbuilder'],
      wikipedia: { en: 'Microsoft', zh: '微软' },
      huggingface: { author: 'microsoft' },
      bilibili: '微软',
    },
  },
  {
    key: 'moonshot',
    title: 'Moonshot AI',
    group: 'vendor',
    sources: {
      github: 'MoonshotAI',
      wikipedia: { en: 'Moonshot_AI', zh: '月之暗面' },
      huggingface: { author: 'moonshotai' },
      bilibili: '月之暗面',
    },
  },
  {
    key: 'nvidia',
    title: 'NVIDIA',
    group: 'vendor',
    sources: {
      github: 'nvidia',
      wikipedia: { en: 'Nvidia', zh: '英伟达' },
      huggingface: { author: 'nvidia' },
      bilibili: '英伟达',
    },
  },
  {
    key: 'ollama',
    title: 'Ollama',
    group: 'vendor',
    sources: {
      github: 'ollama',
      npm: ['ollama'],
      wikipedia: { en: 'Ollama', zh: 'Ollama' },
      huggingface: { author: 'ollama' },
      bilibili: 'Ollama',
    },
  },
  {
    key: 'openai',
    title: 'OpenAI',
    group: 'vendor',
    sources: {
      github: 'openai',
      npm: ['openai'],
      wikipedia: { en: 'OpenAI', zh: 'OpenAI' },
      huggingface: { author: 'openai' },
      bilibili: 'OpenAI',
    },
  },
  {
    key: 'opencode',
    title: 'OpenCode',
    group: 'vendor',
    sources: {
      // The former `sst` org moved to `anomalyco`; OpenCode lives there now.
      github: 'anomalyco',
      npm: ['opencode-ai'],
      wikipedia: { en: 'OpenCode' },
      bilibili: 'OpenCode',
    },
  },
  {
    key: 'openrouter',
    title: 'OpenRouter',
    group: 'vendor',
    sources: {
      github: 'OpenRouterTeam',
      npm: ['@openrouter/ai-sdk-provider'],
      wikipedia: { en: 'OpenRouter' },
      bilibili: 'OpenRouter',
    },
  },
  {
    key: 'radius',
    title: 'Radius',
    group: 'vendor',
    sources: {
      // Radius (radius.pi.dev) is a service by the Pi developers rather than a
      // company with its own GitHub org, Wikipedia article or Hugging Face
      // organisation. Only a Bilibili keyword is measurable, so the key is
      // deliberately low-confidence instead of borrowing Earendil Works' numbers.
      bilibili: 'Radius AI',
    },
  },
  {
    key: 'tencent',
    title: 'Tencent',
    group: 'vendor',
    sources: {
      github: 'Tencent',
      npm: ['tencentcloud-sdk-nodejs'],
      wikipedia: { en: 'Tencent', zh: '腾讯' },
      huggingface: { author: 'tencent' },
      bilibili: '腾讯',
    },
  },
  {
    key: 'together',
    title: 'Together AI',
    group: 'vendor',
    sources: {
      github: 'togethercomputer',
      npm: ['together-ai'],
      huggingface: { author: 'togethercomputer' },
      bilibili: 'Together AI',
    },
  },
  {
    key: 'typesafe',
    title: 'TypeSafe',
    group: 'vendor',
    sources: {
      github: 'typesafe-ai',
      bilibili: 'TypeSafe AI',
    },
  },
  {
    key: 'vercel',
    title: 'Vercel',
    group: 'vendor',
    sources: {
      github: 'vercel',
      npm: ['ai', 'vercel'],
      wikipedia: { en: 'Vercel' },
      huggingface: { author: 'vercel' },
      bilibili: 'Vercel',
    },
  },
  {
    key: 'xai',
    title: 'xAI',
    group: 'vendor',
    sources: {
      github: 'xai-org',
      wikipedia: { en: 'XAI', zh: 'XAI' },
      huggingface: { author: 'xai-org' },
      bilibili: 'xAI',
    },
  },
  {
    key: 'xiaomi',
    title: 'Xiaomi',
    group: 'vendor',
    sources: {
      github: 'Xiaomi',
      wikipedia: { en: 'Xiaomi', zh: '小米集团' },
      huggingface: { author: 'XiaomiMiMo' },
      bilibili: '小米',
    },
  },
  {
    key: 'zhipu',
    title: 'Zhipu AI',
    group: 'vendor',
    sources: {
      github: 'zai-org',
      wikipedia: { en: 'Zhipu_AI', zh: '智谱' },
      huggingface: { author: 'zai-org' },
      bilibili: '智谱',
    },
  },
  /* -------------------------------- model -------------------------------- */
  {
    key: 'antling',
    title: 'Ant Ling',
    group: 'model',
    parent: 'antgroup',
    sources: {
      wikipedia: { zh: '灵波' },
      huggingface: { author: 'inclusionAI', search: 'Ling' },
      bilibili: '蚂蚁灵波',
    },
  },
  {
    key: 'claude',
    title: 'Claude',
    group: 'model',
    parent: 'anthropic',
    sources: {
      wikipedia: { en: 'Claude_(language_model)', zh: 'Claude_(语言模型)' },
      bilibili: 'Claude AI',
    },
  },
  {
    key: 'command',
    title: 'Command',
    group: 'model',
    parent: 'cohere',
    sources: {
      huggingface: { author: 'CohereLabs', search: 'command' },
      bilibili: 'Command R',
    },
  },
  {
    key: 'deepseek',
    title: 'DeepSeek',
    group: 'model',
    sources: {
      github: 'deepseek-ai',
      wikipedia: { en: 'DeepSeek', zh: '深度求索' },
      huggingface: { author: 'deepseek-ai', search: 'deepseek' },
      bilibili: 'DeepSeek',
    },
  },
  {
    key: 'doubao',
    title: 'Doubao',
    group: 'model',
    parent: 'bytedance',
    sources: {
      wikipedia: { en: 'Doubao', zh: '豆包' },
      bilibili: '豆包',
    },
  },
  {
    key: 'ernie',
    title: 'ERNIE',
    group: 'model',
    parent: 'baidu',
    sources: {
      wikipedia: { en: 'Ernie_Bot', zh: '文心一言' },
      huggingface: { author: 'baidu', search: 'ernie' },
      bilibili: '文心一言',
    },
  },
  {
    key: 'gemini',
    title: 'Gemini',
    group: 'model',
    parent: 'google',
    sources: {
      wikipedia: { en: 'Gemini_(language_model)', zh: 'Gemini_(语言模型)' },
      bilibili: 'Gemini AI',
    },
  },
  {
    key: 'glm',
    title: 'GLM',
    group: 'model',
    parent: 'zhipu',
    sources: {
      github: 'zai-org',
      wikipedia: { en: 'ChatGLM', zh: '智谱清言' },
      huggingface: { author: 'zai-org', search: 'glm' },
      bilibili: '智谱GLM',
    },
  },
  {
    key: 'gpt',
    title: 'GPT',
    group: 'model',
    parent: 'openai',
    sources: {
      wikipedia: { en: 'ChatGPT', zh: 'ChatGPT' },
      huggingface: { author: 'openai', search: 'gpt' },
      bilibili: 'ChatGPT',
    },
  },
  {
    key: 'grok',
    title: 'Grok',
    group: 'model',
    parent: 'xai',
    sources: {
      wikipedia: { en: 'Grok_(chatbot)', zh: 'Grok' },
      huggingface: { author: 'xai-org', search: 'grok' },
      bilibili: 'Grok AI',
    },
  },
  {
    key: 'hailuo',
    title: 'Hailuo',
    group: 'model',
    parent: 'minimax',
    sources: {
      wikipedia: { en: 'Hailuo_AI' },
      bilibili: '海螺AI',
    },
  },
  {
    key: 'hunyuan',
    title: 'Hunyuan',
    group: 'model',
    parent: 'tencent',
    sources: {
      wikipedia: { en: 'Hunyuan', zh: '腾讯混元' },
      huggingface: { author: 'tencent', search: 'hunyuan' },
      bilibili: '腾讯混元',
    },
  },
  {
    key: 'kimi',
    title: 'Kimi',
    group: 'model',
    parent: 'moonshot',
    sources: {
      wikipedia: { en: 'Kimi_(chatbot)', zh: 'Kimi' },
      huggingface: { author: 'moonshotai', search: 'kimi' },
      bilibili: 'Kimi AI',
    },
  },
  {
    key: 'llama',
    title: 'Llama',
    group: 'model',
    parent: 'meta',
    sources: {
      github: 'meta-llama',
      wikipedia: { en: 'Llama_(language_model)', zh: 'Llama' },
      huggingface: { author: 'meta-llama', search: 'llama' },
      bilibili: 'Llama 模型',
    },
  },
  {
    key: 'minimax',
    title: 'MiniMax',
    group: 'model',
    sources: {
      github: 'MiniMax-AI',
      wikipedia: { en: 'MiniMax_(company)', zh: 'MiniMax' },
      huggingface: { author: 'MiniMaxAI', search: 'minimax' },
      bilibili: 'MiniMax AI',
    },
  },
  {
    key: 'mistral',
    title: 'Mistral',
    group: 'model',
    sources: {
      github: 'mistralai',
      npm: ['@mistralai/mistralai'],
      wikipedia: { en: 'Mistral_AI', zh: 'Mistral_AI' },
      huggingface: { author: 'mistralai', search: 'mistral' },
      bilibili: 'Mistral AI',
    },
  },
  {
    key: 'nemotron',
    title: 'Nemotron',
    group: 'model',
    parent: 'nvidia',
    sources: {
      wikipedia: { en: 'Nemotron' },
      huggingface: { author: 'nvidia', search: 'nemotron' },
      bilibili: 'Nemotron',
    },
  },
  {
    key: 'nova',
    title: 'Nova',
    group: 'model',
    parent: 'aws',
    sources: {
      wikipedia: { en: 'Amazon_Nova' },
      bilibili: 'Amazon Nova',
    },
  },
  {
    key: 'perplexity',
    title: 'Perplexity',
    group: 'model',
    sources: {
      github: 'perplexityai',
      wikipedia: { en: 'Perplexity_AI' },
      huggingface: { author: 'perplexity-ai' },
      bilibili: 'Perplexity AI',
    },
  },
  {
    key: 'phi',
    title: 'Phi',
    group: 'model',
    parent: 'microsoft',
    sources: {
      wikipedia: { en: 'Phi_(language_model)' },
      huggingface: { author: 'microsoft', search: 'phi' },
      bilibili: 'Phi 模型',
    },
  },
  {
    key: 'qwen',
    title: 'Qwen',
    group: 'model',
    parent: 'alibaba',
    sources: {
      github: 'QwenLM',
      npm: ['@qwen-code/qwen-code'],
      wikipedia: { en: 'Qwen', zh: '通义千问' },
      huggingface: { author: 'Qwen', search: 'qwen' },
      bilibili: '通义千问',
    },
  },
  {
    key: 'stepfun',
    title: 'StepFun',
    group: 'model',
    sources: {
      github: 'stepfun-ai',
      wikipedia: { en: 'StepFun', zh: '阶跃星辰' },
      huggingface: { author: 'stepfun-ai', search: 'step' },
      bilibili: '阶跃星辰',
    },
  },
  {
    key: 'xiaomimimo',
    title: 'Xiaomi MiMo',
    group: 'model',
    parent: 'xiaomi',
    sources: {
      github: 'XiaomiMiMo',
      wikipedia: { en: 'Xiaomi_MiMo', zh: '小米MiMo' },
      huggingface: { author: 'XiaomiMiMo', search: 'mimo' },
      bilibili: '小米MiMo',
    },
  },
  {
    key: 'yi',
    title: 'Yi',
    group: 'model',
    sources: {
      github: '01-ai',
      wikipedia: { en: '01.AI' },
      huggingface: { author: '01-ai', search: 'yi' },
      bilibili: '零一万物',
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });

const warn = (message: string): void => {
  console.warn('warning: ' + message);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function roundScore(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* -------------------------------------------------------------------------- */
/* HTTP and on-disk cache                                                     */
/* -------------------------------------------------------------------------- */

interface HttpResponse {
  status: number;
  body: string;
  setCookies: string[];
}

interface Runtime {
  cacheDir: string;
  delays: Record<SourceId, number>;
  githubToken: string | undefined;
}

function cacheFile(runtime: Runtime, source: SourceId, url: string): string {
  const hash = createHash('sha1')
    .update(source + '\n' + url)
    .digest('hex');
  return join(runtime.cacheDir, source, hash + '.json');
}

function readCache(runtime: Runtime, source: SourceId, url: string): HttpResponse | null {
  const path = cacheFile(runtime, source, url);
  if (!existsSync(path)) return null;
  const parsed = parseJson(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) return null;
  const status = asNumber(parsed.status);
  const body = typeof parsed.body === 'string' ? parsed.body : null;
  if (status === null || body === null || parsed.url !== url) return null;
  return { status, body, setCookies: [] };
}

function writeCache(runtime: Runtime, source: SourceId, url: string, response: HttpResponse): void {
  const path = cacheFile(runtime, source, url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ url, status: response.status, body: response.body }));
}

async function fetchOnce(
  url: string,
  headers: Readonly<Record<string, string>>,
  redirect: RequestRedirect = 'follow',
): Promise<HttpResponse> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, ...headers },
    redirect,
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : [];
  return { status: response.status, body, setCookies };
}

function backoff(attempt: number, base = 1000): number {
  return Math.min(20000, base * 2 ** attempt);
}

/** A status that will not change on retry and is worth caching. */
function isTerminalStatus(status: number): boolean {
  return status === 200 || status === 400 || status === 404;
}

async function fetchWithRetry(
  runtime: Runtime,
  source: SourceId,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<HttpResponse> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchOnce(url, headers);
      const retryable = response.status === 429 || response.status === 412 || response.status >= 500;
      if (!retryable) return response;
      runtime.delays[source] = Math.min(runtime.delays[source] * 2, MAX_DELAY_MS);
      warn(`${source} HTTP ${response.status} for ${url} (retry ${attempt + 1}/${MAX_ATTEMPTS})`);
      await sleep(backoff(attempt));
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) {
        warn(`${source} request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
        return { status: 0, body: '', setCookies: [] };
      }
      await sleep(backoff(attempt));
    }
  }
  return { status: 0, body: '', setCookies: [] };
}

async function cachedGet(
  runtime: Runtime,
  source: SourceId,
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<HttpResponse> {
  const cached = readCache(runtime, source, url);
  if (cached !== null) return cached;
  const response = await fetchWithRetry(runtime, source, url, headers);
  if (isTerminalStatus(response.status)) writeCache(runtime, source, url, response);
  await sleep(runtime.delays[source]);
  return response;
}

/* -------------------------------------------------------------------------- */
/* Source collectors                                                          */
/* -------------------------------------------------------------------------- */

async function collectGithub(org: string, runtime: Runtime): Promise<GithubSource | null> {
  const url = `https://api.github.com/orgs/${encodeURIComponent(org)}`;
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  if (runtime.githubToken !== undefined) headers.authorization = `Bearer ${runtime.githubToken}`;
  const response = await cachedGet(runtime, 'github', url, headers);
  if (response.status !== 200) {
    if (response.status !== 404) warn(`github: ${org} returned HTTP ${response.status}`);
    return null;
  }
  const data = parseJson(response.body);
  if (!isRecord(data)) return null;
  const followers = asNumber(data.followers);
  if (followers === null) return null;
  return { value: followers, handle: org, url };
}

async function collectNpm(packages: readonly string[], runtime: Runtime): Promise<NpmSource | null> {
  let best: NpmSource | null = null;
  for (const packageName of packages) {
    const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`;
    const response = await cachedGet(runtime, 'npm', url);
    if (response.status !== 200) {
      if (response.status !== 404) warn(`npm: ${packageName} returned HTTP ${response.status}`);
      continue;
    }
    const data = parseJson(response.body);
    if (!isRecord(data)) continue;
    const downloads = asNumber(data.downloads);
    if (downloads === null) continue;
    if (best === null || downloads > best.value) best = { value: downloads, handle: packageName, url };
  }
  return best;
}

async function collectWikipedia(
  source: { en?: string; zh?: string },
  runtime: Runtime,
): Promise<WikipediaSource | null> {
  const detail: { en?: WikiDetail; zh?: WikiDetail } = {};
  const urls: string[] = [];
  for (const lang of ['en', 'zh'] as const) {
    const title = source[lang];
    if (title === undefined || title === '') continue;
    const url =
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/` +
      `${encodeURIComponent(title)}/monthly/${WIKI_START}/${WIKI_END}`;
    const response = await cachedGet(runtime, 'wikipedia', url, { accept: 'application/json' });
    if (response.status !== 200) {
      if (response.status !== 404) warn(`wikipedia: ${lang}:${title} returned HTTP ${response.status}`);
      continue;
    }
    const data = parseJson(response.body);
    if (!isRecord(data) || !Array.isArray(data.items)) continue;
    let views = 0;
    let found = false;
    for (const item of data.items) {
      if (!isRecord(item)) continue;
      const value = asNumber(item.views);
      if (value === null) continue;
      views += value;
      found = true;
    }
    if (!found) continue;
    detail[lang] = { title, views };
    urls.push(url);
  }
  if (detail.en === undefined && detail.zh === undefined) return null;
  const value = (detail.en?.views ?? 0) + (detail.zh?.views ?? 0);
  const handle = [
    detail.en === undefined ? null : `en:${detail.en.title}`,
    detail.zh === undefined ? null : `zh:${detail.zh.title}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' | ');
  return { value, handle, url: urls[0] ?? '', detail };
}

async function collectHuggingFace(
  source: { author: string; search?: string },
  runtime: Runtime,
): Promise<HuggingFaceSource | null> {
  const params = new URLSearchParams({ author: source.author, limit: '1000' });
  if (source.search !== undefined && source.search !== '') params.set('search', source.search);
  const url = `https://huggingface.co/api/models?${params.toString()}`;
  const response = await cachedGet(runtime, 'huggingface', url, { accept: 'application/json' });
  if (response.status !== 200) {
    warn(`huggingface: ${source.author} returned HTTP ${response.status}`);
    return null;
  }
  const data = parseJson(response.body);
  if (!Array.isArray(data) || data.length === 0) return null;
  let likes = 0;
  let downloads = 0;
  for (const model of data) {
    if (!isRecord(model)) continue;
    likes += asNumber(model.likes) ?? 0;
    downloads += asNumber(model.downloads) ?? 0;
  }
  const handle = source.search === undefined ? source.author : `${source.author} (search: ${source.search})`;
  return { value: likes + downloads, likes, downloads, handle, url };
}

/** Cached Bilibili session cookie; the search API answers 412 without one. */
let bilibiliCookie = '';

/**
 * Bilibili sets `buvid3`/`b_nut` on the homepage response, but only when the
 * redirect is not followed automatically; `redirect: 'manual'` keeps those
 * headers. A caller-supplied `BILIBILI_COOKIE` wins, which makes a rate-limited
 * refresh reproducible without bootstrapping a session.
 */
async function fetchBilibiliCookie(redirect: RequestRedirect): Promise<string> {
  const response = await fetchOnce(
    'https://www.bilibili.com/',
    { 'user-agent': BILIBILI_USER_AGENT, 'accept-language': 'zh-CN,zh;q=0.9' },
    redirect,
  );
  const cookie = response.setCookies
    .map((raw) => raw.split(';')[0] ?? '')
    .filter((part) => part !== '')
    .join('; ');
  if (cookie === '') {
    warn(`bilibili: session bootstrap (redirect: ${redirect}) returned HTTP ${response.status} without cookies`);
  }
  return cookie;
}

async function ensureBilibiliCookie(): Promise<string> {
  if (bilibiliCookie !== '') return bilibiliCookie;
  const override = process.env.BILIBILI_COOKIE;
  if (override !== undefined && override.trim() !== '') {
    bilibiliCookie = override.trim();
    return bilibiliCookie;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const redirect of ['manual', 'follow'] as const) {
      try {
        const cookie = await fetchBilibiliCookie(redirect);
        if (cookie !== '') {
          bilibiliCookie = cookie;
          return cookie;
        }
      } catch (error) {
        warn(`bilibili: session bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await sleep(1200);
  }
  warn('bilibili: could not obtain a session cookie; searches will likely return 412');
  return '';
}

interface BilibiliPayload {
  numResults: number;
  sumTop20Plays: number;
}

function parseBilibiliResponse(body: string): BilibiliPayload | null {
  const data = parseJson(body);
  if (!isRecord(data) || asNumber(data.code) !== 0) return null;
  const payload = data.data;
  if (!isRecord(payload)) return null;
  const numResults = Math.min(asNumber(payload.numResults) ?? 0, BILIBILI_RESULT_CAP);
  let sumTop20Plays = 0;
  const results = Array.isArray(payload.result) ? payload.result.slice(0, 20) : [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    const play =
      typeof item.play === 'number' ? item.play : typeof item.play === 'string' ? Number(item.play) : Number.NaN;
    if (Number.isFinite(play)) sumTop20Plays += play;
  }
  return { numResults, sumTop20Plays };
}

async function collectBilibili(keyword: string, runtime: Runtime): Promise<BilibiliSource | null> {
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(keyword);
  const cached = readCache(runtime, 'bilibili', url);
  if (cached !== null && cached.status === 200) {
    const payload = parseBilibiliResponse(cached.body);
    if (payload !== null) {
      return {
        value: payload.sumTop20Plays,
        numResults: payload.numResults,
        sumTop20Plays: payload.sumTop20Plays,
        handle: keyword,
        url,
      };
    }
  }
  let cookie = await ensureBilibiliCookie();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: HttpResponse | null = null;
    try {
      response = await fetchOnce(url, {
        'user-agent': BILIBILI_USER_AGENT,
        referer: 'https://search.bilibili.com/',
        'accept-language': 'zh-CN,zh;q=0.9',
        cookie,
      });
    } catch (error) {
      warn(`bilibili: "${keyword}" request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(runtime.delays.bilibili);
    if (response !== null && response.status === 200) {
      const payload = parseBilibiliResponse(response.body);
      if (payload !== null) {
        writeCache(runtime, 'bilibili', url, response);
        return {
          value: payload.sumTop20Plays,
          numResults: payload.numResults,
          sumTop20Plays: payload.sumTop20Plays,
          handle: keyword,
          url,
        };
      }
    }
    runtime.delays.bilibili = Math.min(runtime.delays.bilibili * 2, MAX_DELAY_MS);
    bilibiliCookie = '';
    cookie = await ensureBilibiliCookie();
    await sleep(backoff(attempt, 1500));
  }
  warn(`bilibili: no usable search response for "${keyword}"`);
  return null;
}

/* -------------------------------------------------------------------------- */
/* Handle inheritance and collection                                          */
/* -------------------------------------------------------------------------- */

interface ResolvedHandles {
  handles: SourceHandles;
  inheritedFrom: Partial<Record<SourceId, string>>;
}

function resolveHandles(entry: CatalogEntry, catalog: ReadonlyMap<string, CatalogEntry>): ResolvedHandles {
  const chain: CatalogEntry[] = [];
  const seen = new Set<string>();
  let current: CatalogEntry | undefined = entry;
  while (current !== undefined) {
    if (seen.has(current.key)) throw new Error(`catalog parent cycle at "${current.key}"`);
    seen.add(current.key);
    chain.push(current);
    current = current.parent === undefined ? undefined : catalog.get(current.parent);
  }
  const pick = <T>(get: (candidate: CatalogEntry) => T | undefined): { value?: T; from?: string } => {
    for (const [index, candidate] of chain.entries()) {
      const value = get(candidate);
      if (value !== undefined) return index === 0 ? { value } : { value, from: candidate.key };
    }
    return {};
  };
  const github = pick((candidate) => candidate.sources.github);
  const npm = pick((candidate) => candidate.sources.npm);
  const wikipedia = pick((candidate) => candidate.sources.wikipedia);
  const huggingface = pick((candidate) => candidate.sources.huggingface);
  const bilibili = pick((candidate) => candidate.sources.bilibili);
  const inheritedFrom: Partial<Record<SourceId, string>> = {};
  if (github.from !== undefined) inheritedFrom.github = github.from;
  if (npm.from !== undefined) inheritedFrom.npm = npm.from;
  if (wikipedia.from !== undefined) inheritedFrom.wikipedia = wikipedia.from;
  if (huggingface.from !== undefined) inheritedFrom.huggingface = huggingface.from;
  if (bilibili.from !== undefined) inheritedFrom.bilibili = bilibili.from;
  return {
    handles: {
      github: github.value,
      npm: npm.value,
      wikipedia: wikipedia.value,
      huggingface: huggingface.value,
      bilibili: bilibili.value,
    },
    inheritedFrom,
  };
}

function markInherited<T extends { inheritedFrom?: string }>(entry: T, from: string | undefined): T {
  return from === undefined ? entry : { ...entry, inheritedFrom: from };
}

async function collectKey(
  entry: CatalogEntry,
  catalog: ReadonlyMap<string, CatalogEntry>,
  runtime: Runtime,
): Promise<RawKey> {
  const { handles, inheritedFrom } = resolveHandles(entry, catalog);
  const sources: KeySources = {};
  const inherited: SourceId[] = [];

  if (handles.github !== undefined) {
    const result = await collectGithub(handles.github, runtime);
    if (result !== null) {
      sources.github = markInherited(result, inheritedFrom.github);
      if (inheritedFrom.github !== undefined) inherited.push('github');
    }
  }
  if (handles.npm !== undefined) {
    const result = await collectNpm(handles.npm, runtime);
    if (result !== null) {
      sources.npm = markInherited(result, inheritedFrom.npm);
      if (inheritedFrom.npm !== undefined) inherited.push('npm');
    }
  }
  if (handles.wikipedia !== undefined) {
    const result = await collectWikipedia(handles.wikipedia, runtime);
    if (result !== null) {
      sources.wikipedia = markInherited(result, inheritedFrom.wikipedia);
      if (inheritedFrom.wikipedia !== undefined) inherited.push('wikipedia');
    }
  }
  if (handles.huggingface !== undefined) {
    const result = await collectHuggingFace(handles.huggingface, runtime);
    if (result !== null) {
      sources.huggingface = markInherited(result, inheritedFrom.huggingface);
      if (inheritedFrom.huggingface !== undefined) inherited.push('huggingface');
    }
  }
  if (handles.bilibili !== undefined) {
    const result = await collectBilibili(handles.bilibili, runtime);
    if (result !== null) {
      sources.bilibili = markInherited(result, inheritedFrom.bilibili);
      if (inheritedFrom.bilibili !== undefined) inherited.push('bilibili');
    }
  }

  return { key: entry.key, title: entry.title, group: entry.group, sources, inherited };
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

interface DimensionInput {
  key: string;
  value: number;
}

/** Percentile rank of each value: (less + 0.5 × equal) / n, in [0, 1]. */
function percentileRanks(inputs: readonly DimensionInput[]): Map<string, number> {
  const output = new Map<string, number>();
  const total = inputs.length;
  if (total === 0) return output;
  for (const current of inputs) {
    let less = 0;
    let equal = 0;
    for (const other of inputs) {
      if (other.value < current.value) less += 1;
      else if (other.value === current.value) equal += 1;
    }
    output.set(current.key, (less + equal / 2) / total);
  }
  return output;
}

type DimensionMaps = Record<SourceId, Map<string, number>>;

/** Per-signal percentile map over every key that has that signal. */
function buildDimensions(rawKeys: readonly RawKey[]): DimensionMaps {
  const github: DimensionInput[] = [];
  const npm: DimensionInput[] = [];
  const wikipedia: DimensionInput[] = [];
  const huggingface: DimensionInput[] = [];
  const bilibiliResults: DimensionInput[] = [];
  const bilibiliPlays: DimensionInput[] = [];
  for (const raw of rawKeys) {
    const sources = raw.sources;
    if (sources.github !== undefined) github.push({ key: raw.key, value: Math.log10(1 + sources.github.value) });
    if (sources.npm !== undefined) npm.push({ key: raw.key, value: Math.log10(1 + sources.npm.value) });
    if (sources.wikipedia !== undefined) {
      wikipedia.push({ key: raw.key, value: Math.log10(1 + sources.wikipedia.value) });
    }
    if (sources.huggingface !== undefined) {
      huggingface.push({
        key: raw.key,
        value: Math.log10(1 + sources.huggingface.likes) + Math.log10(1 + sources.huggingface.downloads),
      });
    }
    if (sources.bilibili !== undefined) {
      bilibiliResults.push({ key: raw.key, value: Math.log10(1 + sources.bilibili.numResults) });
      bilibiliPlays.push({ key: raw.key, value: Math.log10(1 + sources.bilibili.sumTop20Plays) });
    }
  }
  const resultPercentiles = percentileRanks(bilibiliResults);
  const playPercentiles = percentileRanks(bilibiliPlays);
  const bilibili = new Map<string, number>();
  for (const [key, resultPercentile] of resultPercentiles) {
    const playPercentile = playPercentiles.get(key);
    if (playPercentile !== undefined) bilibili.set(key, (resultPercentile + playPercentile) / 2);
  }
  return {
    github: percentileRanks(github),
    npm: percentileRanks(npm),
    wikipedia: percentileRanks(wikipedia),
    huggingface: percentileRanks(huggingface),
    bilibili,
  };
}

function computeRanks(rawKeys: readonly RawKey[]): Map<string, ComputedKey> {
  const dimensions = buildDimensions(rawKeys);
  const computed = new Map<string, ComputedKey>();
  for (const raw of rawKeys) {
    let weighted = 0;
    let weightSum = 0;
    let available = 0;
    for (const source of SOURCE_IDS) {
      const percentile = dimensions[source].get(raw.key);
      if (percentile === undefined) continue;
      weighted += WEIGHTS[source] * percentile;
      weightSum += WEIGHTS[source];
      available += 1;
    }
    const score = weightSum === 0 ? 0 : roundScore(weighted / weightSum);
    computed.set(raw.key, { score, lowConfidence: available < 2, available });
  }
  return computed;
}

/** Order keys inside each group: normal before low-confidence, score desc, title asc. */
function rankKeys(rawKeys: readonly RawKey[], computed: ReadonlyMap<string, ComputedKey>): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const group of GROUPS) {
    const members = rawKeys.filter((raw) => raw.group === group);
    members.sort((left, right) => {
      const leftComputed = computed.get(left.key);
      const rightComputed = computed.get(right.key);
      const leftScore = leftComputed?.score ?? 0;
      const rightScore = rightComputed?.score ?? 0;
      const leftLow = leftComputed?.lowConfidence ?? true;
      const rightLow = rightComputed?.lowConfidence ?? true;
      if (leftLow !== rightLow) return leftLow ? 1 : -1;
      if (leftScore !== rightScore) return rightScore - leftScore;
      if (left.title !== right.title) return left.title < right.title ? -1 : 1;
      return left.key < right.key ? -1 : 1;
    });
    for (const [index, member] of members.entries()) ranks.set(member.key, index + 1);
  }
  return ranks;
}

/* -------------------------------------------------------------------------- */
/* Snapshot assembly                                                          */
/* -------------------------------------------------------------------------- */

const CATALOG_BY_KEY: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((entry) => [entry.key, entry]));

function assembleDocument(
  collectedAt: string,
  rawKeys: readonly RawKey[],
  computed: ReadonlyMap<string, ComputedKey>,
  ranks: ReadonlyMap<string, number>,
): RankingsDocument {
  const keys: KeyDocument[] = [];
  for (const raw of rawKeys) {
    const score = computed.get(raw.key);
    const rank = ranks.get(raw.key);
    if (score === undefined || rank === undefined) throw new Error(`no rank computed for "${raw.key}"`);
    const missing = SOURCE_IDS.filter((source) => raw.sources[source] === undefined);
    keys.push({
      key: raw.key,
      title: raw.title,
      group: raw.group,
      rank,
      score: score.score,
      lowConfidence: score.lowConfidence,
      inherited: raw.inherited.toSorted(),
      missing,
      sources: raw.sources,
    });
  }
  keys.sort((left, right) => {
    const leftGroup = GROUPS.indexOf(left.group);
    const rightGroup = GROUPS.indexOf(right.group);
    return leftGroup !== rightGroup ? leftGroup - rightGroup : left.rank - right.rank;
  });
  return {
    schemaVersion: 1,
    collectedAt,
    window: { start: WINDOW.start, end: WINDOW.end },
    weights: { ...WEIGHTS },
    sources: SOURCE_IDS.map((source) => ({ id: source, label: SOURCE_LABELS[source], weight: WEIGHTS[source] })),
    keys,
  };
}

/* -------------------------------------------------------------------------- */
/* Generated module and docs renderers                                        */
/* -------------------------------------------------------------------------- */

function renderRankingModule(doc: RankingsDocument): string {
  const lines: string[] = [
    '/**',
    ' * Generated by scripts/rank-logos.ts from reference/rankings.json — do not edit.',
    ' *',
    ' * A compact snapshot of measured online prominence, used only to order the icon',
    " * picker groups: `LOGO_RANKS[key]` is a 1-based rank inside the key's group (vendor",
    ' * and model ranks are independent; 1 is the most prominent). Raw metrics and',
    ' * per-source provenance stay in reference/rankings.json and docs/rankings.md;',
    ' * this module stays tiny because it is inlined into the client bundle.',
    ' *',
    ' * Refresh: pnpm run rank (network; optional proxy) → pnpm run rank:check (offline).',
    ' */',
    '',
    '/** One weighted signal behind the ranks. */',
    'export interface RankingSource {',
    '  readonly id: string;',
    '  readonly label: string;',
    '  readonly weight: number;',
    '}',
    '',
    '/** Collection date of the snapshot (UTC). */',
    `export const RANKING_DATE = '${doc.collectedAt.slice(0, 10)}';`,
    '',
    '/** The five weighted signals behind the ranks. */',
    'export const RANKING_SOURCES: readonly RankingSource[] = Object.freeze([',
  ];
  for (const source of doc.sources) {
    lines.push(`  { id: '${source.id}', label: '${source.label}', weight: ${source.weight} },`);
  }
  lines.push(']);', '', '/** 1-based prominence rank within each group; unranked keys are absent. */');
  lines.push('export const LOGO_RANKS: Readonly<Record<string, number>> = Object.freeze({');
  for (const group of GROUPS) {
    const members = doc.keys.filter((entry) => entry.group === group);
    lines.push(`  // ${group} (${members.length} keys)`);
    for (const member of members) lines.push(`  ${member.key}: ${member.rank},`);
  }
  lines.push('});');
  return lines.join('\n') + '\n';
}

/** Render a markdown table the way oxfmt formats one (aligned, left, min width 3). */
function renderMarkdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((header, index) => {
    let width = Math.max(3, header.length);
    for (const row of rows) width = Math.max(width, row[index]?.length ?? 0);
    return width;
  });
  const renderRow = (cells: readonly string[]): string =>
    '| ' + cells.map((cell, index) => cell.padEnd(widths[index] ?? 3)).join(' | ') + ' |';
  const delimiter = '| ' + widths.map((width) => '-'.repeat(width)).join(' | ') + ' |';
  return [renderRow(headers), delimiter, ...rows.map((row) => renderRow(row))];
}

function inheritedFlag(doc: KeyDocument): string {
  const bySource = new Map<string, SourceId[]>();
  for (const source of SOURCE_IDS) {
    const from = doc.sources[source]?.inheritedFrom;
    if (from === undefined) continue;
    const list = bySource.get(from) ?? [];
    list.push(source);
    bySource.set(from, list);
  }
  const parts: string[] = [];
  if (doc.lowConfidence) parts.push('low-confidence');
  for (const [from, sources] of bySource) parts.push(`inherited ${sources.join(', ')} from ${from}`);
  if (doc.missing.length > 0) parts.push(`missing ${doc.missing.join(', ')}`);
  return parts.length === 0 ? '—' : parts.join('; ');
}

function sourceCell(doc: KeyDocument, source: SourceId): string {
  switch (source) {
    case 'github':
      return doc.sources.github === undefined ? '—' : formatCount(doc.sources.github.value);
    case 'npm':
      return doc.sources.npm === undefined ? '—' : formatCount(doc.sources.npm.value);
    case 'wikipedia':
      return doc.sources.wikipedia === undefined ? '—' : formatCount(doc.sources.wikipedia.value);
    case 'huggingface': {
      const entry = doc.sources.huggingface;
      return entry === undefined ? '—' : `${formatCount(entry.likes)} / ${formatCount(entry.downloads)}`;
    }
    case 'bilibili': {
      const entry = doc.sources.bilibili;
      return entry === undefined ? '—' : `${formatCount(entry.numResults)} / ${formatCount(entry.sumTop20Plays)}`;
    }
  }
}

function renderGroupTable(doc: RankingsDocument, group: Group): string[] {
  const members = doc.keys.filter((entry) => entry.group === group);
  const rows = members.map((entry) => [
    String(entry.rank),
    entry.key,
    entry.title,
    entry.score.toFixed(3),
    sourceCell(entry, 'github'),
    sourceCell(entry, 'npm'),
    sourceCell(entry, 'wikipedia'),
    sourceCell(entry, 'huggingface'),
    sourceCell(entry, 'bilibili'),
    inheritedFlag(entry),
  ]);
  const headers = [
    '#',
    'Key',
    'Title',
    'Score',
    'GitHub followers',
    'npm / week',
    'Wikipedia views',
    'HF likes / downloads',
    'Bilibili results / top-20 plays',
    'Flags',
  ];
  return renderMarkdownTable(headers, rows);
}

function renderRankingsMarkdown(doc: RankingsDocument): string {
  const lines: string[] = [
    '# Visibility ranking snapshot',
    '',
    'The icon picker does not sort its two groups alphabetically. It uses the checked-in',
    'snapshot below — a reproducible mix of GitHub, npm, Wikipedia, Hugging Face and',
    'Bilibili signals — so the marks people actually look for come first. This document',
    'is generated by `pnpm run rank` from [`reference/rankings.json`](../reference/rankings.json);',
    'do not edit it by hand. Edit `scripts/rank-logos.ts` and refresh the snapshot instead.',
    '',
    `- **Collected:** ${doc.collectedAt} (UTC)`,
    `- **Wikipedia window:** ${doc.window.start} → ${doc.window.end} (monthly, user access, English + Chinese summed)`,
    '- **Snapshot:** [`reference/rankings.json`](../reference/rankings.json) — raw values, handles, URLs and provenance',
    '- **Generated ranks:** [`src/logos/ranking.ts`](../src/logos/ranking.ts) — the small `LOGO_RANKS` map inlined into the bundle',
    '',
    '## Method',
    '',
    'Five independent signals are collected per brand key. Model keys use model-specific',
    "handles where one exists and inherit their developer's handle otherwise (marked",
    '`inherited … from …` in the flags column). Every number is measured, never guessed,',
    'and no model or image recognition is involved.',
    '',
  ];
  const signalRows: string[][] = [
    ['GitHub', 'followers of the official organisation', '20%'],
    ['npm', 'weekly downloads of the official SDK/CLI package (maximum across candidates)', '20%'],
    ['Wikipedia', 'monthly pageviews, six months, English + Chinese summed', '25%'],
    ['Hugging Face', 'Σ likes + Σ downloads over the organisation’s models', '20%'],
    ['Bilibili', 'video search result count (capped at 1000) + Σ plays of the first 20 results', '15%'],
  ];
  lines.push(...renderMarkdownTable(['Signal', 'Metric', 'Weight'], signalRows), '');
  lines.push(
    '- Each metric becomes `log10(1 + value)` and is then percentile-ranked across every',
    '  key that has data for that signal (0 = least visible, 1 = most). Hugging Face',
    '  combines `log10(1 + likes) + log10(1 + downloads)` before ranking; Bilibili',
    '  averages the percentiles of the result count and the top-20 play sum.',
    "- A key's score is the weighted mean over the signals it has; weights are",
    '  renormalised over the available ones.',
    '- At least two signals are required for a normal rank. Keys with fewer are',
    '  `low-confidence` and sorted after the normal keys of their group, then by score',
    '  and title.',
    '- Ranks are independent per group, contiguous and start at 1; ties break by title.',
    '',
    '## Limitations',
    '',
    '- Bilibili caps `numResults` at 1000, so the results column saturates; the top-20',
    '  play sum carries most of the discriminating signal.',
    '- Hugging Face listings are capped at 1000 models per query, so very large',
    '  organisations are undercounted.',
    '- A signal that could not be measured is `missing` in the snapshot and shown as',
    '  `—` here; the score is renormalised over what remains.',
    '- GitHub measures organisation followers only — not repositories, stars or',
    '  individual maintainers.',
    '- Wikipedia measures article traffic only (no search interest) and only the',
    '  English and Chinese editions.',
    '- This is a snapshot, not a live ranking: it changes only when `pnpm run rank` is',
    '  re-run and the snapshot is committed.',
    '',
    '## Vendor marks',
    '',
    ...renderGroupTable(doc, 'vendor'),
    '',
    '## Model marks',
    '',
    ...renderGroupTable(doc, 'model'),
    '',
    '## Refresh',
    '',
    '```bash',
    'pnpm run rank        # network; set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY if a proxy is required',
    'pnpm run rank:check  # offline; also part of pnpm run verify',
    '```',
    '',
  );
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Sanity checks                                                              */
/* -------------------------------------------------------------------------- */

function checkSanity(doc: RankingsDocument): string[] {
  const problems: string[] = [];
  const vendors = doc.keys.filter((entry) => entry.group === 'vendor');
  const models = doc.keys.filter((entry) => entry.group === 'model');
  const expectations: ReadonlyArray<{
    label: string;
    members: readonly KeyDocument[];
    top?: { count: number; keys: readonly string[] };
    bottom?: { count: number; keys: readonly string[] };
  }> = [
    { label: 'model top', members: models, top: SANITY.modelTop },
    { label: 'model bottom', members: models, bottom: SANITY.modelBottom },
    { label: 'vendor top', members: vendors, top: SANITY.vendorTop },
    { label: 'vendor bottom', members: vendors, bottom: SANITY.vendorBottom },
  ];
  for (const expectation of expectations) {
    for (const key of expectation.top?.keys ?? []) {
      const entry = expectation.members.find((candidate) => candidate.key === key);
      const count = expectation.top?.count ?? 0;
      if (entry === undefined) problems.push(`${expectation.label}: expected "${key}" to be ranked but it is missing`);
      else if (entry.rank > count)
        problems.push(`${expectation.label}: "${key}" is rank ${entry.rank}, expected top ${count}`);
    }
    for (const key of expectation.bottom?.keys ?? []) {
      const entry = expectation.members.find((candidate) => candidate.key === key);
      const count = expectation.bottom?.count ?? 0;
      const firstBottomRank = expectation.members.length - count + 1;
      if (entry === undefined) problems.push(`${expectation.label}: expected "${key}" to be ranked but it is missing`);
      else if (entry.rank < firstBottomRank) {
        problems.push(`${expectation.label}: "${key}" is rank ${entry.rank}, expected bottom ${count}`);
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Collect mode                                                               */
/* -------------------------------------------------------------------------- */

function reportDocument(doc: RankingsDocument): void {
  const coverage = SOURCE_IDS.map((source) => {
    const count = doc.keys.filter((entry) => entry.sources[source] !== undefined).length;
    return `${source} ${count}/${doc.keys.length}`;
  });
  console.log(`snapshot: ${doc.keys.length} keys, coverage ${coverage.join(', ')}`);
  const lowConfidence = doc.keys.filter((entry) => entry.lowConfidence);
  console.log(
    `low confidence: ${lowConfidence.length === 0 ? 'none' : lowConfidence.map((entry) => entry.key).join(', ')}`,
  );
  const missing = doc.keys.filter((entry) => entry.missing.length > 0);
  console.log(
    `missing signals: ${missing.length === 0 ? 'none' : missing.map((entry) => `${entry.key}(${entry.missing.join('/')})`).join(', ')}`,
  );
  for (const group of GROUPS) {
    const members = doc.keys.filter((entry) => entry.group === group);
    const head = members
      .slice(0, 5)
      .map((entry) => `${entry.rank}. ${entry.key}`)
      .join(', ');
    const tail = members
      .slice(-3)
      .map((entry) => `${entry.rank}. ${entry.key}`)
      .join(', ');
    console.log(`${group}: top [${head}] … bottom [${tail}]`);
  }
}

async function runCollect(): Promise<void> {
  if (
    process.env.NODE_USE_ENV_PROXY !== '1' &&
    process.env.HTTPS_PROXY === undefined &&
    process.env.HTTP_PROXY === undefined
  ) {
    warn('network may be blocked: set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY when a proxy is required');
  }
  const collectedAt = new Date().toISOString();
  const runtime: Runtime = {
    cacheDir: join(CACHE_ROOT, collectedAt.slice(0, 10)),
    delays: { ...BASE_DELAYS },
    githubToken:
      process.env.GITHUB_TOKEN !== undefined && process.env.GITHUB_TOKEN.trim() !== ''
        ? process.env.GITHUB_TOKEN.trim()
        : undefined,
  };
  console.log(`collecting ${CATALOG.length} keys; cache ${runtime.cacheDir}`);
  const rawKeys: RawKey[] = [];
  for (const [index, entry] of CATALOG.entries()) {
    rawKeys.push(await collectKey(entry, CATALOG_BY_KEY, runtime));
    if ((index + 1) % 8 === 0 || index === CATALOG.length - 1) {
      console.log(`collected ${index + 1}/${CATALOG.length} keys`);
    }
  }

  const computed = computeRanks(rawKeys);
  const ranks = rankKeys(rawKeys, computed);
  const doc = assembleDocument(collectedAt, rawKeys, computed, ranks);

  writeFileSync(REFERENCE_PATH, JSON.stringify(doc, null, 2) + '\n');
  writeFileSync(RANKING_TS_PATH, renderRankingModule(doc));
  writeFileSync(DOCS_PATH, renderRankingsMarkdown(doc));
  console.log(`wrote reference/rankings.json (${doc.keys.length} keys)`);
  console.log('wrote src/logos/ranking.ts');
  console.log('wrote docs/rankings.md');
  reportDocument(doc);

  const problems = checkSanity(doc);
  if (problems.length > 0) {
    for (const problem of problems) console.error('error: ' + problem);
    console.error('sanity expectations failed; adjust query handles or coverage — not the ranks');
    process.exitCode = 1;
    return;
  }
  console.log('sanity expectations hold');
}

/* -------------------------------------------------------------------------- */
/* Offline check mode                                                         */
/* -------------------------------------------------------------------------- */

function isSourceId(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCE_IDS as readonly string[]).includes(value);
}

function validateSource<T extends { value: number; handle: string; url: string; inheritedFrom?: string }>(
  value: unknown,
  key: string,
  source: SourceId,
  problems: string[],
  validateExtra: (record: Record<string, unknown>, entry: T) => void,
  build: (record: Record<string, unknown>) => T | null,
): T | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    problems.push(`${key}: source "${source}" must be an object`);
    return undefined;
  }
  const amount = asNumber(value.value);
  const handle = typeof value.handle === 'string' ? value.handle : '';
  const url = typeof value.url === 'string' ? value.url : '';
  if (amount === null || amount < 0) problems.push(`${key}: source "${source}" has no non-negative value`);
  if (handle === '') problems.push(`${key}: source "${source}" has no handle`);
  if (!url.startsWith('http')) problems.push(`${key}: source "${source}" has no URL`);
  if (value.inheritedFrom !== undefined && typeof value.inheritedFrom !== 'string') {
    problems.push(`${key}: source "${source}" has an invalid inheritedFrom`);
  }
  const entry = build(value);
  if (entry === null) {
    problems.push(`${key}: source "${source}" is malformed`);
    return undefined;
  }
  validateExtra(value, entry);
  return entry;
}

function validateDocument(doc: RankingsDocument, problems: string[]): RawKey[] {
  const rawKeys: RawKey[] = [];
  const seen = new Set<string>();
  for (const entry of doc.keys) {
    if (!isRecord(entry) || typeof entry.key !== 'string') {
      problems.push('snapshot contains a malformed key entry');
      continue;
    }
    if (seen.has(entry.key)) {
      problems.push(`snapshot contains duplicate key "${entry.key}"`);
      continue;
    }
    seen.add(entry.key);
    const catalogEntry = CATALOG_BY_KEY.get(entry.key);
    if (catalogEntry === undefined) {
      problems.push(`snapshot contains unexpected key "${entry.key}"`);
      continue;
    }
    if (entry.group !== catalogEntry.group) {
      problems.push(`${entry.key}: group "${String(entry.group)}" != "${catalogEntry.group}"`);
    }
    if (entry.title !== catalogEntry.title) {
      problems.push(`${entry.key}: title "${String(entry.title)}" != "${catalogEntry.title}"`);
    }
    if (!isRecord(entry.sources)) {
      problems.push(`${entry.key}: sources must be an object`);
      continue;
    }
    const rawSources = entry.sources;
    const sources: KeySources = {};
    sources.github = validateSource<GithubSource>(
      rawSources.github,
      entry.key,
      'github',
      problems,
      (record, source) => {
        const parent = record.inheritedFrom;
        if (parent !== undefined && catalogEntry.parent !== parent) {
          problems.push(`${entry.key}: github inheritedFrom "${String(parent)}" is not the catalog parent`);
        }
        if (!Number.isInteger(source.value)) problems.push(`${entry.key}: github followers must be an integer`);
      },
      (record) => {
        const value = asNumber(record.value);
        const handle = typeof record.handle === 'string' ? record.handle : '';
        const url = typeof record.url === 'string' ? record.url : '';
        if (value === null || handle === '' || url === '') return null;
        return {
          value,
          handle,
          url,
          ...(typeof record.inheritedFrom === 'string' ? { inheritedFrom: record.inheritedFrom } : {}),
        };
      },
    );
    sources.npm = validateSource<NpmSource>(
      rawSources.npm,
      entry.key,
      'npm',
      problems,
      (record) => {
        if (!Number.isInteger(asNumber(record.value))) problems.push(`${entry.key}: npm downloads must be an integer`);
      },
      (record) => {
        const value = asNumber(record.value);
        const handle = typeof record.handle === 'string' ? record.handle : '';
        const url = typeof record.url === 'string' ? record.url : '';
        if (value === null || handle === '' || url === '') return null;
        return {
          value,
          handle,
          url,
          ...(typeof record.inheritedFrom === 'string' ? { inheritedFrom: record.inheritedFrom } : {}),
        };
      },
    );
    sources.wikipedia = validateSource<WikipediaSource>(
      rawSources.wikipedia,
      entry.key,
      'wikipedia',
      problems,
      (record, source) => {
        const detail = record.detail;
        if (!isRecord(detail)) {
          problems.push(`${entry.key}: wikipedia detail must be an object`);
          return;
        }
        let sum = 0;
        for (const lang of ['en', 'zh'] as const) {
          const part = detail[lang];
          if (part === undefined) continue;
          if (!isRecord(part)) {
            problems.push(`${entry.key}: wikipedia detail.${lang} must be an object`);
            continue;
          }
          const views = asNumber(part.views);
          if (views === null || !Number.isInteger(views) || views < 0) {
            problems.push(`${entry.key}: wikipedia detail.${lang}.views is invalid`);
            continue;
          }
          if (typeof part.title !== 'string' || part.title === '') {
            problems.push(`${entry.key}: wikipedia detail.${lang}.title is invalid`);
          }
          sum += views;
        }
        if (sum !== source.value) problems.push(`${entry.key}: wikipedia value ${source.value} != detail sum ${sum}`);
      },
      (record) => {
        const value = asNumber(record.value);
        const handle = typeof record.handle === 'string' ? record.handle : '';
        const url = typeof record.url === 'string' ? record.url : '';
        const detail = isRecord(record.detail) ? record.detail : {};
        if (value === null || handle === '' || url === '') return null;
        const parsedDetail: { en?: WikiDetail; zh?: WikiDetail } = {};
        for (const lang of ['en', 'zh'] as const) {
          const part = detail[lang];
          if (!isRecord(part)) continue;
          const views = asNumber(part.views);
          const title = typeof part.title === 'string' ? part.title : '';
          if (views === null || title === '') continue;
          parsedDetail[lang] = { title, views };
        }
        return {
          value,
          handle,
          url,
          detail: parsedDetail,
          ...(typeof record.inheritedFrom === 'string' ? { inheritedFrom: record.inheritedFrom } : {}),
        };
      },
    );
    sources.huggingface = validateSource<HuggingFaceSource>(
      rawSources.huggingface,
      entry.key,
      'huggingface',
      problems,
      (_record, source) => {
        if (source.value !== source.likes + source.downloads) {
          problems.push(`${entry.key}: huggingface value != likes + downloads`);
        }
      },
      (record) => {
        const likes = asNumber(record.likes);
        const downloads = asNumber(record.downloads);
        const value = asNumber(record.value);
        const handle = typeof record.handle === 'string' ? record.handle : '';
        const url = typeof record.url === 'string' ? record.url : '';
        if (likes === null || downloads === null || value === null || handle === '' || url === '') return null;
        return {
          value,
          likes,
          downloads,
          handle,
          url,
          ...(typeof record.inheritedFrom === 'string' ? { inheritedFrom: record.inheritedFrom } : {}),
        };
      },
    );
    sources.bilibili = validateSource<BilibiliSource>(
      rawSources.bilibili,
      entry.key,
      'bilibili',
      problems,
      (_record, source) => {
        if (source.value !== source.sumTop20Plays) problems.push(`${entry.key}: bilibili value != top-20 play sum`);
        if (source.numResults > BILIBILI_RESULT_CAP) problems.push(`${entry.key}: bilibili numResults exceeds its cap`);
      },
      (record) => {
        const numResults = asNumber(record.numResults);
        const sumTop20Plays = asNumber(record.sumTop20Plays);
        const value = asNumber(record.value);
        const handle = typeof record.handle === 'string' ? record.handle : '';
        const url = typeof record.url === 'string' ? record.url : '';
        if (numResults === null || sumTop20Plays === null || value === null || handle === '' || url === '') {
          return null;
        }
        return {
          value,
          numResults,
          sumTop20Plays,
          handle,
          url,
          ...(typeof record.inheritedFrom === 'string' ? { inheritedFrom: record.inheritedFrom } : {}),
        };
      },
    );
    const inherited = SOURCE_IDS.filter((source) => sources[source]?.inheritedFrom !== undefined);
    rawKeys.push({ key: entry.key, title: entry.title, group: catalogEntry.group, sources, inherited });
  }
  for (const catalogEntry of CATALOG) {
    if (!seen.has(catalogEntry.key)) problems.push(`snapshot is missing key "${catalogEntry.key}"`);
  }
  return rawKeys;
}

function loadDocument(problems: string[]): RankingsDocument | null {
  if (!existsSync(REFERENCE_PATH)) {
    problems.push('reference/rankings.json is missing — run `pnpm run rank`');
    return null;
  }
  const parsed = parseJson(readFileSync(REFERENCE_PATH, 'utf8'));
  if (!isRecord(parsed)) {
    problems.push('reference/rankings.json must be a JSON object');
    return null;
  }
  if (parsed.schemaVersion !== 1) problems.push('reference/rankings.json: unsupported schemaVersion');
  if (typeof parsed.collectedAt !== 'string' || Number.isNaN(Date.parse(parsed.collectedAt))) {
    problems.push('reference/rankings.json: collectedAt must be an ISO timestamp');
  }
  if (!isRecord(parsed.window) || parsed.window.start !== WINDOW.start || parsed.window.end !== WINDOW.end) {
    problems.push(`reference/rankings.json: window must be ${WINDOW.start} → ${WINDOW.end}`);
  }
  if (!isRecord(parsed.weights)) {
    problems.push('reference/rankings.json: weights must be an object');
  } else {
    for (const source of SOURCE_IDS) {
      const weight = asNumber(parsed.weights[source]);
      if (weight === null || Math.abs(weight - WEIGHTS[source]) > 1e-9) {
        problems.push(`reference/rankings.json: weight for "${source}" must be ${WEIGHTS[source]}`);
      }
    }
  }
  if (!Array.isArray(parsed.keys)) {
    problems.push('reference/rankings.json: keys must be an array');
    return null;
  }
  for (const entry of parsed.keys) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.title !== 'string') {
      problems.push('reference/rankings.json: every key entry needs string key and title');
      return null;
    }
    if (entry.group !== 'vendor' && entry.group !== 'model') {
      problems.push(`reference/rankings.json: key "${entry.key}" has an invalid group`);
      return null;
    }
  }
  return parsed as unknown as RankingsDocument;
}

async function validateGeneratedModule(doc: RankingsDocument, problems: string[]): Promise<void> {
  if (!existsSync(RANKING_TS_PATH)) {
    problems.push('src/logos/ranking.ts is missing — run `pnpm run rank`');
    return;
  }
  const actual = readFileSync(RANKING_TS_PATH, 'utf8');
  if (actual !== renderRankingModule(doc)) {
    problems.push('src/logos/ranking.ts is stale — run `pnpm run rank`');
  }
  let module: unknown;
  try {
    module = await import(pathToFileURL(RANKING_TS_PATH).href);
  } catch (error) {
    problems.push(`src/logos/ranking.ts cannot be imported: ${String(error)}`);
    return;
  }
  if (!isRecord(module)) {
    problems.push('src/logos/ranking.ts does not export a module namespace');
    return;
  }
  const ranks = module.LOGO_RANKS;
  if (!isRecord(ranks)) {
    problems.push('src/logos/ranking.ts: LOGO_RANKS must be an object');
    return;
  }
  if (Object.keys(ranks).length !== doc.keys.length) {
    problems.push(
      `src/logos/ranking.ts: LOGO_RANKS has ${Object.keys(ranks).length} keys, expected ${doc.keys.length}`,
    );
  }
  for (const entry of doc.keys) {
    if (ranks[entry.key] !== entry.rank) {
      problems.push(`src/logos/ranking.ts: LOGO_RANKS["${entry.key}"] != snapshot rank ${entry.rank}`);
    }
  }
  const date = module.RANKING_DATE;
  const expectedDate = doc.collectedAt.slice(0, 10);
  if (date !== expectedDate) {
    problems.push(`src/logos/ranking.ts: RANKING_DATE ${String(date)} != snapshot date ${expectedDate}`);
  }
}

function validateDocs(doc: RankingsDocument, problems: string[]): void {
  if (!existsSync(DOCS_PATH)) {
    problems.push('docs/rankings.md is missing — run `pnpm run rank`');
    return;
  }
  if (readFileSync(DOCS_PATH, 'utf8') !== renderRankingsMarkdown(doc)) {
    problems.push('docs/rankings.md is stale — run `pnpm run rank`');
  }
}

async function runCheck(): Promise<void> {
  const problems: string[] = [];
  const doc = loadDocument(problems);
  if (doc === null) {
    for (const problem of problems) console.error('error: ' + problem);
    process.exitCode = 1;
    return;
  }
  const rawKeys = validateDocument(doc, problems);
  const docByKey = new Map(doc.keys.map((entry) => [entry.key, entry]));
  const computed = computeRanks(rawKeys);
  const ranks = rankKeys(rawKeys, computed);

  for (const raw of rawKeys) {
    const docKey = docByKey.get(raw.key);
    if (docKey === undefined) continue;
    const result = computed.get(raw.key);
    const rank = ranks.get(raw.key);
    if (result === undefined || rank === undefined) continue;
    if (Math.abs(docKey.score - result.score) > 1e-9) {
      problems.push(`${raw.key}: score ${docKey.score} != recomputed ${result.score}`);
    }
    if (docKey.rank !== rank) problems.push(`${raw.key}: rank ${docKey.rank} != recomputed ${rank}`);
    if (docKey.lowConfidence !== result.lowConfidence) {
      problems.push(
        `${raw.key}: lowConfidence ${String(docKey.lowConfidence)} != recomputed ${String(result.lowConfidence)}`,
      );
    }
    const recomputedInherited = raw.inherited.toSorted().join(',');
    const documentedInherited = Array.isArray(docKey.inherited)
      ? docKey.inherited.filter(isSourceId).toSorted().join(',')
      : '';
    if (recomputedInherited !== documentedInherited) {
      problems.push(`${raw.key}: inherited [${documentedInherited}] != recomputed [${recomputedInherited}]`);
    }
    const recomputedMissing = SOURCE_IDS.filter((source) => raw.sources[source] === undefined).join(',');
    const documentedMissing = Array.isArray(docKey.missing) ? docKey.missing.filter(isSourceId).join(',') : '';
    if (recomputedMissing !== documentedMissing) {
      problems.push(`${raw.key}: missing [${documentedMissing}] != recomputed [${recomputedMissing}]`);
    }
  }

  for (const group of GROUPS) {
    const expectedCount = CATALOG.filter((entry) => entry.group === group).length;
    const groupRanks = doc.keys
      .filter((entry) => entry.group === group)
      .map((entry) => entry.rank)
      .toSorted((left, right) => left - right);
    if (groupRanks.length !== expectedCount) {
      problems.push(`${group}: expected ${expectedCount} ranks, found ${groupRanks.length}`);
      continue;
    }
    for (const [index, rank] of groupRanks.entries()) {
      if (!Number.isInteger(rank) || rank !== index + 1) {
        problems.push(`${group}: ranks are not contiguous and unique (found ${groupRanks.join(', ')})`);
        break;
      }
    }
  }

  for (const problem of checkSanity(doc)) problems.push(problem);
  await validateGeneratedModule(doc, problems);
  validateDocs(doc, problems);

  if (problems.length > 0) {
    for (const problem of problems) console.error('error: ' + problem);
    process.exitCode = 1;
    return;
  }
  const vendorCount = doc.keys.filter((entry) => entry.group === 'vendor').length;
  const modelCount = doc.keys.filter((entry) => entry.group === 'model').length;
  console.log(
    `rankings check: ${doc.keys.length} keys (${vendorCount} vendor, ${modelCount} model), ` +
      `${SOURCE_IDS.length} sources; ranks contiguous, src/logos/ranking.ts and docs/rankings.md match — ok`,
  );
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

if (process.argv.includes('--collect')) {
  await runCollect();
} else if (process.argv.includes('--check')) {
  await runCheck();
} else {
  console.error('usage: tsx scripts/rank-logos.ts --collect|--check');
  process.exitCode = 1;
}
