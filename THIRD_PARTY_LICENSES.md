# Third-party licenses and artwork provenance

This package is MIT licensed (see [LICENSE](LICENSE)). The brand marks bundled in
`src/logos/official.generated.ts` and `src/logos/manual.ts` are third-party
artwork; the licenses below cover that artwork, and the trademarks remain the
property of their owners. The marks are used only to identify the corresponding
provider or model in the plugin's UI.

## @lobehub/icons-static-svg 1.102.0 — MIT

- Package: `@lobehub/icons-static-svg` 1.102.0
- Upstream: <https://github.com/lobehub/lobe-icons>
- Source files: <https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/>
- License: MIT, copyright © 2023 LobeHub
- Included here: the 46 upstream files committed verbatim under
  `reference/official/` (one `<slug>.svg` per source mark, sha256 pinned in
  `reference/official/manifest.json`), fitted into 24×24 tiles by
  `scripts/import-logos.ts` to produce `src/logos/official.generated.ts`.

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Simple Icons — CC0 1.0 Universal

- Upstream: <https://simpleicons.org> (source: <https://github.com/simple-icons/simple-icons>)
- License: CC0 1.0 Universal (public domain dedication)
- Included here: the Xiaomi "mi" counters in `src/logos/manual.ts` (the
  rounded-square Simple Icons body is replaced by the official orange tile).

## Official brand marks kept in `src/logos/manual.ts`

The following marks are not covered by the licenses above. They are official
brand assets reproduced or approximated only to identify the brand, and the
trademarks remain with their owners:

- **DeepSeek** — official whale glyph from `reference/deepseek-whale.svg`
  (50×50 viewBox), recoloured and fitted into the shared tile.
- **AWS / Nova** — the official smile-arrow symbol (AWS; Nova reuses it because
  there is no distinct official Nova model mark). AWS and the smile symbol are
  trademarks of Amazon.com, Inc.
- **Xiaomi** — the "mi" counters from the Simple Icons Xiaomi mark; Xiaomi and
  Mi are trademarks of Xiaomi Corporation.
- **Radius** — a hand-drawn "R" letterform created for this project (no official
  mark was found).

No artwork in this repository is claimed to be licensed by the brand owners; if
a brand owner asks for removal, replace or remove the mark and regenerate the
artwork module with `pnpm exec tsx scripts/import-logos.ts`.
