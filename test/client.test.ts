/**
 * Loads the generated browser module in a minimal DOM/React/settings stand-in
 * and checks every contribution it registers:
 *
 *  - the composer model label (still priority -1) draws the mark + catalog name,
 *    honours persisted per-model overrides (`brand`, `letter`, `none`) and keeps
 *    the shipped 1017 release badge;
 *  - the "Model icons" settings section is registered under id `model-logos`;
 *  - the apply() disposers remove the injected stylesheet, restore the document
 *    listeners and disconnect the decoration observer.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = resolve(ROOT, 'client.js');

/** One element the fake React `createElement()` produces. */
interface FakeElement {
  type: unknown;
  props: FakeProps;
  children: unknown[];
}

/** Props bag passed to the fake React factory (the bundle's own props). */
interface FakeProps {
  className?: string;
  title?: string;
  'aria-hidden'?: string;
  dangerouslySetInnerHTML?: { __html: string };
  children?: unknown;
  [key: string]: unknown;
}

/** Minimal React: enough for the contributions' createElement/hook trees. */
const createElement = (type: unknown, props?: FakeProps | null, ...children: unknown[]): FakeElement => {
  const single = children.length === 1 ? children[0] : undefined;
  return {
    type,
    props: props ?? {},
    children: children.length === 1 && Array.isArray(single) ? (single as unknown[]) : children,
  };
};
class FakeComponent {
  props: FakeProps;
  state: unknown;
  constructor(props: FakeProps) {
    this.props = props;
    this.state = {};
  }
  setState(next: unknown): void {
    this.state = next;
  }
}

const fakeReact = {
  createElement,
  Component: FakeComponent,
  // The label and the settings section subscribe to the icon/catalog stores.
  useSyncExternalStore: <T>(_subscribe: () => void, getSnapshot: () => T): T => getSnapshot(),
  useState: <T>(initial: T | (() => T)): [T, (value: T) => void] => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    () => {},
  ],
  useEffect: (): void => {},
  useMemo: <T>(factory: () => T): T => factory(),
  useCallback: <T>(callback: T): T => callback,
  useRef: <T>(value: T): { current: T } => ({ current: value }),
  Fragment: 'Fragment',
};

/** One stylesheet tag the fake document mounted. */
interface FakeStyleTag {
  tagName: string;
  dataset: { plugin?: string; pluginCss?: string };
  textContent: string;
  hidden: boolean;
  mounted: boolean;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** Minimal document: stylesheet mounting plus the decorator's listeners. */
interface FakeDocument {
  documentElement: { lang: string };
  body: { tagName: string };
  activeElement: null;
  styleTags: FakeStyleTag[];
  listeners: Map<string, Set<unknown>>;
  createElement(tagName: string): FakeStyleTag;
  head: { appendChild(tag: FakeStyleTag): void };
  querySelector(selector: string): FakeStyleTag | null;
  querySelectorAll(): unknown[];
  addEventListener(type: string, listener: unknown): void;
  removeEventListener(type: string, listener: unknown): void;
}

function createFakeDocument(): FakeDocument {
  const styleTags: FakeStyleTag[] = [];
  const listeners = new Map<string, Set<unknown>>();
  return {
    documentElement: { lang: 'en' },
    body: { tagName: 'BODY' },
    activeElement: null,
    styleTags,
    listeners,
    createElement(tagName: string): FakeStyleTag {
      const tag: FakeStyleTag = {
        tagName: String(tagName).toUpperCase(),
        dataset: {},
        textContent: '',
        hidden: false,
        mounted: false,
        removed: false,
        setAttribute(): void {},
        remove(): void {
          tag.removed = true;
          const index = styleTags.indexOf(tag);
          if (index !== -1) styleTags.splice(index, 1);
        },
      };
      if (tag.tagName === 'STYLE') styleTags.push(tag);
      return tag;
    },
    head: {
      appendChild(tag: FakeStyleTag): void {
        tag.mounted = true;
      },
    },
    querySelector(selector: string): FakeStyleTag | null {
      if (selector.startsWith('style[data-plugin-css=')) {
        return (
          styleTags.find((tag) => tag.dataset.pluginCss !== undefined && selector.includes(tag.dataset.pluginCss)) ??
          null
        );
      }
      // No Settings dialog in this stand-in: the decorator shapes nothing.
      return null;
    },
    querySelectorAll(): unknown[] {
      return [];
    },
    addEventListener(type: string, listener: unknown): void {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: unknown): void {
      listeners.get(type)?.delete(listener);
    },
  };
}

/** MutationObserver stand-in: records observe/disconnect without observing. */
function createObserverRegistry() {
  const observers: FakeMutationObserver[] = [];
  class FakeMutationObserver {
    callback: unknown;
    observations: Array<{ target: unknown; options: unknown }> = [];
    disconnected = false;
    constructor(callback: unknown) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target: unknown, options: unknown): void {
      this.observations.push({ target, options });
    }
    disconnect(): void {
      this.disconnected = true;
    }
    takeRecords(): unknown[] {
      return [];
    }
  }
  return { observers, FakeMutationObserver };
}

/** A configForms mirror (used by the section catalog, irrelevant to the label). */
function createMirror(namespaces: unknown[] = []) {
  return {
    ensure: (): Promise<void> => Promise.resolve(),
    subscribe: (): (() => void) => () => {},
    getSnapshot: (): { status: string; view: { namespaces: unknown[] } } => ({
      status: 'ready',
      view: { namespaces },
    }),
  };
}

/** Settings value the fake form mirrors: every field the bundle reads. */
interface FakeFormValue {
  modelIcons: Record<string, Record<string, string>>;
  /** Absent in a legacy profile that never stored a provider override. */
  providerIcons?: Record<string, string>;
  /** Absent in a legacy profile that never stored a custom icon. */
  customIcons?: Record<string, unknown>;
}

/** Snapshot shape the fake settings form returns to the bundle. */
interface FakeFormSnapshot {
  status: string;
  value: FakeFormValue;
  base: Record<string, never>;
  user: Record<string, never>;
  revision: number;
  writable: boolean;
}

/** A fake `ctx.configForms.get('dsh-model-logos')` form with mutable overrides. */
interface FakeForm {
  listeners: Set<() => void>;
  mutateCalls: Array<{ ops: unknown[]; expectedRevision: number | undefined }>;
  snapshot: FakeFormSnapshot;
  getSnapshot(): FakeFormSnapshot;
  subscribe(listener: () => void): () => boolean;
  set(field: unknown, value: unknown): Promise<boolean>;
  unset(field: unknown): Promise<boolean>;
  mutate(ops: unknown[], expectedRevision?: number): Promise<boolean>;
}

/** Mutate behaviour the fake form needs beyond its default document. */
interface FakeFormOptions {
  /** Persisted provider overrides; omit for a legacy document that predates them. */
  providerIcons?: Record<string, string>;
  /** Persisted custom icons; omit for a legacy document that predates them. */
  customIcons?: Record<string, unknown>;
}

function createForm(overrides: Record<string, Record<string, string>>, options: FakeFormOptions = {}): FakeForm {
  const form: FakeForm = {
    listeners: new Set(),
    mutateCalls: [],
    snapshot: {
      status: 'ready',
      value: {
        modelIcons: overrides,
        ...(options.providerIcons === undefined ? {} : { providerIcons: options.providerIcons }),
        ...(options.customIcons === undefined ? {} : { customIcons: options.customIcons }),
      },
      base: {},
      user: {},
      revision: 1,
      writable: true,
    },
    getSnapshot(): FakeFormSnapshot {
      return form.snapshot;
    },
    subscribe(listener: () => void): () => boolean {
      form.listeners.add(listener);
      return () => form.listeners.delete(listener);
    },
    async set(field: unknown, value: unknown): Promise<boolean> {
      return form.mutate([{ op: 'set', path: [field], value }]);
    },
    async unset(field: unknown): Promise<boolean> {
      return form.mutate([{ op: 'unset', path: [field] }]);
    },
    async mutate(ops: unknown[], expectedRevision?: number): Promise<boolean> {
      form.mutateCalls.push({ ops, expectedRevision });
      for (const op of ops) {
        if (!isRecord(op)) continue;
        const path = Array.isArray(op.path) ? op.path : [];
        // Per-model overrides: ['modelIcons', providerId, modelId].
        if (path[0] === 'modelIcons' && path.length === 3) {
          const providerId = String(path[1]);
          const modelId = String(path[2]);
          const icons = { ...(form.snapshot.value.modelIcons ?? {}) };
          const bucket = { ...(icons[providerId] ?? {}) };
          if (op.op === 'unset') {
            delete bucket[modelId];
            if (Object.keys(bucket).length === 0) delete icons[providerId];
            else icons[providerId] = bucket;
          } else {
            bucket[modelId] = String(op.value);
            icons[providerId] = bucket;
          }
          form.snapshot = {
            ...form.snapshot,
            revision: form.snapshot.revision + 1,
            value: { ...form.snapshot.value, modelIcons: icons },
          };
          continue;
        }
        // Per-provider overrides: ['providerIcons', providerId].
        if (path[0] === 'providerIcons' && path.length === 2) {
          const providerId = String(path[1]);
          const providers = { ...(form.snapshot.value.providerIcons ?? {}) };
          if (op.op === 'unset') delete providers[providerId];
          else providers[providerId] = String(op.value);
          form.snapshot = {
            ...form.snapshot,
            revision: form.snapshot.revision + 1,
            value: { ...form.snapshot.value, providerIcons: providers },
          };
          continue;
        }
        // Custom icons: ['customIcons', id] set/unset, or ['customIcons', id, 'name'].
        if (path[0] === 'customIcons' && path.length === 2) {
          const iconId = String(path[1]);
          const icons = { ...(form.snapshot.value.customIcons ?? {}) };
          if (op.op === 'unset') delete icons[iconId];
          else icons[iconId] = op.value;
          form.snapshot = {
            ...form.snapshot,
            revision: form.snapshot.revision + 1,
            value: { ...form.snapshot.value, customIcons: icons },
          };
          continue;
        }
        if (path[0] === 'customIcons' && path.length === 3 && path[2] === 'name' && op.op === 'set') {
          const iconId = String(path[1]);
          const icons = { ...(form.snapshot.value.customIcons ?? {}) };
          const current = icons[iconId];
          if (isRecord(current)) icons[iconId] = { ...current, name: String(op.value) };
          form.snapshot = {
            ...form.snapshot,
            revision: form.snapshot.revision + 1,
            value: { ...form.snapshot.value, customIcons: icons },
          };
        }
      }
      for (const listener of [...form.listeners]) listener();
      return true;
    },
  };
  return form;
}

/** One slot registration the fake context recorded. */
interface SlotOptions {
  name?: string;
  id?: string;
  priority?: number;
  label?: () => string;
  [key: string]: unknown;
}

type ComponentFn = (props: LabelProps) => RenderResult;
type RenderResult = FakeElement | string | null;

interface Registration {
  options: SlotOptions;
  component: ComponentFn;
}

interface ContextOptions {
  overrides?: Record<string, Record<string, string>>;
  /** Persisted provider overrides; omit for a document written before they existed. */
  providerIcons?: Record<string, string>;
  /** Persisted custom icons; omit for a document written before they existed. */
  customIcons?: Record<string, unknown>;
  missing?: string[];
  /** Active DSH locale (`en` unless a test forces another language). */
  lang?: string;
  /** Provider groups the fake `remote.session.modelCatalog()` advertises. */
  liveGroups?: unknown[];
  /** Settings-document namespaces the fake mirror exposes to the catalog reader. */
  namespaces?: unknown[];
}

interface FakeScope {
  effect(callback: () => unknown, label?: string): () => void;
  on(event: string, handler: unknown): () => void;
  get(name: string): unknown;
}

interface FakeContext {
  effect(callback: () => unknown, label?: string): () => void;
  on(event: string, handler: unknown): () => void;
  get(name: string): unknown;
  inject(dependencies: readonly string[], callback: (scope: FakeScope) => unknown): () => void;
  slots: {
    inject(slotName: string, callback: () => unknown): () => void;
    register(options: unknown, component: unknown): () => void;
  };
}

/**
 * Build a plugin context with the services the bundle injects.
 * `missing` names services to withhold (e.g. `['configForms']`).
 */
function createContext({
  overrides = {},
  providerIcons,
  customIcons,
  missing = [],
  lang = 'en',
  liveGroups = [],
  namespaces = [],
}: ContextOptions = {}) {
  const registrations: Registration[] = [];
  const injectedSlots: string[] = [];
  const effects: Array<{ label: string | undefined; off: unknown }> = [];
  const disposers: unknown[] = [];
  const events: Array<{ event: string; handler: unknown; off: () => void }> = [];
  const form = createForm(overrides, {
    ...(providerIcons === undefined ? {} : { providerIcons }),
    ...(customIcons === undefined ? {} : { customIcons }),
  });
  const mirror = createMirror(namespaces);
  const session = {
    modelCatalog: async () => ({
      groups: liveGroups,
      failures: [],
    }),
  };
  const services: Record<string, unknown> = {
    configForms: { get: (id: string) => (id === 'dsh-model-logos' ? form : form), describe: () => mirror },
    remote: {
      llm: {
        listConfigurableProviders: async () => [
          { provider: 'deepseek-account', displayName: 'DeepSeek Account' },
          { provider: 'anthropic', displayName: 'Anthropic' },
          { provider: 'volcengine', displayName: 'Volcengine', declared: true },
        ],
        listProviders: async () => [{ id: 'deepseek-account', name: 'DeepSeek Account' }],
      },
      session,
      settings: { mutate: async () => true },
      $on: () => () => {},
    },
    'remote.session': session,
    locale: {
      getSnapshot: () => ({ active: lang }),
      subscribe: () => () => {},
    },
  };
  for (const name of missing) delete services[name];

  const recordEffect = (callback: () => unknown, label?: string): (() => void) => {
    const off = callback();
    effects.push({ label, off });
    return () => {};
  };
  const makeScope = (): FakeScope => ({
    effect: recordEffect,
    on(event: string, handler: unknown): () => void {
      const off = () => {};
      events.push({ event, handler, off });
      return off;
    },
    get(name: string): unknown {
      return services[name];
    },
  });

  const ctx: FakeContext = {
    effect: recordEffect,
    on(event: string, handler: unknown): () => void {
      const off = () => {};
      events.push({ event, handler, off });
      return off;
    },
    get(name: string): unknown {
      return services[name];
    },
    inject(_dependencies: readonly string[], callback: (scope: FakeScope) => unknown): () => void {
      const scope = makeScope();
      const off = callback(scope);
      if (typeof off === 'function') disposers.push(off);
      return () => {};
    },
    slots: {
      inject(slotName: string, callback: () => unknown): () => void {
        injectedSlots.push(slotName);
        const off = callback();
        if (typeof off === 'function') disposers.push(off);
        return () => {};
      },
      register(options: unknown, component: unknown): () => void {
        registrations.push({ options: options as SlotOptions, component: component as ComponentFn });
        return () => {};
      },
    },
  };
  return { ctx, registrations, injectedSlots, effects, disposers, events, form, mirror };
}

/** The loader definition `client.js` hands to `window.__ModuleLoader__.load`. */
interface BundleDefinition {
  factory(requireModule: (id: string) => unknown): unknown;
}

/** The bundle's public exports (`inject` + `apply`). */
interface BundleExports {
  inject?: unknown;
  apply(context: unknown): unknown;
}

/** Load client.js and apply it to a fresh fake context. */
function loadClient(options: ContextOptions = {}) {
  const source = readFileSync(CLIENT, 'utf8');
  const doc = createFakeDocument();
  const registry = createObserverRegistry();
  const definitions: BundleDefinition[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = {
    __ModuleLoader__: {
      load: (value: unknown): void => {
        definitions.push(value as BundleDefinition);
      },
    },
  };
  globals.document = doc;
  globals.MutationObserver = registry.FakeMutationObserver;
  new Function(source)();
  const definition = definitions[0];
  expect(definition, 'client.js did not call window.__ModuleLoader__.load').toBeTruthy();
  if (definition === undefined) throw new Error('client.js did not call window.__ModuleLoader__.load');
  const moduleExports = loadBundleExports(
    definition.factory((id: string) => {
      if (id === 'react') return fakeReact;
      if (id === 'react-dom/client') {
        return { createRoot: () => ({ render(): void {}, unmount(): void {} }) };
      }
      throw new Error(`unexpected require("${id}") in the generated bundle`);
    }),
  );
  const harness = createContext(options);
  moduleExports.apply(harness.ctx);
  return { ...harness, moduleExports, doc, registry };
}

/** Narrow the bundle factory's return value to `{ apply }`. */
function loadBundleExports(value: unknown): BundleExports {
  const candidate = value as Partial<BundleExports> | null;
  if (candidate === null || typeof candidate !== 'object' || typeof candidate.apply !== 'function') {
    throw new Error('the bundle factory did not return { apply }');
  }
  return candidate as BundleExports;
}

/** `assert.ok(value, message)` that also narrows `undefined` away for the caller. */
function expectPresent<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeTruthy();
  if (value === undefined) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Icon-state snapshot the bundle publishes for maintainers and the live harness. */
interface DiagnosticsIconState {
  status: string;
  overrides: Record<string, Record<string, string>>;
  providerOverrides: Record<string, string>;
  customIcons: Record<string, { id: string; name: string; image: string }>;
  writable: boolean;
  error: string | null;
}

/** Catalog snapshot the bundle publishes for the Model icons page. */
interface DiagnosticsCatalog {
  status: string;
  providers: Array<{
    providerId: string;
    displayName: string;
    official: boolean;
    declared: boolean;
    models: Array<{ modelId: string; name: string }>;
  }>;
  error: string | null;
}

/** The read-only diagnostics surface `apply()` publishes on `globalThis`. */
interface Diagnostics {
  iconState(): DiagnosticsIconState;
  catalog(): DiagnosticsCatalog;
  refreshCatalog(): Promise<void>;
}

/** Read the diagnostics surface, failing loudly when `apply()` never set it. */
function diagnostics(): Diagnostics {
  const value = (globalThis as unknown as Record<string, unknown>).__dshModelLogos;
  expect(value, 'apply() must publish the diagnostics surface').toBeTruthy();
  if (value === undefined) throw new Error('apply() must publish the diagnostics surface');
  return value as Diagnostics;
}

interface LabelProps {
  provider?: { id?: string; name?: string } | null;
  model?: { id?: string; name?: string } | null;
  placement?: string;
  selected?: boolean;
  [key: string]: unknown;
}

const flatten = (node: unknown): Array<FakeElement | string> => {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((item) => flatten(item));
  if (typeof node !== 'object') return [];
  const element = node as FakeElement;
  // The fake React never renders function components; expand them here so a
  // rendered section's rows (not just the page chrome) are inspectable.
  const rendered =
    typeof element.type === 'function' ? flatten((element.type as (props: FakeProps) => unknown)(element.props)) : [];
  const own = flatten(element.children ?? []);
  const nested = element.props?.children === undefined ? [] : flatten(element.props.children);
  return [element, ...own, ...nested, ...rendered];
};

const labelProps = (providerId: string, providerName: string, modelId: string, modelName: string): LabelProps => ({
  provider: { id: providerId, name: providerName },
  model: { id: modelId, name: modelName },
  placement: 'trigger',
  selected: true,
});

const labelRegistration = (registrations: Registration[]): Registration => {
  const matches = registrations.filter((entry) => entry.options.name === 'conversation.input.model.label');
  expect(matches.length, 'expected exactly one composer label contribution').toBe(1);
  return expectPresent(matches[0], 'expected exactly one composer label contribution');
};

const findClass = (tree: unknown, className: string): FakeElement | undefined =>
  flatten(tree).find((node): node is FakeElement => typeof node !== 'string' && node.props.className === className);
const findMark = (tree: unknown): FakeElement | undefined => findClass(tree, 'dshml-mark');
const findText = (tree: unknown): FakeElement | undefined => findClass(tree, 'dshml-text');

/** Narrow a render result to the element the label contributes. */
function expectElement(result: RenderResult, message: string): FakeElement {
  if (result === null || typeof result === 'string') throw new Error(message);
  return result;
}

/** The declaration block of one exact selector in a mounted stylesheet. */
function cssRule(style: FakeStyleTag, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(style.textContent);
  return match?.[1] ?? '';
}

describe('generated client bundle', () => {
  it('registers the label (priority -1) and the Model-icons settings section', () => {
    const { moduleExports, registrations, injectedSlots } = loadClient();
    expect(moduleExports.inject).toEqual(['slots']);
    expect(injectedSlots.includes('conversation.input.model.label'), 'label slot must be requested').toBeTruthy();
    expect(injectedSlots.includes('settings.section'), 'settings.section slot must be requested').toBeTruthy();

    const label = labelRegistration(registrations);
    expect(label.options.priority, 'must outrank the shipped priority-0 release label').toBe(-1);
    expect(typeof label.component).toBe('function');

    const sections = registrations.filter((entry) => entry.options.name === 'settings.section');
    expect(sections.length, 'expected exactly one settings section contribution').toBe(1);
    const section = expectPresent(sections[0], 'expected exactly one settings section contribution');
    expect(section.options.id, 'the settings nav entry id is fixed').toBe('model-logos');
    expect(typeof section.component, 'the section component must be registered').toBe('function');
    expect(typeof section.options.label, 'the section needs a nav label').toBe('function');
    const sectionLabel = section.options.label;
    if (sectionLabel === undefined) throw new Error('the section needs a nav label');
    expect(typeof sectionLabel()).toBe('string');
    expect(sectionLabel().trim() !== '', 'the section nav label must not be empty').toBeTruthy();
  });

  it('marks the Model icons page as plugin-owned so the Settings decorator leaves it alone', () => {
    // The page draws its own 22px row marks. Without the marker the decorator's
    // provider-name rule accepts a row's leaf-span header as an editor title and
    // inserts its seat into the name's column flex — a duplicate icon above it.
    const { registrations } = loadClient();
    const section = expectPresent(
      registrations.find((entry) => entry.options.name === 'settings.section'),
      'the Model icons section must be registered',
    );
    const tree = section.component({}) as unknown as FakeElement;
    expect(tree.props['data-dshml-section'], 'the page root must carry the plugin-owned marker').toBe('1');
  });

  it('merges the live session catalog so account models get their own rows', async () => {
    // `deepseek-account` keeps its models in the account listing, not in a
    // settings document: the directory names the provider, but only the
    // Host-generation catalog can name its models. Without this merge the Model
    // icons page could never offer a per-model row for it.
    const { registrations } = loadClient({
      namespaces: [
        {
          ns: 'llm-deepseek',
          value: { models: [{ id: 'deepseek-flash', name: 'Settings Flash' }] },
        },
      ],
      liveGroups: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-flash', name: 'Live Flash' },
            { id: 'deepseek-live-only', name: 'Live Only' },
          ],
        },
        {
          id: 'deepseek-account',
          name: 'DeepSeek Account',
          models: [
            { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
            { id: 'deepseek-reasoner', name: 'DeepSeek-V4.1-Reasoner' },
          ],
        },
      ],
    });
    await diagnostics().refreshCatalog();
    const catalog = diagnostics().catalog();
    const official = catalog.providers.find((provider) => provider.providerId === 'deepseek-official');
    // A settings-document model keeps its configured name and comes first; the
    // live catalog only appends the models it is uniquely able to name.
    expect(official?.models.map(({ modelId, name }) => ({ modelId, name }))).toEqual([
      { modelId: 'deepseek-flash', name: 'Settings Flash' },
      { modelId: 'deepseek-live-only', name: 'Live Only' },
    ]);
    const account = catalog.providers.find((provider) => provider.providerId === 'deepseek-account');
    expect(account, 'the live catalog must contribute the account provider').toBeTruthy();
    expect(account?.models.map((model) => model.modelId)).toEqual(['deepseek-flash', 'deepseek-reasoner']);
    expect(account?.models[0]?.name, 'the advertised name, not the bare id').toBe('DeepSeek-V4.1-Flash');

    const section = expectPresent(
      registrations.find((entry) => entry.options.name === 'settings.section'),
      'the Model icons section must be registered',
    );
    const tree = section.component({});
    const texts = flatten(tree).filter((node): node is string => typeof node === 'string');
    expect(texts.includes('DeepSeek-V4.1-Flash'), 'the account model name must render').toBe(true);
    expect(
      texts.some((text) => text.includes('deepseek-flash')),
      'the account model id must render on its row',
    ).toBe(true);
  });

  it('sizes the composer mark at 20px, the Settings marks on the 22px base and the picker preview at 36px', () => {
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    /** Whether one rule declares both the width and the height. */
    const sized = (selector: string, px: number): boolean => {
      const block = cssRule(style, selector);
      return new RegExp('width:\\s*' + px + 'px').test(block) && new RegExp('height:\\s*' + px + 'px').test(block);
    };
    // The composer mark fits the 13px/20px label line exactly. The Settings → Models
    // marks and the Model icons page share one 22px base, and the picker preview is
    // the single enlarged surface at 36px.
    expect(sized('.dshml-mark', 20), 'composer trigger/menu mark').toBe(true);
    expect(sized('.dshml-vendor', 22), 'Settings vendor mark').toBe(true);
    expect(sized('.dshml-model-icon-btn', 22), 'Settings model-row icon seat').toBe(true);
    expect(sized('.dshml-model-icon-btn .dshml-model-mark', 22), 'Settings model-row mark').toBe(true);
    expect(sized('.dshml-combo-mark', 22), 'provider combobox mark').toBe(true);
    expect(sized('.dshml-section-mark', 22), 'Model icons page mark seat').toBe(true);
    // The picker preview is the one enlarged surface: 36px.
    expect(sized('.dshml-picker-option-mark', 36), 'picker option mark').toBe(true);
  });

  it('centres the composer mark on the label line without a paint offset', () => {
    // The composer label is a 13px/20px line. The 20px mark box fits that line
    // exactly, so flex centring puts the mark's centre on the name's line and in
    // the 28px trigger's hit area without the old 2px paint nudge. Settings marks
    // and the picker preview are centred by their own grid/flex rows.
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    const root = cssRule(style, '.dshml-root');
    expect(root, 'the label row is a flex container').toMatch(/display:\s*flex/);
    expect(root, 'the row centres the 20px mark box and the name').toMatch(/align-items:\s*center/);
    expect(root, 'the label keeps the host line baseline').toMatch(/vertical-align:\s*baseline/);
    const mark = cssRule(style, '.dshml-mark');
    expect(mark, 'the mark fits the label line box').toMatch(/width:\s*20px/);
    expect(mark).toMatch(/height:\s*20px/);
    expect(mark, 'the composer mark needs no optical nudge').not.toMatch(/top:\s*2px/);
    for (const seat of [
      '.dshml-vendor',
      '.dshml-model-icon-btn',
      '.dshml-combo-mark',
      '.dshml-section-mark',
      '.dshml-picker-option-mark',
    ]) {
      expect(cssRule(style, seat), seat + ' keeps its own row centring').not.toMatch(/top:\s*2px/);
    }
  });

  it('draws the picker close button as a centred SVG glyph, not a text character', () => {
    // A typed `×` follows the user's system font, so its ink size and position
    // drift off the hit-area centre. The close mark is now a fixed 16px SVG and
    // the button centres it with flex layout: no font-size or line-height.
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    const close = cssRule(style, '.dshml-picker-close');
    expect(close, 'the close button is an inline flex box').toMatch(/display:\s*inline-flex/);
    expect(close, 'the glyph is centred horizontally').toMatch(/justify-content:\s*center/);
    expect(close, 'the glyph is centred vertically').toMatch(/align-items:\s*center/);
    expect(close, 'the hit area stays 28×28 px').toMatch(/width:\s*28px/);
    expect(close, 'the hit area stays 28×28 px').toMatch(/height:\s*28px/);
    expect(close, 'the close mark must not depend on a font').not.toMatch(/font-size|line-height|font:/);
    const icon = cssRule(style, '.dshml-picker-close-icon');
    expect(icon, 'the drawn icon owns its 16px box').toMatch(/width:\s*16px/);
    expect(icon, 'the drawn icon owns its 16px box').toMatch(/height:\s*16px/);
    expect(icon, 'the SVG is block-level inside the flex button').toMatch(/display:\s*block/);
  });

  it('draws input focus and pressed options in the theme blue and animates the state change', () => {
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    // The old focus rule mixed a near-black `--dsw-alias-brand-primary` border
    // with a separate blue shadow, which painted the stacked outlines this popup
    // used to show. Inputs now use the theme's business blue only.
    for (const selector of [
      '.dshml-picker-search:focus',
      '.dshml-section-search:focus',
      '.dshml-section-input:focus',
    ]) {
      const block = cssRule(style, selector);
      expect(block, selector + ' uses the blue border token').toMatch(
        /border-color:\s*var\(--dsw-alias-state-business-primary/,
      );
      expect(block, selector + ' must not use the neutral brand token').not.toMatch(/--dsw-alias-brand-primary/);
      expect(block, selector + ' keeps a soft blue focus halo').toMatch(
        /box-shadow:[\s\S]*color-mix\(in srgb, var\(--dsw-alias-state-business-primary/,
      );
    }
    for (const selector of ['.dshml-picker-search', '.dshml-section-search', '.dshml-section-input']) {
      const block = cssRule(style, selector);
      expect(block, selector + ' animates the border').toMatch(
        /transition:[^}]*border-color[^}]*var\(--ds-transition-duration-fast/,
      );
      expect(block, selector + ' animates the focus halo').toMatch(/transition:[^}]*box-shadow/);
      expect(cssRule(style, selector + ':active'), selector + ' has an active border').toMatch(
        /--dsw-alias-state-business-primary/,
      );
    }
    // The three mode buttons (Auto / No icon / Letter icon) share the option cell.
    expect(cssRule(style, '.dshml-picker-option')).toMatch(/transition:[^}]*background-color/);
    const selected = cssRule(style, '.dshml-picker-option[aria-pressed="true"]');
    expect(selected, 'the selected option border is the same blue').toMatch(
      /border-color:\s*var\(--dsw-alias-state-business-primary/,
    );
    expect(selected, 'the selected option uses the blue tint, not the neutral hover fill').toMatch(
      /background:\s*var\(--dsw-alias-state-business-tertiary/,
    );
  });

  it('styles the custom-icon group and editor', () => {
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    for (const selector of [
      '.dshml-picker-back',
      '.dshml-picker-custom-edit',
      '.dshml-picker-create',
      '.dshml-custom-tabs',
      '.dshml-custom-tab-soon',
      '.dshml-custom-drop',
      '.dshml-custom-cropper',
      '.dshml-custom-btn-primary',
    ]) {
      expect(cssRule(style, selector), selector + ' must carry a style block').not.toBe('');
    }
    expect(cssRule(style, '.dshml-custom-tab-soon'), 'disabled type tabs must not look clickable').toMatch(
      /cursor:\s*not-allowed/,
    );
    expect(cssRule(style, '.dshml-custom-file'), 'the file input stays out of the visual flow').toMatch(
      /display:\s*none/,
    );
  });

  it('draws the brand mark before the catalog name', () => {
    const { registrations } = loadClient();
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
    const root = expectElement(tree, 'expected a composer label element');
    expect(root.props.className).toBe('dshml-root dshml-trigger');
    const mark = expectPresent(findMark(tree), 'expected a mark element');
    expect(mark.props.dangerouslySetInnerHTML?.__html ?? '').toMatch(/^<svg/);
    expect(mark.props['aria-hidden']).toBe('true');
    const text = expectPresent(findText(tree), 'expected a label text element');
    expect(text.children[0]).toBe('DeepSeek-V4.1-Flash');
  });

  it('uses the official Chinese brand name in the zh locale', () => {
    const zh = loadClient({ lang: 'zh' });
    const zhLabel = labelRegistration(zh.registrations).component;
    // Qwen is officially 「千问」 since Alibaba's 2026 brand unification.
    const zhQwen = zhLabel(labelProps('openrouter', 'OpenRouter', 'qwen3-max', 'Qwen3 Max'));
    expect(expectPresent(findMark(zhQwen), 'qwen must resolve through the heuristic').props.title).toBe('千问');
    // No official Chinese name exists, so the artwork title survives in zh.
    const zhClaude = zhLabel(labelProps('anthropic', 'Anthropic', 'claude-sonnet-4-5', 'Claude Sonnet 4.5'));
    expect(expectPresent(findMark(zhClaude), 'claude must resolve through the heuristic').props.title).toBe('Claude');

    const en = loadClient({ lang: 'en' });
    const enLabel = labelRegistration(en.registrations).component;
    const enQwen = enLabel(labelProps('openrouter', 'OpenRouter', 'qwen3-max', 'Qwen3 Max'));
    expect(expectPresent(findMark(enQwen), 'qwen must resolve through the heuristic').props.title).toBe('Qwen');
  });

  it('keeps the shipped 1017 release badge on the official Flash entry', () => {
    const { registrations } = loadClient();
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
    const badge = expectPresent(findClass(tree, 'dshml-badge'), 'expected the release badge to survive the shadow');
    expect(badge.children[0]).toBe('1017');
  });

  it('renders a persisted brand override instead of the heuristic', () => {
    const { registrations } = loadClient({
      overrides: { openai: { 'gpt-4o': 'claude' } },
    });
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('openai', 'OpenAI', 'gpt-4o', 'GPT-4o'));
    const mark = expectPresent(
      findMark(tree),
      'override must draw a mark even though the heuristic chose another brand',
    );
    expect(mark.props.title, 'the override brand, not the heuristic brand, must render').toBe('Claude');
    expect(mark.props.dangerouslySetInnerHTML?.__html ?? '').toMatch(/^<svg/);
    expect(expectPresent(findText(tree), 'expected a label text element').children[0]).toBe('GPT-4o');
  });

  it('renders a generated letter tile for the letter sentinel', () => {
    const { registrations } = loadClient({
      overrides: { volcengine: { 'my-local-qwen': 'letter' } },
    });
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('volcengine', 'Volcengine', 'my-local-qwen', 'My Local Qwen'));
    const mark = expectPresent(findMark(tree), 'the letter sentinel must draw a generated tile');
    expect(mark.props.dangerouslySetInnerHTML?.__html ?? '').toMatch(/^<svg/);
    expect(expectPresent(findText(tree), 'expected a label text element').children[0]).toBe('My Local Qwen');
  });

  it('renders a user-created icon for the custom sentinel', () => {
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const { registrations } = loadClient({
      customIcons: { 'c-demo': { name: 'My Local Model', kind: 'image', image, createdAt: 1 } },
      overrides: { acme: { 'acme-chat-1': 'custom:c-demo' } },
    });
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
    const mark = expectPresent(findMark(tree), 'a custom override must draw the user-created icon');
    expect(mark.props.title, 'the custom name is the mark title').toBe('My Local Model');
    const html = mark.props.dangerouslySetInnerHTML?.__html ?? '';
    expect(html).toMatch(/^<svg/);
    expect(html, 'the raster payload rides an SVG <image>').toContain('<image href="' + image + '"');
    expect(html, 'the tile fills its viewBox').toContain('preserveAspectRatio="xMidYMid slice"');
    expect(html, 'the custom tile rounds like brand artwork').toContain('clip-path: inset(0 round 25%)');
  });

  it('renders no mark for a stale custom reference', () => {
    const { registrations } = loadClient({
      overrides: { acme: { 'acme-chat-1': 'custom:c-missing' } },
    });
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
    expect(tree, 'a reference to a deleted icon must fall back to the bare name').toBe('Acme Chat 1');
  });

  it('adopts persisted custom icons from the settings document', () => {
    loadClient({
      customIcons: {
        'c-demo': {
          name: 'My Local Model',
          kind: 'image',
          image: 'data:image/png;base64,iVBORw0KGgo=',
          createdAt: 1,
        },
      },
    });
    const state = diagnostics().iconState();
    expect(Object.keys(state.customIcons)).toEqual(['c-demo']);
    expect(state.customIcons['c-demo']?.name).toBe('My Local Model');
  });

  it('folds a custom icon written through the settings form into the icon state', async () => {
    const loaded = loadClient();
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const ok = await loaded.form.mutate([
      {
        op: 'set',
        path: ['customIcons', 'c-new'],
        value: { name: 'New Icon', kind: 'image', image, createdAt: 2 },
      },
    ]);
    expect(ok, 'the settings form must accept the custom icon write').toBe(true);
    expect(diagnostics().iconState().customIcons['c-new']?.name).toBe('New Icon');
    await loaded.form.mutate([{ op: 'set', path: ['modelIcons', 'acme', 'acme-chat-1'], value: 'custom:c-new' }]);
    const component = labelRegistration(loaded.registrations).component;
    const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
    expect(expectPresent(findMark(tree), 'the written custom icon must render').props.title).toBe('New Icon');
  });

  it('picks up an override written through the settings form', async () => {
    const loaded = loadClient();
    const component = labelRegistration(loaded.registrations).component;
    const props = labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1');
    expect(component(props), 'an unset pair starts without a mark').toBe('Acme Chat 1');
    const ok = await loaded.form.mutate([{ op: 'set', path: ['modelIcons', 'acme', 'acme-chat-1'], value: 'claude' }]);
    expect(ok, 'the settings form must accept the picker write').toBe(true);
    const tree = component(props);
    const mark = expectPresent(findMark(tree), 'the label must re-render with the override that was just written');
    expect(mark.props.title).toBe('Claude');
  });

  it('starts with an empty provider override document', () => {
    loadClient();
    expect(diagnostics().iconState().status).toBe('ready');
    expect(diagnostics().iconState().providerOverrides).toEqual({});
  });

  it('folds a provider override written through the settings form into the icon state', async () => {
    const loaded = loadClient();
    const ok = await loaded.form.mutate([{ op: 'set', path: ['providerIcons', 'volcengine'], value: 'qwen' }]);
    expect(ok, 'the settings form must accept the provider write').toBe(true);
    expect(diagnostics().iconState().providerOverrides).toEqual({ volcengine: 'qwen' });
    // An unset at the same path removes the entry again.
    const cleared = await loaded.form.mutate([{ op: 'unset', path: ['providerIcons', 'volcengine'] }]);
    expect(cleared, 'the settings form must accept the provider reset').toBe(true);
    expect(diagnostics().iconState().providerOverrides).toEqual({});
  });

  it('keeps a legacy document without provider overrides ready and empty', () => {
    // A profile written before provider overrides existed carries `modelIcons`
    // only; the bundle must not treat the missing field as an error.
    loadClient({ overrides: { 'deepseek-account': { 'deepseek-flash': 'deepseek' } } });
    const state = diagnostics().iconState();
    expect(state.status).toBe('ready');
    expect(state.providerOverrides).toEqual({});
    expect(state.customIcons).toEqual({});
    expect(state.overrides).toEqual({ 'deepseek-account': { 'deepseek-flash': 'deepseek' } });
  });

  it('adopts persisted provider overrides from the settings document', () => {
    loadClient({ providerIcons: { volcengine: 'qwen', anthropic: 'none' } });
    expect(diagnostics().iconState().providerOverrides).toEqual({ volcengine: 'qwen', anthropic: 'none' });
  });

  it('the none sentinel renders text only', () => {
    const { registrations } = loadClient({
      overrides: { acme: { 'acme-chat-1': 'none' } },
    });
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
    expect(tree, 'an explicitly disabled icon must fall back to the bare name').toBe('Acme Chat 1');
  });

  it('falls back to the bare catalog name when no brand matches', () => {
    const { registrations } = loadClient();
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
    expect(tree).toBe('Acme Chat 1');
  });

  it('unknown models without a catalog name fall back to the model id', () => {
    const { registrations } = loadClient();
    const component = labelRegistration(registrations).component;
    const tree = component({
      provider: { id: 'acme', name: 'Acme' },
      model: { id: 'internal-v0' },
      placement: 'option',
      selected: false,
    });
    expect(tree).toBe('internal-v0');
  });

  it('keeps heuristic marks when the settings service is unavailable', () => {
    const { registrations } = loadClient({ missing: ['configForms'] });
    const component = labelRegistration(registrations).component;
    const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
    expect(findMark(tree), 'the composer label must not depend on the settings service').toBeTruthy();
  });

  it('apply disposers remove the stylesheet, listeners and observer', () => {
    const loaded = loadClient();
    const { doc, registry, effects, disposers } = loaded;
    expect(doc.styleTags.length, 'the plugin stylesheet must be mounted once').toBe(1);
    expect(expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted once').mounted).toBe(true);
    expect(registry.observers.length, 'the settings decorator must observe the document').toBe(1);
    const observer = expectPresent(registry.observers[0], 'the settings decorator must observe the document');
    expect(observer.disconnected).toBe(false);
    const listenerCount = (): number => [...doc.listeners.values()].reduce((total, set) => total + set.size, 0);
    expect(listenerCount(), 'input/change/pointerdown capture listeners must be installed').toBe(3);

    const cleanups = [...effects.map((entry) => entry.off), ...disposers].filter(
      (off): off is () => void => typeof off === 'function',
    );
    expect(cleanups.length >= 4, 'every mounted scope must expose a disposer').toBeTruthy();
    for (const cleanup of cleanups.reverse()) cleanup();

    expect(doc.styleTags.length, 'the stylesheet must be removed on dispose').toBe(0);
    expect(listenerCount(), 'the document listeners must be removed on dispose').toBe(0);
    expect(observer.disconnected, 'the mutation observer must be disconnected on dispose').toBe(true);
  });
});
