# Engineering — toolchain, module map, and contribution rules

This document is the contract for the TypeScript toolchain. It replaces the old
"hand-written `.mjs` fragments concatenated by a regex" pipeline with a typed
module graph, a real bundler, a linter/formatter pair and a test runner.

## 1. Toolchain

| Concern             | Tool                                                                                              | Where                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Runtime             | Node.js ≥ 26.13.0 (the Brotli decoder fix landed in 26.12.1, so older 26.x is not acceptable)     | `package.json` (`engines`)              |
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
pnpm run verify:dom   # headless-Edge DOM fixture harness (needs Edge)
pnpm run verify:live  # assert the running GUI serves this exact client.js
pnpm run verify       # typecheck + lint + fmt:check + test + build + check (CI gate)
```

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
src/logos/{intl,cn,vendors}.ts   LOGOS artwork sets (validated by the build)
src/logos/index.ts  LOGOS — the merged set every renderer reads
```

Browser modules (import the modules above; no globals):

```
src/i18n.ts         dshmlLang, dshmlSetLang, dshmlT
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
src/section.ts      DshmlModelIconsSection
src/client.ts       `inject` + `apply` — the bundle entry; owns the composer
                    label and the stylesheet
src/host.ts         host half: volatile Config for the `dsh-model-logos` namespace
```

Dependency direction (no cycles): `types` ← `runtime` ← everything;
`match` ← `resolve` ← `overrides` ← `picker` ← `section` / `decorate` ← `client`;
`logos` ← `overrides`/`picker`/`section`; `i18n` ← `overrides`/`picker`/`decorate`/`client`.

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
