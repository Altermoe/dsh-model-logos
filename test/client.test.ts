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
const fakeReact = {
  createElement,
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
function createMirror() {
  return {
    ensure: (): Promise<void> => Promise.resolve(),
    subscribe: (): (() => void) => () => {},
    getSnapshot: (): { status: string; view: { namespaces: unknown[] } } => ({
      status: 'ready',
      view: { namespaces: [] },
    }),
  };
}

/** Snapshot shape the fake settings form returns to the bundle. */
interface FakeFormSnapshot {
  status: string;
  value: { modelIcons: Record<string, Record<string, string>> };
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

function createForm(overrides: Record<string, Record<string, string>>): FakeForm {
  const form: FakeForm = {
    listeners: new Set(),
    mutateCalls: [],
    snapshot: {
      status: 'ready',
      value: { modelIcons: overrides },
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
        if (path.length !== 3 || path[0] !== 'modelIcons') continue;
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
  missing?: string[];
  /** Active DSH locale (`en` unless a test forces another language). */
  lang?: string;
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
function createContext({ overrides = {}, missing = [], lang = 'en' }: ContextOptions = {}) {
  const registrations: Registration[] = [];
  const injectedSlots: string[] = [];
  const effects: Array<{ label: string | undefined; off: unknown }> = [];
  const disposers: unknown[] = [];
  const events: Array<{ event: string; handler: unknown; off: () => void }> = [];
  const form = createForm(overrides);
  const mirror = createMirror();
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
      settings: { mutate: async () => true },
      $on: () => () => {},
    },
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
  const own = flatten(element.children ?? []);
  const nested = element.props?.children === undefined ? [] : flatten(element.props.children);
  return [element, ...own, ...nested];
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

  it('sizes the marks on the shared 22px base and the picker preview at 36px', () => {
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    /** Whether one rule declares both the width and the height. */
    const sized = (selector: string, px: number): boolean => {
      const block = cssRule(style, selector);
      return new RegExp('width:\\s*' + px + 'px').test(block) && new RegExp('height:\\s*' + px + 'px').test(block);
    };
    // The composer label, the Settings → Models marks and the Model icons page
    // share one 22px base, so a mark never renders at a different scale.
    expect(sized('.dshml-mark', 22), 'composer trigger/menu mark').toBe(true);
    expect(sized('.dshml-vendor', 22), 'Settings vendor mark').toBe(true);
    expect(sized('.dshml-model-icon-btn', 22), 'Settings model-row icon seat').toBe(true);
    expect(sized('.dshml-model-icon-btn .dshml-model-mark', 22), 'Settings model-row mark').toBe(true);
    expect(sized('.dshml-combo-mark', 22), 'provider combobox mark').toBe(true);
    expect(sized('.dshml-section-mark', 22), 'Model icons page mark seat').toBe(true);
    // The picker preview is the one enlarged surface: 36px.
    expect(sized('.dshml-picker-option-mark', 36), 'picker option mark').toBe(true);
  });

  it('optically centres the composer mark on the label line', () => {
    // The composer label is a 13px/20px line. Its glyphs sit about 2px below the
    // centre of the 22px mark box, and the row's baseline alignment used to leave
    // the mark high in the 28px trigger hit area and high against the model name.
    // One 2px paint-only nudge covers the optical difference. The mark keeps its
    // 22px layout box, so the host's row heights, clipping boxes and hit areas do
    // not move. Settings marks and the picker preview are already centred by their
    // own grid/flex rows and must not take the nudge.
    const { doc } = loadClient();
    const style = expectPresent(doc.styleTags[0], 'the plugin stylesheet must be mounted');
    const root = cssRule(style, '.dshml-root');
    expect(root, 'the row centres the 22px mark box and the name').toMatch(/align-items:\s*center/);
    expect(root, 'the label keeps the host line baseline').toMatch(/vertical-align:\s*baseline/);
    const mark = cssRule(style, '.dshml-mark');
    expect(mark, 'the optical nudge must not change the 22px layout box').toMatch(/position:\s*relative/);
    expect(mark, 'a 13px line needs a 2px optical nudge').toMatch(/top:\s*2px/);
    expect(mark, 'the composer mark stays on the shared 22px base').toMatch(/width:\s*22px/);
    expect(mark).toMatch(/height:\s*22px/);
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
