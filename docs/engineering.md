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
                    isKnownLogoKey, letterTextFor, resolveModelIcon
src/logos/official.generated.ts   LOGOS — marks imported from the pinned Lobe Icons set
src/logos/manual.ts               LOGOS — DeepSeek, Xiaomi, AWS, Radius exceptions
src/logos/groups.ts               groupLogoEntries, filterLogoGroups, SHARED_VENDOR_MARKS
src/logos/ranking.ts              LOGO_RANKS, RANKING_DATE — generated snapshot summary
src/logos/index.ts                LOGOS — the merged set every renderer reads
scripts/import-logos.ts           offline importer/checker for the official artwork
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
                    dshmlResolveFor, dshmlLetterTextFor, dshmlModelMark,
                    dshmlVendorMark, dshmlSetModelIcon, dshmlClearModelIcon,
                    dshmlRefreshCatalog, dshmlScheduleCatalogRefresh,
                    dshmlMountIconStore
src/picker.ts       dshmlOpenIconPicker + the shared picker helpers the settings
                    section reuses (DSHML_LETTER_ICON, DSHML_PICKER_NONE_SVG,
                    dshmlUiCopy, dshmlUiCurrentError, dshmlUiOverrides,
                    dshmlUiOverrideValue, dshmlUiLogo, dshmlUiLetterTile,
                    dshmlUiResolve, dshmlUiUseIconState)
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
```

Dependency direction (no cycles): `types` ← `runtime` ← everything;
`match` ← `resolve` ← `overrides` ← `picker` ← `section` / `decorate` ← `client`;
`logos` ← `overrides`/`picker`/`section`; `i18n` ← `overrides`/`picker`/`decorate`/`nav-icon`/`client`;
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

This record describes the 0.5.0 tree; byte sizes and revision ids are from the run
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
- Grouping tests pin the exact 32 vendor / 24 model key sets, the absence of
  overlaps, search filtering across both groups, caller-supplied localized search
  aliases, the alias glyphs
  (`gpt/openai`, `llama/meta`, `phi/microsoft`, `nemotron/nvidia`, `nova/aws`,
  `ernie/baidu`), and the ranking sanity relations.
- Brand-name tests pin the reviewed official-Chinese-name table (`千问`,
  `蚂蚁百灵`, `亚马逊云科技`, …), that every localized key has artwork and differs
  from the English title, that names without an official Chinese form stay
  English, and that the localized names are searchable in both languages.
- Resolver tests pin override precedence (`brand` / `none` / `letter` / stale
  value), immutability, and per-provider keys.
- Bundle tests load the generated `client.js` in a DOM/React stand-in and check the
  label contribution (slot, priority −1, override rendering, letter and none
  sentinels, the shipped release badge, the localized official brand name in the
  zh locale), the label stylesheet (the composer's 20px mark, the 22px Settings
  base, the 36px picker preview, and the flex-centred label with no paint offset),
  the settings-section registration, and
  that `apply()` disposers remove the stylesheet, listeners and observer.
- `scripts/verify-dom.ts` drives the faithful Settings fixture in headless Edge:
  **63 assertions pass** — vendor logos on official rows/editor titles (including
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
  `pnpm exec tsx scripts/verify-dom.ts --screenshot docs/preview-settings.png --open combobox`
  and `... --screenshot docs/preview-picker.png --open picker` render the decorated
  Settings page and the icon picker from the real generated bundle; `pnpm exec tsx
  scripts/preview-logos.ts --only-set composer --scale 2 --out docs/preview-composer.png`
  renders the composer trigger and model-menu mock at the shipped 20px mark size;
  `pnpm exec tsx scripts/preview-logos.ts --out docs/preview.png` renders the artwork
  sheet. `screenshots.json` lists the three shipped screenshots.
- The navigation glyph is validated twice: `test/nav-icon.test.ts` pins its 16 px
  `currentColor` geometry, the percent-encoded mask URL and the row matcher
  (including the element-name case a real browser reports for SVG children), and
  `scripts/build.ts` refuses a glyph or a stylesheet rule that breaks those
  invariants.
- Live bundle check with `scripts/verify-live.ts` against the running Web GUI:
  `/plugins/??dsh-model-logos/client.js&rev=e81788b19a12` returned the freshly built
  artifact (203,742 bytes served, 56 artwork entries), proving the client HMR
  transport published this exact build without an app restart.
- `pnpm run verify` on the final tree: typecheck, lint (0 errors; warnings are the
  pre-existing `verify-dom.ts` style notes), fmt:check, 75 unit/bundle tests,
  `logo:check`, `rank:check`, build and artifact freshness all pass.
