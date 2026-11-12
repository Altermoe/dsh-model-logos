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
 *         image: data:image/png;base64,...      # 128×128 poster
 *         motion:                               # optional sampled animation
 *           atlas: data:image/webp;base64,...   # frames × 128 wide, 128 high
 *           frames: 24
 *           fps: 12
 *           frameWidth: 128
 *         createdAt: 1762...
 *
 * `motion` is additive: an older client ignores it and renders `image`, and a
 * corrupt atlas is dropped by the browser parser while the poster stays. The
 * per-surface playback policy is a second volatile field:
 *
 *     playback:
 *       composer: always
 *       settings: hover
 *       iconsPage: hover
 *       picker: hover
 *
 * `kind` is part of the document shape even though only `image` is accepted
 * today: a motion icon is still an image payload (poster + atlas), so no new kind
 * value is introduced.
 *
 * `pnpm run build` compiles this module into the committed `index.js` entry
 * declared by `package.json` `exports["."]`.
 */
import z from '@deepseek-ai/schemastery';

/** Poster / atlas data URLs the document accepts (PNG, JPEG or WebP). */
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;

export const Config = z.object({
  /** provider route id → model id → logo key (or `none` / `letter` / `custom:<id>`). */
  modelIcons: z.dict(z.dict(z.string())).volatile(),
  /** provider route id → logo key (or `none` / `letter` / `custom:<id>`). */
  providerIcons: z.dict(z.string()).volatile(),
  /**
   * User-created icons: generated id → { name, kind, image, motion?, createdAt }.
   *
   * The image is a data URL, so the field is validated as one: only the three
   * raster types the picker accepts are allowed, and the string stays under the
   * picker's size budget (~128 KiB). `motion.atlas` is a PNG/WebP strip capped at
   * the same single-data-URL budget; `frames × frameWidth` is bounded to 4096 so
   * a hand-edited document cannot ask the renderer for a 100k-pixel strip.
   */
  customIcons: z
    .dict(
      z.object({
        name: z.string(),
        kind: z.string().default('image'),
        image: z.string().pattern(IMAGE_DATA_URL).max(131072),
        motion: z.object({
          atlas: z
            .string()
            .pattern(/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
            .max(131072),
          frames: z.number().min(2).max(24),
          fps: z.number().min(0.5).max(30),
          frameWidth: z.number().min(96).max(256),
        }),
        createdAt: z.number().default(0),
      }),
    )
    .volatile(),
  /**
   * Per-surface playback policy for motion icons. The browser parser keeps the
   * documented defaults for a missing/unknown value; the schema mirrors them so a
   * fresh install already serializes the intended behaviour.
   */
  playback: z
    .object({
      composer: z.string().default('always'),
      settings: z.string().default('hover'),
      iconsPage: z.string().default('hover'),
      picker: z.string().default('hover'),
    })
    .volatile(),
});

/** Host body: nothing to mount; the settings document does the persistence. */
export function apply(): void {}
