# Submitting to awesome-dsh-plugin

Working note for the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
submission. The contract is its
[`contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md),
fetched 2026-11-04 (local copy: `.preview/contributing.md`).

Submission target: **`Altermoe/dsh-model-logos`**, public since 2026-11-04 (GitHub
`created_at` 2026-11-04T07:51:14Z) and carrying the `dsh-plugin` topic. Audited tree: the
0.5.0 changes (vendor/model picker groups, pinned official-vector artwork, ranked icon
order, `assets/icon-180.png`, `screenshots.json`, version 0.5.0) plus the listing metadata,
`LICENSE` and README install section recorded in §3.

Submission pull request: **#11938**, opened 2026-11-04 on
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11938).
The repository is under the 1-day age bar until 2026-11-05T07:51Z, so the Submission gate is
expected to report that one failure until the re-check workflow re-runs the open PR.

## 1. The entry

One file, `data/plugins/Altermoe__dsh-model-logos.yml`. One PR, no other files, and no hand
edits to the generated `README.md` / `README.zh.md`.

```yaml
url: https://github.com/Altermoe/dsh-model-logos
name: Altermoe/dsh-model-logos
category: ui
description:
  en: 'Model brand marks in the composer model selector; vendor and model marks across Settings → Models (provider rows, model rows, the add-provider dropdown); and a per provider/model icon picker that stores overrides in the DSH user settings document.'
  zh: '在输入框的模型选择器中显示模型品牌图标，在「设置 → 模型」页的提供商行、模型行和添加提供商下拉框中显示厂商与模型图标，并提供按提供商/模型覆盖图标的图标选择器，覆盖项保存在 DSH 用户设置文档中。'
icon: https://raw.githubusercontent.com/Altermoe/dsh-model-logos/main/assets/icon-180.png
# tarball: https://github.com/Altermoe/dsh-model-logos/releases/latest/download/dsh-model-logos.tgz
```

Field notes:

- `url` matches the public repository exactly, including owner casing; CI fetches
  `package.json` from it.
- `category: ui` — the section that already holds the closest neighbours
  (`zhangyongshuai56-hub/dsh-model-picker-brand`, `ttmouse/dsh-model-picker`,
  `anonamerjaxon-dev/dsh-model-grid`). `model` is the plausible alternative (Models & Providers);
  the contributors' doc says a near miss is re-filed by a maintainer, not rejected.
- `description.en` is the only required description, one line ending with a period. It contains
  no `: ` (a colon would need quoting) and deliberately claims no counts and no version — the
  artwork set and the package version both move, and the review counts any number against the code.
- `description.zh` is optional; it is included. The settings-navigation glyph ships with the
  plugin, but the entry does not enumerate it: the descriptions cover the marks and the picker.
- The descriptions are single-quoted, as in `Altermoe__dsh-onedev.yml`; needs no escaping either
  way, but the list's entries are consistently quoted.
- `icon` must be a GitHub-hosted **raster** image; the repo's `icon.svg` is refused. It points at
  `assets/icon-180.png` (180×180 PNG, committed; the same mark as `icon.svg`), which is also the
  DSH manifest `"icon"` used by the Plugins page. Do not point it at `docs/preview*.png` — those
  are full screenshots, not a 96 px tile.
- `tarball` is optional and only becomes valid once a release carries the asset. Keep the asset
  name version-free with `latest/download/` (as above), or pin the release tag and then a
  versioned filename is fine. The entry itself carries no version.

## 2. Requirements — status per requirement

| Requirement (contributing.md)                                       | Status             | Evidence / action                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsh.bundle` manifest in `package.json`                             | satisfied          | `package.json` → `dsh.bundle.patch: "./cordis.patch.yml"`. Not a `dsh.client`-only submission, which is the usual rejection reason.                                                                                                                              |
| `cordis.patch.yml` next to `package.json`                           | satisfied          | Root file inserts host entry `id: dsh-model-logos`, `name: dsh-model-logos`.                                                                                                                                                                                     |
| Real, working code, not a placeholder                               | satisfied          | `src/**` (TypeScript sources), `test/**`, `scripts/**`; `client.js` / `index.js` are generated, git-ignored build output.                                                                                                                                        |
| Repo at least 1 day old                                             | **waiting**        | GitHub reports `created_at` 2026-11-04T07:51:14Z, so the bar is met at 2026-11-05T07:51Z. The local history starts 2026-10-27, but CI reads the GitHub creation date. The re-check workflow re-runs open PRs automatically once they age in — no push is needed. |
| Actively maintained                                                 | satisfied for now  | Latest commit 2026-11-04; keep it true after submission.                                                                                                                                                                                                         |
| Add the `dsh-plugin` GitHub topic                                   | satisfied          | Added 2026-11-04 (`gh repo edit --add-topic dsh-plugin`).                                                                                                                                                                                                        |
| Description states what the plugin does, no superlatives            | satisfied by draft | Claims checked against `src/`: composer label (`src/client.ts`), Settings decoration (`src/decorate.ts`), picker and settings page (`src/picker.ts`, `src/section.ts`), persistence (`src/overrides.ts`, `src/host.ts`), navigation glyph (`src/nav-icon.ts`).   |
| Description must be accurate (checked against code)                 | satisfied by draft | Same evidence; the draft omits counts and version on purpose, and the navigation glyph (`src/nav-icon.ts`) is chrome that the descriptions do not enumerate. Re-check if the entry or the feature set changes before submission.                                 |
| Category matches what the plugin does                               | chosen             | `ui`; rationale in §1.                                                                                                                                                                                                                                           |
| Not a meta-package                                                  | satisfied          | Ships its own behaviour: label slot, Settings decorator, combobox, picker, settings page, host `Config`. It is not a dependency list.                                                                                                                            |
| Dependencies resolve to upstream                                    | satisfied          | Only runtime dependency is official `@deepseek-ai/schemastery`; nothing re-uploaded.                                                                                                                                                                             |
| Icon is a GitHub-hosted raster image                                | satisfied          | `assets/icon-180.png` (180×180 PNG) is committed; `package.json` declares `"icon": "assets/icon-180.png"` and the entry points at its GitHub raw URL.                                                                                                            |
| Screenshots, 1–8 images (optional, recommended)                     | satisfied          | `screenshots.json` at the repo root declares `docs/preview-picker.png`, `docs/preview-settings.png` and `docs/preview-composer.png` (3 of the 8 allowed).                                                                                                        |
| npm package (optional)                                              | not published      | Listing does not require it. `package.json` now declares `repository`, so a later publish is linked rather than unattached (§4).                                                                                                                                 |
| One PR, at most 3 entries, one yml file, only its own entry touched | manual             | This submission adds one entry and nothing else.                                                                                                                                                                                                                 |
| Repo is public and installs with `dsh plugin add`                   | **partially**      | The repo is public and `main` carries the manifest and `prepare` build. A clean-profile install (`dsh plugin --profile web add github:Altermoe/dsh-model-logos`) still has to be verified by hand before or during review (§5).                                  |

## 3. Repo-side changes still open

These are repository changes, not PR-to-the-list work; none are required for the yml itself. The
only file this audit adds is this document (`docs/awesome-plugin.md`); it is not part of the
submission PR.

1. **`LICENSE`** — done in this tree: MIT, `Copyright (c) 2026 Altermoe`, matching
   `package.json`'s `"license": "MIT"`.
2. **README install section** — done in this tree: both READMEs now document
   `dsh plugin --profile web add github:Altermoe/dsh-model-logos` before the local
   `plugin_manager ... install_bundle` path, including the source-install build requirement.
3. **Publish path** — done in v0.5.0: the [`v0.5.0` release](https://github.com/Altermoe/dsh-model-logos/releases/tag/v0.5.0)
   carries the prebuilt `dsh-model-logos.tgz` asset (version-free name, so a
   `latest/download/` URL cannot rot), and both READMEs document that install path. The package
   stays `private: true` and is not on npm; see §4 and §8.

## 4. npm, `repository`, and the metadata proposal

Listing is unaffected by npm; publishing only adds a download count. If the package **is**
published, its `repository` field must point back at the repository listed in the entry, or the
two are not linked.

Current state: `repository`, `homepage`, `bugs` and `author` are now declared alongside
`keywords` and the DSH manifest `icon` (`assets/icon-180.png`, the Plugins-page artwork rather
than npm metadata); `private: true`; `license: MIT` with a matching `LICENSE` file.
`private: true` makes `npm publish` refuse; it does not affect `dsh plugin add` from GitHub.

The declarations, for the record:

```jsonc
  "author": "Altermoe <kuroneko7520@outlook.com>",
  "repository": { "type": "git", "url": "git+https://github.com/Altermoe/dsh-model-logos.git" },
  "homepage": "https://github.com/Altermoe/dsh-model-logos#readme",
  "bugs": { "url": "https://github.com/Altermoe/dsh-model-logos/issues" },
```

Only if publishing: remove `"private": true` (or set it to `false`) and optionally add
`"publishConfig": { "access": "public" }` (the name is unscoped, so that is optional). The
LICENSE file now exists. Keep `pnpm-lock.yaml` untouched for these metadata-only fields: none
of them change the dependency graph, so `pnpm install --frozen-lockfile` stays valid.

**`@deepseek-ai/schemastery` and peerDependencies.** The contributing doc _recommends_ declaring
official `@deepseek-ai/*` packages as `peerDependencies`, not `dependencies`, and warns that a
peer range without an explicit prerelease branch silently excludes prerelease builds. This repo
currently has `"@deepseek-ai/schemastery": "^3.18.5"` as a real dependency because `src/host.ts`
imports it and the build keeps it external (`scripts/build.ts`); `docs/architecture.md` records
that the Host resolves it from this package's dependencies. Risk of moving it:

- peer-only assumes the target DSH profile already provides `schemastery` at a compatible version;
  if it does not, the host half fails to load and the settings namespace disappears (icon
  overrides stop saving), which is worse than a dependency.
- a peer range with no prerelease branch (`>=3.18.5 <4.0.0-0`) would silently exclude a
  prerelease `schemastery` if the target harness ships one; an explicit `||` branch would need the
  actual tuple from the target harness, not a guess.
- a dependency → peer move changes the lockfile importer, so the lockfile must change in the same
  commit and the Lead must run the gates.

Recommendation: leave it in `dependencies` unless a clean-profile test proves the host provides
it. The peer-declaration item is "recommended" and not CI-checked; installability comes first.

Optionally, if a minimum harness version is actually known, other entries in the list declare it
as `"dsh": { "engines": { "dsh": ">=0.2.1-rc.2" } }`. This repo has no such floor; do not add one
without verifying it against the shipped slots and services the plugin uses.

**Tarball instead of npm.** Source install executes `prepare` (`simple-git-hooks && pnpm run
build`): Node ≥ 24.22.2, pnpm, devDependencies and the storefront's build approval. To skip that
path, publish to npm (preferred) or attach a prebuilt tarball — **done in v0.5.0**:

1. `pnpm run build` then `pnpm pack`; `client.js` and `index.js` are in the `files` array, so the
   `.tgz` carries the built artifacts.
2. Attach it to a GitHub release as `dsh-model-logos.tgz` (version-free asset name) — `latest/download/`
   takes the filename literally, so a version in the name 404s at the next release. The asset is on
   [`v0.5.0`](https://github.com/Altermoe/dsh-model-logos/releases/tag/v0.5.0); the entry's
   `tarball:` line stays commented out until a listing update is worth a fresh PR (§8).

## 5. Manual steps (human only)

1. Create the public GitHub repository and push `main`; keep `main` as the default branch (the
   `icon` URL assumes it). — **done 2026-11-04**: `main` is the default branch and `origin/main`
   tracks the local `main`.
2. Add the `dsh-plugin` topic to the repository. — **done 2026-11-04**.
3. Land the remaining repo-side items in §3 (LICENSE and the README install command) through the
   normal gate workflow. — **done in this tree**.
4. Wait until GitHub reports the repository as at least 1 day old. CI measures creation, not
   commits; the gate refreshes itself on open PRs, so an early submission is not fatal. — **met**:
   the repository was created 2026-11-04T07:51:14Z.
5. Verify installation on a clean profile: `dsh plugin --profile web add
   github:Altermoe/dsh-model-logos`. If that fails on the build step, publish npm or attach the
   tarball first and test that path. — **still open**; the prebuilt tarball (§8) is the documented
   path that skips the build.
6. Optional: publish to npm (only after §4 metadata and `private` are handled) or cut the
   tarball release and uncomment `tarball:`. — **tarball release done in v0.5.0** (§8); npm publish
   remains open and needs npm auth.
7. Fork `awesome-dsh-plugin`, add exactly `data/plugins/Altermoe__dsh-model-logos.yml` with the
   values in §1, commit that one file, open the PR. Do not edit `README.md` / `README.zh.md` and
   do not regenerate them for the PR. Committing a locally regenerated README is accepted only
   if it matches the data source. — **done 2026-11-04**: PR
   [#11938](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11938) adds exactly
   `data/plugins/Altermoe__dsh-model-logos.yml` on branch `add-dsh-model-logos` of the existing
   fork `Altermoe/awesome-dsh-plugin`, created from a fork main synced to upstream. — **merged
   2026-11-05T17:09Z**: the entry is live upstream and the generated README lists the plugin.
8. If a maintainer applies `held: author`, push the fixes to the same branch and leave one
   comment describing them; do not open a new PR. — not applicable; the PR merged without the label.

## 6. Open questions for the Lead

- Clean-profile install: does `dsh plugin --profile web add github:Altermoe/dsh-model-logos`
  succeed end to end (build approval, Node/pnpm availability)? Not yet tested by hand; the prebuilt
  tarball (§8) is the documented path that skips the build.
- npm publish is still open: it needs npm auth and `"private": true` removed (§4), and nothing in the
  listing depends on it.
- Category `ui` vs `model`: `ui` is chosen because the two nearest entries live there; the
  contributors' doc treats a near miss as maintenance, not a rejection.

## 7. Related entries and duplicate-coverage risk

The review checks whether an entry is already covered. Honest positioning below; the description
in §1 is written to carry the differentiator without claiming novelty.

| Entry                                                                                                          | What it covers                                                                                                                     | Relation to this plugin                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zhangyongshuai56-hub/dsh-model-picker-brand` (`ui`)                                                           | Provider logos and model IDs on the same `conversation.input.model.label` slot; 22 marks; letter monogram fallback. Composer only. | Closest neighbour and the real duplicate-coverage question. Overlap is the composer picker. No Settings → Models decoration, no add-provider combobox, no per-model override picker, no settings page. |
| `koliy82/dsh-rustvy` (`model`)                                                                                 | Vendor marks in the model picker plus mirrored catalog sync.                                                                       | Composer surfaces only; no Settings → Models, no overrides.                                                                                                                                            |
| `prgrmrwy/dsh-sidebar-session-provider-icon` (`ui`)                                                            | Provider + model icons in sidebar session rows.                                                                                    | Different surface; same "provider + model mark" idea.                                                                                                                                                  |
| `ttmouse/dsh-model-picker`, `anonamerjaxon-dev/dsh-model-grid`, `ArcaneOrion/dsh-model-selector-search` (`ui`) | Replace or restyle the model picker itself.                                                                                        | Ours decorates the shipped picker in place instead of replacing it.                                                                                                                                    |

`docs/prior-art.md` has the fuller survey (including the composer-icon competitors that are not on
the list) and the one-line differentiator: Settings → Models coverage, model-level matching, and a
per `provider + model` override picker persisted in the DSH settings document.

## 8. Release record

- **v0.5.0** (2026-11-06) — first tagged release: annotated tag `v0.5.0` on `main`, published as
  <https://github.com/Altermoe/dsh-model-logos/releases/tag/v0.5.0>. The tag and the release name the
  same version as `package.json`.
- The release carries `dsh-model-logos.tgz`, packed from the tagged tree with `pnpm pack`. `client.js`
  and `index.js` are in the `files` array, so the tarball is a prebuilt install that needs no
  `prepare` build; `assets/`, `screenshots.json` and both READMEs travel with it. The release notes
  record the asset's SHA-256.
- Gates on the tagged tree: `pnpm run verify` (73 tests, build + artifact freshness), `pnpm run
  verify:dom` (55/55 assertions), `pnpm run verify:live` (the running GUI served this exact bundle),
  plus the `CI` workflow on the pushed `main` commit.
- **No listing re-push is required for v0.5.0.** The merged entry carries no version, its description
  still matches the released feature set, and its icon and screenshots are fetched from `main`. The
  only optional follow-up is adding `tarball:` to the entry (§4) so storefronts offer the prebuilt
  package instead of the source build — a new one-file PR touching only our own entry, left unopened
  until it is worth the maintainers' review time.
