/**
 * Headless-Edge verification of the generated `client.js` against the faithful
 * Settings → Models DOM fixture.
 *
 * The fixture (`test/fixtures/settings-models.html`) reproduces the shipped page's
 * DOM: the Settings dialog shell from `@deepseek-ai/dsh-client-ui-settings-general`
 * wrapping the Models section from `@deepseek-ai/dsh-client-ui-settings-models`
 * (provider rows, an open provider editor with three model rows, the add-provider
 * catalog card with its native `<select>`).
 *
 * This script loads that fixture in headless Edge, adds React/ReactDOM 18 UMD,
 * a stub `window.__ModuleLoader__`, the real generated `client.js`, and a fake
 * plugin context (slots / locale / effect / on / inject / configForms / remote)
 * that records registrations, settings mutations, and disposers. It then drives
 * the same interactions a user would:
 *
 *   - vendor logo before the official provider row name (and none on the custom one)
 *   - model-logo buttons on every provider-editor model row
 *   - the custom combobox painted over the native provider `<select>`
 *   - clicking a model-row logo opens the picker modal
 *   - picking a brand writes the nested override through `configForms.mutate`
 *   - dispose removes every inserted node and restores the native select
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-dom.ts                          # assertions (exit 1 on failure)
 *   pnpm exec tsx scripts/verify-dom.ts --json .preview/dom.json # also save the raw result
 *   pnpm exec tsx scripts/verify-dom.ts --screenshot docs/preview-settings.png
 *                                                                # decorated page screenshot
 *   pnpm exec tsx scripts/verify-dom.ts --screenshot docs/preview-settings.png --open picker
 *                                                                # ... with the picker modal open
 *   pnpm exec tsx scripts/verify-dom.ts --harness <path>         # keep the generated page
 *
 * Requires Edge (`EDGE` env var may point at msedge.exe).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'settings-models.html');
const CLIENT = join(ROOT, 'client.js');
const REACT_UMD = join(ROOT, 'node_modules', 'react', 'umd', 'react.development.js');
const REACT_DOM_UMD = join(ROOT, 'node_modules', 'react-dom', 'umd', 'react-dom.development.js');

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | null => {
  const at = args.indexOf(flag);
  if (at < 0) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
};
const hasFlag = (flag: string): boolean => args.includes(flag);
const screenshotPath = valueAfter('--screenshot');
const openMode = valueAfter('--open') ?? 'combobox';
const jsonPath = valueAfter('--json');
const keptHarnessPath = valueAfter('--harness');
const requireBuild = hasFlag('--require-build');
const scale = Number(valueAfter('--scale') ?? 2) || 2;

/* -------------------------------------------------------------------------- */
/* Harness data                                                               */
/* -------------------------------------------------------------------------- */

/** One row of the fake provider directory. */
interface DirectoryEntry {
  provider: string;
  displayName: string;
  declared?: boolean;
  settingsNs: string;
  settingsPath: string[];
}

/** One option of the add-provider catalog `<select>`. */
interface SelectOption {
  value: string;
  label: string;
}

/** The serialized configuration handed to the in-page driver. */
interface DriverConfig {
  lang: string;
  providerRows: number;
  modelRows: number;
  directory: DirectoryEntry[];
  options: SelectOption[];
  officialProvider: { id: string; displayName: string };
  accountProvider: { id: string; displayName: string };
  customProvider: { id: string; displayName: string };
  firstModel: { providerId: string; modelId: string; displayName: string };
}

/**
 * Directory returned by `remote.llm.listConfigurableProviders()`; mirrors the fixture.
 *
 * Real catalog entries carry the route id as their display name (`llm-pi-ai`'s
 * `directoryEntries()` calls `declare(provider, provider)` for every installed
 * catalog route), while a saved profile may override it (`displayName`), which is
 * how the hand-declared 火山 Coding Plan row is named. The one localized outlier
 * is `deepseek-account`, whose row text is the page's `deepSeekAccount` copy.
 */
const DIRECTORY: DirectoryEntry[] = [
  {
    provider: 'deepseek-account',
    displayName: 'DeepSeek Account',
    settingsNs: 'llm-deepseek-account',
    settingsPath: [],
  },
  {
    provider: 'anthropic',
    displayName: 'anthropic',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'anthropic'],
  },
  {
    provider: 'volcengine',
    displayName: '火山 Coding Plan',
    declared: true,
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'volcengine'],
  },
  { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
  { provider: 'google', displayName: 'google', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'google'] },
  {
    provider: 'moonshotai',
    displayName: 'moonshotai',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'moonshotai'],
  },
  { provider: 'xai', displayName: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
  {
    provider: 'openrouter',
    displayName: 'openrouter',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'openrouter'],
  },
];

/** The add-provider catalog `<select>` options, in fixture order (text = display name). */
const SELECT_OPTIONS: SelectOption[] = [
  { value: 'openai', label: 'openai' },
  { value: 'google', label: 'google' },
  { value: 'moonshotai', label: 'moonshotai' },
  { value: 'xai', label: 'xai' },
  { value: 'openrouter', label: 'openrouter' },
];

const DRIVER_CONFIG: DriverConfig = {
  lang: 'zh',
  providerRows: 3,
  modelRows: 3,
  directory: DIRECTORY,
  options: SELECT_OPTIONS,
  officialProvider: { id: 'anthropic', displayName: 'anthropic' },
  accountProvider: { id: 'deepseek-account', displayName: 'DeepSeek 账号' },
  customProvider: { id: 'volcengine', displayName: '火山 Coding Plan' },
  firstModel: { providerId: 'anthropic', modelId: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5' },
};

/* -------------------------------------------------------------------------- */
/* In-page driver result types                                                */
/* -------------------------------------------------------------------------- */

/** One assertion recorded by the in-page driver. */
interface Assertion {
  name: string;
  required: boolean;
  ok: boolean;
  detail: string;
}

/** Counts of the inserted decoration (screenshot mode diagnostics). */
interface DecoratedCounts {
  vendor: number;
  modelRows: number;
  combobox: boolean;
  picker: boolean;
}

/** What the in-page driver reports for `--screenshot` runs. */
interface ScreenshotResult {
  mode: 'screenshot';
  open: string;
  decorated: DecoratedCounts;
  pageErrors: string[];
  consoleIssues: string[];
}

/** What the in-page driver reports for `--verify` runs. */
interface VerifyResult {
  ok: boolean;
  mode: 'verify';
  lang: string;
  assertions: Assertion[];
  pageErrors: string[];
  consoleIssues: string[];
  mutateCalls: unknown[];
  setCalls: Array<[unknown, unknown]>;
  slotRequests: string[];
  injected: string[];
  overrides: OverrideMap;
  // Diagnostics: where every inserted vendor mark landed.
  vendorMarkers: Array<{ provider: string | null; parent: string; inCombo: boolean }>;
  modelRowMarkers: number;
}

type DriverResult = VerifyResult | ScreenshotResult;

/** `modelIcons[providerId][modelId] = icon key` as the plugin persists it. */
type OverrideMap = Record<string, Record<string, string>>;

/** A cleanup returned by a plugin effect / slot registration. */
type Cleanup = () => void;

/** One slot registration recorded by the fake context. */
interface RecordedRegistration {
  options: Record<string, unknown> | undefined;
  component: unknown;
  slot: unknown;
}

/** What the bundle factory hands back: its `apply` mount point. */
interface BundleExports {
  apply(context: unknown): unknown;
}

/** The loader definition `client.js` hands to `window.__ModuleLoader__.load`. */
interface BundleDefinition {
  factory(requireModule: (id: string) => unknown): unknown;
}

/** The subset of the React UMD build the harness page uses. */
interface ReactUmd {
  createElement(type: unknown, props?: Record<string, unknown> | null): unknown;
  Fragment: unknown;
}

/** A React root as this harness drives it. */
interface ReactRootLike {
  render(node: unknown): void;
  unmount(): void;
}

/** The subset of the ReactDOM UMD build the harness page uses. */
interface ReactDomUmd {
  createRoot(container: Element): ReactRootLike;
}

/** One settings document value the fake config form stores. */
interface SettingsValue {
  modelIcons: OverrideMap;
  [key: string]: unknown;
}

/** Snapshot the fake settings form serves. */
interface FormSnapshot {
  status: string;
  value: SettingsValue;
  base: Record<string, never>;
  user: SettingsValue;
  revision: number;
  writable: boolean;
}

/** One menu item of the custom provider combobox. */
interface MenuItem {
  value: string | undefined;
  label: string;
  node: HTMLElement;
}

/** The mutable harness bookkeeping the driver asserts against. */
interface HarnessState {
  cleanups: Cleanup[];
  registrations: RecordedRegistration[];
  slotRequests: string[];
  injected: string[];
  mutateCalls: unknown[];
  setCalls: Array<[unknown, unknown]>;
  formListeners: Array<(snapshot: FormSnapshot) => void>;
  // The persisted nested dict: modelIcons[providerId][modelId] = icon key.
  overrides: OverrideMap;
  revision: number;
  errors: string[];
}

declare global {
  interface Window {
    /** Fixture harness global: the loader stub parks the bundle definition here. */
    __dshmlModule: BundleDefinition | null;
    /** React 18 UMD build injected by the fixture harness. */
    React: ReactUmd;
    /** ReactDOM 18 UMD build injected by the fixture harness. */
    ReactDOM: ReactDomUmd;
  }
}

/* -------------------------------------------------------------------------- */
/* In-page driver                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Runs inside headless Edge. Must stay a pure browser function: it is serialized
 * with `Function.prototype.toString` and injected into the harness page.
 */
async function browserDriver(config: DriverConfig): Promise<void> {
  'use strict';

  /** JSON round-trip used to snapshot recorded operations. */
  const cloneJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  /** True for any non-null object (arrays included). */
  const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

  /** The stack of anything thrown in the page. */
  const errorText = (error: unknown): string => {
    if (isRecord(error) && typeof error.stack === 'string') return error.stack;
    return String(error);
  };

  /** True when a cleanup returned by the bundle is callable. */
  const isCleanup = (value: unknown): value is Cleanup => typeof value === 'function';

  /** True when the factory returned the bundle's `{ apply }` exports. */
  const isBundleExports = (value: unknown): value is BundleExports =>
    isRecord(value) && typeof value.apply === 'function';

  // Keep the dumped DOM small: React's development UMD builds are ~1MB each and
  // they are already executing safely by the time this last script runs.
  document.querySelectorAll('script').forEach((scriptTag) => scriptTag.remove());

  const params = new URLSearchParams(location.search);
  const MODE = params.get('mode') || 'verify';
  const OPEN = params.get('open') || '';

  const pageErrors: string[] = [];
  const consoleIssues: string[] = [];

  window.addEventListener('error', (event: ErrorEvent) => {
    pageErrors.push('window.error: ' + (event.message || String(event.error)));
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    pageErrors.push(
      'unhandledrejection: ' + (isRecord(reason) && typeof reason.stack === 'string' ? reason.stack : String(reason)),
    );
  });
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]): void => {
      consoleIssues.push(
        level +
          ': ' +
          parts
            .map((part) => {
              try {
                return typeof part === 'string' ? part : JSON.stringify(part);
              } catch {
                return String(part);
              }
            })
            .join(' '),
      );
      original(...parts);
    };
  }

  /* ------------------------------ tiny helpers ----------------------------- */

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((done) => {
      setTimeout(done, ms);
    });
  const now = (): number => performance.now();
  const waitFor = async <T>(probe: () => T | null | undefined, timeoutMs?: number): Promise<NonNullable<T> | null> => {
    const startedAt = now();
    const limit = timeoutMs === undefined ? 4000 : timeoutMs;
    for (;;) {
      let value: T | null | undefined = null;
      try {
        value = probe();
      } catch {
        value = null;
      }
      if (value) return value as NonNullable<T>;
      if (now() - startedAt >= limit) return null;
      await sleep(30);
    }
  };
  const q = <T extends Element = HTMLElement>(selector: string, root?: ParentNode | null): T | null =>
    (root ?? document).querySelector<T>(selector);
  const qa = <T extends Element = HTMLElement>(selector: string, root?: ParentNode | null): T[] =>
    Array.from((root ?? document).querySelectorAll<T>(selector));
  const text = (node: Element | null | undefined): string =>
    node
      ? String(node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  const visible = (node: Element | null | undefined): boolean => {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0.01
    );
  };
  const describeNode = (node: Element | null | undefined): string => {
    if (!node) return 'null';
    const id = node.id ? '#' + node.id : '';
    const rawClass: unknown = node.className;
    const className =
      typeof rawClass === 'string' && rawClass.trim() !== '' ? '.' + rawClass.trim().replace(/\s+/g, '.') : '';
    return node.tagName.toLowerCase() + id + className;
  };
  const isBefore = (first: Element | null, second: Element | null): boolean =>
    first !== null &&
    second !== null &&
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  const assertions: Assertion[] = [];
  const add = (name: string, required: boolean, ok: boolean, detail?: unknown): boolean => {
    assertions.push({
      name,
      required: required !== false,
      ok: ok === true,
      detail: detail === undefined || detail === null ? '' : String(detail),
    });
    return ok === true;
  };

  /* --------------------------- fake plugin context -------------------------- */

  const H: HarnessState = {
    cleanups: [],
    registrations: [],
    slotRequests: [],
    injected: [],
    mutateCalls: [],
    setCalls: [],
    formListeners: [],
    overrides: {},
    revision: 1,
    errors: [],
  };

  // What `form.getSnapshot().value` returns: the settings document value with the
  // host plugin's `modelIcons` volatile field on top. Path ops arrive relative to
  // this root (`['modelIcons', providerId, modelId]`), so the harness applies
  // them here — `H.overrides` always stays the inner dict the plugin reads.
  const settingsValue: SettingsValue = { modelIcons: H.overrides };

  function setPath(root: Record<string, unknown>, path: readonly unknown[], value: unknown): void {
    let node: Record<string, unknown> = root;
    for (let index = 0; index < path.length - 1; index++) {
      const key = String(path[index]);
      const existing = node[key];
      if (existing === null || typeof existing !== 'object') node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[String(path[path.length - 1])] = value;
  }

  function unsetPath(root: Record<string, unknown>, path: readonly unknown[]): void {
    const parents: Array<[Record<string, unknown>, string]> = [];
    let node: Record<string, unknown> = root;
    for (let index = 0; index < path.length - 1; index++) {
      const key = String(path[index]);
      const child = node[key];
      if (child === null || typeof child !== 'object') return;
      parents.push([node, key]);
      node = child as Record<string, unknown>;
    }
    delete node[String(path[path.length - 1])];
    for (let index = parents.length - 1; index >= 0; index--) {
      const parent = parents[index];
      if (parent === undefined) continue;
      const [target, key] = parent;
      const value = target[key];
      if (value && typeof value === 'object' && Object.keys(value).length === 0) delete target[key];
      else break;
    }
  }

  const fieldPath = (field: unknown): unknown[] => (Array.isArray(field) ? field : String(field).split('.'));

  let cachedSnapshot: FormSnapshot | null = null;
  const buildSnapshot = (): FormSnapshot => ({
    status: 'ready',
    value: settingsValue,
    base: {},
    user: settingsValue,
    revision: H.revision,
    writable: true,
  });
  const notifyForm = (): void => {
    cachedSnapshot = buildSnapshot();
    const snapshot = cachedSnapshot;
    for (const listener of H.formListeners.slice()) {
      try {
        listener(snapshot);
      } catch (error) {
        H.errors.push('form listener: ' + errorText(error));
      }
    }
  };

  const form = {
    // The settings namespace the plugin owns; any other id is not a form.
    getSnapshot(): FormSnapshot {
      if (cachedSnapshot === null) cachedSnapshot = buildSnapshot();
      return cachedSnapshot;
    },
    subscribe(listener: (snapshot: FormSnapshot) => void): () => void {
      H.formListeners.push(listener);
      return () => {
        const at = H.formListeners.indexOf(listener);
        if (at >= 0) H.formListeners.splice(at, 1);
      };
    },
    mutate(operations: unknown): boolean {
      H.mutateCalls.push(cloneJson(operations));
      try {
        for (const candidate of Array.isArray(operations) ? operations : []) {
          if (!isRecord(candidate)) continue;
          const path = candidate.path;
          if (!Array.isArray(path) || path.length === 0) continue;
          if (candidate.op === 'set') setPath(settingsValue, path, candidate.value);
          else if (candidate.op === 'unset') unsetPath(settingsValue, path);
        }
      } catch (error) {
        H.errors.push('form.mutate: ' + errorText(error));
      }
      H.revision += 1;
      notifyForm();
      return true;
    },
    set(field: unknown, value: unknown): boolean {
      H.setCalls.push([cloneJson(field), cloneJson(value)]);
      setPath(settingsValue, fieldPath(field), value);
      H.revision += 1;
      notifyForm();
      return true;
    },
    unset(field: unknown): boolean {
      H.setCalls.push([cloneJson(field), '<unset>']);
      unsetPath(settingsValue, fieldPath(field));
      H.revision += 1;
      notifyForm();
      return true;
    },
  };

  const configForms = {
    get(id: string): typeof form | null {
      return id === 'dsh-model-logos' ? form : null;
    },
    // The settings mirror: the plugin calls ensure()/getSnapshot()/subscribe()
    // and reads view.namespaces for the model catalog. This deployment has no
    // extra namespaces to contribute.
    describe(): {
      ensure(): Promise<void>;
      getSnapshot(): { view: { namespaces: unknown[] } };
      subscribe(): () => void;
    } {
      return {
        ensure(): Promise<void> {
          return Promise.resolve();
        },
        getSnapshot(): { view: { namespaces: unknown[] } } {
          return { view: { namespaces: [] } };
        },
        subscribe(): () => void {
          return () => {};
        },
      };
    },
  };

  const llm = {
    listConfigurableProviders(): Promise<DirectoryEntry[]> {
      return Promise.resolve(config.directory.map((entry) => Object.assign({}, entry)));
    },
    listProviders(): Promise<Array<{ id: string; name: string }>> {
      return Promise.resolve([{ id: 'deepseek-account', name: 'DeepSeek Account' }]);
    },
    discoverModels(): Promise<unknown[]> {
      return Promise.resolve([]);
    },
  };
  const remote = {
    llm,
    settings: {
      get(): Promise<undefined> {
        return Promise.resolve(undefined);
      },
    },
  };

  const localeListeners: Array<() => void> = [];
  const locale = {
    getSnapshot(): { active: string; locales: string[] } {
      return { active: config.lang, locales: [config.lang] };
    },
    subscribe(listener: () => void): () => void {
      localeListeners.push(listener);
      return () => {
        const at = localeListeners.indexOf(listener);
        if (at >= 0) localeListeners.splice(at, 1);
      };
    },
  };

  const slots = {
    inject(name: string, callback: () => unknown): () => void {
      H.slotRequests.push(name);
      // Only slots the fixture declares would resolve in the real app.
      if (name === 'conversation.input.model.label' || name === 'settings.section') {
        try {
          callback();
        } catch (error) {
          H.errors.push('slots.inject(' + name + '): ' + errorText(error));
        }
      }
      return () => {};
    },
    register(options: unknown, component: unknown): { dispose(): void } {
      const record = isRecord(options) ? options : undefined;
      H.registrations.push({ options: record, component, slot: record === undefined ? undefined : record.name });
      return { dispose(): void {} };
    },
  };

  const services: Record<string, unknown> = {
    slots,
    locale,
    configForms,
    remote,
    // Cordis projects service namespaces as their own injected keys: the plugin
    // injects `remote.llm` (not `remote`) because property reads of a folded name
    // are refused on a context that did not inject it. Resolve the exact key.
    'remote.llm': llm,
    llm,
    theme: {
      getSnapshot(): { mode: string; appearance: string } {
        return { mode: 'light', appearance: 'light' };
      },
      subscribe(): () => void {
        return () => {};
      },
    },
    connection: {
      getSnapshot(): { status: string } {
        return { status: 'connected' };
      },
      subscribe(): () => void {
        return () => {};
      },
    },
  };

  function effect(callback: () => unknown, label?: string): () => void {
    try {
      const dispose = callback();
      if (isCleanup(dispose)) H.cleanups.push(dispose);
      else if (Array.isArray(dispose)) {
        for (const candidate of dispose) if (isCleanup(candidate)) H.cleanups.push(candidate);
      }
    } catch (error) {
      H.errors.push('effect(' + (label || 'unlabelled') + '): ' + errorText(error));
    }
    return () => {};
  }

  /** Resolve a service by the exact key the bundle asks for (`remote.llm` included). */
  function getService(name: unknown): unknown {
    if (typeof name !== 'string') return undefined;
    if (Object.prototype.hasOwnProperty.call(services, name)) return services[name];
    // Tolerate a dotted read that was requested as a property chain.
    if (name.includes('.')) {
      let node: unknown = services;
      for (const part of name.split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[part];
      }
      return node;
    }
    return undefined;
  }

  const on = (): (() => void) => () => {};

  function inject(dependencies: unknown, callback: (scope: unknown) => unknown): () => void {
    const requested: unknown[] = Array.isArray(dependencies)
      ? dependencies
      : dependencies === undefined
        ? []
        : [dependencies];
    H.injected.push(...requested.map((name) => String(name)));
    try {
      const dispose = callback(makeContext());
      if (isCleanup(dispose)) H.cleanups.push(dispose);
    } catch (error) {
      H.errors.push('inject(' + JSON.stringify(requested) + '): ' + errorText(error));
    }
    return () => {};
  }

  function makeContext(): Record<string, unknown> {
    return {
      slots,
      locale,
      configForms,
      remote,
      // Convenience properties mirroring the injected namespaces; the bundle reads
      // `remote.llm` through get(), but a property read must stay harmless.
      llm,
      theme: services.theme,
      connection: services.connection,
      effect,
      on,
      inject,
      get: getService,
    };
  }

  /* ----------------------------- bundle loading ---------------------------- */

  function makeJsxRuntime(): Record<string, unknown> {
    const React = window.React;
    const create = (type: unknown, config: unknown, maybeKey?: unknown): unknown => {
      const props: Record<string, unknown> = {};
      let key = maybeKey;
      if (config !== null && config !== undefined) {
        for (const name in config) {
          const value = (config as Record<string, unknown>)[name];
          if (name === 'key') key = value;
          else props[name] = value;
        }
      }
      if (key !== undefined) props.key = key;
      return React.createElement(type, props);
    };
    return { Fragment: React.Fragment, jsx: create, jsxs: create, jsxDEV: create };
  }

  function makeRequire(): (id: string) => unknown {
    return (id: string): unknown => {
      if (id === 'react') return window.React;
      if (id === 'react-dom') return window.ReactDOM;
      if (id === 'react-dom/client') {
        return { createRoot: window.ReactDOM.createRoot };
      }
      if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return makeJsxRuntime();
      throw new Error('harness has no module for require(' + JSON.stringify(id) + ')');
    };
  }

  let exported: BundleExports | null = null;
  try {
    const definition = window.__dshmlModule;
    if (!definition || typeof definition.factory !== 'function') {
      throw new Error('client.js did not call window.__ModuleLoader__.load({ factory })');
    }
    const factoryResult = definition.factory(makeRequire());
    if (!isBundleExports(factoryResult)) throw new Error('the bundle factory did not return { apply }');
    exported = factoryResult;
  } catch (error) {
    H.errors.push('factory: ' + errorText(error));
  }

  let applyDispose: unknown = null;
  if (exported !== null) {
    try {
      applyDispose = exported.apply(makeContext());
      if (isCleanup(applyDispose)) H.cleanups.push(applyDispose);
    } catch (error) {
      H.errors.push('apply: ' + errorText(error));
    }
  }

  const root = q('[data-shortcut-modal="settings"]');
  const rowCards = root ? qa('li.jrmgQW_rowCard', root) : [];
  const modelEntries = root ? qa('.jrmgQW_modelEntry', root) : [];
  const modelRows = modelEntries
    .map((entry) => q('.jrmgQW_modelRow', entry))
    .filter((row): row is HTMLElement => row !== null);

  /* -------------------------- decoration locators -------------------------- */

  const vendorMarkers = (): HTMLElement[] => qa('[data-dshml-vendor]');

  function findProviderRow(displayName: string): HTMLElement | null {
    return rowCards.filter((row) => text(q('.jrmgQW_rowName', row)) === displayName)[0] ?? null;
  }

  /** Model rows carry [data-dshml-model-row] once decorated; the button is `.dshml-model-icon-btn`. */
  function modelRowNodes(): HTMLElement[] {
    return root ? qa('[data-dshml-model-row]', root) : [];
  }

  function findModelRowButton(index: number): HTMLButtonElement | null {
    const row = modelRowNodes()[index];
    if (!row) return null;
    return q<HTMLButtonElement>('.dshml-model-icon-btn', row);
  }

  function findComboboxFace(select: Element | null): HTMLElement | null {
    if (!select) return null;
    const field = select.closest('.jrmgQW_field');
    const scopes: ParentNode[] = [field, root].filter((scope): scope is HTMLElement => scope !== null);
    for (const scope of scopes) {
      for (const button of qa('.dshml-combo-button', scope)) {
        if (button !== select && visible(button)) return button;
      }
      for (const node of qa('[role="combobox"]', scope)) {
        if (node !== select && visible(node)) return node;
      }
    }
    return null;
  }

  /** The open `.dshml-combo-menu` (hidden while the combobox is closed). */
  function findComboMenu(): HTMLElement | null {
    const direct =
      qa('.dshml-combo .dshml-combo-menu, [data-dshml-combo="1"] [role="listbox"]').filter(visible)[0] ?? null;
    if (direct) return direct;
    // Fallback: the smallest visible element that carries every option label.
    const labels = config.options.map((option) => option.label);
    const candidates = qa('body *').filter((node) => {
      if (node === document.body || node.closest('select')) return false;
      if (!visible(node)) return false;
      const content = text(node);
      if (content === '') return false;
      for (const label of labels) if (content.indexOf(label) < 0) return false;
      return true;
    });
    candidates.sort((left, right) => text(left).length - text(right).length);
    return candidates[0] ?? null;
  }

  /** Menu entries carry `data-value`; fall back to matching their label text. */
  function findMenuItems(menu: Element | null): MenuItem[] {
    if (!menu) return [];
    const items = qa('.dshml-combo-item[data-value]', menu);
    if (items.length > 0) {
      return items.map((node) => ({
        value: node.dataset.value,
        label: text(q('.dshml-combo-item-label', node)) || text(node),
        node,
      }));
    }
    const fallback: MenuItem[] = [];
    for (const option of config.options) {
      const candidates: HTMLElement[] = qa('*', menu).filter((node) => text(node) === option.label);
      let smallest: HTMLElement | null = null;
      for (const candidate of candidates) if (smallest === null || smallest.contains(candidate)) smallest = candidate;
      if (smallest) fallback.push({ value: option.value, label: option.label, node: smallest });
    }
    return fallback;
  }

  function clickable(node: HTMLElement): HTMLElement {
    return node.closest<HTMLElement>('button, [role="option"], [role="menuitem"], [role="menuitemradio"], li') || node;
  }

  /** The icon picker modal root is `[data-dshml-picker]` (portaled into body). */
  function findPicker(): HTMLElement | null {
    const direct = qa('[data-dshml-picker]').filter(visible)[0] ?? null;
    if (direct) return direct;
    const candidates = qa('.dshml-picker-layer, [role="dialog"]').filter(
      (node) => !node.hasAttribute('data-shortcut-modal') && visible(node),
    );
    return candidates[0] ?? null;
  }

  function pickerTitle(picker: Element | null): string {
    const title = picker ? q('.dshml-picker-title', picker) : null;
    return title ? text(title) : '';
  }

  function findPickerOption(picker: Element | null, label: string): HTMLElement | null {
    if (!picker) return null;
    const nodes = qa('.dshml-picker-option, [aria-label], [title], button, [role="option"]', picker);
    for (const node of nodes) {
      const name = (node.getAttribute('aria-label') || node.getAttribute('title') || text(node)).trim();
      if (name === label) return node;
    }
    const labelled = qa('*', picker).filter((node) => text(node) === label);
    let smallest: HTMLElement | null = null;
    for (const node of labelled) if (smallest === null || smallest.contains(node)) smallest = node;
    return smallest;
  }

  async function chooseInCombobox(
    face: HTMLElement | null,
    select: HTMLSelectElement | null,
    value: string,
  ): Promise<boolean> {
    if (!face || !select) return false;
    if (face.getAttribute('aria-expanded') !== 'true') face.click();
    const menu = await waitFor(findComboMenu, 3000);
    if (!menu) return false;
    const item = findMenuItems(menu).filter((candidate) => candidate.value === value)[0];
    if (!item) return false;
    clickable(item.node).click();
    const selected = await waitFor(() => select.value === value, 3000);
    return !!selected;
  }

  /* -------------------------------- routing -------------------------------- */

  if (MODE === 'screenshot') {
    await waitFor(() => qa('[data-dshml-model-row]').length >= config.modelRows || vendorMarkers().length > 0, 6000);
    document.documentElement.setAttribute('data-dshml-screenshot', '1');
    await sleep(150);
    if (OPEN === 'combobox' || OPEN === 'menu') {
      const select = q<HTMLSelectElement>('.jrmgQW_addPanel select', root);
      const face = select ? findComboboxFace(select) : null;
      if (face) face.click();
      await waitFor(findComboMenu, 3000);
    } else if (OPEN === 'picker') {
      const button = findModelRowButton(0);
      if (button) button.click();
      await waitFor(findPicker, 5000);
    }
    await sleep(350);
    const screenshotResult: ScreenshotResult = {
      mode: 'screenshot',
      open: OPEN,
      decorated: {
        vendor: vendorMarkers().length,
        modelRows: qa('[data-dshml-model-row]').length,
        combobox: !!findComboboxFace(q<HTMLSelectElement>('.jrmgQW_addPanel select', root)),
        picker: !!findPicker(),
      },
      pageErrors,
      consoleIssues,
    };
    const pre = document.createElement('pre');
    pre.id = 'dshml-result';
    pre.textContent = JSON.stringify(screenshotResult, null, 2);
    pre.style.display = 'none';
    document.body.appendChild(pre);
  } else {
    /* ------------------------------ assertions ------------------------------ */

    add(
      'fixture: settings dialog root present',
      true,
      !!root,
      root ? describeNode(root) : 'missing [data-shortcut-modal="settings"]',
    );
    add(
      'fixture: three saved provider rows (account + official + declared) and three model rows',
      true,
      rowCards.length === config.providerRows && modelRows.length === config.modelRows,
      'provider rows=' + rowCards.length + ', model rows=' + modelRows.length,
    );

    // Give the decorator's async directory fetch + observer debounce time to land.
    await waitFor(() => vendorMarkers().length > 0, 6000);
    await sleep(150);

    // The DeepSeek account row: the page renders the localized `deepSeekAccount`
    // copy ("DeepSeek 账号"), not the directory display name ("DeepSeek Account"),
    // so only the display-name alias can resolve it. It has no Edit/Delete button
    // (the page suppresses Edit for the account route and it is not removable),
    // yet the vendor mark must still land before its row name.
    const accountRow = findProviderRow(config.accountProvider.displayName);
    const accountName = accountRow ? q('.jrmgQW_rowName', accountRow) : null;
    const accountMarker =
      (accountName
        ? qa('[data-dshml-vendor="' + config.accountProvider.id + '"]', accountRow).filter(
            (marker) => marker.parentElement === accountName.parentElement,
          )[0]
        : null) ?? null;
    add(
      'vendor logo before localized account row name (deepseek-account alias)',
      true,
      !!accountMarker && !!q('svg', accountMarker) && isBefore(accountMarker, accountName),
      accountMarker
        ? 'marker ' + describeNode(accountMarker) + ' precedes ' + describeNode(accountName)
        : 'no [data-dshml-vendor="' +
            config.accountProvider.id +
            '"] beside "' +
            config.accountProvider.displayName +
            '"; row buttons=' +
            (accountRow ? qa('button[aria-label]', accountRow).length : 'row missing'),
    );

    const officialRow = findProviderRow(config.officialProvider.displayName);
    const officialName = officialRow ? q('.jrmgQW_rowName', officialRow) : null;
    const rowMarker =
      (officialName
        ? qa('[data-dshml-vendor="' + config.officialProvider.id + '"]', officialRow).filter(
            (marker) => marker.parentElement === officialName.parentElement,
          )[0]
        : null) ?? null;
    add(
      'vendor logo before official provider row name (' + config.officialProvider.displayName + ')',
      true,
      !!rowMarker && !!q('svg', rowMarker) && isBefore(rowMarker, officialName),
      rowMarker
        ? 'marker ' + describeNode(rowMarker) + ' precedes ' + describeNode(officialName)
        : 'no [data-dshml-vendor="' +
            config.officialProvider.id +
            '"] beside .jrmgQW_rowName; markers=' +
            JSON.stringify(qa('[data-dshml-vendor]').map((node) => node.getAttribute('data-dshml-vendor'))),
    );
    if (rowMarker) {
      const box = rowMarker.getBoundingClientRect();
      add(
        'vendor logo is sized to the 14px row text',
        false,
        box.height >= 10 && box.height <= 22 && box.width >= 10 && box.width <= 22,
        'marker box ' + Math.round(box.width) + '×' + Math.round(box.height) + 'px',
      );
    }

    const editorTitle = officialRow ? q('.jrmgQW_editorHeader .jrmgQW_editorTitle', officialRow) : null;
    const titleMarker =
      (editorTitle
        ? qa('[data-dshml-vendor="' + config.officialProvider.id + '"]', officialRow).filter(
            (marker) => marker.parentElement === editorTitle.parentElement && isBefore(marker, editorTitle),
          )[0]
        : null) ?? null;
    add(
      'vendor logo before the provider editor title',
      true,
      !!titleMarker && !!q('svg', titleMarker),
      titleMarker
        ? 'marker ' + describeNode(titleMarker) + ' precedes ' + describeNode(editorTitle)
        : 'editor title ' + describeNode(editorTitle) + ' has no preceding vendor marker',
    );

    const customRow = findProviderRow(config.customProvider.displayName);
    add(
      'no vendor logo on the hand-declared provider (' + config.customProvider.id + ')',
      true,
      !!customRow &&
        qa('[data-dshml-vendor]', customRow).length === 0 &&
        qa('[data-dshml-vendor="' + config.customProvider.id + '"]').length === 0,
      customRow
        ? 'markers inside custom row=' + qa('[data-dshml-vendor]', customRow).length
        : 'custom provider row not found',
    );

    const select = q<HTMLSelectElement>('.jrmgQW_addPanel select', root);
    const optionPollution = select
      ? qa<HTMLOptionElement>('option', select).filter(
          (option) => option.children.length > 0 || qa('[data-dshml-vendor]', option).length > 0,
        )
      : [];
    add(
      'no decoration inserted inside native <select> options',
      true,
      !!select && optionPollution.length === 0 && qa('[data-dshml-vendor]', select || root).length === 0,
      optionPollution.length === 0
        ? 'options untouched'
        : 'polluted options: ' + optionPollution.map((option) => option.value).join(', '),
    );

    const rowStates = qa('.jrmgQW_modelEntry .jrmgQW_modelRow', root).map((row, index) => {
      const first = row.firstElementChild;
      const button =
        first !== null && first.classList.contains('dshml-model-icon-btn') ? first : q('.dshml-model-icon-btn', row);
      const mark = button ? q('.dshml-model-mark', button) : null;
      return {
        index,
        row,
        first,
        marked: row.getAttribute('data-dshml-model-row') === '1',
        button,
        childCount: row.children.length,
        hasSvg: !!mark && !!q('svg', mark),
        placeholder: !!button && !!q('.dshml-model-placeholder', button),
        ariaLabel: button ? button.getAttribute('aria-label') || '' : '',
      };
    });
    add(
      'model-logo buttons on all three model rows',
      true,
      rowStates.length === config.modelRows &&
        rowStates.every(
          (state) =>
            state.marked &&
            state.button !== null &&
            state.first === state.button &&
            state.childCount === 5 &&
            state.ariaLabel !== '',
        ),
      JSON.stringify(
        rowStates.map((state) => ({
          row: state.index + 1,
          first: state.first
            ? state.first.tagName.toLowerCase() +
              '.' +
              (typeof state.first.className === 'string' ? state.first.className.split(' ')[0] : '')
            : 'none',
          marked: state.marked,
          children: state.childCount,
          ariaLabel: state.ariaLabel,
        })),
      ),
    );
    add(
      'every model row shows a brand mark (heuristic initial icon, not the placeholder)',
      true,
      rowStates.length === config.modelRows && rowStates.every((state) => state.hasSvg && !state.placeholder),
      JSON.stringify(
        rowStates.map((state) => ({ row: state.index + 1, svg: state.hasSvg, placeholder: state.placeholder })),
      ),
    );
    const gridTrackCounts = qa('.jrmgQW_modelEntry .jrmgQW_modelRow', root).map((row) => {
      const value = getComputedStyle(row).gridTemplateColumns;
      return value === 'none' ? 0 : value.trim().split(/\s+/).filter(Boolean).length;
    });
    add(
      'model row grid gains an extra auto column (5 tracks)',
      true,
      modelRows.length === config.modelRows && gridTrackCounts.every((count) => count === 5),
      'grid-template-columns track counts=' + JSON.stringify(gridTrackCounts),
    );

    const selectHiddenOk = ((): boolean => {
      if (!select) return false;
      const style = getComputedStyle(select);
      const opacityHidden = Number(style.opacity) === 0 || parseFloat(style.height) === 0;
      return (
        select.getAttribute('aria-hidden') === 'true' &&
        select.tabIndex === -1 &&
        style.position === 'absolute' &&
        style.pointerEvents === 'none' &&
        opacityHidden
      );
    })();
    add(
      'native provider select is hidden in place but kept as the state source',
      true,
      selectHiddenOk,
      select
        ? 'aria-hidden=' +
            select.getAttribute('aria-hidden') +
            ' tabIndex=' +
            select.tabIndex +
            ' position=' +
            getComputedStyle(select).position +
            ' opacity=' +
            getComputedStyle(select).opacity +
            ' pointer-events=' +
            getComputedStyle(select).pointerEvents +
            ' height=' +
            getComputedStyle(select).height
        : 'no select found',
    );

    const face = select ? findComboboxFace(select) : null;
    add(
      'custom combobox face replaces the native select visually',
      true,
      !!face &&
        face.classList.contains('dshml-combo-button') &&
        visible(face) &&
        text(face).indexOf(text(select?.options[select.selectedIndex])) >= 0,
      face
        ? 'face ' + describeNode(face) + ' -> "' + text(face) + '"'
        : 'no visible .dshml-combo-button after the hidden select',
    );

    let changeEvents = 0;
    if (select) {
      select.addEventListener('change', () => {
        changeEvents += 1;
      });
    }

    let menu: HTMLElement | null = null;
    let menuItems: MenuItem[] = [];
    if (face && select) {
      face.click();
      menu = await waitFor(findComboMenu, 4000);
      menuItems = menu ? findMenuItems(menu) : [];
      add(
        'combobox popup lists every provider option with vendor logos',
        true,
        menu !== null &&
          menuItems.length === config.options.length &&
          menuItems.every((item) => config.options.some((option) => option.value === item.value)) &&
          menuItems.filter((item) => q('svg', item.node) !== null).length >= config.options.length - 1,
        menu === null
          ? 'no open .dshml-combo-menu containing all option labels'
          : 'items=' +
              JSON.stringify(
                menuItems.map((item) => ({ value: item.value, label: item.label, svg: !!q('svg', item.node) })),
              ),
      );

      // The decorator inserts marks before *provider identity* text; it must never
      // touch the plugin's own combobox DOM (each menu item already draws its mark).
      // Wait out the decorator's 40 ms debounce so a pass over the open menu lands.
      await sleep(250);
      const leakedIntoCombo = qa('.dshml-combo [data-dshml-vendor]').length;
      add(
        "decoration stays out of the plugin's own combobox UI",
        true,
        leakedIntoCombo === 0,
        leakedIntoCombo === 0
          ? 'no vendor markers inside .dshml-combo'
          : leakedIntoCombo +
              ' vendor marker(s) inserted inside .dshml-combo: ' +
              JSON.stringify(
                qa('.dshml-combo [data-dshml-vendor]').map((node) => ({
                  provider: node.getAttribute('data-dshml-vendor'),
                  parent: describeNode(node.parentElement),
                })),
              ),
      );

      const choseGoogle = await chooseInCombobox(face, select, 'google');
      add(
        'combobox selection writes back to the native select (google)',
        true,
        choseGoogle && select.value === 'google' && changeEvents > 0,
        'select.value="' + select.value + '" change events=' + changeEvents,
      );
      const faceAfter = findComboboxFace(select);
      const selectedLabel = text(select.options[select.selectedIndex]);
      add(
        'combobox face re-syncs to the selected option',
        true,
        !!faceAfter && text(faceAfter).indexOf(selectedLabel) >= 0 && selectedLabel === 'google',
        faceAfter ? 'face -> "' + text(faceAfter) + '" (selected "' + selectedLabel + '")' : 'face vanished',
      );
      // Put the select back on OpenAI so later steps/screenshots read naturally.
      const restored = await chooseInCombobox(findComboboxFace(select), select, 'openai');
      add('combobox selection restores (openai)', false, restored, 'select.value="' + select.value + '"');
      // Close any still-open menu without selecting: an outside pointerdown closes it.
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await sleep(120);
    } else {
      add('combobox popup lists every provider option with vendor logos', true, false, 'skipped: no combobox face');
      add('combobox selection writes back to the native select (google)', true, false, 'skipped: no combobox face');
      add('combobox face re-syncs to the selected option', true, false, 'skipped: no combobox face');
    }

    // Clicking a model-row logo opens the picker.
    const firstMarkedRow = q('[data-dshml-model-row="1"]', root);
    const iconButton =
      (firstMarkedRow ? q<HTMLButtonElement>('.dshml-model-icon-btn', firstMarkedRow) : null) || findModelRowButton(0);
    const markBefore = iconButton ? (q('.dshml-model-mark', iconButton)?.innerHTML ?? '') : '';
    add(
      'model row exposes a clickable `.dshml-model-icon-btn`',
      true,
      !!iconButton && iconButton.tagName === 'BUTTON' && iconButton.type === 'button',
      iconButton ? describeNode(iconButton) : 'no .dshml-model-icon-btn in [data-dshml-model-row="1"]',
    );
    let picker: HTMLElement | null = null;
    if (iconButton) {
      iconButton.click();
      picker = await waitFor(findPicker, 5000);
      const title = pickerTitle(picker);
      add(
        'clicking a model-row logo opens the icon picker modal',
        true,
        !!picker && (title.indexOf('选择模型图标') >= 0 || title.indexOf('Choose model icon') >= 0),
        picker ? 'root ' + describeNode(picker) + ' title "' + title + '"' : 'no [data-dshml-picker] modal appeared',
      );
    } else {
      add('clicking a model-row logo opens the icon picker modal', true, false, 'skipped: no picker button');
    }

    // Picking a brand writes the nested override through configForms.mutate.
    let write: unknown[] | null = null;
    if (picker !== null) {
      const pickerNode = picker;
      const brandOption = findPickerOption(pickerNode, 'OpenAI');
      add(
        'picker offers brand options',
        true,
        !!brandOption && brandOption.classList.contains('dshml-picker-option'),
        brandOption ? 'found ' + describeNode(brandOption) : 'no OpenAI option inside the picker',
      );
      if (brandOption) {
        clickable(brandOption).click();
        write = await waitFor(() => {
          const match = H.mutateCalls.filter((call) => {
            const serialized = JSON.stringify(call);
            return (
              serialized.indexOf('modelIcons') >= 0 &&
              serialized.indexOf(config.firstModel.providerId) >= 0 &&
              serialized.indexOf(config.firstModel.modelId) >= 0
            );
          })[0];
          return Array.isArray(match) ? match : null;
        }, 5000);
      }
      const closed = await waitFor(() => !pickerNode.isConnected || !visible(pickerNode), 4000);
      add('picker closes after a successful write', false, !!closed, closed ? 'modal removed' : 'modal still visible');
    }

    const writeOperation =
      write === null ? null : (write.find((operation) => isRecord(operation) && operation.op === 'set') ?? null);
    const writePath =
      writeOperation !== null && isRecord(writeOperation) && Array.isArray(writeOperation.path)
        ? writeOperation.path
        : null;
    const writeValue = writeOperation !== null && isRecord(writeOperation) ? writeOperation.value : undefined;
    add(
      'picking a brand writes modelIcons[provider][model] through configForms.mutate',
      true,
      writePath !== null &&
        writePath[0] === 'modelIcons' &&
        writePath[1] === config.firstModel.providerId &&
        writePath[2] === config.firstModel.modelId &&
        typeof writeValue === 'string' &&
        writeValue !== 'none',
      writeOperation ? 'op=' + JSON.stringify(writeOperation) : 'mutate calls=' + JSON.stringify(H.mutateCalls),
    );
    const overrideBucket = H.overrides[config.firstModel.providerId];
    add(
      'picked brand key lands in the persisted override map',
      true,
      overrideBucket !== undefined && overrideBucket[config.firstModel.modelId] === writeValue,
      'modelIcons=' + JSON.stringify(H.overrides),
    );
    add(
      'picked option is the OpenAI brand mark',
      true,
      writeValue === 'openai',
      'value="' + String(writeValue ?? '') + '"',
    );
    if (iconButton) {
      const button = iconButton;
      const refreshedMark = await waitFor(() => {
        const markNow = q('.dshml-model-mark', button)?.innerHTML ?? '';
        return markNow !== '' && markNow !== markBefore ? markNow : null;
      }, 4000);
      add(
        'model row mark refreshes after the override write',
        false,
        !!refreshedMark,
        refreshedMark ? 'mark changed (' + refreshedMark.length + ' bytes)' : 'mark did not change',
      );
    }

    // Composer label contribution: still registered, and it honours the override.
    const labelRegistration = H.registrations.filter(
      (registration) => registration.options && registration.options.name === 'conversation.input.model.label',
    )[0];
    add(
      'composer label contribution still registers at priority -1',
      false,
      !!labelRegistration && labelRegistration.options?.priority === -1,
      labelRegistration ? 'priority=' + String(labelRegistration.options?.priority) : 'not registered',
    );
    add(
      'settings.section contribution registers the Model icons page',
      false,
      H.registrations.some(
        (registration) =>
          registration.options &&
          registration.options.name === 'settings.section' &&
          registration.options.id === 'model-logos',
      ),
      'registrations=' + JSON.stringify(H.registrations.map((registration) => registration.options)),
    );

    let labelHost: HTMLElement | null = null;
    let labelRoot: ReactRootLike | null = null;
    if (labelRegistration && window.React && window.ReactDOM) {
      try {
        const host = document.createElement('div');
        host.id = 'dshml-label-probe';
        host.hidden = true;
        document.body.appendChild(host);
        labelHost = host;
        const mounted = window.ReactDOM.createRoot(host);
        labelRoot = mounted;
        const props = {
          provider: { id: config.firstModel.providerId, name: config.officialProvider.displayName },
          model: { id: config.firstModel.modelId, name: config.firstModel.displayName },
          placement: 'trigger',
        };
        mounted.render(window.React.createElement(labelRegistration.component, props));
        const rendered = await waitFor(() => host.querySelector('.dshml-mark, svg'), 4000);
        add(
          'composer label renders the overridden brand mark',
          false,
          !!rendered && text(host).indexOf(config.firstModel.displayName) >= 0,
          rendered ? 'markup: ' + host.innerHTML.slice(0, 160) : 'no mark rendered',
        );
        form.mutate([
          {
            op: 'set',
            path: ['modelIcons', config.firstModel.providerId, config.firstModel.modelId],
            value: 'none',
          },
        ]);
        mounted.render(window.React.createElement(labelRegistration.component, props));
        await sleep(120);
        add(
          "composer label honours an explicit 'none' override",
          false,
          host.querySelector('svg, .dshml-mark') === null && text(host).indexOf(config.firstModel.displayName) >= 0,
          'markup: ' + host.innerHTML.slice(0, 160),
        );
        form.mutate([{ op: 'unset', path: ['modelIcons', config.firstModel.providerId, config.firstModel.modelId] }]);
      } catch (error) {
        add('composer label renders the overridden brand mark', false, false, 'threw: ' + errorText(error));
      } finally {
        if (labelRoot !== null) {
          try {
            labelRoot.unmount();
          } catch {
            /* rendering a plain fragment needs no unmount bookkeeping */
          }
        }
        if (labelHost !== null) labelHost.remove();
      }
    }

    add('no uncaught page errors during decoration', true, pageErrors.length === 0, JSON.stringify(pageErrors));

    /* ------------------------------- disposal ------------------------------ */

    const initialDecoration = {
      vendor: qa('[data-dshml-vendor]', root || document).length,
      modelRows: qa('[data-dshml-model-row]', root || document).length,
      owners: qa('[data-dshml-owner="1"]', root || document).length,
      styleTags: qa('style[data-plugin="dsh-model-logos"]').length,
    };
    for (const dispose of H.cleanups.slice().reverse()) {
      try {
        dispose();
      } catch (error) {
        H.errors.push('dispose: ' + errorText(error));
      }
    }
    await sleep(300);

    const markerCount = qa('[data-dshml-vendor]', root || document).length;
    const rowMarkerCount = qa('[data-dshml-model-row]', root || document).length;
    const ownerCount = qa('[data-dshml-owner="1"]', root || document).length;
    const rowsRestored = qa('.jrmgQW_modelEntry .jrmgQW_modelRow', root || document).every(
      (row) => row.firstElementChild !== null && row.firstElementChild.tagName === 'INPUT',
    );
    add(
      'dispose removes the inserted decoration',
      true,
      initialDecoration.vendor > 0 &&
        initialDecoration.owners > 0 &&
        markerCount === 0 &&
        rowMarkerCount === 0 &&
        ownerCount === 0 &&
        rowsRestored,
      'before=' +
        JSON.stringify(initialDecoration) +
        ' after vendor=' +
        markerCount +
        ' modelRows=' +
        rowMarkerCount +
        ' owners=' +
        ownerCount +
        ' rowsRestored=' +
        rowsRestored,
    );

    const selectAfter = q<HTMLSelectElement>('.jrmgQW_addPanel select', root || document);
    const selectStyle = selectAfter ? getComputedStyle(selectAfter) : null;
    add(
      'dispose restores the native provider select',
      true,
      !!selectAfter &&
        selectAfter.getAttribute('aria-hidden') !== 'true' &&
        selectAfter.tabIndex !== -1 &&
        selectStyle !== null &&
        selectStyle.position !== 'absolute' &&
        selectStyle.pointerEvents !== 'none' &&
        Number(selectStyle.opacity) > 0.9,
      selectAfter
        ? 'aria-hidden=' +
            selectAfter.getAttribute('aria-hidden') +
            ' tabIndex=' +
            selectAfter.tabIndex +
            ' position=' +
            selectStyle?.position +
            ' opacity=' +
            selectStyle?.opacity
        : 'select missing after dispose',
    );
    add(
      'dispose removes the custom combobox and plugin stylesheets',
      true,
      findComboboxFace(selectAfter) === null && qa('style[data-plugin="dsh-model-logos"]').length === 0,
      'combobox=' +
        (findComboboxFace(selectAfter) === null ? 'gone' : 'still present') +
        ', style tags=' +
        qa('style[data-plugin="dsh-model-logos"]').length,
    );

    const ancestorRow = findProviderRow(config.officialProvider.displayName);
    const rowsList = q('.jrmgQW_rows', root || document);
    if (ancestorRow && rowsList) {
      const clone = ancestorRow.cloneNode(true) as HTMLElement;
      rowsList.appendChild(clone);
      await sleep(350);
      add(
        'dispose disconnects the settings MutationObserver',
        true,
        qa('[data-dshml-vendor]', clone).length === 0,
        qa('[data-dshml-vendor]', clone).length === 0
          ? 'clone stayed undecorated'
          : 'observer kept decorating after dispose',
      );
      clone.remove();
    }

    add('no errors thrown while disposing', true, H.errors.length === 0, JSON.stringify(H.errors));

    const result: VerifyResult = {
      ok: assertions.every((assertion) => !assertion.required || assertion.ok),
      mode: 'verify',
      lang: config.lang,
      assertions,
      pageErrors,
      consoleIssues,
      mutateCalls: H.mutateCalls,
      setCalls: H.setCalls,
      slotRequests: H.slotRequests,
      injected: H.injected,
      overrides: H.overrides,
      // Diagnostics: where every inserted vendor mark landed.
      vendorMarkers: qa('[data-dshml-vendor]').map((node) => ({
        provider: node.getAttribute('data-dshml-vendor'),
        parent: describeNode(node.parentElement),
        inCombo: !!node.closest('.dshml-combo'),
      })),
      modelRowMarkers: qa('[data-dshml-model-row]').length,
    };
    const pre = document.createElement('pre');
    pre.id = 'dshml-result';
    pre.textContent = JSON.stringify(result, null, 2);
    pre.style.display = 'none';
    document.body.appendChild(pre);
  }
}

/* -------------------------------------------------------------------------- */
/* Node harness                                                               */
/* -------------------------------------------------------------------------- */

const DRIVER_SOURCE = '(' + browserDriver.toString() + ')(' + JSON.stringify(DRIVER_CONFIG) + ');';

/** True for any non-null object (arrays included). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** The stack of anything thrown in this process. */
function readableError(error: unknown): string {
  if (isPlainRecord(error) && typeof error.stack === 'string') return error.stack;
  return String(error);
}

/** Narrow a parsed driver result to its runtime shape. */
function isDriverResult(value: unknown): value is DriverResult {
  if (!isPlainRecord(value)) return false;
  if (value.mode !== 'verify' && value.mode !== 'screenshot') return false;
  if (!Array.isArray(value.pageErrors) || !Array.isArray(value.consoleIssues)) return false;
  if (value.mode === 'verify') return Array.isArray(value.assertions);
  return isPlainRecord(value.decorated);
}

function findEdge(): string {
  const candidates = [
    process.env.EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate !== '');
  const found = candidates.filter((candidate) => existsSync(candidate))[0];
  if (!found) {
    console.error('error: Edge not found; set EDGE=<msedge.exe path>');
    process.exit(1);
  }
  return found;
}

function readRequired(path: string, label: string): string {
  if (!existsSync(path)) {
    console.error('error: missing ' + label + ': ' + path);
    process.exit(1);
  }
  return readFileSync(path, 'utf8');
}

/** Insert the harness scripts before `</body>`; CSS/markup live in the fixture itself. */
function buildHarness(fixtureHtml: string, clientJs: string, headExtra: string): string {
  const react = readRequired(REACT_UMD, 'React development UMD');
  const reactDom = readRequired(REACT_DOM_UMD, 'ReactDOM development UMD');
  const loaderStub = `// tsx compiles this script with esbuild's keepNames transform, so the serialized
// driver body references the bundler's __name() helper; keep it resolvable here.
window.__name = function (target) { return target; };
window.__dshmlModule = null;
window.__ModuleLoader__ = {
  load(definition) {
    window.__dshmlModule = definition;
  },
};
`;
  const closeBodyAt = fixtureHtml.lastIndexOf('</body>');
  if (closeBodyAt < 0) throw new Error('fixture has no </body>');
  const scripts =
    '\n' +
    headExtra +
    '<script>\n' +
    react.replace(/<\/script/gi, '<\\/script') +
    '\n</script>\n' +
    '<script>\n' +
    reactDom.replace(/<\/script/gi, '<\\/script') +
    '\n</script>\n' +
    '<script>\n' +
    loaderStub +
    '\n</script>\n' +
    '<script>\n' +
    clientJs.replace(/<\/script/gi, '<\\/script') +
    '\n</script>\n' +
    '<script>\n' +
    DRIVER_SOURCE.replace(/<\/script/gi, '<\\/script') +
    '\n</script>\n';
  return fixtureHtml.slice(0, closeBodyAt) + scripts + fixtureHtml.slice(closeBodyAt);
}

/** The outcome of one headless-Edge invocation. */
interface RunResult {
  stdout: string;
  stderr?: string;
  failed?: boolean;
}

function runEdge(edge: string, edgeArgs: string[], timeoutMs: number): RunResult {
  try {
    const stdout = execFileSync(edge, edgeArgs, {
      encoding: 'utf8',
      timeout: timeoutMs || 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout };
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    return {
      stdout: failure.stdout ? String(failure.stdout) : '',
      stderr: failure.stderr ? String(failure.stderr) : String(failure.message),
      failed: true,
    };
  }
}

function decodeEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseResult(dom: string): DriverResult | null {
  const match = /<pre id="dshml-result"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
  if (!match) return null;
  const encoded = match[1];
  if (encoded === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(decodeEntities(encoded));
    return isDriverResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function printAssertions(result: VerifyResult): number {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  for (const assertion of result.assertions) {
    const status = assertion.ok ? 'PASS' : assertion.required ? 'FAIL' : 'WARN';
    if (assertion.ok) passed++;
    else if (assertion.required) failed++;
    else warnings++;
    console.log(status.padEnd(4) + ' ' + assertion.name + (assertion.detail ? '  [' + assertion.detail + ']' : ''));
  }
  console.log('');
  console.log(`${passed} passed, ${failed} failed, ${warnings} warning(s)`);
  if (result.pageErrors.length > 0) {
    console.log('page errors: ' + JSON.stringify(result.pageErrors, null, 2));
  }
  if (result.consoleIssues.length > 0) {
    console.log('console issues (' + result.consoleIssues.length + '):');
    for (const issue of result.consoleIssues.slice(0, 20)) console.log('  ' + issue.slice(0, 400));
  }
  return failed;
}

async function main(): Promise<void> {
  const fixtureHtml = readRequired(FIXTURE, 'settings fixture');
  const clientJs = readRequired(CLIENT, 'generated client bundle');

  const buildMarkers: Record<string, boolean> = {
    'settings decorator (data-dshml-vendor)': clientJs.indexOf('dshml-vendor') >= 0,
    'model-row decorator (data-dshml-model-row)': clientJs.indexOf('data-dshml-model-row') >= 0,
    'settings section (settings.section)': clientJs.indexOf('settings.section') >= 0,
    'icon picker (dshml-picker)': clientJs.indexOf('dshml-picker') >= 0,
  };
  const missingMarkers = Object.keys(buildMarkers).filter((name) => !buildMarkers[name]);
  const stale = missingMarkers.length > 0;
  if (stale) {
    console.error('warning: client.js looks stale (no Settings decoration code found):');
    for (const name of missingMarkers) console.error('  - missing ' + name);
    console.error('  ask the Lead to run `pnpm run build` first');
    if (requireBuild) process.exit(2);
  }
  if (!existsSync(REACT_UMD) || !existsSync(REACT_DOM_UMD)) {
    console.error('error: React/ReactDOM 18 UMD builds are not installed in node_modules');
    process.exit(1);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'dshml-verify-'));
  const edge = findEdge();
  const edgeArgsBase = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  const profileDir = join(tmpDir, 'edge-profile');
  mkdirSync(profileDir, { recursive: true });

  const extraStyle =
    '<style>html[data-dshml-screenshot] .AnXs9G_panel{height:auto;max-height:none}html[data-dshml-screenshot] body{overflow:auto}</style>\n';

  try {
    if (screenshotPath) {
      const pngPath = resolve(ROOT, screenshotPath);
      mkdirSync(dirname(pngPath), { recursive: true });
      const query = '?mode=screenshot&open=' + encodeURIComponent(openMode);
      const harness = buildHarness(fixtureHtml, clientJs, extraStyle);
      const harnessPath = join(tmpDir, 'settings-models-screenshot.html');
      writeFileSync(harnessPath, harness);
      const url = pathToFileURL(harnessPath).href + query;
      rmSync(pngPath, { force: true });
      const width = 1280;
      const height = openMode === 'picker' ? 1100 : 1500;
      const run = runEdge(
        edge,
        [
          ...edgeArgsBase,
          '--force-device-scale-factor=' + String(scale),
          `--user-data-dir=${profileDir}`,
          `--window-size=${width},${height}`,
          '--virtual-time-budget=8000',
          `--screenshot=${pngPath}`,
          '--dump-dom',
          url,
        ],
        120000,
      );
      const result = parseResult(run.stdout);
      const deadline = Date.now() + 20000;
      while (!existsSync(pngPath) && Date.now() < deadline) {
        await new Promise<void>((done) => {
          setTimeout(done, 200);
        });
      }
      if (!existsSync(pngPath) || statSync(pngPath).size === 0) {
        console.error('error: no screenshot produced at ' + pngPath);
        if (run.stderr) console.error(run.stderr.slice(0, 2000));
        process.exit(1);
      }
      if (result !== null && result.mode === 'screenshot') {
        const decorated = result.decorated;
        if (decorated.vendor === 0 || decorated.modelRows < DRIVER_CONFIG.modelRows) {
          console.error(
            'warning: page was not fully decorated when the screenshot was taken: ' + JSON.stringify(decorated),
          );
        }
      }
      console.log(`wrote ${pngPath} (${statSync(pngPath).size} bytes, ${width * scale}×${height * scale}px)`);
      if (result !== null && result.consoleIssues.length > 0) {
        console.log('console issues: ' + result.consoleIssues.length);
      }
      return;
    }

    const harness = buildHarness(fixtureHtml, clientJs, extraStyle);
    const harnessPath = join(tmpDir, 'settings-models-verify.html');
    writeFileSync(harnessPath, harness);
    const url = pathToFileURL(harnessPath).href + '?mode=verify';
    const run = runEdge(
      edge,
      [...edgeArgsBase, `--user-data-dir=${profileDir}`, '--virtual-time-budget=12000', '--dump-dom', url],
      150000,
    );
    const result = parseResult(run.stdout);
    if (result === null || result.mode !== 'verify') {
      console.error('error: the harness page produced no result block.');
      if (run.stderr) console.error(run.stderr.slice(0, 4000));
      const dumpPath = join(tmpDir, 'dump.html');
      writeFileSync(dumpPath, run.stdout || '');
      console.error('kept dumped DOM: ' + dumpPath + ' (' + (run.stdout || '').length + ' bytes)');
      if (keptHarnessPath) writeFileSync(resolve(ROOT, keptHarnessPath), harness);
      process.exit(1);
    }
    if (jsonPath) {
      const target = resolve(ROOT, jsonPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(result, null, 2));
      console.log('result: ' + target);
    }
    const failed = printAssertions(result);
    if (keptHarnessPath) {
      const target = resolve(ROOT, keptHarnessPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, harness);
      console.log('harness: ' + target);
    }
    if (failed > 0) {
      const failedHarness = join(tmpDir, 'settings-models-verify.html');
      console.log('harness: ' + failedHarness);
      process.exit(1);
    }
  } finally {
    // The user-data-dir can be held briefly by a just-exited browser; cleanup is
    // best-effort and must never mask the run's result.
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows may still hold the profile lock; the OS temp cleaner handles it. */
    }
  }
}

main().catch((error: unknown) => {
  console.error('error: ' + readableError(error));
  process.exit(1);
});
