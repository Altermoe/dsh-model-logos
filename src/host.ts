/**
 * Host half of the model-logos bundle.
 *
 * The Browser half owns all rendering; this file exists so the plugin becomes a
 * DSH settings namespace: the volatile Config fields are projected into the user
 * settings document, persisted in the profile's `cordis.patch.yml`, and read or
 * written by the browser half through `ctx.configForms.get('dsh-model-logos')`.
 *
 * `modelIcons` is the per-model icon override map:
 *
 *     modelIcons:
 *       deepseek-account:
 *         deepseek-flash: deepseek
 *       volcengine:
 *         doubao-seed-2-1-turbo-260628: doubao
 *
 * `providerIcons` is the per-provider (vendor / channel) override map. It is one
 * level flat because a provider has no model dimension:
 *
 *     providerIcons:
 *       volcengine: qwen
 *       my-local-relay: letter
 *
 * A missing entry means "auto" (the official channel table decides, and a
 * hand-declared provider gets no invented mark); the sentinel value `none` means
 * the user explicitly turned the provider icon off.
 *
 * `customIcons` holds icons the user created in the icon picker. The dictionary
 * key is the generated icon id; a model/provider override references it through
 * the value `custom:<id>`. The image is a cropped data URL (a 128×128 PNG/WebP
 * square produced by the picker), stored here rather than in `localStorage` so
 * the icon travels with the rest of the user's DSH settings and is readable from
 * any browser that opens the same profile:
 *
 *     customIcons:
 *       c-1d2f...:
 *         name: 我的本地模型
 *         kind: image
 *         image: data:image/png;base64,...
 *         createdAt: 1762...
 *
 * `kind` is part of the document shape even though only `image` is accepted
 * today: the picker reserves the same tabs for animated images and short videos,
 * and those kinds will store their payload here when the feature lands.
 *
 * `pnpm run build` compiles this module into the committed `index.js` entry
 * declared by `package.json` `exports["."]`.
 */
import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  /** provider route id → model id → logo key (or `none` / `letter` / `custom:<id>`). */
  modelIcons: z.dict(z.dict(z.string())).volatile(),
  /** provider route id → logo key (or `none` / `letter` / `custom:<id>`). */
  providerIcons: z.dict(z.string()).volatile(),
  /**
   * User-created icons: generated id → { name, kind, image, createdAt }.
   *
   * The image is a data URL, so the field is validated as one: only the three
   * raster types the picker accepts are allowed, and the string stays under the
   * picker's size budget (~128 KiB).
   */
  customIcons: z
    .dict(
      z.object({
        name: z.string(),
        kind: z.string().default('image'),
        image: z
          .string()
          .pattern(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
          .max(131072),
        createdAt: z.number().default(0),
      }),
    )
    .volatile(),
});

/** Host body: nothing to mount; the settings document does the persistence. */
export function apply(): void {}
