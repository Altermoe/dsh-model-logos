# Engineering — toolchain, module map, and contribution rules

This document is the contract for the TypeScript toolchain. It replaces the old
"hand-written `.mjs` fragments concatenated by a regex" pipeline with a typed
module graph, a real bundler, a linter/formatter pair and a test runner.

## 1. Toolchain

| Concern             | Tool                                                                                              | Where                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Runtime             | Node.js ≥ 24.22.2 (the Brotli decoder fix landed in 24.22.1, so older 24.x is not acceptable)     | `package.json` (`engines`)              |
| DSH host            | `>=0.2.2-alpha.3 <0.3.0-0` — the range dshmarket and the host gate read                           | `package.json` (`engines.dsh`)          |
| Language            | TypeScript 7 (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) | `tsconfig.json`                         |
| Package manager     | pnpm 12 (pinned by `packageManager`; lockfile committed)                                          | `package.json`, `pnpm-workspace.yaml`   |
| Bundle + host build | esbuild (programmatic API)                                                                        | `scripts/build.ts`                      |
| Script runner       | tsx (Node ESM + TS without a build step)                                                          | `pnpm run build`, `verify:*`, `preview` |
| Unit/bundle tests   | Vitest (node environment)                                                                         | `vitest.config.ts`, `test/**/*.test.ts` |
| DOM verification    | headless Edge driver script                                                                       | `scripts/verify-dom.ts`                 |
| Lint                | oxlint                                                                                            | `.oxlintrc.json`                        |
| Format              | oxfmt (Prettier-compatible options)                                                               | `.oxfmtrc.json`, `.editorconfig`        |
| Commit gate         | simple-git-hooks + lint-staged                                                                    | `package.json`                          |
| CI                  | GitHub Actions                                                                                    | `.github/workflows/ci.yml`              |

## 2. Commands

```bash
pnpm install          # install dependencies (prepare: artifact build + git hooks)
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # oxlint
pnpm run lint:fix     # oxlint --fix
pnpm run fmt          # oxfmt --write .
pnpm run fmt:check    # oxfmt --check .
pnpm test             # vitest run
pnpm run test:coverage
pnpm run build        # generate client.js + index.js (also runs on pnpm install)
pnpm run check        # assert both generated artifacts match their sources
pnpm run logo:check   # offline: re-run the official-artwork importer and compare
pnpm run rank         # refresh the visibility snapshot (network; optional proxy)
pnpm run rank:check   # offline: recompute the snapshot and compare the ranks
pnpm run verify:dom   # headless-Edge DOM fixture harness (needs Edge)
pnpm run verify:live  # assert the running GUI serves this exact client.js
pnpm run verify       # typecheck + lint + fmt:check + test + logo:check + rank:check + build + check
pnpm publish         # prepublishOnly runs verify, then packs the prebuilt artifacts
```

Publishing is a manual step. `pnpm publish` triggers `prepublishOnly`, which runs
the full `verify` gate before the tarball is built; `files` in `package.json`
carries the generated `client.js` / `index.js`, so an npm install needs no local
build. The account, 2FA and tag/release alignment are recorded in the Publishing
section of `README.md`.

`client.js` and `index.js` are **generated, never committed**. They are written
into the package root because the local DSH install loads the bundle from disk,
but they are build output: `.gitignore` excludes them and `pnpm install` (via the
`prepare` script) regenerates them. Never edit them by hand; run
`pnpm run build` after changing a source file and `pnpm run check` to prove the
on-disk artifacts match the sources.

## 3. Output contract

`client.js` is one esbuild IIFE bundle wrapped in the loader contract:

```js
window.__ModuleLoader__.load({
  id: 'dsh-model-logos',
  factory(require) {
    …bundle body…
    return { inject: __dshml.inject, apply: __dshml.apply };
  },
});
```

`require` inside the bundle is the loader's platform-module resolver. `react`,
`react-dom` and `react-dom/client` stay external; everything else is inlined.
`src/runtime.ts` is the only module that touches that `require`.

`index.js` is an ES module with `@deepseek-ai/schemastery` external; the Host
resolves it from this package's dependencies.

## 4. Module map

Type-only module (erased at build time, import from anywhere):

```
src/types.ts        Logo/LogoSet/LogoKey, identities, IconResolution, ModelMark,
                    VendorMark, OverrideDocument, IconState, CatalogState,
                    Cordis context + service surfaces, diagnostics global
src/runtime.ts      React/createElement/createRoot access through the loader's
                    `require`; the only place that touches it
```

Pure modules (no DOM, no network, fully unit-tested):

```
src/match.ts        LOGO_KEYS, MODEL_RULES, PROVIDER_RULES, VENDOR_CHANNELS,
                    VENDOR_RULES, normalizeModelText, labelTexts,
                    matchModelLogo, matchVendorLogo, isOfficialVendorChannel
src/artwork.ts      escapeXml, escapeHtml, letterTile
src/resolve.ts      overrideIcon, withOverride, withoutOverride, flattenOverrides,
                    isKnownLogoKey, letterTextFor, resolveModelIcon,
                    providerOverrideIcon, withProviderOverride,
                    withoutProviderOverride, flattenProviderOverrides,
                    providerLetterTextFor, resolveProviderIcon
src/logos/official.generated.ts   LOGOS — marks imported from the pinned Lobe Icons set
src/logos/manual.ts               LOGOS — the nine derived and hand-drawn exceptions
src/logos/groups.ts               groupLogoEntries, filterLogoGroups, SHARED_VENDOR_MARKS
src/logos/ranking.ts              LOGO_RANKS, RANKING_DATE — generated snapshot summary
src/logos/index.ts                LOGOS — the merged set every renderer reads
src/custom-icons.ts               DSHML_CUSTOM_PREFIX, dshmlCustomIconsOf,
                                  dshmlCustomIconList, dshmlCustomIconIdOf,
                                  dshmlCustomIconKey, dshmlValidateCustomName,
                                  dshmlIsCustomImageDataUrl, dshmlIsAcceptedImageType,
                                  dshmlCropRect, dshmlCustomMarkSvg, dshmlPosterSvg,
                                  dshmlIsCustomPosterDataUrl, dshmlCustomFitsTotalBudget,
                                  dshmlBudgetPlan, dshmlNewCustomIconId, the
                                  name/poster/atlas/document limits
src/motion.ts                     DSHML_MOTION_* budgets, dshmlSampleTimes,
                                  dshmlEffectiveFps, dshmlInitialFrameCount,
                                  dshmlClampRange, dshmlSpriteLayout(Fits),
                                  dshmlNormalizeMotion, dshmlMotionOf, dshmlAtlasSvg,
                                  DSHML_PLAYBACK_SURFACES/DEFAULTS, dshmlPlaybackOf,
                                  dshmlPlayableMarkHtml
scripts/import-logos.ts           offline importer/checker for the official artwork
scripts/derive-marks.ts           --check for reference/derived/ (the Z and the aurora)
scripts/rank-logos.ts             --collect/--check for reference/rankings.json
```

Browser modules (import the modules above; no globals):

```
src/i18n.ts         dshmlLang, dshmlSetLang, dshmlT, DSHML_BRAND_NAMES,
                    dshmlBrandName, dshmlBrandNameAliases
src/ui-css.ts       DSHML_UI_CSS
src/overrides.ts    icon store + settings persistence + catalog store:
                    dshmlIconState, dshmlSubscribeIconState, dshmlUseIconState,
                    dshmlCatalogState, dshmlSubscribeCatalog, dshmlUseModelCatalog,
                    dshmlResolveFor, dshmlResolveProviderFor, dshmlLetterTextFor,
                    dshmlProviderLetterTextFor, dshmlModelMark, dshmlVendorMark,
                    dshmlSetModelIcon, dshmlClearModelIcon, dshmlSetProviderIcon,
                    dshmlClearProviderIcon, dshmlCreateCustomIcon,
                    dshmlRenameCustomIcon, dshmlDeleteCustomIcon,
                    dshmlRefreshCatalog, dshmlScheduleCatalogRefresh,
                    dshmlMountIconStore; also writes customIcons through the same
                    configForms form (optimistic snapshots + Host re-read)
src/picker.ts       dshmlOpenIconPicker (model scope and provider scope) + the shared
                    picker helpers the settings section reuses (DSHML_LETTER_ICON,
                    DSHML_PICKER_NONE_SVG, dshmlUiCopy, dshmlUiCurrentError,
                    dshmlUiOverrides, dshmlUiProviderOverrides,
                    dshmlUiOverrideValue, dshmlUiProviderOverrideValue,
                    dshmlUiLogo, dshmlUiLetterTile, dshmlUiProviderLetterTile,
                    dshmlUiResolve, dshmlUiResolveProvider, dshmlUiUseIconState,
                    dshmlUiCustomIcons, dshmlUiCustomIcon, dshmlUiCustomMark); owns
                    the `自定义` group and the create/rename/delete editor shell
src/custom-icon-editor.ts
                    DshmlCustomIconEditor — name, two type tabs (static / motion),
                    image upload + react-easy-crop viewport + zoom + canvas encode,
                    the motion studio mount, rename and confirm-then-delete;
                    rendered inside the picker's modal shell
src/media-source.ts DshmlMediaSource (drawFrame(ms) + duration + preview URL),
                    dshmlOpenMediaSource, dshmlMediaKindOf, DshmlMediaError — the
                    ImageDecoder path for animated images and the detached
                    `<video>` seek path for videos; both decode into a ≤1024px
                    work canvas
src/sprite.ts       dshmlEncodeMotionIcon, dshmlFitMotionBudget — render frames,
                    compose/encode the atlas + poster, and the fixed quality →
                    frame-count → frame-edge slimming ladder
src/motion-studio.ts
                    DshmlMotionStudio — import / monitor / framing / timeline /
                    sampling / budget / true-size preview state machine
src/playable-mark.ts
                    DshmlPlayableMark, dshmlAttachPlayableMark — the React and
                    plain-DOM playback surfaces (always / hover / never, reduced
                    motion, focus-within)
src/decorate.ts     dshmlMountSettingsDecorator, dshmlDecorateNow,
                    dshmlRequestDecorate
src/nav-icon.ts     DSHML_NAV_MARKER, DSHML_NAV_ICON_SVG, DSHML_NAV_ICON_URL,
                    DSHML_NAV_ICON_CSS, dshmlNavIconLabels, dshmlDecorateNavIcon,
                    dshmlClearNavIcon — this plugin's Settings navigation glyph
                    (the shell has no per-section icon seat, so the rendered row is
                    marked and the glyph painted by the stylesheet)
src/section.ts      DshmlModelIconsSection
src/client.ts       `inject` + `apply` — the bundle entry; owns the composer
                    label and the stylesheet
src/host.ts         host half: volatile Config for the `dsh-model-logos` namespace
                    (modelIcons, providerIcons, customIcons incl. motion, playback)
```

Dependency direction (no cycles): `types` ← `runtime` ← everything;
`match` ← `resolve` ← `overrides` ← `picker` ← `section` / `decorate` ← `client`;
`logos` ← `overrides`/`picker`/`section`; `custom-icons` ← `resolve`/`overrides`/`picker`/`section`;
`motion` ← `custom-icons`/`overrides`/`playable-mark`/`sprite`/`motion-studio`;
`media-source` ← `sprite`/`motion-studio`; `sprite` ← `motion-studio`;
`overrides` ← `custom-icon-editor` ← `picker`; `overrides` ← `playable-mark`
← `client`/`picker`/`section`/`decorate`;
`i18n` ← `overrides`/`picker`/`custom-icon-editor`/`motion-studio`/`decorate`/`nav-icon`/`client`;
`nav-icon` ← `decorate`/`client`.

## 5. Source conventions

- ESM with extensionless relative imports (`./match`); `import type` for
  type-only imports (`verbatimModuleSyntax` is on).
- No `any`. Use `unknown` at boundaries and narrow it. Third-party-shaped values
  (settings snapshots, remote answers, DOM attributes) are the normal case.
- No enums, namespaces or parameter properties (`erasableSyntaxOnly`: every
  construct must be strippable by esbuild).
- `noUncheckedIndexedAccess` is on: index reads are `T | undefined`, so either
  narrow or fall back explicitly — the current code already handles that
  defensively.
- Keep the existing runtime behaviour byte-for-byte equivalent; this migration is
  about types and tooling, not about changing what the plugin does.
- Keep the prose comments and JSDoc descriptions. Convert JSDoc _types_
  (`@param {string} x`) into TypeScript annotations and drop the now-duplicated
  type braces; keep the parameter descriptions.
- Browser modules must not assume Node globals. `document`/`window` guards in the
  existing code stay.
- 120-column lines, single quotes, semicolons — oxfmt enforces it.

## 6. Verification log

This record describes the 0.6.0 tree; byte sizes and revision ids are from the run
that recorded them, not from the current build.

- Build validation rejects malformed artwork (missing title, non-`<svg>` string,
  `id` attributes, scripts, event handlers, external references), duplicate keys,
  missing vendor/model groups, missing or non-contiguous prominence ranks, vendor
  channels that point at a model-only mark, and artwork keys no rule can reach
  (except the documented picker-only vendor marks). It also validates the
  localized brand-name overlay: only known artwork keys, trimmed non-empty values,
  a CJK character in every value, and no entry that merely repeats the official
  English title.
- Brand names are localized from a deliberately narrow table in `src/i18n.ts`:
  only names the brand owner itself publishes in Chinese. `docs/brand-names.md`
  records the primary source for every entry and the policy that excludes
  community translations; `en` is empty because the artwork titles already are
  the official English names. `test/i18n.test.ts` pins the reviewed set exactly,
  so a new name (or a folk translation) cannot ship without changing the pinned
  list and its documented source. The picker shows the localized title in its
  option label/`title`/`aria-label`, the composer mark's tooltip follows it, and
  search matches the artwork key, the official title and every localized name.
- `pnpm run logo:check` re-runs the offline importer against the committed
  `reference/official/` files and fails on a path/title/tile drift; the manifest
  pins each upstream file's sha256 and the Lobe Icons version/license.
- `pnpm run rank:check` recomputes the snapshot from `reference/rankings.json`
  offline and verifies key/group coverage, contiguous unique ranks per group,
  source flags, and exact agreement with `src/logos/ranking.ts` and
  `docs/rankings.md`.
- Matcher tests pin the configured providers, aggregator rows, provider fallbacks,
  the no-match case, all 44 official channel ids, the vendor/model key split, the
  legacy override keys, and the closed `LOGO_KEYS`/artwork invariants.
- Artwork tests pin the letter-tile generator (determinism, safe SVG, CJK text,
  escaping) and the brand marks' inlining rules.
- Grouping tests pin the exact 35 vendor / 24 model key sets, the absence of
  overlaps, search filtering across both groups, caller-supplied localized search
  aliases, the alias glyphs
  (`gpt/openai`, `llama/meta`, `phi/microsoft`, `nemotron/nvidia`, `nova/aws`,
  `ernie/baidu`, `glm/zhipu`), and the ranking sanity relations.
- Brand-name tests pin the reviewed official-Chinese-name table (`千问`,
  `蚂蚁百灵`, `亚马逊云科技`, …), that every localized key has artwork and differs
  from the English title, that names without an official Chinese form stay
  English, and that the localized names are searchable in both languages.
- Resolver tests pin override precedence (`brand` / `none` / `letter` / stale
  value), immutability, and per-provider keys.
- **Provider icons are configurable.** A provider's 22px seat was decoration: the
  only way to give a relay or local server a mark was to edit a config file, and an
  official channel's mark could not be corrected at all. The icon picker now has a
  provider scope (the same modal, retitled `选择厂商图标` / `Choose vendor icon` and
  with a provider-only subtitle) writing to a second, flat `providerIcons` settings
  field, so provider and model overrides cannot collide. `resolveProviderIcon` is the
  single order — override (`brand` / `none` / `letter`) → the official channel table
  → the letter tile for an official channel only, because a declared provider must
  still never borrow a brand it did not declare. Settings → Models keeps the 22px
  seat in every state but makes it a `<button>`: it opens the picker, and only a seat
  whose provider the directory cannot name yet stays inert (disabled, `tabindex=-1`,
  `aria-hidden="true"`) so no override can be written under a guessed route id. The
  Model icons page gains a provider group with the same choose/reset actions.
  `test/resolve.test.ts` and `test/client.test.ts` pin the resolution matrix and the
  settings round-trip; `verify:dom` pins the seat states, the provider-scope modal and
  both write paths.
- Bundle tests load the generated `client.js` in a DOM/React stand-in and check the
  label contribution (slot, priority −1, override rendering, letter and none
  sentinels, the shipped release badge, the localized official brand name in the
  zh locale), the label stylesheet (the composer's 20px mark, the 22px Settings
  base, the 36px picker preview, and the flex-centred label with no paint offset),
  the settings-section registration, and
  that `apply()` disposers remove the stylesheet, listeners and observer.
- `scripts/verify-dom.ts` drives the faithful Settings fixture in headless Edge:
  **89 assertions pass** — vendor logos on official rows/editor titles (including
  the localized DeepSeek account row), none on the declared custom provider but its
  empty 22px name seat, the reserved **22px mark base** for provider-name seats and
  the model-row icon seat (dropping either seat re-inserts it on the same task, so
  the row's text never moves), the **36px picker preview**, model-row buttons and
  the flex model row, the hidden native select, the custom combobox (option marks,
  write-back, bubbling `change`, face re-sync), the picker groups (vendor before
  model, both populated, official Chinese brand labels (`阿里巴巴`, `谷歌`,
  `千问`, …) instead of a community translation, search keeps only the matching
  group), the picker write
  path into `configForms.mutate`, the picker close button (SVG only, no text
  symbol, 16 px glyph centred in the 28 px hit area, `currentColor`), the composer
  label override/`none` rendering, the
  composer mark's geometry in a rebuilt shipped trigger (the 20px box centred on the
  28px hit area, paint box inside the label line box), the plugin's own settings-nav row
  (marked by label, shipped gear hidden, 16 px `currentColor` mask glyph painted, no
  other row marked), full disposal reversibility and observer disconnection.
- **Settings decoration lands before the first paint.** The decorator used to defer
  every pass to a 40 ms `setTimeout`, so the dialog painted one to three frames
  without its seats and then shifted each provider name / model row sideways when
  they arrived — the flash this change removes. A `MutationObserver` callback
  already runs in the microtask checkpoint after the task that made the DOM change,
  i.e. before style, layout and paint, so the decorator now runs the pass
  synchronously for records that touch the dialog (and for the plugin's own mount,
  plus the catalogue / override subscriptions); only unrelated page churn and the
  keystroke-driven refreshes keep the debounce. `verify:dom` pins the contract from
  three sides: the seats exist when `apply()` returns (before any timer can run), a
  dialog mounted after the plugin started is seated before the next task, and a
  seat removed from an open dialog is back one 0 ms task later — all three
  assertions fail on the timer-based code. The synchronous pass performs no layout
  reads, so it cannot force a reflow inside React's commit.
- **The composer mark fills the label's line box, so it needs no optical nudge.** A
  composer label is a 13px/20px line. The mark is a 20px box, exactly the line box,
  inside a `display:flex; align-items:center` row: its centre therefore lands on the
  name's line and on the 28px trigger's hit-area centre, and the paint box cannot
  escape the host's clipping box. The old 22px box plus a paint-only `top: 2px`
  nudge is gone; Settings marks keep the 22px base and the picker preview keeps 36px,
  both centred by their own rows. `verify:dom` pins the geometry against a rebuilt
  shipped trigger (20px box, centre within 1.5px, paint box inside the label line
  box); the bundle test pins the 20px size, the flex label, and that no mark carries
  a paint offset.
- **The picker close button is a drawn glyph, not a text character.** The modal
  rendered `×` as the button's own text, so the mark's ink size, weight and
  position came from whatever system font won the fallback: it could sit off the
  28px hit-area centre or change shape per platform. The button now holds a 16px
  SVG (24-unit `viewBox`, `currentColor` stroke) and centres it as a flex item; the
  stylesheet keeps no `font-size`/`line-height` for the mark. `verify:dom` pins the
  rendered contract (SVG-only button that keeps an accessible label, a 16×16 icon
  centred within 1px of the 28×28 hit area, `currentColor` inheriting the button
  colour); the bundle test pins the flex centring and the absence of font-based
  sizing in the rule.
- **Settings model rows become flex rows.** The host ships `.jrmgQW_modelRow` as a
  grid with four tracks; the plugin used to add a fifth `auto` track so the leading
  icon seat could reserve its 22px. The stylesheet now turns the tagged row into
  `display:flex; flex-direction:row; align-items:center` instead, so the seat leads
  the row without taking a grid track away from the model-ID and display-name inputs,
  and the delete action stays on the same line. `verify:dom` pins the computed
  `flex/row/center` layout and the 22×22 seat, and that disposal restores the host's
  grid row.
- **Settings decoration is write-idempotent.** The decorator re-runs on a
  `MutationObserver` over `document.body`, and re-writing identical markup into its
  own inserted marks (`innerHTML` always replaces children) used to feed that
  observer: every pass scheduled the next, and the vendor/model marks of
  Settings → Models were rewritten ~25 times a second — visibly flashing in the
  devtools inspector and burning a timer for as long as the page stayed open. The
  observer now ignores records that target its own `[data-dshml-owner="1"]` nodes,
  and every mark/text write is compared against the last value written (WeakMap
  bookkeeping), so a no-op pass touches nothing. `verify:dom` pins it: after the
  page settles, a 500 ms quiet window records **0 self-writes and 0 other
  mutations** on the decorated page, while removing an inserted vendor mark (what a
  React re-render does) still wakes the decorator and the mark is re-inserted on the
  next pass.
- Visual check of every mark at the shipped 20 / 22 / 36 px sizes plus a 96 px
  reference: `docs/preview.png`; the vendor marks and the letter-tile fallback at
  the same sizes: `docs/preview-vendors.png`. The historical before/after of
  Claude, Ollama and Doubao (`docs/preview-corrected-marks.png`) is a record from
  the artwork correction: it still renders the size ladder shipped at that time,
  so its 16/14 px samples are history, not the current base. The design sheet also
  renders the plugin's 16 px settings-navigation glyph next to shipped nav icons
  on light and dark surfaces.
- The README preview set is generated from the current build, never hand-captured.
  `pnpm exec tsx scripts/verify-dom.ts --screenshot docs/preview-settings.png --open combobox`,
  `... --screenshot docs/preview-picker.png --open picker`,
  `... --screenshot docs/preview-custom-icon.png --open custom`,
  `... --screenshot docs/preview-motion-studio.png --open motion` and
  `... --screenshot docs/preview-playback-settings.png --open playback` render the
  decorated Settings page, the icon picker, the custom-icon editor, the motion
  sampling studio and the per-surface playback group from the real generated
  bundle; `pnpm exec tsx
  scripts/preview-logos.ts --only-set composer --scale 2 --out docs/preview-composer.png`
  renders the composer trigger and model-menu mock at the shipped 20px mark size;
  `pnpm exec tsx scripts/preview-logos.ts --out docs/preview.png` renders the artwork
  sheet. `screenshots.json` lists the six shipped screenshots.
- The navigation glyph is validated twice: `test/nav-icon.test.ts` pins its 16 px
  `currentColor` geometry, the percent-encoded mask URL and the row matcher
  (including the element-name case a real browser reports for SVG children), and
  `scripts/build.ts` refuses a glyph or a stylesheet rule that breaks those
  invariants.
- **Four artwork corrections: two wrong glyphs, one wrong palette, one missing
  brand.** `zhipu` shipped the Lobe swirl (white dots that read as noise at 22px)
  and `glm` the Lobe `glmv.svg` animal; both now render the official Zhipu mark —
  the zai-org/GLM-5 `resources/logo.svg` black tile (`#2D2D2D`, `rx 6`) with the
  white Z. They share one tile, like `ernie`/`baidu`, but keep their own titles and
  groups (`Zhipu AI` vendor, `GLM` model). `gemini` shipped a flat white star; it
  now carries the official Lobe `gemini-color.svg` aurora quantised into flat,
  id-free cells, because an inlined tile may not carry ids or gradient definitions. `baiducloud` (BaiduCloud, 百度智能云) is new: a vendor mark from Lobe
  `baiducloud-color.svg`, the tri-colour cube with no wordmark. That change took
  the key set from 56 to 57 (33 vendor / 24 model).
- **Three keys moved out of the Lobe import into a pinned derived set.** `zhipu`,
  `glm` and `gemini` are no longer `SOURCE_MARKS`: they are rebuilt offline by
  `scripts/derive-marks.ts` from `reference/derived/`, whose `manifest.json` records
  each file's url, pinned commit or version, sha256 and licence. The Z source is
  `zhipu-z.svg`, the zai-org/GLM-5 `resources/logo.svg` pinned to commit
  `83c03d317378f86f0a012f7c4cd48b6243c7e69b` (Apache-2.0); the aurora source is
  `gemini-aurora.svg`, Lobe `gemini-color.svg` at 1.102.0 (MIT). They are
  hand-derived rather than imported because Lobe 1.102.0 does not carry the Z at
  all, and the Lobe aurora would need the gradient definitions an inlined tile may
  not hold. Both derived files are committed byte-exact against their upstream
  sha256 — one `curl` of the pinned blob would otherwise be the only way to notice a
  silent upstream change.
- `pnpm exec tsx scripts/derive-marks.ts --check` is wired into `pnpm run
  logo:check`: it re-reads the two sources, rebuilds both tiles (the Z and the
  aurora) and fails on drift, so no derived mark can change without its source
  changing. Its guards are numeric, like the Lobe importer's: the Z fit must put the
  mapped glyph bbox centre on (12,12) and inside 0..24, and the aurora quantisation
  must cover every silhouette sample, stay under a per-pixel error bound and keep
  every colour family — asserted in the script, not eyeballed from the assets.
- The Gemini reconstruction is a measured quantisation, not "bands that look
  right". `scripts/derive-marks.ts` reads the pinned aurora, flattens its four-arc
  star outline, and parses the three `userSpaceOnUse` opacity ramps — green
  `#08B962` and red `#F94543` fade to zero over their full axis, yellow `#FABC12`
  over 0.46 of it. It composites them over the `#3186FF` base in document order,
  then quarters the cell with the widest colour spread until the silhouette is
  covered by 40 flat cells (mean colour per cell, adjacent cells overlapping by
  0.06 units so no seam can show the white plate). The script asserts coverage, a
  mean |ΔRGB| bound (9.6 by its own 0.05-unit sampling, hard limit 12) and a
  minimum share for each of the red, yellow, green and blue families, so a
  flat-blue or half-size reconstruction fails the build instead of passing a
  score. Measured independently from the
  shipped `client.js` in a headless browser: mean |ΔRGB| **7.65** at 96 px and
  **7.87** at 384 px, mean ΔE76 **9.5**, silhouette IoU **0.991** against the
  placed source, and every hue family present. The first attempt at this tile
  scored only the pixels it covered, and shipped a star at half the intended size
  whose bands left the green ramp and most of the outline white — the guard is
  therefore coverage plus a full-silhouette error, never a score over covered
  pixels only.
- **Two vendor marks added: LM Studio and Volcengine.** `lmstudio` is imported from
  Lobe `lmstudio.svg` as a white glyph on the app's violet tile
  (`#5B3FD6`) — the two opacity steps in the source already read as the
  streaming-text trail of the app icon. `volcengine` is a manual mark: the official
  two-blue mountain artwork from `reference/volcengine.svg` (the site-header
  vector, `#006AFF`/`#00DCFF`) fitted on a white tile, because the Lobe
  `volcengine-color.svg` still carries older brand hexes. Both live in the vendor
  picker group and in `PICKER_ONLY_KEYS`: neither has a shipped DSH route, so
  nothing may infer them from a provider id. The Chinese name of Volcengine is
  overlaid from its own site (火山引擎), while LM Studio keeps its English title.
  The key set grows 57 → 59 (35 vendor / 24 model).
- The arithmetic is now 47 − `zhipu` − `glm` − `gemini` + `baiducloud` = 45 upstream
  files, + 5 aliases = 50 generated marks, + the 9 `manual.ts` exceptions (`aws`,
  `deepseek`, `gemini`, `glm`, `nova`, `radius`, `volcengine`, `xiaomi`, `zhipu`) =
  **59 keys** (35 vendor / 24 model), which `MANUAL_MARKS` in
  `scripts/fetch-official-logos.ts` pins as an exact set and `assertConfigCoverage`
  enforces as `generated + manual == required`. `pnpm exec tsx
  scripts/fetch-official-logos.ts` reproduces all 46 files under
  `reference/official/` (45 `.svg` + `manifest.json`) byte-identically; the 44
  entries whose sha256 did not change are upstream immutability, not stale pins,
  while `lmstudio.svg` is the one new fetch.
- `zhipu` staying group `vendor` is what keeps `SHARED_VENDOR_MARKS` untouched:
  `glm` sharing its glyph with `zhipu` is a model mark reusing a vendor mark, the
  reverse of the `deepseek`/`mistral`/`minimax` exception the build validates, and
  `zhipu` is not in `VENDOR_CHANNELS` at all, so no vendor channel points at a
  model-only mark. Verified by the build and by the grouping test rather than by
  adding an entry no check reads.
- `baiducloud` is **picker-only**, like `radius` and `typesafe`: a real Baidu
  product mark that no shipped DSH route resolves to. It is therefore in
  `LOGO_KEYS` and in `PICKER_ONLY_KEYS`, and deliberately in no rule target set —
  `matchVendorLogo('baiducloud')`, `'baidu-cloud'` and `'bce'` all return null. If a
  Qianfan channel is ever added, `baidu`/`ernie` remain its marks; nothing may map
  to `baiducloud` by pattern. `test/match.test.ts` pins that closure for every
  picker-only key, not just the new one.
- Live bundle check with `scripts/verify-live.ts` against the running Web GUI:
  `/plugins/??dsh-model-logos/client.js&rev=e81788b19a12` returned the freshly built
  artifact (203,742 bytes served, 56 artwork entries), proving the client HMR
  transport published this exact build without an app restart.
- `pnpm run verify` on the final tree: typecheck, lint (0 errors; warnings are the
  pre-existing `verify-dom.ts` style notes), fmt:check, 93 unit/bundle tests,
  `logo:check`, `rank:check`, build and artifact freshness all pass.
- **User-created icons.** The picker's `自定义` group creates an icon from a local
  image: the editor names it, crops it square through `react-easy-crop` (MIT) and a
  canvas encode, then writes `customIcons[id]` and the overriding `custom:<id>` value
  in one settings write. The icon is stored in the same volatile-config document as
  the overrides (never localStorage), rendered as a 24×24 `<svg><image href="data:…">`
  whose image is clipped by `clip-path: inset(0 round 25%)` — the same 6/24 corner
  radius as every brand plate, so the tile rounds by 5px at 20px, 5.5px at 22px and
  9px at 36px. Every mark surface keeps its string contract, and the icon is
  removable together with every reference in one `mutate` batch. Type tabs for
  animated images and video are rendered disabled with the `即将实现` label; the
  persisted `kind` field reserves their
  document shape. The crop rectangle is clamped and the payload validated in
  `src/custom-icons.ts`; `test/custom-icons.test.ts` pins the id/sentinel parsing,
  name rules, document hardening (hostile shapes, `__proto__`, unknown kinds),
  payload limits, crop geometry, ordering and the escaped SVG tile.
  `test/resolve.test.ts` pins the `custom:<id>` resolution branch and its
  malformed-value fallback; `test/client.test.ts` pins the composer mark for a
  persisted custom icon, the bare-name fallback for a deleted reference, the state
  adoption of the `customIcons` field and the settings-form round-trip.
  `scripts/verify-dom.ts` drives the whole user flow through the rendered UI: the
  custom group and create cell, the three tabs and the disabled/annotated pair, the
  name field and hidden file input, a real PNG File through `DataTransfer`, the live
  cropper crop area, the create write validating `custom:<id>` and the persisted data
  URL, the model row's `<image>` mark, the selected custom cell, the rename write
  (`customIcons[id].name` only), the confirm-then-delete write that unsets the icon
  and its model reference, the fallback mark afterwards, and the Model icons page
  preview of a stored custom icon. The harness also publishes a watchdog result when
  a driver step throws, so a broken run reports its collected assertions instead of an
  empty dump. `pnpm run verify:dom` passes **115 assertions** on the final tree.
- **Motion icons.** The `动态` tab samples animated images (ImageDecoder) and
  short videos (a detached muted `<video>` + frame-accurate seeks) through one
  `drawFrame(ms)` source interface. Sampling is capped at 2 s / 24 frames / 128 px;
  `src/sprite.ts` renders each distinct frame count once, composes the horizontal
  atlas, encodes WebP (PNG fallback) and walks the quality → frame-count →
  frame-edge ladder until the atlas fits 128 KiB. The poster is frame 0 encoded at
  128 px and capped at 32 KiB; the whole document is capped at 3 MiB by
  `dshmlCreateCustomIcon`. A stored `motion` record is validated by
  `dshmlNormalizeMotion` on every read; any invalid field drops only the animation
  and keeps the icon. `test/motion.test.ts` pins the sampling maths, sprite
  geometry, validation, the playing SVG and the playback-markup decision tree;
  `test/custom-icons.test.ts` pins motion parsing/fallback, the poster cap and the
  document budget; `test/client.test.ts` pins the composer's playing poster and
  the adopted per-surface policy. `scripts/verify-dom.ts` drives the whole motion
  flow from the rendered UI: two enabled tabs, a real four-frame GIF through
  ImageDecoder, the timeline / strip / true-size previews, a frame-count change,
  the saved `image` + `motion` (6 frames, 128 px, 7.5 fps), the picker's
  poster → hover → poster sequence, the four-surface playback group, the Settings
  row playing under `always`, staying still under `never` even on hover, and the
  composer playing under its default policy. `pnpm run verify:dom` passes
  **140 assertions** on the final tree.
- The provider-icon contract is pinned from four sides. `test/resolve.test.ts` pins
  the precedence matrix (override → official channel → letter tile, and a declared
  provider resolving to nothing), the flat document's immutable edits and its
  `__proto__`-safe reads. `test/client.test.ts` pins the `providerIcons` round-trip
  through `configForms.mutate` and that a legacy document carrying only `modelIcons`
  still reaches `status: 'ready'`. `verify:dom` pins the seat's three states — marked
  (svg + `data-dshml-vendor`), known-but-unmarked (empty, clickable, identity in
  `data-dshml-seat-provider`), and unresolved (disabled + `tabindex="-1"` +
  `aria-hidden="true"`, captured synchronously inside `apply()` before the directory
  resolves) — the provider-scope modal (`选择厂商图标`, subtitle naming the channel and
  never a model id), both write paths (`['providerIcons', id]` set/unset), and the
  Model icons page's provider group with its per-scope summary counts. Those
  assertions were mutation-tested against the bundle: deleting the
  known-but-unmarked branch fails exactly three of them, and renaming the summary
  hook fails exactly one.
- **The 0.6.0 release run.** `pnpm run verify` on the release tree: typecheck, lint
  (0 errors; the warnings are the pre-existing `verify-dom.ts` style notes),
  fmt:check, **95/95 unit/bundle tests**, `logo:check` (44 upstream files + 5
  aliases → 49 generated marks, 8 manual marks, 57 keys), `derive-marks --check`
  (2 pinned sources → 3 marks), `rank:check` (57 keys over 5 sources), build
  (`client.js` 230,684 bytes, `index.js` 448 bytes) and artifact freshness.
  `pnpm run verify:dom` **89/89 assertions** in headless Edge; `pnpm run verify:live`
  against the running Web GUI served `rev=03054869bb7f` (230,756 bytes, 57 artwork
  entries). `package.json` `0.6.0`, the annotated tag `v0.6.0`, the npm tarball
  (`prepublishOnly` re-ran `verify`) and the release asset packed with `pnpm pack`
  all come from that one commit: the release commit itself changes nothing but
  `package.json`, this record and `docs/awesome-plugin.md` §8.

- **The Model icons page lists the signed-in account models.** `deepseek-account`
  keeps its model list outside the settings document (the signed-in account
  `/models` listing), so the page could show its provider row but never a
  per-model row to pick an icon for. `src/overrides.ts` now injects
  `remote.session` and merges `session.modelCatalog().groups` into the catalog
  after the settings-document lists and before the persisted overrides: settings
  names and order still win, while live-only models (the account route first)
  gain their own rows, and a model that already has an override keeps its
  advertised name instead of falling back to the bare model id. The live read
  starts in parallel and lands in a second publish on the first load, so the
  provider seats and the settings-backed rows never wait on the account
  listing; a missing service or a failed read degrades to the previous
  catalog.
  `test/client.test.ts` pins the merge, the source ordering and the rendered
  account row; `verify:dom` pins the rendered row, opening the model-scope
  picker from it and the `modelIcons[deepseek-account][<model id>]` write.
  `pnpm run verify` passes 124 tests; `pnpm run verify:dom` passes 115
  assertions.

- **The Model icons page keeps its own marks.** The decorator's provider-name rule
  accepted a row's leaf-span name header on that page as an editor title (a leaf
  span in a two-child header, no action buttons beside it), so it inserted a second
  22px vendor seat into the name's column flex — every provider row showed a
  duplicate icon stacked above its name, next to the row's own mark. The page root
  now carries `data-dshml-section="1"` and the pass skips its spans, also dropping a
  seat left by a hot-reloaded build. `test/client.test.ts` pins the marker on the
  rendered root; `verify:dom` mounts a section-shaped row inside the Settings dialog
  and proves no seat is inserted into it (with the guard disabled that assertion
  reports exactly one seat). `pnpm run verify` passes 125 tests;
  `pnpm run verify:dom` passes 117 assertions.
