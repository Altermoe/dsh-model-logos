/**
 * Icon resolution tests: the persisted override document (nested dict keyed by
 * provider id + model id), immutable edits, and the resolution precedence
 * override → heuristic → none. `none` disables the mark; `letter` asks for the
 * generated letter tile; an unknown/stale brand key is ignored.
 */
import { describe, expect, it } from 'vitest';

import {
  flattenOverrides,
  letterTextFor,
  overrideIcon,
  resolveModelIcon,
  withOverride,
  withoutOverride,
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
    expect(resolved).toEqual({ key: 'claude', source: 'override', disabled: false, letter: false });
  });

  it('the none sentinel disables the mark even when the heuristic would match', () => {
    const resolved = resolveModelIcon(
      { 'deepseek-account': { 'deepseek-flash': 'none' } },
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: null, source: 'override', disabled: true, letter: false });
  });

  it('the letter sentinel asks for a generated tile and wins over the heuristic', () => {
    const resolved = resolveModelIcon(
      { 'deepseek-account': { 'deepseek-flash': 'letter' } },
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: null, source: 'override', disabled: false, letter: true });
  });

  it('an unknown or stale override value is ignored in favour of the heuristic', () => {
    const overrides = { 'deepseek-account': { 'deepseek-flash': 'brand-that-does-not-exist' } };
    const resolved = resolveModelIcon(
      overrides,
      { id: 'deepseek-account', name: 'DeepSeek Account' },
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    );
    expect(resolved).toEqual({ key: 'deepseek', source: 'heuristic', disabled: false, letter: false });
  });

  it('no override falls back to the heuristic initial icon', () => {
    expect(resolveModelIcon(null, { id: 'openrouter' }, { id: 'anthropic/claude-sonnet-4.5' })).toEqual({
      key: 'claude',
      source: 'heuristic',
      disabled: false,
      letter: false,
    });
    expect(resolve(undefined)).toEqual({ key: null, source: 'none', disabled: false, letter: false });
  });

  it('nothing matches → source none with no mark', () => {
    expect(resolve({})).toEqual({ key: null, source: 'none', disabled: false, letter: false });
    expect(resolveModelIcon({}, null, null)).toEqual({
      key: null,
      source: 'none',
      disabled: false,
      letter: false,
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
