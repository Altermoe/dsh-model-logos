# dsh-model-logos

A DeepSeek Harness (DSH) Web GUI plugin that draws each model's brand mark to the
left of its name in the composer's model selector and in the model picker popup.

![Brand marks at shipped sizes, on light and dark surfaces](docs/preview.png)

The feature is a single contribution to the shipped `conversation.input.model.label`
slot, so the same component renders all three placements the selector uses it for:

| Placement | Where it shows |
| --- | --- |
| `trigger` | the model name in the composer's bottom-right model button |
| `menu` | the current model in the picker's root menu row |
| `option` | every model row inside the picker |

It owns no state, network request, or interaction: clicks, search, focus, check
marks, reasoning-effort labels and accessibility text stay with the shipped
selector. Models the heuristics cannot identify keep the plain catalog name.

## How matching works

`src/match.mjs` is a pure, ordered heuristic over the provider and model identity
the slot exposes (`provider.id`, `provider.name`, `model.id`, `model.name`):

1. **Model-level rules run first.** Tokens in the model id/name win, so an
   aggregator row such as `openrouter / anthropic/claude-sonnet-4.5` shows the
   Claude mark rather than the OpenRouter mark. Examples: `deepseek`,
   `claude|anthropic`, `gpt|o1…o9|chatgpt`, `gemini|gemma`, `qwen|qwq|tongyi`,
   `glm|chatglm|zhipu`, `kimi|moonshot`, `minimax`, `mistral|mixtral`, `llama`,
   `grok|xai`, `doubao|seed`, `ernie|wenxin`, `hunyuan`, `command-r`,
   `sonar|perplexity`, `phi-N`, `nemotron`, `nova|titan`, `step-N`, `yi`.
2. **Provider-level rules are the fallback** for opaque model ids on a known
   provider (`deepseek-account` → DeepSeek, `zai-coding-cn` → GLM/Zhipu,
   `moonshot-ai` → Kimi, `google-vertex` → Gemini, …).
3. **No match → no mark.** The contribution then returns exactly the text the
   shipped label would have rendered.

Matcher keys are a closed set (`LOGO_KEYS`); every key needs artwork in
`src/logos-intl.mjs` or `src/logos-cn.mjs`. `test/match.test.mjs` pins the
classification of the providers configured in this profile plus a matrix of
aggregator and Chinese model ids.

## Artwork

Each brand is a hand-drawn, dependency-free 24×24 SVG tile (brand-coloured
rounded square, flat white glyph) so it renders identically offline and stays
legible at the shipped sizes (14px in the trigger/menu, 16px in option rows).

- `src/logos-cn.mjs` — DeepSeek, Qwen, Zhipu/GLM, Kimi/Moonshot, MiniMax, Doubao,
  Baidu/ERNIE, Tencent/Hunyuan, StepFun, 01.AI.
- `src/logos-intl.mjs` — OpenAI, Claude/Anthropic, Gemini, Meta/Llama, Mistral,
  xAI/Grok, Microsoft, NVIDIA, AWS, Cohere, Perplexity, Hugging Face, Ollama,
  Groq, OpenRouter.

The DeepSeek whale is the official asset shipped with this app
(`reference/deepseek-whale.svg`, taken from the Web front-end favicon); the rest
are vector reconstructions of each brand's official mark, redrawn for offline
use. Reconstructions differ from the official artwork by design: flat fills only,
a uniform tile, and glyphs simplified to survive 14px. The loosest
reconstructions are `cohere`, `perplexity`, `openai`, `groq`, `aws`, `stepfun`,
`minimax`, `tencent`, `kimi` and `baidu`; treat them as brand hints, not official
vector assets. Brand logos are trademarks of their owners and appear here only to
identify the model being used. Replace any mark with an official asset when one is
available under a redistribution-friendly licence.

## Build

`client.js` is generated — never edit it by hand. It inlines `src/match.mjs`,
serializes the artwork from `src/logos-*.mjs`, and wraps `src/label.js` in the
browser module factory.

```sh
node scripts/build-client.mjs          # write client.js
node scripts/build-client.mjs --check  # fail when client.js is stale
node --test "test/*.test.mjs"          # matcher + client contribution tests
node scripts/preview-logos.mjs         # design sheet -> .preview/logos.png
node scripts/preview-logos.mjs --only claude   # one mark, large -> .preview/claude.png
node scripts/verify-live.mjs           # the running GUI serves this exact build
```

`scripts/preview-logos.mjs` renders the marks at shipped sizes on light and dark
surfaces, next to a simulated composer trigger and model menu, and captures the
result with headless Edge. It is a design aid only, not part of the bundle.

`scripts/verify-live.mjs` recomputes the artifact revision the Host serves
(`SHA-1` over the bundle's mtime/ctime/size), fetches
`/plugins/??dsh-model-logos/client.js&rev=<rev>` from the running GUI and checks
the served bytes: a 200 proves the page's HMR transport has published exactly the
build in this directory, without restarting the app.

## Install

The bundle installs into a DSH profile with the Plugin Manager:

```
plugin_manager action=install_bundle target=<absolute path to this directory>
```

Then refresh the Web GUI page. The plugin appears in Plugins as **Model Logos** /
**模型 Logo**; disabling it removes the contribution and restores plain names.

## Implementation notes

- The label slot is `single`. A shipped label (`ui-deepseek-model-label-1017`)
  already occupies the default priority 0, and the slot API rejects two
  contributions at the same priority. This contribution registers at **priority
  -1**, which is the lowest priority and therefore the one that renders.
- Because it shadows that shipped label, it reproduces its visible behaviour: the
  `1017` release badge on the official `DeepSeek-V4.1-Flash` entry
  (`provider.id` `deepseek-account` / `deepseek-official`, `model.id`
  `deepseek-flash`).
- The stylesheet is injected once with a `data-plugin-css` tag and removed when
  the plugin disposes.
- `/model` command popup rows use the command popup's own rendering API, not this
  slot, so they keep plain names.

## Verification log

- Build validation rejects malformed artwork (missing title, non-`<svg>` string,
  `id` attributes, scripts, event handlers, external references) and duplicate keys.
- Matcher tests pin configured providers, aggregator rows, provider fallbacks, and
  the no-match case.
- Client tests load the generated bundle in a minimal DOM/React stand-in and check
  the registration (slot name, priority −1, one contribution) and the rendered
  label tree for a matched model, the release badge, and unknown models.
- Visual check of every mark at 14/16/24/48/96px: `docs/preview.png`.
- Installed into the running Desktop profile (`plugin_manager install_bundle`,
  `application: applied`, row `dsh-model-logos` active). The live Client slot
  inspection reports exactly one `conversation.input.model.label` contribution at
  priority −1 (`active: true`) with the shipped priority-0 label shadowed
  (`active: false`), so the page's component tree is the new one.
- `scripts/verify-live.mjs` fetched the exact artifact the running GUI serves
  (`/plugins/??dsh-model-logos/client.js&rev=d6fbb2d03518`, 26,195 bytes, 25 artwork
  entries), which also confirms the client HMR transport republished this build
  without an app restart.

Not verified from inside the running GUI: this session cannot open the Web page
(it requires the `dsh web` auth token held by the Desktop shell), so the trigger
and popup were checked through the static preview at their real sizes and through
the served-bundle/slot inspection above, not by screenshotting the live page.
