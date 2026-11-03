/**
 * Icon state, settings persistence and catalog access.
 *
 * This fragment owns the single browser-side view of the plugin's user-settings
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

/** Host plugin entry id — the settings namespace that stores our overrides. */
const DSHML_SETTINGS_NS = 'dsh-model-logos';

/** Settings field name declared by the host half's volatile Config. */
const DSHML_SETTINGS_FIELD = 'modelIcons';

/** Snapshot store for the icon overrides. */
const dshmlIconsRef = {
  snapshot: {
    status: 'loading',
    overrides: {},
    writable: false,
    error: null,
  },
  listeners: new Set(),
};

/** Snapshot store for the picker section's catalog. */
const dshmlCatalogRef = {
  snapshot: {
    status: 'loading',
    providers: [],
    error: null,
  },
  listeners: new Set(),
};

/** The mounted config form (null until the settings service is available). */
let dshmlIconForm = null;
/** Debouncer handle for catalog refreshes. */
let dshmlCatalogTimer = null;
/** Latest catalog refresh sequence, so an older read never wins. */
let dshmlCatalogGeneration = 0;
/** Services captured while mounting. */
let dshmlRemoteService = null;
let dshmlRemoteLlm = null;
let dshmlConfigFormsService = null;

/** Read a service from an injected child context defensively. */
function dshmlServiceOf(scope, name) {
  if (scope === null || typeof scope !== 'object') return undefined;
  try {
    if (typeof scope.get === 'function') {
      const value = scope.get(name);
      if (value !== undefined) return value;
    }
  } catch {
    // Fall through to the property read.
  }
  const key = name.includes('.') ? name.split('.').pop() : name;
  return scope[key];
}

/** The remote `llm` namespace (directory reads), once injected. */
function dshmlRemoteNamespace(name) {
  if (name === 'llm') return dshmlRemoteLlm;
  const remote = dshmlRemoteService;
  if (remote === null || typeof remote !== 'object') return undefined;
  return remote[name];
}

/** Replace the icons snapshot and notify subscribers. */
function dshmlPublishIcons(next) {
  dshmlIconsRef.snapshot = next;
  for (const listener of [...dshmlIconsRef.listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[dsh-model-logos] icon listener failed', error);
    }
  }
}

/** Replace the catalog snapshot and notify subscribers. */
function dshmlPublishCatalog(next) {
  dshmlCatalogRef.snapshot = next;
  for (const listener of [...dshmlCatalogRef.listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[dsh-model-logos] catalog listener failed', error);
    }
  }
}

/** Current icon state (stable reference between changes). */
function dshmlIconState() {
  return dshmlIconsRef.snapshot;
}

/** Subscribe to icon-state changes. */
function dshmlSubscribeIconState(listener) {
  dshmlIconsRef.listeners.add(listener);
  return function unsubscribe() {
    dshmlIconsRef.listeners.delete(listener);
  };
}

/** React hook over the icon state. */
function dshmlUseIconState() {
  return React.useSyncExternalStore(dshmlSubscribeIconState, dshmlIconState, dshmlIconState);
}

/** Current catalog snapshot. */
function dshmlCatalogState() {
  return dshmlCatalogRef.snapshot;
}

/** Subscribe to catalog changes; the first subscriber wakes a refresh. */
function dshmlSubscribeCatalog(listener) {
  dshmlCatalogRef.listeners.add(listener);
  if (dshmlCatalogRef.listeners.size === 1) dshmlScheduleCatalogRefresh(0);
  return function unsubscribe() {
    dshmlCatalogRef.listeners.delete(listener);
  };
}

/** React hook over the model catalog. */
function dshmlUseModelCatalog() {
  return React.useSyncExternalStore(dshmlSubscribeCatalog, dshmlCatalogState, dshmlCatalogState);
}

/** Resolve one model identity against the live overrides. */
function dshmlResolveFor(provider, model) {
  return resolveModelIcon(dshmlIconState().overrides, provider, model);
}

/** Letter-tile source text for the picker preview and DOM fallbacks. */
function dshmlLetterTextFor(provider, model) {
  return letterTextFor(provider, model);
}

/**
 * The mark data a renderer should draw: a brand SVG or a generated letter tile,
 * or null when the pair has no mark (auto found nothing, disabled, or 'none').
 * @returns {{ resolved: object, svg: string | null, title: string | null }}
 */
function dshmlModelMark(provider, model) {
  const resolved = dshmlResolveFor(provider, model);
  if (resolved.disabled) return { resolved, svg: null, title: null };
  if (resolved.letter) {
    const tile = letterTile(dshmlLetterTextFor(provider, model));
    return { resolved, svg: tile.svg, title: tile.title };
  }
  if (resolved.key !== null && LOGOS[resolved.key] !== undefined) {
    return { resolved, svg: LOGOS[resolved.key].svg, title: LOGOS[resolved.key].title };
  }
  return { resolved, svg: null, title: null };
}

/**
 * The vendor mark for an official channel row / dropdown option.
 * Unknown official channels fall back to a letter tile; pass allowFallback=false
 * for custom (hand-declared) providers, which get no vendor mark at all.
 * @returns {{ key: string | null, svg: string | null, title: string | null }}
 */
function dshmlVendorMark(providerId, displayName, allowFallback) {
  const key = matchVendorLogo(providerId);
  if (key !== null && LOGOS[key] !== undefined) {
    return { key, svg: LOGOS[key].svg, title: LOGOS[key].title };
  }
  if (allowFallback !== false) {
    const tile = letterTile(displayName || providerId || '?');
    return { key: null, svg: tile.svg, title: tile.title };
  }
  return { key: null, svg: null, title: null };
}

/** Adopt the settings form snapshot into the icon store. */
function dshmlAcceptIconForm(form) {
  let snapshot;
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
  const raw = value !== null && typeof value === 'object' ? value[DSHML_SETTINGS_FIELD] : undefined;
  const overrides = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const previous = dshmlIconState();
  // Keep an optimistic value while a queued write has not been folded back yet.
  const merged = Object.keys(previous.overrides).length > 0 && previous.status === 'ready' && dshmlIconFormWriting
    ? previous.overrides
    : overrides;
  dshmlPublishIcons({
    status: 'ready',
    overrides: merged,
    writable: snapshot.writable === true,
    error: null,
  });
}

/** Whether a write is in flight (prevents the mirror from reverting an optimistic value). */
let dshmlIconFormWriting = 0;

/**
 * Write one override operation.
 * @param {string} providerId - provider route id.
 * @param {string} modelId - model id.
 * @param {string | null} icon - brand key, 'none', 'letter', or null to clear.
 * @returns {Promise<boolean>} whether the Host accepted the write.
 */
async function dshmlWriteIcon(providerId, modelId, icon) {
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
  const optimistic = value === ''
    ? withoutOverride(previous.overrides, provider, model)
    : withOverride(previous.overrides, provider, model, value);
  dshmlPublishIcons({ ...previous, overrides: optimistic, error: null });
  dshmlIconFormWriting += 1;
  try {
    const ops = value === ''
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
function dshmlSetModelIcon(providerId, modelId, icon) {
  return dshmlWriteIcon(providerId, modelId, icon);
}

/** Reset one model to the heuristic initial icon. */
function dshmlClearModelIcon(providerId, modelId) {
  return dshmlWriteIcon(providerId, modelId, null);
}

/** Unwrap a remote answer: `{ok,value}` envelopes and plain values both work. */
function dshmlUnwrapRemote(answer) {
  if (answer !== null && typeof answer === 'object' && typeof answer.ok === 'boolean') {
    if (answer.ok !== true) throw new Error(answer.error?.message ?? 'remote call refused');
    return answer.value;
  }
  return answer;
}

/** Read the model entries a settings namespace value carries. */
function dshmlModelsFromView(view) {
  const value = view?.value;
  const out = [];
  if (value === null || typeof value !== 'object') return out;
  if (view.ns === 'llm-pi-ai') {
    const providers = value.providers;
    if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return out;
    for (const providerId of Object.keys(providers)) {
      const profile = providers[providerId];
      if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue;
      const models = Array.isArray(profile.models) ? profile.models : [];
      for (const model of models) {
        if (model === null || typeof model !== 'object') continue;
        const modelId = typeof model.id === 'string' ? model.id.trim() : '';
        if (modelId === '') continue;
        const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name.trim() : modelId;
        out.push({ providerId, modelId, name });
      }
    }
    return out;
  }
  if (view.ns === 'llm-deepseek') {
    const models = Array.isArray(value.models) ? value.models : [];
    for (const model of models) {
      if (model === null || typeof model !== 'object') continue;
      const modelId = typeof model.id === 'string' ? model.id.trim() : '';
      if (modelId === '') continue;
      const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name.trim() : modelId;
      out.push({ providerId: 'deepseek-official', modelId, name });
    }
  }
  return out;
}

/** Join the provider directory with the settings-document model lists. */
function dshmlBuildCatalog(directory, registered, views, overrides) {
  const providers = new Map();
  const ensureProvider = (providerId, displayName, official, declared) => {
    const existing = providers.get(providerId);
    if (existing !== undefined) return existing;
    const entry = {
      providerId,
      displayName: displayName || providerId,
      official: official === true,
      declared: declared === true,
      models: [],
      modelIds: new Set(),
    };
    providers.set(providerId, entry);
    return entry;
  };
  const addModel = (providerId, modelId, name, source) => {
    const entry = ensureProvider(providerId, providerId, false, true);
    if (entry.modelIds.has(modelId)) return;
    entry.modelIds.add(modelId);
    entry.models.push({ modelId, name: name || modelId, manual: source === 'override' });
  };
  for (const row of Array.isArray(directory) ? directory : []) {
    if (row === null || typeof row !== 'object' || typeof row.provider !== 'string' || row.provider === '') continue;
    const entry = ensureProvider(row.provider, row.displayName, row.declared !== true, row.declared === true);
    entry.official = row.declared !== true;
    entry.declared = row.declared === true;
    if (typeof row.displayName === 'string' && row.displayName.trim() !== '') entry.displayName = row.displayName.trim();
  }
  for (const route of Array.isArray(registered) ? registered : []) {
    const id = route !== null && typeof route === 'object' && typeof route.id === 'string' ? route.id : '';
    if (id === '') continue;
    const entry = ensureProvider(id, typeof route.name === 'string' ? route.name : id, true, false);
    if (entry.displayName === id && typeof route.name === 'string' && route.name.trim() !== '') entry.displayName = route.name.trim();
  }
  for (const view of Array.isArray(views) ? views : []) {
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
  const ordered = [...providers.values()].map((entry) => ({
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
async function dshmlRefreshCatalog() {
  const generation = ++dshmlCatalogGeneration;
  const llm = dshmlRemoteLlm;
  const configForms = dshmlConfigFormsService;
  let directory = [];
  let registered = [];
  const warnings = [];
  try {
    if (llm !== null && llm !== undefined && typeof llm === 'object') {
      if (typeof llm.listConfigurableProviders === 'function') {
        try {
          directory = dshmlUnwrapRemote(await llm.listConfigurableProviders()) ?? [];
        } catch (error) {
          warnings.push(String(error?.message ?? error));
        }
      }
      if (typeof llm.listProviders === 'function') {
        try {
          registered = dshmlUnwrapRemote(await llm.listProviders()) ?? [];
        } catch (error) {
          warnings.push(String(error?.message ?? error));
        }
      }
    }
    let views = [];
    if (configForms !== null && typeof configForms === 'object' && typeof configForms.describe === 'function') {
      const mirror = configForms.describe();
      if (mirror !== null && typeof mirror === 'object') {
        if (typeof mirror.ensure === 'function') await mirror.ensure();
        const snapshot = typeof mirror.getSnapshot === 'function' ? mirror.getSnapshot() : null;
        const view = snapshot !== null && typeof snapshot === 'object' ? snapshot.view : null;
        if (view !== null && typeof view === 'object' && Array.isArray(view.namespaces)) views = view.namespaces;
      }
    }
    if (generation !== dshmlCatalogGeneration) return;
    const providers = dshmlBuildCatalog(directory, registered, views, dshmlIconState().overrides);
    if (providers.length === 0 && warnings.length > 0 && dshmlCatalogState().providers.length === 0) {
      dshmlPublishCatalog({ status: 'unavailable', providers: [], error: warnings[0] });
      return;
    }
    dshmlPublishCatalog({ status: 'ready', providers, error: null });
  } catch (error) {
    if (generation !== dshmlCatalogGeneration) return;
    dshmlPublishCatalog({
      status: dshmlCatalogState().providers.length > 0 ? 'ready' : 'unavailable',
      providers: dshmlCatalogState().providers,
      error: String(error?.message ?? error),
    });
  }
}

/** Debounced catalog refresh. */
function dshmlScheduleCatalogRefresh(delay) {
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
function dshmlMountSettingsScope(scope) {
  const configForms = dshmlServiceOf(scope, 'configForms');
  if (configForms === undefined) return function noop() {};
  dshmlConfigFormsService = configForms;
  const form = typeof configForms.get === 'function' ? configForms.get(DSHML_SETTINGS_NS) : null;
  if (form === null) return function noop() {};
  dshmlIconForm = form;
  const apply = () => dshmlAcceptIconForm(form);
  apply();
  const off = typeof form.subscribe === 'function' ? form.subscribe(apply) : null;
  let offMirror = null;
  try {
    const mirror = typeof configForms.describe === 'function' ? configForms.describe() : null;
    if (mirror !== null && typeof mirror === 'object') {
      if (typeof mirror.ensure === 'function') mirror.ensure();
      if (typeof mirror.subscribe === 'function') {
        offMirror = mirror.subscribe(() => dshmlScheduleCatalogRefresh(60));
      }
    }
  } catch {
    // The catalog refresh falls back to the timer.
  }
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlIconForm === form) dshmlIconForm = null;
    if (typeof off === 'function') off();
    if (typeof offMirror === 'function') offMirror();
  };
}

/** Wire the provider directory (`remote.llm` projected namespace). */
function dshmlMountRemoteLlmScope(scope) {
  const llm = dshmlServiceOf(scope, 'remote.llm');
  if (llm === undefined) return function noop() {};
  dshmlRemoteLlm = llm;
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlRemoteLlm === llm) dshmlRemoteLlm = null;
  };
}

/** Wire forwarded topology events from the remote root service. */
function dshmlMountRemoteScope(scope) {
  const remote = dshmlServiceOf(scope, 'remote');
  if (remote === undefined) return function noop() {};
  dshmlRemoteService = remote;
  let offEvent = null;
  try {
    if (typeof remote.$on === 'function') {
      offEvent = remote.$on('llm/adapters-updated', () => dshmlScheduleCatalogRefresh(120));
    }
  } catch {
    // Older hosts: the mirror subscription still refreshes the catalog.
  }
  if (offEvent === null && typeof scope.on === 'function') {
    try {
      const off = scope.on('llm/adapters-updated', () => dshmlScheduleCatalogRefresh(120));
      if (typeof off === 'function') offEvent = off;
    } catch {
      // Ignore an unavailable event bus.
    }
  }
  dshmlScheduleCatalogRefresh(0);
  return function cleanup() {
    if (dshmlRemoteService === remote) dshmlRemoteService = null;
    if (typeof offEvent === 'function') offEvent();
  };
}

/** Wire the DSH locale service so copy follows the app language. */
function dshmlMountLocaleScope(scope) {
  const locale = dshmlServiceOf(scope, 'locale');
  if (locale === undefined) return function noop() {};
  const apply = () => {
    let active = null;
    try {
      const snapshot = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null;
      active = snapshot !== null && typeof snapshot === 'object' ? snapshot.active : null;
    } catch {
      active = null;
    }
    dshmlSetLang(active);
    dshmlPublishIcons(dshmlIconState());
    dshmlPublishCatalog(dshmlCatalogState());
  };
  apply();
  const off = typeof locale.subscribe === 'function' ? locale.subscribe(apply) : null;
  return function cleanup() {
    if (typeof off === 'function') off();
  };
}

/**
 * Mount every optional service the plugin uses. Each scope is injected
 * independently: a deployment without the settings service keeps the composer
 * marks (they just stay heuristic-only).
 */
function dshmlMountIconStore(ctx) {
  if (ctx === null || typeof ctx !== 'object') return;
  const scopes = [
    ['locale', dshmlMountLocaleScope],
    ['configForms', dshmlMountSettingsScope],
    ['remote', dshmlMountRemoteScope],
    ['remote.llm', dshmlMountRemoteLlmScope],
  ];
  for (const [service, wire] of scopes) {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject([service], (child) => {
          child.effect(() => wire(child), 'dsh-model-logos: ' + service);
        });
      } else if (typeof ctx.get === 'function' && ctx.get(service) !== undefined) {
        ctx.effect(() => wire(ctx), 'dsh-model-logos: ' + service);
      }
    } catch (error) {
      console.warn('[dsh-model-logos] cannot inject ' + service, error);
    }
  }
}
