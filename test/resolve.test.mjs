/**
 * Icon resolution tests: the persisted override document (nested dict keyed by
 * provider id + model id), immutable edits, and the resolution precedence
 * override → heuristic → none. `none` disables the mark; `letter` asks for the
 * generated letter tile; an unknown/stale brand key is ignored.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  flattenOverrides,
  letterTextFor,
  overrideIcon,
  resolveModelIcon,
  withOverride,
  withoutOverride,
} from '../src/resolve.mjs';

/** A provider/model pair that no heuristic rule knows. */
const acme = {
  provider: { id: 'acme', name: 'Acme' },
  model: { id: 'acme-chat-1', name: 'Acme Chat 1' },
};
const resolve = (overrides, pair = acme) => resolveModelIcon(overrides, pair.provider, pair.model);

test('reads overrides by provider id + model id only', () => {
  const overrides = {
    'deepseek-account': { 'deepseek-flash': 'deepseek' },
    local: { 'qwen2.5:7b/coder': 'letter' },
  };
  assert.equal(overrideIcon(overrides, 'deepseek-account', 'deepseek-flash'), 'deepseek');
  assert.equal(overrideIcon(overrides, 'local', 'qwen2.5:7b/coder'), 'letter');
  assert.equal(overrideIcon(overrides, 'deepseek-account', 'deepseek-reasoner'), null);
  assert.equal(overrideIcon(overrides, 'other', 'deepseek-flash'), null);
  assert.equal(overrideIcon(overrides, 'deepseek-account', ''), null);
  assert.equal(overrideIcon(overrides, '', 'deepseek-flash'), null);
  assert.equal(overrideIcon(undefined, 'a', 'b'), null);
  assert.equal(overrideIcon(null, 'a', 'b'), null);
});

test('overrideIcon keeps the none and letter sentinels verbatim', () => {
  const overrides = { p: { off: 'none', tile: 'letter' } };
  assert.equal(overrideIcon(overrides, 'p', 'off'), 'none');
  assert.equal(overrideIcon(overrides, 'p', 'tile'), 'letter');
});

test('model display names are not override keys', () => {
  // The persisted document is keyed by ids; a name-only bucket must be inert.
  assert.equal(resolve({ acme: { 'Acme Chat 1': 'claude' } }).source, 'none');
  assert.equal(resolve({ acme: { 'Acme Chat 1': 'claude' } }).key, null);
  // A same-named model id under another provider must not leak across providers.
  assert.equal(resolve({ other: { 'acme-chat-1': 'claude' } }).source, 'none');
});

test('withOverride writes immutably and creates nested buckets', () => {
  const base = { p: { m: 'claude' } };
  const next = withOverride(base, 'p', 'm2', 'openai');
  assert.deepEqual(next, { p: { m: 'claude', m2: 'openai' } });
  assert.notEqual(next, base);
  assert.notEqual(next.p, base.p);
  assert.deepEqual(base, { p: { m: 'claude' } }, 'the input document must not mutate');
  assert.deepEqual(withOverride(undefined, 'p', 'm', 'qwen'), { p: { m: 'qwen' } });
  assert.deepEqual(withOverride(null, 'p', 'm', 'qwen'), { p: { m: 'qwen' } });
});

test('withOverride accepts the none and letter sentinels', () => {
  assert.deepEqual(withOverride({}, 'p', 'm', 'none'), { p: { m: 'none' } });
  assert.deepEqual(withOverride({}, 'p', 'm', 'letter'), { p: { m: 'letter' } });
  assert.equal(overrideIcon(withOverride({}, 'p', 'm', 'letter'), 'p', 'm'), 'letter');
});

test('withOverride replaces an existing value in place without touching siblings', () => {
  const next = withOverride({ p: { a: 'claude', b: 'none' } }, 'p', 'a', 'openai');
  assert.deepEqual(next, { p: { a: 'openai', b: 'none' } });
});

test('withoutOverride removes immutably and tolerates missing pairs', () => {
  const base = { p: { a: 'claude', b: 'openai' }, q: { c: 'none' } };
  const next = withoutOverride(base, 'p', 'a');
  assert.deepEqual(next, { p: { b: 'openai' }, q: { c: 'none' } });
  assert.notEqual(next, base);
  assert.notEqual(next.p, base.p);
  assert.deepEqual(base, { p: { a: 'claude', b: 'openai' }, q: { c: 'none' } }, 'input must not mutate');
  assert.deepEqual(withoutOverride(base, 'p', 'missing'), base);
  assert.deepEqual(withoutOverride(base, 'missing', 'a'), base);
  assert.deepEqual(withoutOverride(null, 'p', 'a'), {});
});

test('removing the last icon of a provider leaves nothing flattened', () => {
  assert.deepEqual(flattenOverrides(withoutOverride({ p: { m: 'claude' } }, 'p', 'm')), []);
});

test('keys with dots, colons, slashes and spaces survive the nested dict', () => {
  const providerId = 'local.provider:one';
  const modelId = 'qwen2.5:7b/coder-max 2';
  const overrides = withOverride({}, providerId, modelId, 'letter');
  assert.equal(overrideIcon(overrides, providerId, modelId), 'letter');
  assert.deepEqual(flattenOverrides(overrides), [{ providerId, modelId, icon: 'letter' }]);
  assert.deepEqual(withoutOverride(overrides, providerId, modelId), {});
});

test('flattenOverrides lists every persisted pair deterministically', () => {
  const rows = flattenOverrides({ q: { b: 'none' }, p: { z: 'letter', a: 'claude' } });
  const sorted = [...rows].sort((left, right) =>
    `${left.providerId}/${left.modelId}`.localeCompare(`${right.providerId}/${right.modelId}`),
  );
  assert.deepEqual(sorted, [
    { providerId: 'p', modelId: 'a', icon: 'claude' },
    { providerId: 'p', modelId: 'z', icon: 'letter' },
    { providerId: 'q', modelId: 'b', icon: 'none' },
  ]);
  assert.deepEqual(flattenOverrides(null), []);
  assert.deepEqual(flattenOverrides(undefined), []);
  assert.deepEqual(flattenOverrides([]), []);
});

test('a known brand override wins over the heuristic', () => {
  const resolved = resolveModelIcon(
    { 'deepseek-account': { 'deepseek-flash': 'claude' } },
    { id: 'deepseek-account', name: 'DeepSeek Account' },
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
  );
  assert.deepEqual(resolved, { key: 'claude', source: 'override', disabled: false, letter: false });
});

test('the none sentinel disables the mark even when the heuristic would match', () => {
  const resolved = resolveModelIcon(
    { 'deepseek-account': { 'deepseek-flash': 'none' } },
    { id: 'deepseek-account', name: 'DeepSeek Account' },
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
  );
  assert.deepEqual(resolved, { key: null, source: 'override', disabled: true, letter: false });
});

test('the letter sentinel asks for a generated tile and wins over the heuristic', () => {
  const resolved = resolveModelIcon(
    { 'deepseek-account': { 'deepseek-flash': 'letter' } },
    { id: 'deepseek-account', name: 'DeepSeek Account' },
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
  );
  assert.deepEqual(resolved, { key: null, source: 'override', disabled: false, letter: true });
});

test('an unknown or stale override value is ignored in favour of the heuristic', () => {
  const overrides = { 'deepseek-account': { 'deepseek-flash': 'brand-that-does-not-exist' } };
  const resolved = resolveModelIcon(
    overrides,
    { id: 'deepseek-account', name: 'DeepSeek Account' },
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
  );
  assert.deepEqual(resolved, { key: 'deepseek', source: 'heuristic', disabled: false, letter: false });
});

test('no override falls back to the heuristic initial icon', () => {
  assert.deepEqual(
    resolveModelIcon(null, { id: 'openrouter' }, { id: 'anthropic/claude-sonnet-4.5' }),
    { key: 'claude', source: 'heuristic', disabled: false, letter: false },
  );
  assert.deepEqual(resolve(undefined), { key: null, source: 'none', disabled: false, letter: false });
});

test('nothing matches → source none with no mark', () => {
  assert.deepEqual(resolve({}), { key: null, source: 'none', disabled: false, letter: false });
  assert.deepEqual(resolveModelIcon({}, null, null), {
    key: null,
    source: 'none',
    disabled: false,
    letter: false,
  });
});

test('letterTextFor prefers model name, then ids, then a placeholder', () => {
  assert.equal(letterTextFor({ name: 'Provider' }, { name: '  Model Name  ' }), 'Model Name');
  assert.equal(letterTextFor({ name: 'Provider' }, { id: 'model-1' }), 'model-1');
  assert.equal(letterTextFor({ name: 'Provider' }, {}), 'Provider');
  assert.equal(letterTextFor({ id: 'prov-1' }, null), 'prov-1');
  assert.equal(letterTextFor({ name: '  ' }, { name: '' }), '?');
  assert.equal(letterTextFor(null, null), '?');
});
