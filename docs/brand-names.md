# Official Chinese brand names

The icon picker draws vendor and model marks from a fixed artwork set. Every mark
has an official English `title` (see `src/logos/`); the Chinese UI may show a
Chinese name **only when the brand owner itself publishes one**. This document is
the source of truth for that overlay, and `src/i18n.ts` must match it.

## Policy

- **Vendor-owned sources only.** A Chinese name is accepted only from the brand
  owner's own Chinese website (`*.cn`, a `/zh*` locale of its own domain), its
  official documentation, an official press release, an official app-store listing
  or the company's own official blog/social account.
- **Community/folk translations are excluded on principle.** Encyclopaedias, wikis,
  CSDN, Zhihu, third-party blogs, news reposts and other people's localisations are
  never evidence. Names such as `克劳德` (Claude), `双子座` (Gemini), `密史脱拉`
  (Mistral), `羊驼` (Llama), `格罗克` (Grok), `开放人工智能` (OpenAI) and `元宇宙`
  (Meta) must not be added, even though they circulate widely.
- **Vendor marks** may use the vendor's official Chinese company/brand name.
  **Model marks** may use a Chinese name only when the _model itself_ is officially
  named that in Chinese; a model does not inherit its company's Chinese name unless
  the vendor presents the two as one brand.
- **When in doubt, stay English.** If no primary source is found, the English title
  stays. Under-inclusion is preferred over a plausible-looking translation.
- Names that are already the official name in Chinese-language contexts are not
  overridden (`Kimi`, `MiniMax`, `DeepSeek`, `Azure`, …).

Research date: **2026-11-06** (Asia/Shanghai), re-checked and extended on
**2026-11-10** with `baiducloud` and on **2026-11-11** with `volcengine`. Every
entry below was checked against a page the brand owner controls; the exact quote
is recorded next to the link.

## Included names

| logoKey      | official English title | official Chinese name | group  | first-party source and quote                                                                                                                                                                   |
| ------------ | ---------------------- | --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alibaba`    | Alibaba                | 阿里巴巴              | vendor | [alibabagroup.com](https://www.alibabagroup.com/zh-CN) — “阿里巴巴集团的使命是让天下没有难做的生意。”                                                                                          |
| `antgroup`   | Ant Group              | 蚂蚁集团              | vendor | [antgroup.com](https://www.antgroup.com/) — “浙江蚂蚁小微金融服务集团股份有限公司正式更名为蚂蚁科技集团股份有限公司，简称蚂蚁集团。”                                                           |
| `aws`        | AWS                    | 亚马逊云科技          | vendor | [amazonaws.cn](https://www.amazonaws.cn/) — “使用亚马逊云科技产品…” “免费试用亚马逊云科技”                                                                                                     |
| `baidu`      | Baidu                  | 百度                  | vendor | [home.baidu.com](https://home.baidu.com/) — “百度公司介绍”                                                                                                                                     |
| `baiducloud` | BaiduCloud             | 百度智能云            | vendor | [cloud.baidu.com/event/brand.html](https://cloud.baidu.com/event/brand.html) — “升级后，面向企业的‘百度开放云’平台将正式使用‘百度智能云’品牌。” Logo释义：“由三原色组成的开放式六边环形标志。” |
| `bytedance`  | ByteDance              | 字节跳动              | vendor | [bytedance.com/zh](https://www.bytedance.com/zh) — “字节跳动是一家全球化科技公司”                                                                                                              |
| `google`     | Google                 | 谷歌                  | vendor | [Google 中国官方博客](https://china.googleblog.com/2006/04/blog-post_2456.html) — “昨天，Google 发布了我们在全球唯一的非英文品牌名称 – 谷歌。”                                                 |
| `microsoft`  | Microsoft              | 微软                  | vendor | [microsoft.com/zh-cn](https://www.microsoft.com/zh-cn) — “微软的数字工具正在帮助…”                                                                                                             |
| `moonshot`   | Moonshot AI            | 月之暗面              | vendor | [moonshot.cn/about](https://www.moonshot.cn/about) — “月之暗面（Moonshot AI）正式成立。”                                                                                                       |
| `nvidia`     | NVIDIA                 | 英伟达                | vendor | [blogs.nvidia.cn](https://blogs.nvidia.cn/) — NVIDIA 官方中国博客首页标题 “NVIDIA 英伟达博客”                                                                                                  |
| `tencent`    | Tencent                | 腾讯                  | vendor | [tencent.com/zh-cn](https://www.tencent.com/zh-cn/about.html) — “腾讯是一家世界领先的互联网科技公司”                                                                                           |
| `volcengine` | Volcengine             | 火山引擎              | vendor | [volcengine.com](https://www.volcengine.com/) — “火山引擎是字节跳动旗下的云与AI服务平台。”                                                                                                     |
| `xiaomi`     | Xiaomi                 | 小米                  | vendor | [mi.com](https://www.mi.com/) — “小米集团隐私政策” “小米商城”                                                                                                                                  |
| `zhipu`      | Zhipu AI               | 智谱                  | vendor | [zhipuai.cn](https://www.zhipuai.cn/) — “智谱（‘公司’；香港联交所股票代码：02513）”                                                                                                            |
| `antling`    | Ant Ling               | 蚂蚁百灵              | model  | [developer.ant-ling.com](https://developer.ant-ling.com/zh-CN/docs/) — “蚂蚁百灵（Ant Ling）是蚂蚁集团开源的大语言模型家族”                                                                    |
| `doubao`     | Doubao                 | 豆包                  | model  | [doubao.com](https://www.doubao.com/) — “关于豆包” “下载豆包电脑版”                                                                                                                            |
| `ernie`      | ERNIE                  | 文心                  | model  | [cloud.baidu.com/wenxin.html](https://cloud.baidu.com/wenxin.html) — “文心一言是百度打造出来的人工智能大语言模型” “文心大模型服务”                                                             |
| `hailuo`     | Hailuo                 | 海螺                  | model  | [minimax.cn](https://www.minimax.cn/news/s2v-01%E5%8F%91%E5%B8%83) — “海螺AI是一台造梦机…”（官方产品/品牌名；API 模型 ID 仍为 `MiniMax-Hailuo-*`）                                             |
| `hunyuan`    | Hunyuan                | 混元                  | model  | [hunyuan.tencent.com](https://hunyuan.tencent.com/) — “腾讯混元”                                                                                                                               |
| `qwen`       | Qwen                   | 千问                  | model  | [阿里云开发者社区（官方）](https://developer.aliyun.com/article/1714078) — “阿里巴巴大模型品牌中文为‘千问大模型’，英文为‘Qwen’…‘通义千问’的名称将不再使用”                                     |
| `stepfun`    | StepFun                | 阶跃星辰              | model  | [stepfun.com/about](https://www.stepfun.com/about) — “# 阶跃星辰（StepFun）”；模型系列名为 “Step”，此标记的标题是公司品牌                                                                      |

## Deliberate review decisions

The overlay was researched in two independent passes and adjudicated against the
primary sources above. Four verdicts differ from the most conservative reading and
are recorded here so a future contributor does not “fix” them into a folk name:

- **`qwen` → 千问, not 通义千问.** Alibaba unified its model/app brand in March
  2026; its own announcement says the “通义千问” name is no longer used. Older
  Alibaba Cloud docs still map Qwen to 通义千问, so both names are official
  historically — the table follows the current official brand. `通义千问` is not
  added as a search alias either.
- **`google` → 谷歌.** Google adopted 谷歌 in 2006 as its only non-English brand
  name, announced on Google China's own official blog (“我们在全球唯一的非英文品牌
  名称 – 谷歌”), and it remains the company's Chinese brand. Google's current
  product pages sometimes use “Google”; that does not revoke the official name.
- **`hailuo` → 海螺 and `stepfun` → 阶跃星辰.** Both marks sit in the picker's model
  group but their titles are brand names, not model IDs: MiniMax brands the Hailuo
  product line 海螺AI in its own Chinese material, and StepFun's official Chinese
  name is 阶跃星辰（its models are “Step”). Their API/model identifiers stay Latin
  (`MiniMax-Hailuo-2.3`, `Step 3.5 Flash`) — only the displayed brand is localized.
- **`baiducloud` → 百度智能云, a separate overlay row from `baidu` → 百度.** The
  cloud business and the consumer search brand are distinct Baidu brands: Baidu
  itself announced the rename on its own brand page (“面向企业的‘百度开放云’平台将
  正式使用‘百度智能云’品牌”), and the mark is the tri-colour open hexagonal ring.
  The two keys must keep separate titles **and** separate Chinese names — `百度`
  colouring the cloud tile, or `百度智能云` colouring search, would misattribute a
  brand the owner keeps apart.

## Names kept in English

### English is already the official name in Chinese-language contexts

The vendor publishes Chinese-language material that keeps the English brand, so an
override would be a rename, not a translation.

| logoKey      | official English title | group  | first-party Chinese-language page using the English name                                                                    |
| ------------ | ---------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `azure`      | Microsoft Azure        | vendor | [azure.microsoft.com/zh-cn](https://azure.microsoft.com/zh-cn/) — “Azure。你的智能云。”                                     |
| `cloudflare` | Cloudflare             | vendor | [cloudflare.com/zh-cn](https://www.cloudflare.com/zh-cn/) — “Cloudflare 是开始构建智能体的最佳平台。”                       |
| `github`     | GitHub                 | vendor | [docs.github.com/zh](https://docs.github.com/zh) — “GitHub 文档”                                                            |
| `openai`     | OpenAI                 | vendor | OpenAI 在所有中文语境中使用拉丁品牌；`开放人工智能` 不是官方名称。                                                          |
| `deepseek`   | DeepSeek               | model  | [deepseek.com](https://www.deepseek.com/) — “DeepSeek 网页版” “和 DeepSeek 对话”                                            |
| `glm`        | GLM                    | model  | [zhipuai.cn](https://www.zhipuai.cn/) — “GLM模型” “GLM-5.3”                                                                 |
| `kimi`       | Kimi                   | model  | [moonshot.cn](https://www.moonshot.cn/) — “立即体验 Kimi”                                                                   |
| `minimax`    | MiniMax                | model  | [minimaxi.com](https://www.minimaxi.com/) — “MiniMax 以‘与所有人共创智能’为使命”                                            |
| `nemotron`   | Nemotron               | model  | [nvidia.cn](https://www.nvidia.cn/) — “代理式 AI 模型 - Nemotron”                                                           |
| `nova`       | Nova                   | model  | [docs.amazonaws.cn](https://docs.amazonaws.cn/sagemaker/latest/dg/nova-fine-tune-1.html) — “Amazon Nova Micro / Lite / Pro” |
| `xiaomimimo` | Xiaomi MiMo            | model  | [mimo.xiaomi.com](https://mimo.xiaomi.com/) — “Xiaomi MiMo-V2.6 系列发布”                                                   |
| `yi`         | Yi                     | model  | [01.ai](https://www.01.ai/) — “发布千亿参数 MoE 模型 Yi-Lightning”                                                          |

### No official Chinese name published

No first-party Chinese name exists for these; the artwork title stays.

- **Vendor:** `anthropic` (Anthropic), `baseten` (Baseten), `cerebras` (Cerebras),
  `cohere` (Cohere), `fireworks` (Fireworks), `groq` (Groq), `huggingface`
  (Hugging Face), `lmstudio` (LM Studio), `meta` (Meta), `ollama` (Ollama),
  `opencode` (OpenCode), `openrouter` (OpenRouter), `radius` (Radius), `together`
  (Together AI), `typesafe` (TypeSafe), `vercel` (Vercel), `xai` (xAI).
- **Model:** `claude` (Claude), `command` (Command), `gemini` (Gemini), `gpt` (GPT),
  `grok` (Grok), `llama` (Llama), `mistral` (Mistral), `perplexity` (Perplexity),
  `phi` (Phi).

## Keeping `src/i18n.ts` in sync

`DSHML_BRAND_NAMES.zh` in `src/i18n.ts` must contain exactly the **Included names**
table above (one entry per row, same characters) and nothing for any key listed
under **Names kept in English**. `DSHML_BRAND_NAMES.en` stays empty: the artwork
titles already are the official English names.

`test/i18n.test.ts` pins the reviewed set, and `scripts/build.ts` rejects a stale
key, an entry that repeats the English title, or a “Chinese” name without a CJK
character. Any future addition needs a first-party citation recorded here first —
never a translation from memory, another product's UI, or a community source.
