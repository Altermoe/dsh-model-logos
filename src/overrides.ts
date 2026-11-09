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
 * Persistence: the Host plugin's Config declares a volatile `modelIcons` field,
 * so the settings document mirror carries it. Writes go through
 * `ctx.configForms.get(NS)` → `remote.settings.mutate`, which lands in the
 * profile's `cordis.patch.yml` (no localStorage).
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
  DshContext,
  IconResolution,
  IconState,
  Identity,
  LocaleService,
  ModelMark,
  OverrideDocument,
  ProviderIconResolution,
  ProviderOverrideDocument,
  RemoteLlmService,
  RemoteService,
  SettingsNamespaceView,
  VendorMark,
} from './types';

/** Host plugin entry id — the settings namespace that stores our overrides. */
export const DSHML_SETTINGS_NS = 'dsh-model-logos';

/** Settings field name declared by the host half's volatile Config. */
export const DSHML_SETTINGS_FIELD = 'modelIcons';

/** Settings field carrying the per-provider (vendor) overrides. */
export const DSHML_PROVIDER_SETTINGS_FIELD = 'providerIcons';

/** Snapshot store for the icon overrides. */
const dshmlIconsRef: { snapshot: IconState; listeners: Set<() => void> } = {
  snapshot: {
    status: 'loading',
    overrides: {},
    providerOverrides: {},
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
 * The mark data a renderer should draw: a brand SVG or a generated letter tile,
 * or null when the pair has no mark (auto found nothing, disabled, or 'none').
 */
export function dshmlModelMark(provider: Identity | null | undefined, model: Identity | null | undefined): ModelMark {
  const resolved = dshmlResolveFor(provider, model);
  if (resolved.disabled) return { resolved, svg: null, title: null };
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
  if (resolved.letter) {
    const tile = letterTile(providerLetterTextFor(providerId, displayName));
    return { key: null, svg: tile.svg, title: tile.title, resolved };
  }
  const key = resolved.key;
  const logo = key !== null ? LOGOS[key] : undefined;
  if (logo !== undefined) return { key, svg: logo.svg, title: dshmlBrandName(key, logo.title), resolved };
  return { key: null, svg: null, title: null, resolved };
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
  const overrides: OverrideDocument =
    rawModel !== null && typeof rawModel === 'object' && !Array.isArray(rawModel) ? (rawModel as OverrideDocument) : {};
  const providerOverrides: ProviderOverrideDocument =
    rawProvider !== null && typeof rawProvider === 'object' && !Array.isArray(rawProvider)
      ? (rawProvider as ProviderOverrideDocument)
      : {};
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
  dshmlPublishIcons({
    status: 'ready',
    overrides: merged,
    providerOverrides: mergedProviders,
    writable: snapshot.writable === true,
    error: null,
  });
}

/** Whether a write is in flight (prevents the mirror from reverting an optimistic value). */
let dshmlIconFormWriting = 0;

/**
 * Write one override operation.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @param icon - brand key, 'none', 'letter', or null to clear.
 * @returns whether the Host accepted the write.
 */
async function dshmlWriteIcon(providerId: string, modelId: string, icon: string | null): Promise<boolean> {
  const provider = typeof providerId === 'string' ? providerId.trim() : '';
  const model = typeof modelId === 'string' ? modelId.trim() : '';
  if (provider === '' || model === '') return false;
  const form = dshmlIconForm;
  if (form === null) {
    dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.unavailable') });
    return false;
  }
  if (dshmlIconState().status === 'unavailable') {
    dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.unavailable') });
    return false;
  }
  const previous = dshmlIconState();
  const value = typeof icon === 'string' ? icon.trim() : '';
  const optimistic =
    value === ''
      ? withoutOverride(previous.overrides, provider, model)
      : withOverride(previous.overrides, provider, model, value);
  dshmlPublishIcons({ ...previous, overrides: optimistic, error: null });
  dshmlIconFormWriting += 1;
  try {
    const ops: ConfigMutateOp[] =
      value === ''
        ? [{ op: 'unset', path: [DSHML_SETTINGS_FIELD, provider, model] }]
        : [{ op: 'set', path: [DSHML_SETTINGS_FIELD, provider, model], value }];
    const ok = await form.mutate(ops);
    if (ok !== true) {
      dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.saveFailed') });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[dsh-model-logos] icon write failed', error);
    dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.saveFailed') });
    return false;
  } finally {
    dshmlIconFormWriting = Math.max(0, dshmlIconFormWriting - 1);
    if (dshmlIconFormWriting === 0) dshmlAcceptIconForm(form);
  }
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
 * @param icon - brand key, 'none', 'letter', or the empty string to clear.
 * @returns whether the Host accepted the write.
 */
async function dshmlWriteProviderIcon(providerId: string, icon: string | null): Promise<boolean> {
  const provider = typeof providerId === 'string' ? providerId.trim() : '';
  if (provider === '') return false;
  const form = dshmlIconForm;
  if (form === null) {
    dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.unavailable') });
    return false;
  }
  if (dshmlIconState().status === 'unavailable') {
    dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.unavailable') });
    return false;
  }
  const previous = dshmlIconState();
  const value = typeof icon === 'string' ? icon.trim() : '';
  const optimistic =
    value === ''
      ? withoutProviderOverride(previous.providerOverrides, provider)
      : withProviderOverride(previous.providerOverrides, provider, value);
  dshmlPublishIcons({ ...previous, providerOverrides: optimistic, error: null });
  dshmlIconFormWriting += 1;
  try {
    const ops: ConfigMutateOp[] =
      value === ''
        ? [{ op: 'unset', path: [DSHML_PROVIDER_SETTINGS_FIELD, provider] }]
        : [{ op: 'set', path: [DSHML_PROVIDER_SETTINGS_FIELD, provider], value }];
    const ok = await form.mutate(ops);
    if (ok !== true) {
      dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.saveFailed') });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[dsh-model-logos] provider icon write failed', error);
    dshmlPublishIcons({ ...dshmlIconState(), error: dshmlT('picker.saveFailed') });
    return false;
  } finally {
    dshmlIconFormWriting = Math.max(0, dshmlIconFormWriting - 1);
    if (dshmlIconFormWriting === 0) dshmlAcceptIconForm(form);
  }
}

/** Set one explicit provider (vendor) icon (brand key, 'none', or 'letter'). */
export function dshmlSetProviderIcon(providerId: string, icon: string | null): Promise<boolean> {
  return dshmlWriteProviderIcon(providerId, icon);
}

/** Reset one provider icon to the automatic (official channel) choice. */
export function dshmlClearProviderIcon(providerId: string): Promise<boolean> {
  return dshmlWriteProviderIcon(providerId, null);
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

/** One provider entry while the catalog is assembled. */
interface DshmlCatalogEntry {
  providerId: string;
  displayName: string;
  official: boolean;
  declared: boolean;
  models: CatalogModel[];
  modelIds: Set<string>;
}

/** Join the provider directory with the settings-document model lists. */
function dshmlBuildCatalog(
  directory: unknown,
  registered: unknown,
  views: readonly SettingsNamespaceView[],
  overrides: OverrideDocument,
  providerOverrides: ProviderOverrideDocument,
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

/** Refresh the catalog snapshot from the directory, the mirror and overrides. */
export async function dshmlRefreshCatalog(): Promise<void> {
  const generation = ++dshmlCatalogGeneration;
  const llm = dshmlRemoteLlm;
  const configForms = dshmlConfigFormsService;
  let directory: unknown = [];
  let registered: unknown = [];
  const warnings: string[] = [];
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
    const state = dshmlIconState();
    const providers = dshmlBuildCatalog(directory, registered, views, state.overrides, state.providerOverrides);
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
