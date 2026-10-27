/**
 * Loads the generated browser module in a minimal DOM/React stand-in and checks
 * the contribution it registers: slot name, shadowing priority, and the rendered
 * label tree for a matched model, an unknown model, and the shipped release badge.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = resolve(ROOT, 'client.js');

/** Minimal React: enough for the label contribution's createElement tree. */
const createElement = (type, props, ...children) => ({
  type,
  props: props ?? {},
  children: children.length === 1 && Array.isArray(children[0]) ? children[0] : children,
});
const fakeReact = { createElement };

/** Minimal document so the style-mounting effect can run. */
function fakeDocument() {
  const styleTags = [];
  return {
    styleTags,
    querySelector: (selector) => (selector.startsWith('style[data-plugin-css=') ? styleTags.find((tag) => selector.includes(tag.dataset.pluginCss)) ?? null : null),
    createElement: (tagName) => {
      const tag = { tagName, dataset: {}, textContent: '', remove() {} };
      styleTags.push(tag);
      return tag;
    },
    head: { appendChild(tag) { tag.mounted = true; } },
  };
}

/** Load the client module, returning its registration plus the component. */
function loadClient() {
  const source = readFileSync(CLIENT, 'utf8');
  let definition = null;
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value; } } };
  globalThis.document = fakeDocument();
  new Function(source)();
  assert.ok(definition, 'client.js did not call window.__ModuleLoader__.load');
  const factory = definition.factory;
  const moduleExports = factory((id) => {
    assert.equal(id, 'react');
    return fakeReact;
  });
  const registrations = [];
  const cleanups = [];
  const ctx = {
    effect: (callback) => {
      const cleanup = callback();
      cleanups.push(cleanup);
      return () => {};
    },
    slots: {
      inject: (slotName, callback) => {
        assert.equal(slotName, 'conversation.input.model.label');
        callback();
        return () => {};
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  moduleExports.apply(ctx);
  return { moduleExports, registrations, cleanups };
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

test('registers exactly one label contribution that shadows the shipped badge', () => {
  const { moduleExports, registrations, cleanups } = loadClient();
  assert.deepEqual(moduleExports.inject, ['slots']);
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.options.name, 'conversation.input.model.label');
  assert.equal(registration.options.priority, -1, 'must outrank the shipped priority-0 release label');
  assert.equal(typeof registration.component, 'function');
  assert.ok(cleanups.length >= 1, 'style effect must be registered for disposal');
});

test('draws the brand mark before the catalog name', () => {
  const { registrations } = loadClient();
  const component = registrations[0].component;
  const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
  assert.equal(tree.props.className, 'dshml-root dshml-trigger');
  const nodes = flatten(tree);
  const mark = nodes.find((node) => node !== null && typeof node === 'object' && node.props?.className === 'dshml-mark');
  assert.ok(mark, 'expected a mark element');
  assert.match(mark.props.dangerouslySetInnerHTML.__html, /^<svg/);
  const text = nodes.find((node) => node !== null && typeof node === 'object' && node.props?.className === 'dshml-text');
  assert.equal(text.children[0], 'DeepSeek-V4.1-Flash');
});

test('keeps the shipped 1017 release badge on the official Flash entry', () => {
  const { registrations } = loadClient();
  const component = registrations[0].component;
  const tree = component(labelProps('deepseek-account', 'DeepSeek Account', 'deepseek-flash', 'DeepSeek-V4.1-Flash'));
  const badge = flatten(tree).find((node) => node !== null && typeof node === 'object' && node.props?.className === 'dshml-badge');
  assert.ok(badge, 'expected the release badge to survive the shadow');
  assert.equal(badge.children[0], '1017');
});

test('falls back to the bare catalog name when no brand matches', () => {
  const { registrations } = loadClient();
  const component = registrations[0].component;
  const tree = component(labelProps('acme', 'Acme', 'acme-chat-1', 'Acme Chat 1'));
  assert.equal(tree, 'Acme Chat 1');
});

test('unknown models without a catalog name fall back to the model id', () => {
  const { registrations } = loadClient();
  const component = registrations[0].component;
  const tree = component({ provider: { id: 'acme', name: 'Acme' }, model: { id: 'internal-v0' }, placement: 'option', selected: false });
  assert.equal(tree, 'internal-v0');
});
