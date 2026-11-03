/**
 * Host half of the model-logos bundle.
 *
 * The Browser half owns all rendering; this file exists so the plugin becomes a
 * DSH settings namespace: a volatile Config field is projected into the user
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
 * A missing entry means "auto" (the heuristic picks the initial icon); the
 * sentinel value `none` means the user explicitly turned the icon off.
 */
import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  /** provider route id → model id → logo key (or `none`). */
  modelIcons: z.dict(z.dict(z.string())).volatile(),
});

/** Host body: nothing to mount; the settings document does the persistence. */
export function apply() {}
