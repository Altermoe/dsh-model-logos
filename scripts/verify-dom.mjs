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
 *   node scripts/verify-dom.mjs                          # assertions (exit 1 on failure)
 *   node scripts/verify-dom.mjs --json .preview/dom.json # also save the raw result
 *   node scripts/verify-dom.mjs --screenshot docs/preview-settings.png
 *                                                        # decorated page screenshot
 *   node scripts/verify-dom.mjs --screenshot docs/preview-settings.png --open picker
 *                                                        # ... with the picker modal open
 *   node scripts/verify-dom.mjs --harness <path>         # keep the generated page
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
const valueAfter = (flag) => {
  const at = args.indexOf(flag);
  if (at < 0) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
};
const hasFlag = (flag) => args.includes(flag);
const screenshotPath = valueAfter('--screenshot');
const openMode = valueAfter('--open') ?? 'combobox';
const jsonPath = valueAfter('--json');
const keptHarnessPath = valueAfter('--harness');
const requireBuild = hasFlag('--require-build');
const scale = Number(valueAfter('--scale') ?? 2) || 2;

/**
 * Directory returned by `remote.llm.listConfigurableProviders()`; mirrors the fixture.
 *
 * Real catalog entries carry the route id as their display name (`llm-pi-ai`'s
 * `directoryEntries()` calls `declare(provider, provider)` for every installed
 * catalog route), while a saved profile may override it (`displayName`), which is
 * how the hand-declared 火山 Coding Plan row is named. The one localized outlier
 * is `deepseek-account`, whose row text is the page's `deepSeekAccount` copy.
 */
const DIRECTORY = [
  {
    provider: 'deepseek-account',
    displayName: 'DeepSeek Account',
    settingsNs: 'llm-deepseek-account',
    settingsPath: [],
  },
  { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] },
  {
    provider: 'volcengine',
    displayName: '火山 Coding Plan',
    declared: true,
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'volcengine'],
  },
  { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
  { provider: 'google', displayName: 'google', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'google'] },
  { provider: 'moonshotai', displayName: 'moonshotai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai'] },
  { provider: 'xai', displayName: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
  { provider: 'openrouter', displayName: 'openrouter', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openrouter'] },
];

/** The add-provider catalog `<select>` options, in fixture order (text = display name). */
const SELECT_OPTIONS = [
  { value: 'openai', label: 'openai' },
  { value: 'google', label: 'google' },
  { value: 'moonshotai', label: 'moonshotai' },
  { value: 'xai', label: 'xai' },
  { value: 'openrouter', label: 'openrouter' },
];

const DRIVER_CONFIG = {
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
/* In-page driver                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Runs inside headless Edge. Must stay a pure browser function: it is serialized
 * with `Function.prototype.toString` and injected into the harness page.
 */
async function browserDriver(config) {
  'use strict';

  // Keep the dumped DOM small: React's development UMD builds are ~1MB each and
  // they are already executing safely by the time this last script runs.
  const scriptTags = document.querySelectorAll('script');
  for (let at = 0; at < scriptTags.length; at++) scriptTags[at].remove();

  const params = new URLSearchParams(location.search);
  const MODE = params.get('mode') || 'verify';
  const OPEN = params.get('open') || '';

  const pageErrors = [];
  const consoleIssues = [];

  window.addEventListener('error', (event) => {
    pageErrors.push('window.error: ' + (event.message || String(event.error)));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    pageErrors.push('unhandledrejection: ' + (reason && reason.stack ? reason.stack : String(reason)));
  });
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...parts) => {
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

  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const now = () => performance.now();
  const waitFor = async (probe, timeoutMs) => {
    const startedAt = now();
    const limit = timeoutMs === undefined ? 4000 : timeoutMs;
    for (;;) {
      let value = null;
      try {
        value = probe();
      } catch {
        value = null;
      }
      if (value) return value;
      if (now() - startedAt >= limit) return null;
      await sleep(30);
    }
  };
  const q = (selector, root) => (root || document).querySelector(selector);
  const qa = (selector, root) =>
    Array.prototype.slice.call((root || document).querySelectorAll(selector));
  const text = (node) => (node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const visible = (node) => {
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
  const describeNode = (node) => {
    if (!node) return 'null';
    const id = node.id ? '#' + node.id : '';
    const className =
      typeof node.className === 'string' && node.className.trim() !== ''
        ? '.' + node.className.trim().replace(/\s+/g, '.')
        : '';
    return node.tagName.toLowerCase() + id + className;
  };
  const escapeHtml = (value) =>
    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isBefore = (first, second) =>
    first && second && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  const assertions = [];
  const add = (name, required, ok, detail) => {
    assertions.push({
      name,
      required: required !== false,
      ok: ok === true,
      detail: detail === undefined || detail === null ? '' : String(detail),
    });
    return ok === true;
  };

  /* --------------------------- fake plugin context -------------------------- */

  const H = {
    cleanups: [],
    registrations: [],
    slotRequests: [],
    injected: [],
    mutateCalls: [],
    setCalls: [],
    formListeners: [],
    // The persisted nested dict: modelIcons[providerId][modelId] = icon key.
    overrides: {},
    revision: 1,
    errors: [],
  };

  // What `form.getSnapshot().value` returns: the settings document value with the
  // host plugin's `modelIcons` volatile field on top. Path ops arrive relative to
  // this root (`['modelIcons', providerId, modelId]`), so the harness applies
  // them here — `H.overrides` always stays the inner dict the plugin reads.
  const settingsValue = { modelIcons: H.overrides };

  const cloneJson = (value) => JSON.parse(JSON.stringify(value));

  function setPath(root, path, value) {
    let node = root;
    for (let index = 0; index < path.length - 1; index++) {
      const key = String(path[index]);
      if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    }
    node[String(path[path.length - 1])] = value;
  }

  function unsetPath(root, path) {
    const parents = [];
    let node = root;
    for (let index = 0; index < path.length - 1; index++) {
      const key = String(path[index]);
      if (node[key] === null || typeof node[key] !== 'object') return;
      parents.push([node, key]);
      node = node[key];
    }
    delete node[String(path[path.length - 1])];
    for (let index = parents.length - 1; index >= 0; index--) {
      const parent = parents[index][0];
      const key = parents[index][1];
      if (parent[key] && typeof parent[key] === 'object' && Object.keys(parent[key]).length === 0) delete parent[key];
      else break;
    }
  }

  const fieldPath = (field) => (Array.isArray(field) ? field : String(field).split('.'));

  let cachedSnapshot = null;
  const buildSnapshot = () => ({
    status: 'ready',
    value: settingsValue,
    base: {},
    user: settingsValue,
    revision: H.revision,
    writable: true,
  });
  const notifyForm = () => {
    cachedSnapshot = buildSnapshot();
    const snapshot = cachedSnapshot;
    for (const listener of H.formListeners.slice()) {
      try {
        listener(snapshot);
      } catch (error) {
        H.errors.push('form listener: ' + (error && error.stack ? error.stack : error));
      }
    }
  };

  const form = {
    // The settings namespace the plugin owns; any other id is not a form.
    getSnapshot() {
      if (cachedSnapshot === null) cachedSnapshot = buildSnapshot();
      return cachedSnapshot;
    },
    subscribe(listener) {
      H.formListeners.push(listener);
      return () => {
        const at = H.formListeners.indexOf(listener);
        if (at >= 0) H.formListeners.splice(at, 1);
      };
    },
    mutate(operations) {
      H.mutateCalls.push(cloneJson(operations));
      try {
        for (const operation of Array.isArray(operations) ? operations : []) {
          if (!operation || !Array.isArray(operation.path) || operation.path.length === 0) continue;
          if (operation.op === 'set') setPath(settingsValue, operation.path, operation.value);
          else if (operation.op === 'unset') unsetPath(settingsValue, operation.path);
        }
      } catch (error) {
        H.errors.push('form.mutate: ' + (error && error.stack ? error.stack : error));
      }
      H.revision += 1;
      notifyForm();
      return true;
    },
    set(field, value) {
      H.setCalls.push([cloneJson(field), cloneJson(value)]);
      setPath(settingsValue, fieldPath(field), value);
      H.revision += 1;
      notifyForm();
      return true;
    },
    unset(field) {
      H.setCalls.push([cloneJson(field), '<unset>']);
      unsetPath(settingsValue, fieldPath(field));
      H.revision += 1;
      notifyForm();
      return true;
    },
  };

  const configForms = {
    get(id) {
      return id === 'dsh-model-logos' ? form : null;
    },
    // The settings mirror: the plugin calls ensure()/getSnapshot()/subscribe()
    // and reads view.namespaces for the model catalog. This deployment has no
    // extra namespaces to contribute.
    describe() {
      return {
        ensure() {
          return Promise.resolve();
        },
        getSnapshot() {
          return { view: { namespaces: [] } };
        },
        subscribe() {
          return () => {};
        },
      };
    },
  };

  const llm = {
    listConfigurableProviders() {
      return Promise.resolve(config.directory.map((entry) => Object.assign({}, entry)));
    },
    listProviders() {
      return Promise.resolve([{ id: 'deepseek-account', name: 'DeepSeek Account' }]);
    },
    discoverModels() {
      return Promise.resolve([]);
    },
  };
  const remote = { llm, settings: { get() { return Promise.resolve(undefined); } } };

  const localeListeners = [];
  const locale = {
    getSnapshot() {
      return { active: config.lang, locales: [config.lang] };
    },
    subscribe(listener) {
      localeListeners.push(listener);
      return () => {
        const at = localeListeners.indexOf(listener);
        if (at >= 0) localeListeners.splice(at, 1);
      };
    },
  };

  const slots = {
    inject(name, callback) {
      H.slotRequests.push(name);
      // Only slots the fixture declares would resolve in the real app.
      if (name === 'conversation.input.model.label' || name === 'settings.section') {
        try {
          callback();
        } catch (error) {
          H.errors.push('slots.inject(' + name + '): ' + (error && error.stack ? error.stack : error));
        }
      }
      return () => {};
    },
    register(options, component) {
      H.registrations.push({ options: options, component: component, slot: options && options.name });
      return { dispose() {} };
    },
  };

  const services = {
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
      getSnapshot() {
        return { mode: 'light', appearance: 'light' };
      },
      subscribe() {
        return () => {};
      },
    },
    connection: { getSnapshot() { return { status: 'connected' }; }, subscribe() { return () => {}; } },
  };

  function effect(callback, label) {
    try {
      const dispose = callback();
      if (typeof dispose === 'function') H.cleanups.push(dispose);
      else if (Array.isArray(dispose)) {
        for (const candidate of dispose) if (typeof candidate === 'function') H.cleanups.push(candidate);
      }
    } catch (error) {
      H.errors.push('effect(' + (label || 'unlabelled') + '): ' + (error && error.stack ? error.stack : error));
    }
    return () => {};
  }

  /** Resolve a service by the exact key the bundle asks for (`remote.llm` included). */
  function getService(name) {
    if (typeof name !== 'string') return undefined;
    if (Object.prototype.hasOwnProperty.call(services, name)) return services[name];
    // Tolerate a dotted read that was requested as a property chain.
    if (name.includes('.')) {
      let node = services;
      for (const part of name.split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = node[part];
      }
      return node;
    }
    return undefined;
  }

  const on = () => () => {};

  function inject(dependencies, callback) {
    const requested = Array.isArray(dependencies) ? dependencies : dependencies === undefined ? [] : [dependencies];
    H.injected.push(...requested.map((name) => String(name)));
    try {
      const dispose = callback(makeContext());
      if (typeof dispose === 'function') H.cleanups.push(dispose);
    } catch (error) {
      H.errors.push('inject(' + JSON.stringify(requested) + '): ' + (error && error.stack ? error.stack : error));
    }
    return () => {};
  }

  function makeContext() {
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

  function makeJsxRuntime() {
    const React = window.React;
    const create = (type, config, maybeKey) => {
      const props = {};
      let key = maybeKey;
      if (config !== null && config !== undefined) {
        for (const name in config) {
          if (name === 'key') key = config[name];
          else props[name] = config[name];
        }
      }
      if (key !== undefined) props.key = key;
      return React.createElement(type, props);
    };
    return { Fragment: React.Fragment, jsx: create, jsxs: create, jsxDEV: create };
  }

  function makeRequire() {
    return (id) => {
      if (id === 'react') return window.React;
      if (id === 'react-dom') return window.ReactDOM;
      if (id === 'react-dom/client') {
        return { createRoot: window.ReactDOM.createRoot, hydrateRoot: window.ReactDOM.hydrateRoot };
      }
      if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return makeJsxRuntime();
      throw new Error('harness has no module for require(' + JSON.stringify(id) + ')');
    };
  }

  let exported = null;
  try {
    const definition = window.__dshmlModule;
    if (!definition || typeof definition.factory !== 'function') {
      throw new Error('client.js did not call window.__ModuleLoader__.load({ factory })');
    }
    exported = definition.factory(makeRequire());
    if (!exported || typeof exported.apply !== 'function') throw new Error('the bundle factory did not return { apply }');
  } catch (error) {
    H.errors.push('factory: ' + (error && error.stack ? error.stack : error));
  }

  let applyDispose = null;
  if (exported) {
    try {
      applyDispose = exported.apply(makeContext());
      if (typeof applyDispose === 'function') H.cleanups.push(applyDispose);
    } catch (error) {
      H.errors.push('apply: ' + (error && error.stack ? error.stack : error));
    }
  }

  const root = q('[data-shortcut-modal="settings"]');
  const rowCards = root ? qa('li.jrmgQW_rowCard', root) : [];
  const modelEntries = root ? qa('.jrmgQW_modelEntry', root) : [];
  const modelRows = modelEntries.map((entry) => q('.jrmgQW_modelRow', entry)).filter(Boolean);

  /* -------------------------- decoration locators -------------------------- */

  const vendorMarkers = () => qa('[data-dshml-vendor]');

  function findProviderRow(displayName) {
    return rowCards.filter((row) => text(q('.jrmgQW_rowName', row)) === displayName)[0] || null;
  }

  /** Model rows carry [data-dshml-model-row] once decorated; the button is `.dshml-model-icon-btn`. */
  function modelRowNodes() {
    return root ? qa('[data-dshml-model-row]', root) : [];
  }

  function findModelRowButton(index) {
    const row = modelRowNodes()[index];
    if (!row) return null;
    return q('.dshml-model-icon-btn', row) || null;
  }

  function findComboboxFace(select) {
    if (!select) return null;
    const field = select.closest('.jrmgQW_field');
    const scopes = [field, root].filter(Boolean);
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
  function findComboMenu() {
    const direct = qa('.dshml-combo .dshml-combo-menu, [data-dshml-combo="1"] [role="listbox"]').filter(visible)[0];
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
    return candidates[0] || null;
  }

  /** Menu entries carry `data-value`; fall back to matching their label text. */
  function findMenuItems(menu) {
    if (!menu) return [];
    const items = qa('.dshml-combo-item[data-value]', menu);
    if (items.length > 0) {
      return items.map((node) => ({
        value: node.dataset.value,
        label: text(q('.dshml-combo-item-label', node)) || text(node),
        node,
      }));
    }
    const fallback = [];
    for (const option of config.options) {
      const candidates = qa('*', menu).filter((node) => text(node) === option.label);
      let smallest = null;
      for (const candidate of candidates) if (smallest === null || smallest.contains(candidate)) smallest = candidate;
      if (smallest) fallback.push({ value: option.value, label: option.label, node: smallest });
    }
    return fallback;
  }

  function clickable(node) {
    return node.closest('button, [role="option"], [role="menuitem"], [role="menuitemradio"], li') || node;
  }

  /** The icon picker modal root is `[data-dshml-picker]` (portaled into body). */
  function findPicker() {
    const direct = qa('[data-dshml-picker]').filter(visible)[0];
    if (direct) return direct;
    const candidates = qa('.dshml-picker-layer, [role="dialog"]').filter(
      (node) => !node.hasAttribute('data-shortcut-modal') && visible(node),
    );
    return candidates[0] || null;
  }

  function pickerTitle(picker) {
    const title = picker ? q('.dshml-picker-title', picker) : null;
    return title ? text(title) : '';
  }

  function findPickerOption(picker, label) {
    if (!picker) return null;
    const nodes = qa('.dshml-picker-option, [aria-label], [title], button, [role="option"]', picker);
    for (const node of nodes) {
      const name = (node.getAttribute('aria-label') || node.getAttribute('title') || text(node)).trim();
      if (name === label) return node;
    }
    const labelled = qa('*', picker).filter((node) => text(node) === label);
    let smallest = null;
    for (const node of labelled) if (smallest === null || smallest.contains(node)) smallest = node;
    return smallest;
  }

  async function chooseInCombobox(face, select, value) {
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
      const select = q('.jrmgQW_addPanel select', root);
      const face = select ? findComboboxFace(select) : null;
      if (face) face.click();
      await waitFor(findComboMenu, 3000);
    } else if (OPEN === 'picker') {
      const button = findModelRowButton(0);
      if (button) button.click();
      await waitFor(findPicker, 5000);
    }
    await sleep(350);
    const screenshotResult = {
      mode: 'screenshot',
      open: OPEN,
      decorated: {
        vendor: vendorMarkers().length,
        modelRows: qa('[data-dshml-model-row]').length,
        combobox: !!findComboboxFace(q('.jrmgQW_addPanel select', root)),
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
    const accountMarker = accountName
      ? qa('[data-dshml-vendor="' + config.accountProvider.id + '"]', accountRow).filter(
          (marker) => marker.parentElement === accountName.parentElement,
        )[0]
      : null;
    add(
      'vendor logo before localized account row name (deepseek-account alias)',
      true,
      !!accountMarker && !!q('svg', accountMarker) && isBefore(accountMarker, accountName),
      accountMarker
        ? 'marker ' + describeNode(accountMarker) + ' precedes ' + describeNode(accountName)
        : 'no [data-dshml-vendor="' + config.accountProvider.id + '"] beside "' + config.accountProvider.displayName +
            '"; row buttons=' + (accountRow ? qa('button[aria-label]', accountRow).length : 'row missing'),
    );

    const officialRow = findProviderRow(config.officialProvider.displayName);
    const officialName = officialRow ? q('.jrmgQW_rowName', officialRow) : null;
    const rowMarker = officialName
      ? qa('[data-dshml-vendor="' + config.officialProvider.id + '"]', officialRow).filter(
          (marker) => marker.parentElement === officialName.parentElement,
        )[0]
      : null;
    add(
      'vendor logo before official provider row name (' + config.officialProvider.displayName + ')',
      true,
      !!rowMarker && !!q('svg', rowMarker) && isBefore(rowMarker, officialName),
      rowMarker
        ? 'marker ' + describeNode(rowMarker) + ' precedes ' + describeNode(officialName)
        : 'no [data-dshml-vendor="' + config.officialProvider.id + '"] beside .jrmgQW_rowName; markers=' +
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
    const titleMarker = editorTitle
      ? qa('[data-dshml-vendor="' + config.officialProvider.id + '"]', officialRow).filter(
          (marker) => marker.parentElement === editorTitle.parentElement && isBefore(marker, editorTitle),
        )[0]
      : null;
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

    const select = q('.jrmgQW_addPanel select', root);
    const optionPollution = select
      ? qa('option', select).filter((option) => option.children.length > 0 || qa('[data-dshml-vendor]', option).length > 0)
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
      const button = first && first.classList.contains('dshml-model-icon-btn') ? first : q('.dshml-model-icon-btn', row);
      const mark = button ? q('.dshml-model-mark', button) : null;
      return {
        index: index,
        row: row,
        first: first,
        marked: row.getAttribute('data-dshml-model-row') === '1',
        button: button,
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
          first: state.first ? state.first.tagName.toLowerCase() + '.' + (typeof state.first.className === 'string' ? state.first.className.split(' ')[0] : '') : 'none',
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
      JSON.stringify(rowStates.map((state) => ({ row: state.index + 1, svg: state.hasSvg, placeholder: state.placeholder }))),
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

    const selectHiddenOk = (() => {
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
        text(face).indexOf(text(select.options[select.selectedIndex])) >= 0,
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

    let menu = null;
    let menuItems = [];
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
      (firstMarkedRow ? q('.dshml-model-icon-btn', firstMarkedRow) : null) || findModelRowButton(0);
    const markBefore = iconButton ? (q('.dshml-model-mark', iconButton) || {}).innerHTML || '' : '';
    add(
      'model row exposes a clickable `.dshml-model-icon-btn`',
      true,
      !!iconButton && iconButton.tagName === 'BUTTON' && iconButton.type === 'button',
      iconButton ? describeNode(iconButton) : 'no .dshml-model-icon-btn in [data-dshml-model-row="1"]',
    );
    let picker = null;
    if (iconButton) {
      iconButton.click();
      picker = await waitFor(findPicker, 5000);
      const title = pickerTitle(picker);
      add(
        'clicking a model-row logo opens the icon picker modal',
        true,
        !!picker && (title.indexOf('选择模型图标') >= 0 || title.indexOf('Choose model icon') >= 0),
        picker
          ? 'root ' + describeNode(picker) + ' title "' + title + '"'
          : 'no [data-dshml-picker] modal appeared',
      );
    } else {
      add('clicking a model-row logo opens the icon picker modal', true, false, 'skipped: no picker button');
    }

    // Picking a brand writes the nested override through configForms.mutate.
    let write = null;
    if (picker) {
      const brandOption = findPickerOption(picker, 'OpenAI');
      add(
        'picker offers brand options',
        true,
        !!brandOption && brandOption.classList.contains('dshml-picker-option'),
        brandOption ? 'found ' + describeNode(brandOption) : 'no OpenAI option inside the picker',
      );
      if (brandOption) {
        clickable(brandOption).click();
        write = await waitFor(() => {
          return (
            H.mutateCalls.filter((call) => {
              const serialized = JSON.stringify(call);
              return (
                serialized.indexOf('modelIcons') >= 0 &&
                serialized.indexOf(config.firstModel.providerId) >= 0 &&
                serialized.indexOf(config.firstModel.modelId) >= 0
              );
            })[0] || null
          );
        }, 5000);
      }
      const closed = await waitFor(() => !picker.isConnected || !visible(picker), 4000);
      add('picker closes after a successful write', false, !!closed, closed ? 'modal removed' : 'modal still visible');
    }

    const writeOperation = write
      ? write.filter((operation) => operation && operation.op === 'set' && Array.isArray(operation.path))[0] || null
      : null;
    add(
      'picking a brand writes modelIcons[provider][model] through configForms.mutate',
      true,
      !!writeOperation &&
        writeOperation.path[0] === 'modelIcons' &&
        writeOperation.path[1] === config.firstModel.providerId &&
        writeOperation.path[2] === config.firstModel.modelId &&
        typeof writeOperation.value === 'string' &&
        writeOperation.value !== 'none',
      writeOperation
        ? 'op=' + JSON.stringify(writeOperation)
        : 'mutate calls=' + JSON.stringify(H.mutateCalls),
    );
    add(
      'picked brand key lands in the persisted override map',
      true,
      !!writeOperation &&
        H.overrides[config.firstModel.providerId] !== undefined &&
        H.overrides[config.firstModel.providerId][config.firstModel.modelId] === writeOperation.value,
      'modelIcons=' + JSON.stringify(H.overrides),
    );
    add(
      'picked option is the OpenAI brand mark',
      true,
      !!writeOperation && writeOperation.value === 'openai',
      'value="' + (writeOperation ? writeOperation.value : '') + '"',
    );
    if (iconButton) {
      const refreshedMark = await waitFor(() => {
        const markNow = (q('.dshml-model-mark', iconButton) || {}).innerHTML || '';
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
      !!labelRegistration && labelRegistration.options.priority === -1,
      labelRegistration ? 'priority=' + labelRegistration.options.priority : 'not registered',
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

    let labelHost = null;
    let labelRoot = null;
    if (labelRegistration && window.React && window.ReactDOM) {
      try {
        labelHost = document.createElement('div');
        labelHost.id = 'dshml-label-probe';
        labelHost.hidden = true;
        document.body.appendChild(labelHost);
        labelRoot = window.ReactDOM.createRoot(labelHost);
        const props = {
          provider: { id: config.firstModel.providerId, name: config.officialProvider.displayName },
          model: { id: config.firstModel.modelId, name: config.firstModel.displayName },
          placement: 'trigger',
        };
        labelRoot.render(window.React.createElement(labelRegistration.component, props));
        const rendered = await waitFor(() => labelHost.querySelector('.dshml-mark, svg'), 4000);
        add(
          'composer label renders the overridden brand mark',
          false,
          !!rendered && text(labelHost).indexOf(config.firstModel.displayName) >= 0,
          rendered ? 'markup: ' + labelHost.innerHTML.slice(0, 160) : 'no mark rendered',
        );
        form.mutate([
          {
            op: 'set',
            path: ['modelIcons', config.firstModel.providerId, config.firstModel.modelId],
            value: 'none',
          },
        ]);
        labelRoot.render(window.React.createElement(labelRegistration.component, props));
        await sleep(120);
        add(
          "composer label honours an explicit 'none' override",
          false,
          labelHost.querySelector('svg, .dshml-mark') === null &&
            text(labelHost).indexOf(config.firstModel.displayName) >= 0,
          'markup: ' + labelHost.innerHTML.slice(0, 160),
        );
        form.mutate([
          { op: 'unset', path: ['modelIcons', config.firstModel.providerId, config.firstModel.modelId] },
        ]);
      } catch (error) {
        add('composer label renders the overridden brand mark', false, false, 'threw: ' + (error && error.stack ? error.stack : error));
      } finally {
        if (labelRoot) {
          try {
            labelRoot.unmount();
          } catch {
            /* rendering a plain fragment needs no unmount bookkeeping */
          }
        }
        if (labelHost) labelHost.remove();
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
        H.errors.push('dispose: ' + (error && error.stack ? error.stack : error));
      }
    }
    await sleep(300);

    const markerCount = qa('[data-dshml-vendor]', root || document).length;
    const rowMarkerCount = qa('[data-dshml-model-row]', root || document).length;
    const ownerCount = qa('[data-dshml-owner="1"]', root || document).length;
    const rowsRestored =
      qa('.jrmgQW_modelEntry .jrmgQW_modelRow', root || document).every(
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

    const selectAfter = q('.jrmgQW_addPanel select', root || document);
    const selectStyle = selectAfter ? getComputedStyle(selectAfter) : null;
    add(
      'dispose restores the native provider select',
      true,
      !!selectAfter &&
        selectAfter.getAttribute('aria-hidden') !== 'true' &&
        selectAfter.tabIndex !== -1 &&
        selectStyle.position !== 'absolute' &&
        selectStyle.pointerEvents !== 'none' &&
        Number(selectStyle.opacity) > 0.9,
      selectAfter
        ? 'aria-hidden=' +
          selectAfter.getAttribute('aria-hidden') +
          ' tabIndex=' +
          selectAfter.tabIndex +
          ' position=' +
          selectStyle.position +
          ' opacity=' +
          selectStyle.opacity
        : 'select missing after dispose',
    );
    add(
      'dispose removes the custom combobox and plugin stylesheets',
      true,
      findComboboxFace(selectAfter) === null && qa('style[data-plugin="dsh-model-logos"]').length === 0,
      'combobox=' + (findComboboxFace(selectAfter) === null ? 'gone' : 'still present') + ', style tags=' + qa('style[data-plugin="dsh-model-logos"]').length,
    );

    const ancestorRow = findProviderRow(config.officialProvider.displayName);
    const rowsList = q('.jrmgQW_rows', root || document);
    if (ancestorRow && rowsList) {
      const clone = ancestorRow.cloneNode(true);
      rowsList.appendChild(clone);
      await sleep(350);
      add(
        'dispose disconnects the settings MutationObserver',
        true,
        qa('[data-dshml-vendor]', clone).length === 0,
        qa('[data-dshml-vendor]', clone).length === 0 ? 'clone stayed undecorated' : 'observer kept decorating after dispose',
      );
      clone.remove();
    }

    add('no errors thrown while disposing', true, H.errors.length === 0, JSON.stringify(H.errors));

    const result = {
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

const DRIVER_SOURCE =
  '(' + browserDriver.toString() + ')(' + JSON.stringify(DRIVER_CONFIG) + ');';

function findEdge() {
  const candidates = [
    process.env.EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.filter((candidate) => existsSync(candidate))[0];
  if (!found) {
    console.error('error: Edge not found; set EDGE=<msedge.exe path>');
    process.exit(1);
  }
  return found;
}

function readRequired(path, label) {
  if (!existsSync(path)) {
    console.error('error: missing ' + label + ': ' + path);
    process.exit(1);
  }
  return readFileSync(path, 'utf8');
}

/** Insert the harness scripts before `</body>`; CSS/markup live in the fixture itself. */
function buildHarness(fixtureHtml, clientJs, headExtra) {
  const react = readRequired(REACT_UMD, 'React development UMD');
  const reactDom = readRequired(REACT_DOM_UMD, 'ReactDOM development UMD');
  const loaderStub = `window.__dshmlModule = null;
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

function runEdge(edge, edgeArgs, timeoutMs) {
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
    return {
      stdout: error.stdout ? String(error.stdout) : '',
      stderr: error.stderr ? String(error.stderr) : String(error.message),
      failed: true,
    };
  }
}

function decodeEntities(html) {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseResult(dom) {
  const match = /<pre id="dshml-result"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
  if (!match) return null;
  try {
    return JSON.parse(decodeEntities(match[1]));
  } catch {
    return null;
  }
}

function printAssertions(result) {
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

async function main() {
  const fixtureHtml = readRequired(FIXTURE, 'settings fixture');
  const clientJs = readRequired(CLIENT, 'generated client bundle');

  const buildMarkers = {
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
    console.error('  ask the Lead to run `node scripts/build-client.mjs` first');
    if (requireBuild) process.exit(2);
  }
  if (!existsSync(REACT_UMD) || !existsSync(REACT_DOM_UMD)) {
    console.error('error: React/ReactDOM 18 UMD builds are not installed in node_modules');
    process.exit(1);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'dshml-verify-'));
  const edge = findEdge();
  const edgeArgsBase = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check'];
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
          `--virtual-time-budget=8000`,
          `--screenshot=${pngPath}`,
          '--dump-dom',
          url,
        ],
        120000,
      );
      const result = parseResult(run.stdout);
      const deadline = Date.now() + 20000;
      while (!existsSync(pngPath) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 200));
      if (!existsSync(pngPath) || statSync(pngPath).size === 0) {
        console.error('error: no screenshot produced at ' + pngPath);
        if (run.stderr) console.error(run.stderr.slice(0, 2000));
        process.exit(1);
      }
      if (result && result.decorated) {
        const decorated = result.decorated;
        if (decorated.vendor === 0 || decorated.modelRows < DRIVER_CONFIG.modelRows) {
          console.error('warning: page was not fully decorated when the screenshot was taken: ' + JSON.stringify(decorated));
        }
      }
      console.log(`wrote ${pngPath} (${statSync(pngPath).size} bytes, ${width * scale}×${height * scale}px)`);
      if (result && result.consoleIssues && result.consoleIssues.length > 0) {
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
    if (!result) {
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

main().catch((error) => {
  console.error('error: ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
