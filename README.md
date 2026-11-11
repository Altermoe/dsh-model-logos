# dsh-model-logos

> 中文版：[README.zh.md](README.zh.md)

Brand marks for the models you actually use — a small plugin for the DeepSeek
Harness (DSH) Web GUI.

![The icon picker: the custom-icon group with a created icon, its rename pencil and the create cell, then auto / no icon / letter tile, vendor and model marks — searchable](docs/preview-picker.png)

## Why icons?

A model picker used to be a short list. Today it is a crowd: DeepSeek, GPT, Claude,
Gemini, Qwen, GLM, Kimi, Doubao, Llama, Mistral… all rendered as the same grey
text. Reading every name is how you find the one you want; recognising a mark is
how you find it without reading. That is the whole case for icons: they move a
choice from recall to recognition.

The place it matters most is the model button in the composer — the control you
look at right before sending a message. The interface answers "which model is
this?" with a string of words. A mark answers it in one glance, the same reason a
phone's home screen is not a list of app names. Model names that differ by a suffix
are also easy to mix up, and the mark catches the mistake before you send.

The button and the menu it opens, mocked at the shipped sizes — a 20px mark beside
each 13px label, on light and dark surfaces:

![The composer model button and the model menu, at shipped sizes on light and dark](docs/preview-composer.png)

Settings → Models makes the point even more plainly. Provider rows show a route id
such as `anthropic` or a display name, the add-provider dropdown lists more of the
same ids, and the model editor is a grid of text inputs. A logo gives every row a
shape you can find without decoding the text, and lets you choose a channel by
sight instead of by spelling.

There is a second, quieter idea in the plugin: **a model can have two brands.** The
_vendor_ is the channel that serves it — OpenRouter, Volcengine, a local relay. The
_model_ is the thing you are talking to — Claude, Qwen, DeepSeek. On an aggregator
row those are two different answers, so they get two different marks, and the
plugin is careful never to pass one off as the other.

## What it looks like

Settings → Models, with the plugin loaded: every official provider row and editor
title reserves a 22px mark seat (filled with the vendor mark; left as empty width
for hand-declared providers) that is **clickable to choose the provider's icon**,
every model row begins with a reserved 22px icon seat (its mark, or a one-click
dashed placeholder), the add-provider `<select>` is replaced by a logo-bearing
combobox, and the plugin's own entry sits in the Settings nav.

![Settings → Models with vendor marks, the 22px model-row icon seats and the add-provider dropdown](docs/preview-settings.png)

The decorated page, rendered from the shipped page markup by the verification
harness — channels are chosen by logo, not by route id.

## What you get

- **The composer and the model picker** — the current model's mark in the composer
  button, on the current model at the top of the picker, and on every option row.
  Clicks, search, check marks and reasoning-effort labels stay with the built-in
  selector. The label itself is redrawn rather than wrapped — the slot holds only one
  label per place — so its component reproduces the model name and the release badge
  the built-in label shows. That is the plugin's one replacement.
- **Settings → Models** — every provider row and provider editor title keeps a
  reserved 22px mark seat: the vendor logo on official channels, empty width on
  hand-declared ones. That seat is a button: clicking it opens the icon picker in
  provider mode, so the vendor icon is configurable exactly like a model's. Every
  model row begins with a model icon in its reserved 22px
  seat (the seat shows a dashed placeholder until an icon is resolved), and a
  logo-bearing combobox replaces the native add-provider `<select>` (the native
  select stays underneath as the source of truth). Both seats are in the DOM before
  the dialog's first paint — the decorator runs from the DOM observer's callback,
  ahead of layout, not from a timer — so reopening Settings never shows an un-seated
  row that then jumps sideways.
- **A Model icons page** — the plugin's own Settings entry lists your providers with
  their current vendor mark and a way to choose or reset it, then lists the models
  from those providers with their current mark and a way to change it.
- **A picker you can always reach** — clicking a model's icon in Settings → Models
  opens it, clicking a provider's mark seat opens it in provider mode, and the Model
  icons page offers both per row, so fixing a wrong guess costs one click and no
  configuration-file editing. The same modal is where custom icons are created,
  renamed and deleted.

Everything else is added around the existing interface, and disabling the plugin
removes the decoration and puts the page back as it was.

## Choosing an icon

Models are matched automatically first — a best-guess "initial" icon from the model
id and name, then from the provider. That is a useful default, not a rule, and every
model can be overridden:

- **Auto** — go back to the automatic choice;
- **No icon** — show no brand mark for that model;
- **Letter icon** — a deterministic colour tile made from the name, for local or
  exotic models that should look intentional rather than pretend to be a brand;
- **Vendor icons** — the company or channel mark (Anthropic, Google, Alibaba,
  ByteDance, OpenRouter, …);
- **Model icons** — the model product mark (Claude, Gemini, Qwen, Doubao, Kimi, …).

**The provider's icon is configurable too.** Clicking the mark seat beside a provider
name in Settings → Models, or the choose button on a provider row of the Model icons
page, opens the same picker in provider mode: pick a vendor mark, a letter tile, or
no icon, and reset back to auto. A hand-declared provider (a relay, a local server)
can pick a shipped mark there too; for artwork of your own, use a custom icon below.

**Custom icons.** The picker's first group is **Custom icons**; its `+ New` cell
opens an editor where you name the icon, pick a local image, and pan/zoom it inside
a square viewport before saving a 128×128 square. The cropped PNG (WebP when it
would exceed the payload budget) is stored in the DSH settings document's
`customIcons` field, and an override references it as `custom:<id>` — the same
document as `modelIcons` / `providerIcons`, so the icons travel with the rest of the
user settings instead of a browser-local store, and no network request is made. A
custom icon works for any model or provider exactly like a brand mark; the pencil on
its cell renames it, and the editor's delete action asks for confirmation and clears
every override that referenced it in the same write, so those rows fall back to auto.

The type tabs at the top of the editor already reserve the follow-up formats:
**Image** works, **Animated** and **Video** are disabled and labelled "Coming soon".
Cropping uses the MIT-licensed
[react-easy-crop](https://github.com/ValentineH/react-easy-crop) rather than a
hand-rolled drag box. Limits: 40 custom icons, 24-character names, 12 MB source
files.

![Create a custom icon: type tabs, name, square crop and zoom; animated/video are labelled "Coming soon"](docs/preview-custom-icon.png)

Provider overrides live in `providerIcons`, model overrides in `modelIcons`, and
user-created icons in `customIcons`, so none of them collide; a provider override
wins over the official channel table, and an unknown channel still falls back to its
deterministic letter tile.

Custom icons come first, then the vendor and model groups, and search covers all of
them at once. Some companies and their models share one graphic (DeepSeek, Mistral,
MiniMax); those marks appear in the model group and the vendor channel rows reuse
the same artwork. Where the two really differ — Anthropic vs Claude, Google vs
Gemini, Alibaba vs Qwen, ByteDance vs Doubao — the picker offers both marks instead
of passing one off as the other.

Within each group, marks are ordered by measured online prominence rather than
alphabetically: a small, reproducible snapshot combines GitHub, npm, Wikipedia,
Hugging Face and Bilibili signals, so the marks people actually look for come
first. The method and raw numbers are in
[`docs/rankings.md`](docs/rankings.md).

Model overrides are pinned to a `provider + model` pair, so two providers serving a
same-named model can show different marks; provider overrides are keyed by the route
id alone. All of it lives in the DSH user settings document (the profile's
`cordis.patch.yml`) — `modelIcons`, `providerIcons` and `customIcons` — next to your
other preferences, not in localStorage, and with no network request involved.

## The honest cases

- **Vendor logos only exist for official channels.** A relay, a self-hosted server
  or a local URL has no vendor brand behind it, so it gets no vendor logo — an
  invented one would be a lie. The name seat is still reserved (empty) so rows line
  up, and every official channel has a mark, falling back to a deterministic letter
  tile for the obscure ones. That empty seat is clickable: the plugin will not
  invent a brand for you, but it will let you pick one.
- **A model with no confident match is not left blank.** The Settings row keeps a
  22px icon seat in place and shows a dashed placeholder in it, always one click
  away from the picker — the name never jumps when the real mark arrives.
- **Names never disappear.** Every button and menu row still carries its name, so the
  interface stays usable even if you do not recognise a mark.

## Install

Install the published package into a DSH profile. The npm tarball carries the
prebuilt `client.js` / `index.js`, so no local build, Node.js toolchain or build
approval is needed:

```sh
dsh plugin --profile web add dsh-model-logos
```

The plugin requires DSH **0.2.2-alpha.3** or newer (below 0.3.0): the Settings
decoration relies on the dialog markup that release line introduced, and the
`engines.dsh` range in `package.json` makes DSH refuse an older host before the
plugin loads.

Alternatively, add the public repository directly. A source install builds the
plugin on your machine — the tracked `prepare` script runs `pnpm run build` — so
it needs Node.js ≥ 24.22.2 and pnpm, and the storefront asks you to approve the
build step once:

```sh
dsh plugin --profile web add github:Altermoe/dsh-model-logos
```

To skip that build without npm, download `dsh-model-logos.tgz` from the
[latest release](https://github.com/Altermoe/dsh-model-logos/releases/latest) and add the file:

```sh
dsh plugin --profile web add ./dsh-model-logos.tgz
```

A local checkout also installs through the Plugin Manager:

```
plugin_manager action=install_bundle target=<absolute path to this directory>
```

Then refresh the Web GUI page. The plugin appears in Plugins as **Model Logos** /
**模型 Logo**; disabling it removes the decoration and restores the plain interface.

## About the artwork

Every mark is a self-contained 24×24 SVG tile — a brand-coloured rounded square with
a glyph that stays legible at the sizes it ships beside UI text: 20px in the composer
label, 22px in Settings → Models and the Model icons page (36px in the icon picker
preview). Nothing is fetched at runtime, so the artwork needs no
network and no external asset.

The shapes are not redrawn by eye. They come from a pinned official vector set —
[`@lobehub/icons-static-svg`](https://github.com/lobehub/lobe-icons) 1.102.0 (MIT),
plus Simple Icons (CC0) for Xiaomi and DeepSeek's own whale from this app's Web front
end — and a checked-in import script fits them into the shared tile. A build check
compares the generated path data with the committed upstream files, so a mark can
only change by changing its source. A few exceptions are marked in the source: Radius
has no official mark, AWS keeps its official smile symbol because the full wordmark
is unreadable at icon sizes, and Xiaomi keeps the Simple Icons "mi". Two marks are
re-derived from their own pinned sources instead of imported: the Zhipu Z from the
official [zai-org/GLM-5](https://github.com/zai-org/GLM-5) logo (Apache-2.0, shared
with GLM) and the Gemini aurora from Lobe's colour mark. Both are committed under
`reference/derived/` and rebuilt offline, so each can only change by changing its
pinned source.

The marks that used to be most wrong were fixed at the source: Claude's irregular
solid burst, Ollama's front-facing llama and Doubao's official female figure replace
the old gear, left-facing silhouette and chat bubble. MiniMax's 2025 waveform and
Mistral's pixel-block M keep their corrected shapes. Brand logos are trademarks of
their owners and appear here only to identify the provider or model in use.

![All the included marks at real sizes, on light and dark surfaces](docs/preview.png)

## Development

The toolchain requires Node.js ≥ 24.22.2 and pnpm (the exact version is pinned by
`packageManager`). `client.js` and `index.js` are generated build output — never edit
them by hand.

```sh
pnpm install          # dependencies; the prepare script also builds both artifacts
pnpm run build        # regenerate client.js + index.js after editing src/**
pnpm run verify       # full gate: types, lint, format, tests, artwork/rank checks, build, artifact check
pnpm run verify:dom   # drive the real bundle against the Settings fixture in headless Edge
pnpm run preview      # render the artwork design sheet into .preview/
pnpm run logo:check   # prove the checked-in marks match the pinned official vectors
pnpm run rank:check   # prove the picker order matches the committed ranking snapshot
```

### Publishing (maintainers)

The npm package is unscoped and public. `pnpm publish` runs `prepublishOnly`
(the full `verify` gate) and packs the generated `client.js` / `index.js`.
pnpm checks that the tree is clean, that the branch is `main` and that it is in
sync with the remote, so commit and push first. A release is one commit that
changes only the `version`, the `docs/engineering.md` verification log and the
release record in `docs/awesome-plugin.md` §8; the npm version, the tag and the
release asset must all name that commit.

```sh
pnpm run verify                                     # gate on the exact release tree
git commit -am "chore: bump the version to X"       # version + release record
git push origin main
git tag -a vX -m "dsh-model-logos X" && git push origin vX
pnpm publish --access public                        # prepublishOnly re-runs verify
pnpm pack                                           # same tree → dsh-model-logos-X.tgz
gh release create vX dsh-model-logos.tgz --title "dsh-model-logos X" --notes-file notes.md
```

`pnpm pack` names the file `dsh-model-logos-<version>.tgz`; rename it to
`dsh-model-logos.tgz` before attaching it. That name is version-free on purpose: `latest/download/`
takes the filename literally, so a version in the name 404s at the next release.
Record its SHA-256 in the release notes.

Bump `version` and cut a matching annotated `v<version>` tag with its GitHub
release before publishing a new version (`v0.6.0`, `0.7.0`, ...). The tag and
the `package.json` version must agree, or the storefront and `dshmarket` show a
version that does not exist on npm.

Afterwards check `pnpm view dsh-model-logos version`, the release page, and verify a
clean-profile install with `dsh plugin --profile web add dsh-model-logos`.

The module map, contribution rules and the verification log are in
[`docs/engineering.md`](docs/engineering.md); the runtime contract and design
decisions are in [`docs/architecture.md`](docs/architecture.md).

## Related

- [`docs/prior-art.md`](docs/prior-art.md) · [中文版](docs/prior-art.zh-CN.md) — how
  this plugin relates to the other DSH icon plugins.
- [`docs/awesome-plugin.md`](docs/awesome-plugin.md) — listing metadata and the
  submission checklist.
