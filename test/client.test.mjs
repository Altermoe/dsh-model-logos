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
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = resolve(ROOT, 'client.js');

/** Minimal React: enough for the contributions' createElement/hook trees. */
const createElement = (type, props, ...children) => ({
  type,
  props: props ?? {},
  children: children.length === 1 && Array.isArray(children[0]) ? children[0] : children,
});
const fakeReact = {
  createElement,
  // The label and the settings section subscribe to the icon/catalog stores.
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useRef: (value) => ({ current: value }),
  Fragment: 'Fragment',
};

/** Minimal document: stylesheet mounting plus the decorator's listeners. */
function createFakeDocument() {
  const styleTags = [];
  const listeners = new Map();
  return {
    documentElement: { lang: 'en' },
    body: { tagName: 'BODY' },
    activeElement: null,
    styleTags,
    listeners,
    createElement(tagName) {
      const tag = {
        tagName: String(tagName).toUpperCase(),
        dataset: {},
        textContent: '',
        hidden: false,
        mounted: false,
        removed: false,
        setAttribute() {},
        remove() {
          tag.removed = true;
          const index = styleTags.indexOf(tag);
          if (index !== -1) styleTags.splice(index, 1);
        },
      };
      if (tag.tagName === 'STYLE') styleTags.push(tag);
      return tag;
    },
    head: { appendChild(tag) { tag.mounted = true; } },
    querySelector(selector) {
      if (selector.startsWith('style[data-plugin-css=')) {
        return styleTags.find((tag) => selector.includes(tag.dataset.pluginCss)) ?? null;
      }
      // No Settings dialog in this stand-in: the decorator shapes nothing.
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
}

/** MutationObserver stand-in: records observe/disconnect without observing. */
function createObserverRegistry() {
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observations = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(target, options) {
      this.observations.push({ target, options });
    }
    disconnect() {
      this.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  }
  return { observers, FakeMutationObserver };
}

/** A configForms mirror (used by the section catalog, irrelevant to the label). */
function createMirror() {
  return {
    ensure: () => Promise.resolve(),
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', view: { namespaces: [] } }),
  };
}

/** A fake `ctx.configForms.get('dsh-model-logos')` form with mutable overrides. */
function createForm(overrides) {
  const form = {
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
    getSnapshot() {
      return form.snapshot;
    },
    subscribe(listener) {
      form.listeners.add(listener);
      return () => form.listeners.delete(listener);
    },
    async set(field, value) {
      return form.mutate([{ op: 'set', path: [field], value }]);
    },
    async unset(field) {
      return form.mutate([{ op: 'unset', path: [field] }]);
    },
    async mutate(ops, expectedRevision) {
      form.mutateCalls.push({ ops, expectedRevision });
      for (const op of ops) {
        const path = Array.isArray(op.path) ? op.path : [];
        if (path.length !== 3 || path[0] !== 'modelIcons') continue;
        const icons = { ...(form.snapshot.value.modelIcons ?? {}) };
        const bucket = { ...(icons[path[1]] ?? {}) };
        if (op.op === 'unset') {
          delete bucket[path[2]];
          if (Object.keys(bucket).length === 0) delete icons[path[1]];
          else icons[path[1]] = bucket;
        } else {
          bucket[path[2]] = op.value;
          icons[path[1]] = bucket;
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

/**
 * Build a plugin context with the services the bundle injects.
 * `missing` names services to withhold (e.g. `['configForms']`).
 */
function createContext({ overrides = {}, missing = [] } = {}) {
  const registrations = [];
  const injectedSlots = [];
  const effects = [];
  const disposers = [];
  const events = [];
  const form = createForm(overrides);
  const mirror = createMirror();
  const services = {
    configForms: { get: (id) => (id === 'dsh-model-logos' ? form : form), describe: () => mirror },
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
      getSnapshot: () => ({ active: 'en' }),
      subscribe: () => () => {},
    },
  };
  for (const name of missing) delete services[name];

  const recordEffect = (callback, label) => {
    const off = callback();
    effects.push({ label, off });
    return () => {};
  };
  const makeScope = () => ({
    effect: recordEffect,
    on(event, handler) {
      const off = () => {};
      events.push({ event, handler, off });
      return off;
    },
    get(name) {
      return services[name];
    },
  });

  const ctx = {
    effect: recordEffect,
    on(event, handler) {
      const off = () => {};
      events.push({ event, handler, off });
      return off;
    },
    get(name) {
      return services[name];
    },
    inject(deps, callback) {
      const scope = makeScope();
      const off = callback(scope);
      if (typeof off === 'function') disposers.push(off);
      return () => {};
    },
    slots: {
      inject(slotName, callback) {
        injectedSlots.push(slotName);
        const off = callback();
        if (typeof off === 'function') disposers.push(off);
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  return { ctx, registrations, injectedSlots, effects, disposers, events, form, mirror };
}

/** Load client.js and apply it to a fresh fake context. */
function loadClient(options = {}) {
  const source = readFileSync(CLIENT, 'utf8');
  const doc = createFakeDocument();
  const registry = createObserverRegistry();
  let definition = null;
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value; } } };
  globalThis.document = doc;
  globalThis.MutationObserver = registry.FakeMutationObserver;
  new Function(source)();
  assert.ok(definition, 'client.js did not call window.__ModuleLoader__.load');
  const moduleExports = definition.factory((id) => {
    if (id === 'react') return fakeReact;
    if (id === 'react-dom/client') {
      return { createRoot: () => ({ render() {}, unmount() {} }) };
    }
    throw new Error(`unexpected require("${id}") in the generated bundle`);
  });
  const harness = createContext(options);
  moduleExports.apply(harness.ctx);
  return { ...harness, moduleExports, doc, registry };
}

const flatten = (node) => {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const own = flatten(node.children ?? []);
  const nested = node.props?.children === undefined ? [] : flatten(node.props.children);
  return [node, ...own, ...nested];
};

const labelProps = (providerId, providerName, modelId, modelName) => ({
  provider: { id: providerId, name: providerName },
  model: { id: modelId, name: modelName },
  placement: 'trigger',
  selected: true,
});

const labelRegistration = (registrations) => {
  const matches = registrations.filter((entry) => entry.options.name === 'conversation.input.model.label');
  assert.equal(matches.length, 1, 'expected exactly one composer label contribution');
  return matches[0];
};

const findMark = (tree) =>
  flatten(tree).find((node) => node !== null && typeof node === 'object' && node.props?.className === 'dshml-mark');
const findText = (tree) =>
  flatten(tree).find((node) => node !== null && typeof node === 'object' && node.props?.className === 'dshml-text');

test('registers the label (priority -1) and the Model-icons settings section', () => {
  const { moduleExports, registrations, injectedSlots } = loadClient();
  assert.deepEqual(moduleExports.inject, ['slots']);
  assert.ok(injectedSlots.includes('conversation.input.model.label'), 'label slot must be requested');
  assert.ok(injectedSlots.includes('settings.section'), 'settings.section slot must be requested');

  const label = labelRegistration(registrations);
  assert.equal(label.options.priority, -1, 'must outrank the shipped priority-0 release label');
  assert.equal(typeof label.component, 'function');

  const sections = registrations.filter((entry) => entry.options.name === 'settings.section');
  assert.equal(sections.length, 1, 'expected exactly one settings section contribution');
  const section = sections[0];
  assert.equal(section.options.id, 'model-logos', 'the settings nav entry id is fixed');
  assert.equal(typeof section.component, 'function', 'the section component must be registered');
  assert.equal(typeof section.options.label, 'function', 'the section needs a nav label');
  assert.equal(typeof section.options.label(), 'string');
  assert.ok(section.options.label().trim() !== '', 'the section nav label must not be empty');
});

test('draws the brand mark before the catalog name', () => {
  const { registrations } = loadClient();
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
  assert.equal(tree.props.className, 'dshml-root dshml-trigger');
  const mark = findMark(tree);
  assert.ok(mark, 'expected a mark element');
  assert.match(mark.props.dangerouslySetInnerHTML.__html, /^<svg/);
  assert.equal(mark.props['aria-hidden'], 'true');
  const text = findText(tree);
  assert.equal(text.children[0], 'DeepSeek-V4.1-Flash');
});

test('keeps the shipped 1017 release badge on the official Flash entry', () => {
  const { registrations } = loadClient();
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
  const badge = flatten(tree).find((node) => node !== null && typeof node === 'object' && node.props?.className === 'dshml-badge');
  assert.ok(badge, 'expected the release badge to survive the shadow');
  assert.equal(badge.children[0], '1017');
});

test('renders a persisted brand override instead of the heuristic', () => {
  const { registrations } = loadClient({
    overrides: { openai: { 'gpt-4o': 'claude' } },
  });
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('openai', 'OpenAI', 'gpt-4o', 'GPT-4o'));
  const mark = findMark(tree);
  assert.ok(mark, 'override must draw a mark even though the heuristic chose another brand');
  assert.equal(mark.props.title, 'Claude', 'the override brand, not the heuristic brand, must render');
  assert.match(mark.props.dangerouslySetInnerHTML.__html, /^<svg/);
  assert.equal(findText(tree).children[0], 'GPT-4o');
});

test('renders a generated letter tile for the letter sentinel', () => {
  const { registrations } = loadClient({
    overrides: { volcengine: { 'my-local-qwen': 'letter' } },
  });
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('volcengine', 'Volcengine', 'my-local-qwen', 'My Local Qwen'));
  const mark = findMark(tree);
  assert.ok(mark, 'the letter sentinel must draw a generated tile');
  assert.match(mark.props.dangerouslySetInnerHTML.__html, /^<svg/);
  assert.equal(findText(tree).children[0], 'My Local Qwen');
});

test('picks up an override written through the settings form', async () => {
  const loaded = loadClient();
  const component = labelRegistration(loaded.registrations).component;
  const props = labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1');
  assert.equal(component(props), 'Acme Chat 1', 'an unset pair starts without a mark');
  const ok = await loaded.form.mutate([
    { op: 'set', path: ['modelIcons', 'acme', 'acme-chat-1'], value: 'claude' },
  ]);
  assert.equal(ok, true, 'the settings form must accept the picker write');
  const tree = component(props);
  const mark = findMark(tree);
  assert.ok(mark, 'the label must re-render with the override that was just written');
  assert.equal(mark.props.title, 'Claude');
});

test('the none sentinel renders text only', () => {
  const { registrations } = loadClient({
    overrides: { acme: { 'acme-chat-1': 'none' } },
  });
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
  assert.equal(tree, 'Acme Chat 1', 'an explicitly disabled icon must fall back to the bare name');
});

test('falls back to the bare catalog name when no brand matches', () => {
  const { registrations } = loadClient();
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
  assert.equal(tree, 'Acme Chat 1');
});

test('unknown models without a catalog name fall back to the model id', () => {
  const { registrations } = loadClient();
  const component = labelRegistration(registrations).component;
  const tree = component({ provider: { id: 'acme', name: 'Acme' }, model: { id: 'internal-v0' }, placement: 'option', selected: false });
  assert.equal(tree, 'internal-v0');
});

test('keeps heuristic marks when the settings service is unavailable', () => {
  const { registrations } = loadClient({ missing: ['configForms'] });
  const component = labelRegistration(registrations).component;
  const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
  assert.ok(findMark(tree), 'the composer label must not depend on the settings service');
});

test('apply disposers remove the stylesheet, listeners and observer', () => {
  const loaded = loadClient();
  const { doc, registry, effects, disposers } = loaded;
  assert.equal(doc.styleTags.length, 1, 'the plugin stylesheet must be mounted once');
  assert.equal(doc.styleTags[0].mounted, true);
  assert.equal(registry.observers.length, 1, 'the settings decorator must observe the document');
  const observer = registry.observers[0];
  assert.equal(observer.disconnected, false);
  const listenerCount = () => [...doc.listeners.values()].reduce((total, set) => total + set.size, 0);
  assert.equal(listenerCount(), 3, 'input/change/pointerdown capture listeners must be installed');

  const cleanups = [...effects.map((entry) => entry.off), ...disposers].filter((off) => typeof off === 'function');
  assert.ok(cleanups.length >= 4, 'every mounted scope must expose a disposer');
  for (const cleanup of cleanups.reverse()) cleanup();

  assert.equal(doc.styleTags.length, 0, 'the stylesheet must be removed on dispose');
  assert.equal(listenerCount(), 0, 'the document listeners must be removed on dispose');
  assert.equal(observer.disconnected, true, 'the mutation observer must be disconnected on dispose');
});
