# GitHub prior art — model / provider logos for DSH

> 中文版：[prior-art.zh-CN.md](prior-art.zh-CN.md)

Survey run 2026-10-27 against GitHub (repos, API search), npm (registry API) and the
DSH plugin indexes, before this repository's first public push. Star counts and
dates are as seen that day. Every entry below was opened and read, not inferred
from a search snippet, unless marked *(unverified)*.

**One-line verdict:** the *composer icons* wheel already exists — seven named
model-icon plugins plus a row of badge/theming plugins draw vendor or model marks
in the DSH Web GUI, all within about two months. But nobody covers this plugin's
combination: **Settings → Models decoration, model-level (not provider-level)
matching, and per-`provider+model` icon overrides with a picker, persisted in
`cordis.patch.yml`.** Ship, but position on those differentiators and cite the
neighbours.

## Closest neighbours

| Plugin | What it decorates | Mark level | Artwork | Configuration / persistence | Overlap with us |
| --- | --- | --- | --- | --- | --- |
| [koliy82/dsh-model-icons](https://github.com/koliy82/dsh-model-icons) | Composer model menu (16 px), composer model button (14 px), `/model` popup; hides a skin's own lockup | model (matched against the provider's mirrored catalog, by model id / display name / id prefix / id shape) | none embedded; provider catalog + `/logos/*.svg` mirrored to a loopback route, painted as a CSS mask | 3 on/off switches on its own settings page → `<profile>\.dsh-model-icons\config.json`; `DSH_MODEL_ICONS_*` env overrides | **Highest.** Same three composer surfaces, model-level matching, a settings page. No Settings → Models coverage, no per-model override, no picker. MIT. |
| [Dogtiti/dsh-plugin-provider-icons](https://github.com/Dogtiti/dsh-plugin-provider-icons) | Composer model menu, trigger, every option row | vendor (exact id → alias → prefix → grey dot) | 24 brands as inline base64 data URIs, sourced from [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) (MIT) | none (edit `LOGOS` in `client.js`) | Matching ladder and offline data-URI idea are close to ours; but vendor-only and composer-only. License shows as "Other" on GitHub — do not assume MIT. |
| [ZG2017/dsh-plugin-model-icons](https://github.com/ZG2017/dsh-plugin-model-icons) | Composer model button only (+ responsive icon-only collapse) | vendor, matched on the **visible model name text** | ~11 brands inlined + sparkle fallback | none | Smallest neighbour; no picker, no overrides. MIT, v0.2.0 targets DSH 0.2.1. |
| [toyvfish/dsh-model-seat](https://github.com/toyvfish/dsh-model-seat) | Replaces the whole composer model seat: trigger, grouped menu with descriptions, search, reasoning slider | vendor (40 brand marks + neutral fallback) | 40 brand SVGs, colour adjustable | 17 appearance settings via the host Config schema → `cordis.patch.yml` | Closest on **persistence** (`cordis.patch.yml`) and a settings page, but the settings are appearance-only; no per-model icon choice. MIT. |
| [hun1315/dsh-msi-icons](https://github.com/hun1315/dsh-msi-icons) | Model selector rows + four-zone relayout, pin/heart, host-side failover routing | vendor | built-in marks + a 16-slot reserved library + user SVG files | `~/.dsh/msi-icons/vendors.json`, `pins.json` (bespoke files) | Overlaps icons and model-row styling; different problem (layout + failover). MIT. |
| [weijianguizhou/dsh-model-provider-badge](https://github.com/weijianguizhou/dsh-model-provider-badge) | Replaces the whole model selector (slot `conversation.input.model`, priority −10) | vendor | official/public SVGs; hash-coloured cloud fallback | none | Selector rewrite, not decoration; no Settings page, no overrides. MIT. |
| [pc439527/dsh-model-provider](https://github.com/pc439527/dsh-model-provider) | Replaces the composer seat with a provider → model → effort drill-down | none yet ("Provider icons" is on its **roadmap**) | — | locale dictionary; no icon config | Shows the space is still open even for selector-rewrite authors. MIT. |
| [Townrain/dsh-model-vendor-badge](https://github.com/Townrain/dsh-model-vendor-badge) | A vendor-logo seat in the composer for the **current** model | vendor | not checked *(unverified)* | not checked | Adjacent; current-model badge rather than per-row marks. |
| [prgrmrwy/dsh-sidebar-session-provider-icon](https://github.com/prgrmrwy/dsh-sidebar-session-provider-icon) | Sidebar session rows: provider logo + 10 px model badge | vendor + model | bundled `@lobehub/icons-static-svg@1.94.0` (MIT) + OpenCode SVG | none | Different surface (sidebar), but proves the "provider logo + model badge" composition. MIT (npm 0.1.7). |
| [maxeone/dsh-plugin-deeptweaks](https://github.com/maxeone/dsh-plugin-deeptweaks) | Visual polish bundle incl. "vector model logos" | vendor/model *(unverified detail)* | not checked | not checked | Bundled feature, not a focused plugin. MIT. |
| [reimu-create/uiopt](https://github.com/reimu-create/uiopt) | Display enhancer: balance, context ring, cache hit rate, **provider icons**, plugin manager | vendor | not checked | not checked | Bundled feature. |

Not model-icon competitors (checked and excluded): app/sidebar branding plugins
(`dsh-custom-logo`, `dsh-brand-custom`), theme/skin plugins, session-icon pickers
(`xieshuaix/dsh-session-icons` — per *session* icon picker), and `dsh-icon-custom`
(browser-tab favicon).

### Settings-page neighbours — and one collision

- [HiSeax/dsh-better-model-setting](https://github.com/HiSeax/dsh-better-model-setting)
  **replaces** the shipped Models page (`settings.section id=models`, order 10) and
  disables `ui-settings-models`. Functional only — providers, reasoning tiers,
  retries, credential dots — **no brand marks**. But it is a collision hazard for
  us: our decorator roots at `[data-shortcut-modal="settings"]` and matches
  provider rows / model rows / `<select>` heuristically, so with the shipped page
  gone the likely outcome is a silent no-op — or a false positive on the
  replacement page's similar markup. It cannot throw, but it can decorate the
  wrong thing; detect the shipped page and skip, or document the
  incompatibility. BSD-3-Clause.
- [yzke/dsh-icon-theme](https://github.com/yzke/dsh-icon-theme) is the closest
  existing *per-item icon override* UX: a Settings → Icons page lists every
  discovered settings/sidebar target, keeps the original by default, and persists
  overrides by stable key. It covers chrome icons, not model marks — but the
  "picker + override + restore original" pattern and its resolution ladder (user
  override → bundled glyph → original → fallback) already exist in this
  ecosystem. MIT.
- [MentonLiu/dsh-any-icon](https://github.com/MentonLiu/dsh-any-icon)
  *(snippet-only)*: Icon Studio panel, upload → 1:1 crop, app / session-row icons
  — not per-model marks.

## What none of them do (our differentiators)

1. **Settings → Models is untouched by every *logo* competitor.** No plugin puts a
   vendor logo on the official provider rows, the provider editor titles, or
   paints the add-provider `<select>` into a logo combobox. The only plugin that
   takes the page over at all is `dsh-better-model-setting`, and it ships no
   logos (see the collision note above); other Settings-page model plugins add
   *data fields*, e.g. a modalities selector.
2. **Model-level brand, not provider-level.** Competitors answer "which channel
   serves this model"; we answer "which brand is this model", so an aggregator row
   `openrouter / anthropic/claude-sonnet-4.5` gets the Claude mark.
3. **Per-`provider+model` icon override with a picker** — Auto / No icon / Letter /
   any shipped brand — stored in the DSH settings document (`cordis.patch.yml`),
   not in `localStorage`, bespoke JSON, or a hardcoded table. No DSH plugin offers
   this for model marks; the override-picker *pattern* exists only for chrome
   (`dsh-icon-theme`: settings/sidebar icons) and per session
   (`dsh-session-icons`).
4. **Deterministic letter tiles** as an honest fallback for exotic/local models,
   plus the dashed "always one click away" placeholder on Settings rows.
5. **No network at all** (offline SVG tiles, no catalog mirroring, no loopback
   route), and **en/zh i18n** on the picker and Settings section.

Caveat: "not found" is not "does not exist". The field is far larger than any
single index: dsh.so indexes ~22k repos (~1,943 under Appearance),
deepseek1024.com ~13.9k plugins, and npm matches ~24k `dsh-` packages. Only
GitHub's repository API and per-repo READMEs were exhaustively searched here;
`awesome-dsh-plugin` and `imsai-sh/awesome-deepseek-harness-plugins` could only be
read through search snippets and `dshbase.com` was not reachable, so a few entries
above are snippet-only. Per-item evidence is verified; the set is not proven
complete.

## Artwork: reuse instead of redrawing?

[`lobehub/lobe-icons`](https://github.com/lobehub/lobe-icons) is MIT ("Copyright ©
2023 LobeHub"), carries 340+ AI model/provider/app brands, and ships static SVG
packages (`@lobehub/icons-static-svg`) plus a CDN. One direct competitor
(Dogtiti) already ships on it, and another (prgrmrwy) bundles its static package —
so it is ecosystem-normal, not novel.

- **Legal:** MIT covers the files, not the marks; the marks remain their owners'
  trademarks. Hand-drawing them buys **no** extra legal safety — the same
  nominative-use / trademark notice is needed either way. The current README's
  trademark paragraph is the right kind of notice; if lobe-icons assets are
  bundled, also carry its MIT text and say so in a NOTICE.
- **Engineering:** the icons are the commodity part. Reusing lobe-icons removes
  alias churn (`gpt-4o`, `claude-sonnet-4.5`, `qwen3…`) and the old hand-maintained
  reconstructions, at the cost of a build-time vendoring step.
- **Decision taken:** vendor the pinned lobe-icons static SVGs into the existing
  24×24 tile frame, keep the import script and provenance note, and keep only the
  few documented manual exceptions. Do not market the artwork as the innovation —
  the override UI and Settings coverage are.

## Before pushing

1. Add a short **Prior art** section to the README, linking the neighbours above
   and stating the two-line differentiator. Do not claim to be the first
   model-logo plugin.
2. Make the *repo/package description* carry the differentiator, because the bare
   names collide semantically: `dsh-model-icons` (koliy82) and
   `dsh-plugin-model-icons` (ZG2017) already exist. `dsh-model-logos` itself is
   free on GitHub and npm (checked 2026-10-27).
3. Consider opening an issue/PR on `koliy82/dsh-model-icons` (the nearest
   neighbour) to offer the override picker, or at least cross-link — that is the
   "don't reinvent the wheel" version of this survey.
4. When publishing, add the `dsh-plugin` GitHub topic and submit to the community
   indexes (`awesome-dsh-plugin`, dsh.so Discover) so the differentiator is
   visible next to the neighbours instead of buried.
5. Coexistence test before release: install next to `dsh-better-model-setting`
   (which replaces the Models page) and confirm the decorator skips cleanly
   instead of throwing or decorating the wrong page; add the result to the
   verification log.
