/**
 * Icon resolution tests: the persisted override document (nested dict keyed by
 * provider id + model id), immutable edits, and the resolution precedence
 * override → heuristic → none. `none` disables the mark; `letter` asks for the
 * generated letter tile; an unknown/stale brand key is ignored.
 */
import { describe, expect, it } from 'vitest';

import {
  flattenOverrides,
  flattenProviderOverrides,
  letterTextFor,
  overrideIcon,
  providerLetterTextFor,
  providerOverrideIcon,
  resolveModelIcon,
  resolveProviderIcon,
  withOverride,
  withProviderOverride,
  withoutOverride,
  withoutProviderOverride,
} from '../src/resolve';

describe('resolve', () => {
  /** A provider/model pair that no heuristic rule knows. */
  const acme = {
    provider: { id: 'acme', name: 'Acme' },
    model: { id: 'acme-chat-1', name: 'Acme Chat 1' },
  };
  const resolve = (overrides: unknown, pair = acme) => resolveModelIcon(overrides, pair.provider, pair.model);

  it('reads overrides by provider id + model id only', () => {
    const overrides = {
      'deepseek-account': { 'deepseek-flash': 'deepseek' },
      local: { 'qwen2.5:7b/coder': 'letter' },
    };
    expect(overrideIcon(overrides, 'deepseek-account', 'deepseek-flash')).toBe('deepseek');
    expect(overrideIcon(overrides, 'local', 'qwen2.5:7b/coder')).toBe('letter');
    expect(overrideIcon(overrides, 'deepseek-account', 'deepseek-reasoner')).toBe(null);
    expect(overrideIcon(overrides, 'other', 'deepseek-flash')).toBe(null);
    expect(overrideIcon(overrides, 'deepseek-account', '')).toBe(null);
    expect(overrideIcon(overrides, '', 'deepseek-flash')).toBe(null);
    expect(overrideIcon(undefined, 'a', 'b')).toBe(null);
    expect(overrideIcon(null, 'a', 'b')).toBe(null);
  });

  it('overrideIcon keeps the none and letter sentinels verbatim', () => {
    const overrides = { p: { off: 'none', tile: 'letter' } };
    expect(overrideIcon(overrides, 'p', 'off')).toBe('none');
    expect(overrideIcon(overrides, 'p', 'tile')).toBe('letter');
  });

  it('model display names are not override keys', () => {
    // The persisted document is keyed by ids; a name-only bucket must be inert.
    expect(resolve({ acme: { 'Acme Chat 1': 'claude' } }).source).toBe('none');
    expect(resolve({ acme: { 'Acme Chat 1': 'claude' } }).key).toBe(null);
    // A same-named model id under another provider must not leak across providers.
    expect(resolve({ other: { 'acme-chat-1': 'claude' } }).source).toBe('none');
  });

  it('withOverride writes immutably and creates nested buckets', () => {
    const base = { p: { m: 'claude' } };
    const next = withOverride(base, 'p', 'm2', 'openai');
    expect(next).toEqual({ p: { m: 'claude', m2: 'openai' } });
    expect(next).not.toBe(base);
    expect(next.p).not.toBe(base.p);
    expect(base, 'the input document must not mutate').toEqual({ p: { m: 'claude' } });
    expect(withOverride(undefined, 'p', 'm', 'qwen')).toEqual({ p: { m: 'qwen' } });
    expect(withOverride(null, 'p', 'm', 'qwen')).toEqual({ p: { m: 'qwen' } });
  });

  it('withOverride accepts the none and letter sentinels', () => {
    expect(withOverride({}, 'p', 'm', 'none')).toEqual({ p: { m: 'none' } });
    expect(withOverride({}, 'p', 'm', 'letter')).toEqual({ p: { m: 'letter' } });
    expect(overrideIcon(withOverride({}, 'p', 'm', 'letter'), 'p', 'm')).toBe('letter');
  });

  it('withOverride replaces an existing value in place without touching siblings', () => {
    const next = withOverride({ p: { a: 'claude', b: 'none' } }, 'p', 'a', 'openai');
    expect(next).toEqual({ p: { a: 'openai', b: 'none' } });
  });

  it('withoutOverride removes immutably and tolerates missing pairs', () => {
    const base = { p: { a: 'claude', b: 'openai' }, q: { c: 'none' } };
    const next = withoutOverride(base, 'p', 'a');
    expect(next).toEqual({ p: { b: 'openai' }, q: { c: 'none' } });
    expect(next).not.toBe(base);
    expect(next.p).not.toBe(base.p);
    expect(base, 'input must not mutate').toEqual({ p: { a: 'claude', b: 'openai' }, q: { c: 'none' } });
    expect(withoutOverride(base, 'p', 'missing')).toEqual(base);
    expect(withoutOverride(base, 'missing', 'a')).toEqual(base);
    expect(withoutOverride(null, 'p', 'a')).toEqual({});
  });

  it('removing the last icon of a provider leaves nothing flattened', () => {
    expect(flattenOverrides(withoutOverride({ p: { m: 'claude' } }, 'p', 'm'))).toEqual([]);
  });

  it('keys with dots, colons, slashes and spaces survive the nested dict', () => {
    const providerId = 'local.provider:one';
    const modelId = 'qwen2.5:7b/coder-max 2';
    const overrides = withOverride({}, providerId, modelId, 'letter');
    expect(overrideIcon(overrides, providerId, modelId)).toBe('letter');
    expect(flattenOverrides(overrides)).toEqual([{ providerId, modelId, icon: 'letter' }]);
    expect(withoutOverride(overrides, providerId, modelId)).toEqual({});
  });

  it('flattenOverrides lists every persisted pair deterministically', () => {
    const rows = flattenOverrides({ q: { b: 'none' }, p: { z: 'letter', a: 'claude' } });
    const sorted = [...rows].sort((left, right) =>
      `${left.providerId}/${left.modelId}`.localeCompare(`${right.providerId}/${right.modelId}`),
    );
    expect(sorted).toEqual([
      { providerId: 'p', modelId: 'a', icon: 'claude' },
      { providerId: 'p', modelId: 'z', icon: 'letter' },
      { providerId: 'q', modelId: 'b', icon: 'none' },
    ]);
    expect(flattenOverrides(null)).toEqual([]);
    expect(flattenOverrides(undefined)).toEqual([]);
    expect(flattenOverrides([])).toEqual([]);
  });

  it('a known brand override wins over the heuristic', () => {
    const resolved = resolveModelIcon(
      { 'deepseek-account': { 'deepseek-flash': 'claude' } },
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: 'claude', source: 'override', disabled: false, letter: false, custom: null });
  });

  it('the none sentinel disables the mark even when the heuristic would match', () => {
    const resolved = resolveModelIcon(
      { 'deepseek-account': { 'deepseek-flash': 'none' } },
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: null, source: 'override', disabled: true, letter: false, custom: null });
  });

  it('a custom:<id> override resolves to the custom sentinel', () => {
    const resolved = resolve({ acme: { 'acme-chat-1': 'custom:c-demo' } });
    expect(resolved).toEqual({
      key: null,
      source: 'override',
      disabled: false,
      letter: false,
      custom: 'c-demo',
    });
  });

  it('a malformed custom value is ignored and the heuristic still decides', () => {
    expect(resolve({ acme: { 'acme-chat-1': 'custom:' } })).toEqual({
      key: null,
      source: 'none',
      disabled: false,
      letter: false,
      custom: null,
    });
    expect(resolve({ acme: { 'acme-chat-1': 'custom:bad id' } })).toEqual({
      key: null,
      source: 'none',
      disabled: false,
      letter: false,
      custom: null,
    });
    expect(
      resolveModelIcon(
        { 'deepseek-account': { 'deepseek-flash': 'custom:' } },
        { id: 'deepseek-account' },
        { id: 'deepseek-flash' },
      ),
    ).toEqual({ key: 'deepseek', source: 'heuristic', disabled: false, letter: false, custom: null });
  });

  it('the letter sentinel asks for a generated tile and wins over the heuristic', () => {
    const resolved = resolveModelIcon(
      { 'deepseek-account': { 'deepseek-flash': 'letter' } },
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: null, source: 'override', disabled: false, letter: true, custom: null });
  });

  it('an unknown or stale override value is ignored in favour of the heuristic', () => {
    const overrides = { 'deepseek-account': { 'deepseek-flash': 'brand-that-does-not-exist' } };
    const resolved = resolveModelIcon(
      overrides,
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: 'deepseek', source: 'heuristic', disabled: false, letter: false, custom: null });
  });

  it('no override falls back to the heuristic initial icon', () => {
    expect(resolveModelIcon(null, { id: 'openrouter' }, { id: 'anthropic/claude-sonnet-4.5' })).toEqual({
      key: 'claude',
      source: 'heuristic',
      disabled: false,
      letter: false,
      custom: null,
    });
    expect(resolve(undefined)).toEqual({ key: null, source: 'none', disabled: false, letter: false, custom: null });
  });

  it('nothing matches → source none with no mark', () => {
    expect(resolve({})).toEqual({ key: null, source: 'none', disabled: false, letter: false, custom: null });
    expect(resolveModelIcon({}, null, null)).toEqual({
      key: null,
      source: 'none',
      disabled: false,
      letter: false,
      custom: null,
    });
  });

  it('letterTextFor prefers model name, then ids, then a placeholder', () => {
    expect(letterTextFor({ name: 'Provider' }, { name: '  Model Name  ' })).toBe('Model Name');
    expect(letterTextFor({ name: 'Provider' }, { id: 'model-1' })).toBe('model-1');
    expect(letterTextFor({ name: 'Provider' }, {})).toBe('Provider');
    expect(letterTextFor({ id: 'prov-1' }, null)).toBe('prov-1');
    expect(letterTextFor({ name: '  ' }, { name: '' })).toBe('?');
    expect(letterTextFor(null, null)).toBe('?');
  });
});

/**
 * Provider (vendor / channel) overrides: the flat `providerId → icon` document,
 * its immutable edits, and the resolution order override → official channel
 * table → optional letter tile. A hand-declared provider must stay empty rather
 * than borrow a logo that would misname it.
 */
describe('provider override resolution', () => {
  it('reads a provider override by route id and ignores inherited properties', () => {
    const overrides = { anthropic: 'anthropic', volcengine: 'qwen', off: 'none', tile: 'letter' };
    expect(providerOverrideIcon(overrides, 'volcengine')).toBe('qwen');
    expect(providerOverrideIcon(overrides, 'off')).toBe('none');
    expect(providerOverrideIcon(overrides, 'tile')).toBe('letter');
    expect(providerOverrideIcon(overrides, 'missing')).toBe(null);
    expect(providerOverrideIcon(overrides, '')).toBe(null);
    expect(providerOverrideIcon(overrides, '   ')).toBe(null);
    expect(providerOverrideIcon(overrides, 42)).toBe(null);
    expect(providerOverrideIcon(overrides, null)).toBe(null);
    expect(providerOverrideIcon(undefined, 'anthropic')).toBe(null);
    expect(providerOverrideIcon(null, 'anthropic')).toBe(null);
    // Only own data properties count, so a polluted prototype chain is inert.
    const polluted = Object.create({ anthropic: 'claude' }) as Record<string, unknown>;
    expect(providerOverrideIcon(polluted, 'anthropic')).toBe(null);
  });

  it('withProviderOverride writes flat and immutably', () => {
    const base = { anthropic: 'anthropic' };
    const next = withProviderOverride(base, 'volcengine', 'qwen');
    expect(next).toEqual({ anthropic: 'anthropic', volcengine: 'qwen' });
    expect(next).not.toBe(base);
    expect(base, 'the input document must not mutate').toEqual({ anthropic: 'anthropic' });
    expect(withProviderOverride({ volcengine: 'qwen' }, 'volcengine', 'openai')).toEqual({ volcengine: 'openai' });
    expect(withProviderOverride(undefined, 'p', 'qwen')).toEqual({ p: 'qwen' });
    expect(withProviderOverride(null, 'p', 'qwen')).toEqual({ p: 'qwen' });
  });

  it('withProviderOverride removes the entry for blank, null and undefined icons', () => {
    const base = { anthropic: 'anthropic', volcengine: 'qwen' };
    expect(withProviderOverride(base, 'volcengine', '')).toEqual({ anthropic: 'anthropic' });
    expect(withProviderOverride(base, 'volcengine', '   ')).toEqual({ anthropic: 'anthropic' });
    expect(withProviderOverride(base, 'volcengine', null)).toEqual({ anthropic: 'anthropic' });
    expect(withProviderOverride(base, 'volcengine', undefined)).toEqual({ anthropic: 'anthropic' });
    expect(base, 'removal must not mutate the input').toEqual({ anthropic: 'anthropic', volcengine: 'qwen' });
    expect(withProviderOverride(base, '', 'qwen')).toEqual(base);
    expect(withProviderOverride(base, '   ', 'qwen')).toEqual(base);
  });

  it('withoutProviderOverride removes immutably and tolerates unset or blank ids', () => {
    const base = { anthropic: 'anthropic', volcengine: 'qwen' };
    const next = withoutProviderOverride(base, 'volcengine');
    expect(next).toEqual({ anthropic: 'anthropic' });
    expect(next).not.toBe(base);
    expect(base, 'the input document must not mutate').toEqual({ anthropic: 'anthropic', volcengine: 'qwen' });
    expect(withoutProviderOverride(base, 'missing')).toEqual(base);
    expect(withoutProviderOverride(base, 'missing')).not.toBe(base);
    expect(withoutProviderOverride(base, '')).toEqual(base);
    expect(withoutProviderOverride(null, 'anthropic')).toEqual({});
    expect(withoutProviderOverride(undefined, 'anthropic')).toEqual({});
  });

  it('provider ids with dots, colons, slashes and spaces survive the flat dict', () => {
    const providerId = 'local.provider:one/two three';
    const overrides = withProviderOverride({}, providerId, 'letter');
    expect(overrides).toEqual({ [providerId]: 'letter' });
    expect(providerOverrideIcon(overrides, providerId)).toBe('letter');
    expect(flattenProviderOverrides(overrides)).toEqual([{ providerId, icon: 'letter' }]);
    expect(withoutProviderOverride(overrides, providerId)).toEqual({});
  });

  it('flattenProviderOverrides lists every persisted entry ordered by provider id', () => {
    expect(flattenProviderOverrides({ zai: 'zhipu', anthropic: 'none', volcengine: 'letter' })).toEqual([
      { providerId: 'anthropic', icon: 'none' },
      { providerId: 'volcengine', icon: 'letter' },
      { providerId: 'zai', icon: 'zhipu' },
    ]);
    // Deterministic: the same document must always flatten to the same order.
    const document = { b: 'openai', a: 'claude', c: 'letter' };
    expect(flattenProviderOverrides(document)).toEqual(flattenProviderOverrides(document));
    // Non-string and empty values are not persisted entries.
    expect(flattenProviderOverrides({ p: '', q: 42, r: null, s: {} } as Record<string, unknown>)).toEqual([]);
  });

  it('flattenProviderOverrides returns [] for null, undefined, arrays and non-objects', () => {
    expect(flattenProviderOverrides(null)).toEqual([]);
    expect(flattenProviderOverrides(undefined)).toEqual([]);
    expect(flattenProviderOverrides([])).toEqual([]);
    expect(flattenProviderOverrides(['qwen'])).toEqual([]);
    expect(flattenProviderOverrides('volcengine')).toEqual([]);
    expect(flattenProviderOverrides(7)).toEqual([]);
  });

  it('a known brand override wins over the official channel', () => {
    const resolved = resolveProviderIcon({ anthropic: 'openai' }, 'anthropic');
    expect(resolved).toEqual({ key: 'openai', source: 'override', disabled: false, letter: false, custom: null });
    // Without the override the official channel table would pick Anthropic itself.
    expect(resolveProviderIcon({}, 'anthropic')).toEqual({
      key: 'anthropic',
      source: 'heuristic',
      disabled: false,
      letter: false,
      custom: null,
    });
  });

  it('the none sentinel disables the mark even for an official channel', () => {
    expect(resolveProviderIcon({ anthropic: 'none' }, 'anthropic')).toEqual({
      key: null,
      source: 'override',
      disabled: true,
      letter: false,
      custom: null,
    });
  });

  it('the letter sentinel asks for a generated tile and wins over the official channel', () => {
    expect(resolveProviderIcon({ anthropic: 'letter' }, 'anthropic')).toEqual({
      key: null,
      source: 'override',
      disabled: false,
      letter: true,
      custom: null,
    });
  });

  it('a custom:<id> provider override resolves to the custom sentinel', () => {
    expect(resolveProviderIcon({ anthropic: 'custom:c-demo' }, 'anthropic')).toEqual({
      key: null,
      source: 'override',
      disabled: false,
      letter: false,
      custom: 'c-demo',
    });
    // A malformed/stale sentinel is ignored, so the channel table still wins.
    expect(resolveProviderIcon({ anthropic: 'custom:' }, 'anthropic')).toEqual({
      key: 'anthropic',
      source: 'heuristic',
      disabled: false,
      letter: false,
      custom: null,
    });
  });

  it('an unknown or stale override value falls back to the official channel', () => {
    expect(resolveProviderIcon({ anthropic: 'brand-that-does-not-exist' }, 'anthropic')).toEqual({
      key: 'anthropic',
      source: 'heuristic',
      disabled: false,
      letter: false,
      custom: null,
    });
  });

  it('a declared provider gets no mark unless the letter fallback is allowed', () => {
    const none = { key: null, source: 'none', disabled: false, letter: false, custom: null };
    expect(resolveProviderIcon({}, 'acme')).toEqual(none);
    expect(resolveProviderIcon({}, 'acme', { fallback: false })).toEqual(none);
    expect(resolveProviderIcon({}, 'acme', { allowFallback: false })).toEqual(none);
    expect(resolveProviderIcon({}, 'acme', null)).toEqual(none);
    expect(resolveProviderIcon({}, 'acme', { fallback: true })).toEqual({
      key: null,
      source: 'none',
      disabled: false,
      letter: true,
      custom: null,
    });
    // `allowFallback` is the legacy spelling of the same flag.
    expect(resolveProviderIcon({}, 'acme', { allowFallback: true })).toEqual({
      key: null,
      source: 'none',
      disabled: false,
      letter: true,
      custom: null,
    });
    // An explicit override still beats either fallback spelling.
    expect(resolveProviderIcon({ acme: 'qwen' }, 'acme', { fallback: true })).toEqual({
      key: 'qwen',
      source: 'override',
      disabled: false,
      letter: false,
      custom: null,
    });
  });

  it('empty and non-string provider ids resolve to no icon, even with a fallback', () => {
    const none = { key: null, source: 'none', disabled: false, letter: false, custom: null };
    for (const providerId of ['', '   ', 42, null, undefined, {}, []]) {
      expect(resolveProviderIcon({ '': 'qwen' }, providerId), String(providerId)).toEqual(none);
      expect(resolveProviderIcon({ '': 'qwen' }, providerId, { fallback: true }), String(providerId)).toEqual(none);
    }
  });

  it('providerLetterTextFor prefers the display name, then the route id, then a placeholder', () => {
    expect(providerLetterTextFor('volcengine', 'Volcengine')).toBe('Volcengine');
    expect(providerLetterTextFor('volcengine', '  Volcengine  ')).toBe('Volcengine');
    expect(providerLetterTextFor('volcengine', '   ')).toBe('volcengine');
    expect(providerLetterTextFor('  volcengine  ', null)).toBe('volcengine');
    expect(providerLetterTextFor('volcengine')).toBe('volcengine');
    expect(providerLetterTextFor('volcengine', 42)).toBe('volcengine');
    expect(providerLetterTextFor('', '')).toBe('?');
    expect(providerLetterTextFor(null, null)).toBe('?');
    expect(providerLetterTextFor(undefined, undefined)).toBe('?');
  });
});
