/**
 * Icon state, settings persistence and catalog access.
 *
 * This module owns the single browser-side view of the plugin's user-settings
 * namespace (`dsh-model-logos`), plus the model catalog that the icon picker's
 * settings section lists. It is mounted from the bundle's `apply(ctx)`, but every
 * consumer (composer label, settings decoration, picker, section) reads it
 * through the same snapshot store, so an override set anywhere is reflected
 * everywhere immediately.
 *
 * The catalog joins the provider directory, the settings-document model lists
 * (`llm-pi-ai`, `llm-deepseek`) and the Host-generation catalog exposed by
 * `remote.session.modelCatalog()`. The last source is what gives a signed-in
 * `deepseek-account` route (whose models live in the account listing, not in a
 * settings namespace) its per-model rows on the Model icons page.
 *
 * Persistence: the Host plugin's Config declares the volatile `modelIcons`,
 * `providerIcons` and `customIcons` fields, so the settings document mirror
 * carries them. Writes go through `ctx.configForms.get(NS)` →
 * `remote.settings.mutate`, which lands in the profile's `cordis.patch.yml`
 * (no localStorage). Custom icons deliberately live in the same document as the
 * overrides that reference them: one write sets the icon and the override it is
 * immediately applied to, and deleting the icon clears every reference in one
 * atomic edit.
 */
import {
  flattenOverrides,
  flattenProviderOverrides,
  letterTextFor,
  providerLetterTextFor,
  resolveModelIcon,
  resolveProviderIcon,
  withOverride,
  withProviderOverride,
  withoutOverride,
  withoutProviderOverride,
} from './resolve';
import {
  DSHML_CUSTOM_KIND_IMAGE,
  DSHML_CUSTOM_MAX_ICONS,
  dshmlCustomIconKey,
  dshmlCustomIconsOf,
  dshmlCustomMarkSvg,
  dshmlIsCustomIconId,
  dshmlIsCustomImageDataUrl,
  dshmlNewCustomIconId,
  dshmlValidateCustomName,
} from './custom-icons';
import { letterTile } from './artwork';
import { LOGOS } from './logos';
import { React } from './runtime';
import { dshmlBrandName, dshmlT, dshmlSetLang } from './i18n';
import type {
  CatalogModel,
  CatalogProvider,
  CatalogState,
  ConfigForm,
  ConfigFormSnapshot,
  ConfigFormsService,
  ConfigMutateOp,
  CustomIcon,
  DshContext,
  IconResolution,
  IconScope,
  IconState,
  Identity,
  LocaleService,
  ModelMark,
  OverrideDocument,
  ProviderIconResolution,
  ProviderOverrideDocument,
  RemoteLlmService,
  RemoteService,
  RemoteSessionService,
  SettingsNamespaceView,
  VendorMark,
} from './types';

/** Host plugin entry id — the settings namespace that stores our overrides. */
export const DSHML_SETTINGS_NS = 'dsh-model-logos';

/** Settings field name declared by the host half's volatile Config. */
export const DSHML_SETTINGS_FIELD = 'modelIcons';

/** Settings field carrying the per-provider (vendor) overrides. */
export const DSHML_PROVIDER_SETTINGS_FIELD = 'providerIcons';

/** Settings field carrying the user-created icons (`id → { name, kind, image, createdAt }`). */
export const DSHML_CUSTOM_SETTINGS_FIELD = 'customIcons';

/** Snapshot store for the icon overrides. */
const dshmlIconsRef: { snapshot: IconState; listeners: Set<() => void> } = {
  snapshot: {
    status: 'loading',
    overrides: {},
    providerOverrides: {},
    customIcons: {},
    writable: false,
    error: null,
  },
  listeners: new Set(),
};

/** Snapshot store for the picker section's catalog. */
const dshmlCatalogRef: { snapshot: CatalogState; listeners: Set<() => void> } = {
  snapshot: {
    status: 'loading',
    providers: [],
    error: null,
  },
  listeners: new Set(),
};

/** The mounted config form (null until the settings service is available). */
let dshmlIconForm: ConfigForm | null = null;
/** Debouncer handle for catalog refreshes. */
let dshmlCatalogTimer: ReturnType<typeof setTimeout> | null = null;
/** Latest catalog refresh sequence, so an older read never wins. */
let dshmlCatalogGeneration = 0;
/** Services captured while mounting. */
let dshmlRemoteService: RemoteService | null = null;
let dshmlRemoteLlm: RemoteLlmService | null = null;
let dshmlRemoteSession: RemoteSessionService | null = null;
let dshmlConfigFormsService: ConfigFormsService | null = null;

/**
 * Read a property of an unknown value, or `undefined` for non-objects: the
 * settings mirror and remote answers arrive untyped and are narrowed here.
 */
function dshmlRead(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}

/** Treat an unknown value as a list: arrays are used as-is, anything else is empty. */
function dshmlListOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Message of an unknown thrown value, exactly like `String(error?.message ?? error)`. */
function dshmlErrorMessage(error: unknown): string {
  return String(dshmlRead(error, 'message') ?? error);
}

/** Normalize the answer of an optional `subscribe()` to a disposer (or null). */
function dshmlDisposerOf(value: unknown): (() => void) | null {
  return typeof value === 'function' ? (value as () => void) : null;
}

/** Read a service from an injected child context defensively. */
function dshmlServiceOf(scope: unknown, name: string): unknown {
  if (scope === null || typeof scope !== 'object') return undefined;
  try {
    const probe = scope as { get?: (id: string) => unknown };
    if (typeof probe.get === 'function') {
      const value = probe.get(name);
      if (value !== undefined) return value;
    }
  } catch {
    // Fall through to the property read.
  }
  const key = name.includes('.') ? (name.split('.').pop() ?? name) : name;
  return (scope as Record<string, unknown>)[key];
}

/** Replace the icons snapshot and notify subscribers. */
function dshmlPublishIcons(next: IconState): void {
  dshmlIconsRef.snapshot = next;
  for (const listener of Array.from(dshmlIconsRef.listeners)) {
    try {
      listener();
    } catch (error) {
      console.warn('[dsh-model-logos] icon listener failed', error);
    }
  }
}

/** Replace the catalog snapshot and notify subscribers. */
function dshmlPublishCatalog(next: CatalogState): void {
  dshmlCatalogRef.snapshot = next;
  for (const listener of Array.from(dshmlCatalogRef.listeners)) {
    try {
      listener();
    } catch (error) {
      console.warn('[dsh-model-logos] catalog listener failed', error);
    }
  }
}

/** Current icon state (stable reference between changes). */
export function dshmlIconState(): IconState {
  return dshmlIconsRef.snapshot;
}

/** Subscribe to icon-state changes. */
export function dshmlSubscribeIconState(listener: () => void): () => void {
  dshmlIconsRef.listeners.add(listener);
  return function unsubscribe() {
    dshmlIconsRef.listeners.delete(listener);
  };
}

/** React hook over the icon state. */
export function dshmlUseIconState(): IconState {
  return React.useSyncExternalStore(dshmlSubscribeIconState, dshmlIconState, dshmlIconState);
}

/** Current catalog snapshot. */
export function dshmlCatalogState(): CatalogState {
  return dshmlCatalogRef.snapshot;
}

/** Subscribe to catalog changes; the first subscriber wakes a refresh. */
export function dshmlSubscribeCatalog(listener: () => void): () => void {
  dshmlCatalogRef.listeners.add(listener);
  if (dshmlCatalogRef.listeners.size === 1) dshmlScheduleCatalogRefresh(0);
  return function unsubscribe() {
    dshmlCatalogRef.listeners.delete(listener);
  };
}

/** React hook over the model catalog. */
export function dshmlUseModelCatalog(): CatalogState {
  return React.useSyncExternalStore(dshmlSubscribeCatalog, dshmlCatalogState, dshmlCatalogState);
}

/** Resolve one model identity against the live overrides. */
export function dshmlResolveFor(
  provider: Identity | null | undefined,
  model: Identity | null | undefined,
): IconResolution {
  return resolveModelIcon(dshmlIconState().overrides, provider, model);
}

/**
 * Resolve one provider (vendor / channel) identity against the live overrides.
 * @param providerId - provider route id.
 * @param fallback - allow the generated letter tile for an unknown channel.
 */
export function dshmlResolveProviderFor(providerId: string, fallback?: boolean): ProviderIconResolution {
  return resolveProviderIcon(dshmlIconState().providerOverrides, providerId, { fallback: fallback === true });
}

/** Letter-tile source text for the picker preview and DOM fallbacks. */
export function dshmlLetterTextFor(provider: Identity | null | undefined, model: Identity | null | undefined): string {
  return letterTextFor(provider, model);
}

/** Letter-tile source text for a provider (display name, then route id). */
export function dshmlProviderLetterTextFor(providerId: string, displayName?: string | null): string {
  return providerLetterTextFor(providerId, displayName);
}

/**
 * The mark data a renderer should draw: a brand SVG, a generated letter tile, a
 * user-created custom icon, or null when the pair has no mark (auto found
 * nothing, disabled, or 'none').
 */
export function dshmlModelMark(provider: Identity | null | undefined, model: Identity | null | undefined): ModelMark {
  const resolved = dshmlResolveFor(provider, model);
  if (resolved.disabled) return { resolved, svg: null, title: null };
  if (resolved.custom !== null) {
    const icon = dshmlCustomIconById(resolved.custom);
    if (icon === null) return { resolved, svg: null, title: null };
    return { resolved, svg: dshmlCustomMarkSvg(icon), title: icon.name };
  }
  if (resolved.letter) {
    const tile = letterTile(dshmlLetterTextFor(provider, model));
    return { resolved, svg: tile.svg, title: tile.title };
  }
  const key = resolved.key;
  const logo = key !== null ? LOGOS[key] : undefined;
  if (logo !== undefined) return { resolved, svg: logo.svg, title: dshmlBrandName(key, logo.title) };
  return { resolved, svg: null, title: null };
}

/**
 * The vendor mark for an official channel row / dropdown option.
 *
 * The configured per-provider override wins; otherwise an official channel falls
 * back to its artwork (`matchVendorLogo`) and then to a letter tile. Pass
 * `allowFallback=false` for custom (hand-declared) providers, which get no
 * vendor mark at all unless the user configured one explicitly.
 */
export function dshmlVendorMark(providerId: string, displayName?: string | null, allowFallback?: boolean): VendorMark {
  // Omitting the flag keeps the historical default (letter tile for unknown
  // channels); callers must pass `false` explicitly for declared providers.
  const resolved = dshmlResolveProviderFor(providerId, allowFallback !== false);
  if (resolved.disabled) return { key: null, svg: null, title: null, resolved };
  if (resolved.custom !== null) {
    const icon = dshmlCustomIconById(resolved.custom);
    if (icon === null) return { key: null, svg: null, title: null, resolved };
    return { key: null, svg: dshmlCustomMarkSvg(icon), title: icon.name, resolved };
  }
  if (resolved.letter) {
    const tile = letterTile(providerLetterTextFor(providerId, displayName));
    return { key: null, svg: tile.svg, title: tile.title, resolved };
  }
  const key = resolved.key;
  const logo = key !== null ? LOGOS[key] : undefined;
  if (logo !== undefined) return { key, svg: logo.svg, title: dshmlBrandName(key, logo.title), resolved };
  return { key: null, svg: null, title: null, resolved };
}

/** One stored custom icon by id, or null when absent. */
function dshmlCustomIconById(id: string): CustomIcon | null {
  const icons = dshmlIconState().customIcons;
  if (!Object.prototype.hasOwnProperty.call(icons, id)) return null;
  const icon = icons[id];
  return icon !== undefined ? icon : null;
}

/** Adopt the settings form snapshot into the icon store. */
function dshmlAcceptIconForm(form: ConfigForm): void {
  let snapshot: ConfigFormSnapshot;
  try {
    snapshot = form.getSnapshot();
  } catch (error) {
    console.warn('[dsh-model-logos] settings snapshot failed', error);
    return;
  }
  if (snapshot === null || typeof snapshot !== 'object') return;
  const status = snapshot.status;
  if (status === 'unavailable') {
    const previous = dshmlIconState();
    dshmlPublishIcons({
      status: 'unavailable',
      overrides: previous.overrides,
      providerOverrides: previous.providerOverrides,
      customIcons: previous.customIcons,
      writable: false,
      error: typeof snapshot.error === 'string' ? snapshot.error : dshmlT('picker.unavailable'),
    });
    return;
  }
  if (status !== 'ready') {
    const previous = dshmlIconState();
    if (previous.status === 'loading') dshmlPublishIcons({ ...previous, status: 'loading' });
    return;
  }
  const value = snapshot.value;
  const rawModel = value !== null && typeof value === 'object' ? dshmlRead(value, DSHML_SETTINGS_FIELD) : undefined;
  const rawProvider =
    value !== null && typeof value === 'object' ? dshmlRead(value, DSHML_PROVIDER_SETTINGS_FIELD) : undefined;
  const rawCustom =
    value !== null && typeof value === 'object' ? dshmlRead(value, DSHML_CUSTOM_SETTINGS_FIELD) : undefined;
  const overrides: OverrideDocument =
    rawModel !== null && typeof rawModel === 'object' && !Array.isArray(rawModel) ? (rawModel as OverrideDocument) : {};
  const providerOverrides: ProviderOverrideDocument =
    rawProvider !== null && typeof rawProvider === 'object' && !Array.isArray(rawProvider)
      ? (rawProvider as ProviderOverrideDocument)
      : {};
  const customIcons = dshmlCustomIconsOf(rawCustom);
  const previous = dshmlIconState();
  const writing = dshmlIconFormWriting > 0;
  // Keep an optimistic value while a queued write has not been folded back yet.
  const merged =
    Object.keys(previous.overrides).length > 0 && previous.status === 'ready' && writing
      ? previous.overrides
      : overrides;
  const mergedProviders =
    Object.keys(previous.providerOverrides).length > 0 && previous.status === 'ready' && writing
      ? previous.providerOverrides
      : providerOverrides;
  const mergedCustom =
    Object.keys(previous.customIcons).length > 0 && previous.status === 'ready' && writing
      ? previous.customIcons
      : customIcons;
  dshmlPublishIcons({
    status: 'ready',
    overrides: merged,
    providerOverrides: mergedProviders,
    customIcons: mergedCustom,
    writable: snapshot.writable === true,
    error: null,
  });
}

/** Whether a write is in flight (prevents the mirror from reverting an optimistic value). */
let dshmlIconFormWriting = 0;

/** Optimistic state projection published before a settings write settles. */
type DshmlOptimisticWrite = (state: IconState) => IconState;

/** Publish one write refusal without throwing. */
function dshmlRefuseWrite(message: string): false {
  dshmlPublishIcons({ ...dshmlIconState(), error: message });
  return false;
}

/**
 * Send path operations to the Host with the store's optimistic-write discipline:
 * project the expected state immediately, refuse when the namespace is not
 * writable, restore the Host snapshot when the last in-flight write settles, and
 * surface a localized error instead of throwing.
 * @param ops - settings path operations.
 * @param optimistic - optional state projection published before the write.
 * @returns whether the Host accepted the write.
 */
async function dshmlWriteOps(ops: readonly ConfigMutateOp[], optimistic?: DshmlOptimisticWrite): Promise<boolean> {
  const form = dshmlIconForm;
  const unavailable = dshmlT('picker.unavailable');
  if (form === null) return dshmlRefuseWrite(unavailable);
  if (dshmlIconState().status === 'unavailable') return dshmlRefuseWrite(unavailable);
  const previous = dshmlIconState();
  dshmlPublishIcons({ ...(optimistic !== undefined ? optimistic(previous) : previous), error: null });
  dshmlIconFormWriting += 1;
  try {
    const ok = await form.mutate(ops);
    if (ok !== true) return dshmlRefuseWrite(dshmlT('picker.saveFailed'));
    return true;
  } catch (error) {
    console.warn('[dsh-model-logos] settings write failed', error);
    return dshmlRefuseWrite(dshmlT('picker.saveFailed'));
  } finally {
    dshmlIconFormWriting = Math.max(0, dshmlIconFormWriting - 1);
    if (dshmlIconFormWriting === 0) dshmlAcceptIconForm(form);
  }
}

/**
 * Write one model override.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @param icon - brand key, 'none', 'letter', `custom:<id>`, or null to clear.
 * @returns whether the Host accepted the write.
 */
async function dshmlWriteIcon(providerId: string, modelId: string, icon: string | null): Promise<boolean> {
  const provider = typeof providerId === 'string' ? providerId.trim() : '';
  const model = typeof modelId === 'string' ? modelId.trim() : '';
  if (provider === '' || model === '') return false;
  const value = typeof icon === 'string' ? icon.trim() : '';
  const ops: ConfigMutateOp[] =
    value === ''
      ? [{ op: 'unset', path: [DSHML_SETTINGS_FIELD, provider, model] }]
      : [{ op: 'set', path: [DSHML_SETTINGS_FIELD, provider, model], value }];
  return dshmlWriteOps(ops, function optimistic(state) {
    return {
      ...state,
      overrides:
        value === ''
          ? withoutOverride(state.overrides, provider, model)
          : withOverride(state.overrides, provider, model, value),
    };
  });
}

/** Set one explicit model icon (brand key, 'none', or 'letter'). */
export function dshmlSetModelIcon(providerId: string, modelId: string, icon: string | null): Promise<boolean> {
  return dshmlWriteIcon(providerId, modelId, icon);
}

/** Reset one model to the heuristic initial icon. */
export function dshmlClearModelIcon(providerId: string, modelId: string): Promise<boolean> {
  return dshmlWriteIcon(providerId, modelId, null);
}

/**
 * Write one provider (vendor) override.
 * @param providerId - provider route id.
 * @param icon - brand key, 'none', 'letter', `custom:<id>`, or the empty string to clear.
 * @returns whether the Host accepted the write.
 */
async function dshmlWriteProviderIcon(providerId: string, icon: string | null): Promise<boolean> {
  const provider = typeof providerId === 'string' ? providerId.trim() : '';
  if (provider === '') return false;
  const value = typeof icon === 'string' ? icon.trim() : '';
  const ops: ConfigMutateOp[] =
    value === ''
      ? [{ op: 'unset', path: [DSHML_PROVIDER_SETTINGS_FIELD, provider] }]
      : [{ op: 'set', path: [DSHML_PROVIDER_SETTINGS_FIELD, provider], value }];
  return dshmlWriteOps(ops, function optimistic(state) {
    return {
      ...state,
      providerOverrides:
        value === ''
          ? withoutProviderOverride(state.providerOverrides, provider)
          : withProviderOverride(state.providerOverrides, provider, value),
    };
  });
}

/** Set one explicit provider (vendor) icon (brand key, 'none', or 'letter'). */
export function dshmlSetProviderIcon(providerId: string, icon: string | null): Promise<boolean> {
  return dshmlWriteProviderIcon(providerId, icon);
}

/** Reset one provider icon to the automatic (official channel) choice. */
export function dshmlClearProviderIcon(providerId: string): Promise<boolean> {
  return dshmlWriteProviderIcon(providerId, null);
}

/* -------------------------------------------------------------------------- */
/* User-created custom icons                                                  */
/* -------------------------------------------------------------------------- */

/** Where a newly created custom icon is applied immediately. */
export interface DshmlCustomIconApply {
  /** `model` targets `modelIcons[provider][model]`, `provider` targets `providerIcons[provider]`. */
  scope: IconScope;
  providerId: string;
  /** Model id; required in `model` scope. */
  modelId?: string | null;
}

/** Validated application target for a new custom icon. */
interface DshmlCustomIconTarget {
  scope: IconScope;
  providerId: string;
  modelId: string;
}

/**
 * Validate where a new icon should be applied.
 * @returns the target, `undefined` to only store the icon, or null when invalid.
 */
function dshmlCustomIconTarget(
  apply: DshmlCustomIconApply | null | undefined,
): DshmlCustomIconTarget | null | undefined {
  if (apply === null || apply === undefined) return undefined;
  const providerId = typeof apply.providerId === 'string' ? apply.providerId.trim() : '';
  if (providerId === '') return null;
  const scope: IconScope = apply.scope === 'provider' ? 'provider' : 'model';
  const modelId = typeof apply.modelId === 'string' ? apply.modelId.trim() : '';
  if (scope === 'model' && modelId === '') return null;
  return { scope, providerId, modelId };
}

/**
 * Create one user-created icon and, optionally, apply it to a picker target in
 * the same settings write (so the icon and its reference cannot drift apart).
 * @param name - raw name input; validated here.
 * @param image - cropped PNG/WebP data URL produced by the crop dialog.
 * @param apply - scope + identity to set as the current icon.
 * @returns the generated icon id, or null when rejected/refused.
 */
export async function dshmlCreateCustomIcon(
  name: unknown,
  image: unknown,
  apply?: DshmlCustomIconApply | null,
): Promise<string | null> {
  const state = dshmlIconState();
  const validated = dshmlValidateCustomName(name, state.customIcons);
  if (!validated.ok || !dshmlIsCustomImageDataUrl(image)) return null;
  if (Object.keys(state.customIcons).length >= DSHML_CUSTOM_MAX_ICONS) {
    dshmlPublishIcons({ ...state, error: dshmlT('picker.iconLimit', { n: DSHML_CUSTOM_MAX_ICONS }) });
    return null;
  }
  const target = dshmlCustomIconTarget(apply);
  if (target === null) return null;
  const id = dshmlNewCustomIconId();
  const key = dshmlCustomIconKey(id);
  if (key === null) return null;
  const icon: CustomIcon = {
    id,
    name: validated.name,
    kind: DSHML_CUSTOM_KIND_IMAGE,
    image,
    createdAt: Date.now(),
  };
  const ops: ConfigMutateOp[] = [{ op: 'set', path: [DSHML_CUSTOM_SETTINGS_FIELD, id], value: icon }];
  if (target !== undefined) {
    ops.push(
      target.scope === 'provider'
        ? { op: 'set', path: [DSHML_PROVIDER_SETTINGS_FIELD, target.providerId], value: key }
        : { op: 'set', path: [DSHML_SETTINGS_FIELD, target.providerId, target.modelId], value: key },
    );
  }
  const ok = await dshmlWriteOps(ops, function optimistic(previous) {
    const withIcon: IconState = { ...previous, customIcons: { ...previous.customIcons, [id]: icon } };
    if (target === undefined) return withIcon;
    return target.scope === 'provider'
      ? { ...withIcon, providerOverrides: withProviderOverride(withIcon.providerOverrides, target.providerId, key) }
      : { ...withIcon, overrides: withOverride(withIcon.overrides, target.providerId, target.modelId, key) };
  });
  return ok ? id : null;
}

/**
 * Rename one stored custom icon. Overrides reference the icon by id, so a rename
 * never needs to touch them.
 * @param id - custom icon id.
 * @param name - raw new name; validated here.
 * @returns whether the Host accepted the write.
 */
export async function dshmlRenameCustomIcon(id: unknown, name: unknown): Promise<boolean> {
  if (!dshmlIsCustomIconId(id)) return false;
  const state = dshmlIconState();
  if (!Object.prototype.hasOwnProperty.call(state.customIcons, id)) return false;
  const icon = state.customIcons[id];
  if (icon === undefined) return false;
  const validated = dshmlValidateCustomName(name, state.customIcons, id);
  if (!validated.ok) return false;
  if (validated.name === icon.name) return true;
  const ops: ConfigMutateOp[] = [{ op: 'set', path: [DSHML_CUSTOM_SETTINGS_FIELD, id, 'name'], value: validated.name }];
  return dshmlWriteOps(ops, function optimistic(previous) {
    const current = previous.customIcons[id];
    if (current === undefined) return previous;
    return {
      ...previous,
      customIcons: { ...previous.customIcons, [id]: { ...current, name: validated.name } },
    };
  });
}

/**
 * Delete one stored custom icon and clear every override that referenced it, in
 * one settings write: a half-applied delete would leave a row pointing at an
 * icon that no longer exists.
 * @param id - custom icon id.
 * @returns whether the Host accepted the write (true when the id is already gone).
 */
export async function dshmlDeleteCustomIcon(id: unknown): Promise<boolean> {
  if (!dshmlIsCustomIconId(id)) return false;
  const state = dshmlIconState();
  if (!Object.prototype.hasOwnProperty.call(state.customIcons, id)) return true;
  const key = dshmlCustomIconKey(id);
  if (key === null) return false;
  const ops: ConfigMutateOp[] = [{ op: 'unset', path: [DSHML_CUSTOM_SETTINGS_FIELD, id] }];
  let overrides = state.overrides;
  for (const row of flattenOverrides(state.overrides)) {
    if (row.icon !== key) continue;
    overrides = withoutOverride(overrides, row.providerId, row.modelId);
    ops.push({ op: 'unset', path: [DSHML_SETTINGS_FIELD, row.providerId, row.modelId] });
  }
  let providerOverrides = state.providerOverrides;
  for (const row of flattenProviderOverrides(state.providerOverrides)) {
    if (row.icon !== key) continue;
    providerOverrides = withoutProviderOverride(providerOverrides, row.providerId);
    ops.push({ op: 'unset', path: [DSHML_PROVIDER_SETTINGS_FIELD, row.providerId] });
  }
  const customIcons = { ...state.customIcons };
  Reflect.deleteProperty(customIcons, id);
  return dshmlWriteOps(ops, function optimistic(previous) {
    return { ...previous, customIcons, overrides, providerOverrides };
  });
}

/** Unwrap a remote answer: `{ok,value}` envelopes and plain values both work. */
function dshmlUnwrapRemote(answer: unknown): unknown {
  const ok = dshmlRead(answer, 'ok');
  if (typeof ok === 'boolean') {
    if (ok !== true) {
      const message = dshmlRead(dshmlRead(answer, 'error'), 'message');
      throw new Error(message === null || message === undefined ? 'remote call refused' : String(message));
    }
    return dshmlRead(answer, 'value');
  }
  return answer;
}

/** One `{providerId, modelId, name}` row read from a settings namespace value. */
interface DshmlCatalogModelRow {
  providerId: string;
  modelId: string;
  name: string;
}

/** Read the model entries a settings namespace value carries. */
function dshmlModelsFromView(view: SettingsNamespaceView | null | undefined): DshmlCatalogModelRow[] {
  const value = view?.value;
  const out: DshmlCatalogModelRow[] = [];
  if (value === null || typeof value !== 'object') return out;
  if (view?.ns === 'llm-pi-ai') {
    const providers = dshmlRead(value, 'providers');
    if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
      return out;
    }
    for (const providerId of Object.keys(providers)) {
      const profile = (providers as Record<string, unknown>)[providerId];
      if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue;
      const models = dshmlListOf(dshmlRead(profile, 'models'));
      for (const model of models) {
        if (model === null || typeof model !== 'object') continue;
        const id = dshmlRead(model, 'id');
        const modelId = typeof id === 'string' ? id.trim() : '';
        if (modelId === '') continue;
        const rawName = dshmlRead(model, 'name');
        const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : modelId;
        out.push({ providerId, modelId, name });
      }
    }
    return out;
  }
  if (view?.ns === 'llm-deepseek') {
    const models = dshmlListOf(dshmlRead(value, 'models'));
    for (const model of models) {
      if (model === null || typeof model !== 'object') continue;
      const id = dshmlRead(model, 'id');
      const modelId = typeof id === 'string' ? id.trim() : '';
      if (modelId === '') continue;
      const rawName = dshmlRead(model, 'name');
      const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : modelId;
      out.push({ providerId: 'deepseek-official', modelId, name });
    }
  }
  return out;
}

/** One provider group read from `remote.session.modelCatalog()`. */
interface DshmlLiveCatalogGroup {
  providerId: string;
  displayName: string;
  models: DshmlCatalogModelRow[];
}

/**
 * Read the Host-generation model catalog (`session.modelCatalog()`) into the
 * same `{providerId, modelId, name}` rows the settings-document readers produce.
 *
 * This is the only source for routes whose catalog is not stored in settings:
 * `deepseek-account` keeps its models in the account listing, so without this
 * reader the Model icons page could show the provider row but never a model row
 * to pick an icon for. Unknown shapes degrade to an empty list.
 * @param catalog - raw `modelCatalog()` answer (host-shaped, so unbounded).
 */
function dshmlLiveCatalogGroups(catalog: unknown): DshmlLiveCatalogGroup[] {
  const groups: DshmlLiveCatalogGroup[] = [];
  for (const group of dshmlListOf(dshmlRead(catalog, 'groups'))) {
    const rawProvider = dshmlRead(group, 'id');
    const providerId = typeof rawProvider === 'string' ? rawProvider.trim() : '';
    if (providerId === '') continue;
    const rawGroupName = dshmlRead(group, 'name');
    const displayName =
      typeof rawGroupName === 'string' && rawGroupName.trim() !== '' ? rawGroupName.trim() : providerId;
    const models: DshmlCatalogModelRow[] = [];
    for (const model of dshmlListOf(dshmlRead(group, 'models'))) {
      const id = dshmlRead(model, 'id');
      const modelId = typeof id === 'string' ? id.trim() : '';
      if (modelId === '') continue;
      const rawName = dshmlRead(model, 'name');
      const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : modelId;
      models.push({ providerId, modelId, name });
    }
    groups.push({ providerId, displayName, models });
  }
  return groups;
}

/** One provider entry while the catalog is assembled. */
interface DshmlCatalogEntry {
  providerId: string;
  displayName: string;
  official: boolean;
  declared: boolean;
  models: CatalogModel[];
  modelIds: Set<string>;
}

/**
 * Join the provider directory with the settings-document model lists and the
 * Host-generation model catalog.
 * @param directory - `listConfigurableProviders()` answer.
 * @param registered - `listProviders()` answer.
 * @param views - settings-document namespaces (`llm-pi-ai`, `llm-deepseek`, …).
 * @param overrides - persisted model overrides.
 * @param providerOverrides - persisted provider overrides.
 * @param live - `session.modelCatalog()` answer: models that have no settings entry.
 */
function dshmlBuildCatalog(
  directory: unknown,
  registered: unknown,
  views: readonly SettingsNamespaceView[],
  overrides: OverrideDocument,
  providerOverrides: ProviderOverrideDocument,
  live: unknown,
): CatalogProvider[] {
  const providers = new Map<string, DshmlCatalogEntry>();
  const ensureProvider = (
    providerId: string,
    displayName: unknown,
    official: unknown,
    declared: unknown,
  ): DshmlCatalogEntry => {
    const existing = providers.get(providerId);
    if (existing !== undefined) return existing;
    const entry: DshmlCatalogEntry = {
      providerId,
      displayName: typeof displayName === 'string' && displayName !== '' ? displayName : providerId,
      official: official === true,
      declared: declared === true,
      models: [],
      modelIds: new Set<string>(),
    };
    providers.set(providerId, entry);
    return entry;
  };
  for (const row of dshmlListOf(directory)) {
    const provider = dshmlRead(row, 'provider');
    if (typeof provider !== 'string' || provider === '') continue;
    const declared = dshmlRead(row, 'declared') === true;
    const entry = ensureProvider(provider, dshmlRead(row, 'displayName'), !declared, declared);
    entry.official = !declared;
    entry.declared = declared;
    const displayName = dshmlRead(row, 'displayName');
    if (typeof displayName === 'string' && displayName.trim() !== '') {
      entry.displayName = displayName.trim();
    }
  }
  for (const route of dshmlListOf(registered)) {
    const id = dshmlRead(route, 'id');
    if (typeof id !== 'string' || id === '') continue;
    const routeName = dshmlRead(route, 'name');
    const entry = ensureProvider(id, typeof routeName === 'string' ? routeName : id, true, false);
    if (entry.displayName === id && typeof routeName === 'string' && routeName.trim() !== '') {
      entry.displayName = routeName.trim();
    }
  }
  for (const view of views) {
    for (const model of dshmlModelsFromView(view)) {
      const entry = ensureProvider(model.providerId, model.providerId, false, true);
      if (entry.modelIds.has(model.modelId)) continue;
      entry.modelIds.add(model.modelId);
      entry.models.push({ modelId: model.modelId, name: model.name, manual: false });
    }
  }
  // Live catalog rows come after the settings-document rows so a configured
  // display name/order always wins, but before the override rows: an account
  // model the user already iconised must still be listed with its advertised
  // name instead of falling back to the bare model id.
  for (const group of dshmlLiveCatalogGroups(live)) {
    const entry = ensureProvider(group.providerId, group.displayName, true, false);
    if (entry.displayName === group.providerId && group.displayName !== group.providerId) {
      entry.displayName = group.displayName;
    }
    for (const model of group.models) {
      if (entry.modelIds.has(model.modelId)) continue;
      entry.modelIds.add(model.modelId);
      entry.models.push({ modelId: model.modelId, name: model.name, manual: false });
    }
  }
  for (const row of flattenOverrides(overrides)) {
    const entry = ensureProvider(row.providerId, row.providerId, false, false);
    if (entry.modelIds.has(row.modelId)) continue;
    entry.modelIds.add(row.modelId);
    entry.models.push({ modelId: row.modelId, name: row.modelId, manual: true });
  }
  // A provider whose only persisted entry is a provider icon still needs a row,
  // otherwise the Model icons page could never show (or reset) that override.
  for (const row of flattenProviderOverrides(providerOverrides)) {
    ensureProvider(row.providerId, row.providerId, false, false);
  }
  const ordered: CatalogProvider[] = [...providers.values()].map((entry) => ({
    providerId: entry.providerId,
    displayName: entry.displayName,
    official: entry.official,
    declared: entry.declared,
    models: entry.models,
  }));
  ordered.sort((left, right) => {
    if (left.official !== right.official) return left.official ? -1 : 1;
    return 0;
  });
  return ordered;
}

/** Refresh the catalog snapshot from the directory, the mirror, the live catalog and overrides. */
export async function dshmlRefreshCatalog(): Promise<void> {
  const generation = ++dshmlCatalogGeneration;
  const llm = dshmlRemoteLlm;
  const session = dshmlRemoteSession;
  const configForms = dshmlConfigFormsService;
  const hadProviders = dshmlCatalogState().providers.length > 0;
  let directory: unknown = [];
  let registered: unknown = [];
  const warnings: string[] = [];
  // Start the possibly network-backed live read now: the settings-backed rows
  // below never wait for it, and the final publish merges it when it lands.
  // The signed-in account route (and any other listing-only route) advertises
  // its models only through this catalog; a failed read is an optional
  // enrichment and leaves the settings-sourced catalog usable.
  const liveRead = (async (): Promise<unknown> => {
    if (session === null || typeof session.modelCatalog !== 'function') return null;
    try {
      return dshmlUnwrapRemote(await session.modelCatalog()) ?? null;
    } catch (error) {
      warnings.push(dshmlErrorMessage(error));
      return null;
    }
  })();
  try {
    if (llm !== null) {
      if (typeof llm.listConfigurableProviders === 'function') {
        try {
          directory = dshmlUnwrapRemote(await llm.listConfigurableProviders()) ?? [];
        } catch (error) {
          warnings.push(dshmlErrorMessage(error));
        }
      }
      if (typeof llm.listProviders === 'function') {
        try {
          registered = dshmlUnwrapRemote(await llm.listProviders()) ?? [];
        } catch (error) {
          warnings.push(dshmlErrorMessage(error));
        }
      }
    }
    let views: readonly SettingsNamespaceView[] = [];
    if (configForms !== null && typeof configForms.describe === 'function') {
      const mirror = configForms.describe();
      if (mirror !== null && typeof mirror === 'object') {
        if (typeof mirror.ensure === 'function') await mirror.ensure();
        const snapshot = typeof mirror.getSnapshot === 'function' ? mirror.getSnapshot() : null;
        const view = snapshot !== null && typeof snapshot === 'object' ? snapshot.view : null;
        if (view !== null && typeof view === 'object') {
          const namespaces = view.namespaces;
          if (Array.isArray(namespaces)) views = namespaces;
        }
      }
    }
    if (generation !== dshmlCatalogGeneration) return;
    // On the first load, publish the settings-backed catalog before the live
    // catalog lands: provider seats and the settings-document model rows must
    // not wait on an account /models round trip. Later refreshes already have
    // content on screen and publish once, with the live rows merged.
    if (!hadProviders) {
      const beforeLive = dshmlIconState();
      const settingsProviders = dshmlBuildCatalog(
        directory,
        registered,
        views,
        beforeLive.overrides,
        beforeLive.providerOverrides,
        null,
      );
      if (settingsProviders.length > 0) {
        dshmlPublishCatalog({ status: 'ready', providers: settingsProviders, error: null });
      }
    }
    const live = await liveRead;
    if (generation !== dshmlCatalogGeneration) return;
    const state = dshmlIconState();
    const providers = dshmlBuildCatalog(directory, registered, views, state.overrides, state.providerOverrides, live);
    if (providers.length === 0 && warnings.length > 0 && dshmlCatalogState().providers.length === 0) {
      dshmlPublishCatalog({ status: 'unavailable', providers: [], error: warnings[0] ?? null });
      return;
    }
    dshmlPublishCatalog({ status: 'ready', providers, error: null });
  } catch (error) {
    if (generation !== dshmlCatalogGeneration) return;
    dshmlPublishCatalog({
      status: dshmlCatalogState().providers.length > 0 ? 'ready' : 'unavailable',
      providers: dshmlCatalogState().providers,
      error: dshmlErrorMessage(error),
    });
  }
}

/** Debounced catalog refresh. */
export function dshmlScheduleCatalogRefresh(delay?: number): void {
  if (dshmlCatalogTimer !== null) {
    clearTimeout(dshmlCatalogTimer);
    dshmlCatalogTimer = null;
  }
  const wait = typeof delay === 'number' ? delay : 120;
  dshmlCatalogTimer = setTimeout(() => {
    dshmlCatalogTimer = null;
    dshmlRefreshCatalog();
  }, wait);
}

/** Wire the settings form and watch the settings mirror. */
function dshmlMountSettingsScope(scope: DshContext): () => void {
  const configForms = dshmlServiceOf(scope, 'configForms');
  if (configForms === undefined) return function noop() {};
  const service = configForms as ConfigFormsService;
  dshmlConfigFormsService = service;
  const form = typeof service.get === 'function' ? service.get(DSHML_SETTINGS_NS) : null;
  if (form === null) return function noop() {};
  dshmlIconForm = form;
  const apply = () => dshmlAcceptIconForm(form);
  apply();
  const off = typeof form.subscribe === 'function' ? dshmlDisposerOf(form.subscribe(apply)) : null;
  let offMirror: (() => void) | null = null;
  try {
    const mirror = typeof service.describe === 'function' ? service.describe() : null;
    if (mirror !== null && typeof mirror === 'object') {
      if (typeof mirror.ensure === 'function') mirror.ensure();
      if (typeof mirror.subscribe === 'function') {
        offMirror = dshmlDisposerOf(mirror.subscribe(() => dshmlScheduleCatalogRefresh(60)));
      }
    }
  } catch {
    // The catalog refresh falls back to the timer.
  }
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlIconForm === form) dshmlIconForm = null;
    if (off !== null) off();
    if (offMirror !== null) offMirror();
  };
}

/** Wire the provider directory (`remote.llm` projected namespace). */
function dshmlMountRemoteLlmScope(scope: DshContext): () => void {
  const llm = dshmlServiceOf(scope, 'remote.llm');
  if (llm === undefined) return function noop() {};
  const service = llm as RemoteLlmService;
  dshmlRemoteLlm = service;
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlRemoteLlm === service) dshmlRemoteLlm = null;
  };
}

/** Wire the Host-generation model catalog (`remote.session` projected namespace). */
function dshmlMountRemoteSessionScope(scope: DshContext): () => void {
  const session = dshmlServiceOf(scope, 'remote.session');
  if (session === undefined) return function noop() {};
  const service = session as RemoteSessionService;
  dshmlRemoteSession = service;
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlRemoteSession === service) dshmlRemoteSession = null;
  };
}

/** Wire forwarded topology events from the remote root service. */
function dshmlMountRemoteScope(scope: DshContext): () => void {
  const remote = dshmlServiceOf(scope, 'remote');
  if (remote === undefined) return function noop() {};
  const service = remote as RemoteService;
  dshmlRemoteService = service;
  let offEvent: (() => void) | null = null;
  try {
    if (typeof service.$on === 'function') {
      offEvent = dshmlDisposerOf(service.$on('llm/adapters-updated', () => dshmlScheduleCatalogRefresh(120)));
    }
  } catch {
    // Older hosts: the mirror subscription still refreshes the catalog.
  }
  if (offEvent === null && typeof scope.on === 'function') {
    try {
      const off = dshmlDisposerOf(scope.on('llm/adapters-updated', () => dshmlScheduleCatalogRefresh(120)));
      if (off !== null) offEvent = off;
    } catch {
      // Ignore an unavailable event bus.
    }
  }
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlRemoteService === service) dshmlRemoteService = null;
    if (offEvent !== null) offEvent();
  };
}

/** Wire the DSH locale service so copy follows the app language. */
function dshmlMountLocaleScope(scope: DshContext): () => void {
  const locale = dshmlServiceOf(scope, 'locale');
  if (locale === undefined) return function noop() {};
  const service = locale as LocaleService;
  const apply = () => {
    let active: unknown = null;
    try {
      const snapshot = typeof service.getSnapshot === 'function' ? service.getSnapshot() : null;
      active = snapshot !== null && typeof snapshot === 'object' ? snapshot.active : null;
    } catch {
      active = null;
    }
    dshmlSetLang(active);
    // The language switch also changes every localized label and brand title.
    // Publish fresh snapshot objects: useSyncExternalStore bails out on an
    // identical reference, so re-sending the old snapshot would leave the
    // composer label, the settings section and an open picker in the old
    // language until the next data change.
    dshmlPublishIcons({ ...dshmlIconState() });
    dshmlPublishCatalog({ ...dshmlCatalogState() });
  };
  apply();
  const off = typeof service.subscribe === 'function' ? dshmlDisposerOf(service.subscribe(apply)) : null;
  return function cleanup() {
    if (off !== null) off();
  };
}

/**
 * Mount every optional service the plugin uses. Each scope is injected
 * independently: a deployment without the settings service keeps the composer
 * marks (they just stay heuristic-only).
 */
export function dshmlMountIconStore(ctx: DshContext): void {
  if (ctx === null || typeof ctx !== 'object') return;
  const scopes: ReadonlyArray<readonly [string, (scope: DshContext) => () => void]> = [
    ['locale', dshmlMountLocaleScope],
    ['configForms', dshmlMountSettingsScope],
    ['remote', dshmlMountRemoteScope],
    ['remote.llm', dshmlMountRemoteLlmScope],
    ['remote.session', dshmlMountRemoteSessionScope],
  ];
  for (const [service, wire] of scopes) {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject([service], (child) => {
          child.effect?.(() => wire(child), 'dsh-model-logos: ' + service);
        });
      } else if (typeof ctx.get === 'function' && ctx.get(service) !== undefined) {
        ctx.effect?.(() => wire(ctx), 'dsh-model-logos: ' + service);
      }
    } catch (error) {
      console.warn('[dsh-model-logos] cannot inject ' + service, error);
    }
  }
}
