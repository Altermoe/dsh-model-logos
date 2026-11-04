/**
 * Platform-module access for the browser half of the bundle.
 *
 * The DSH client loader calls the bundle's `factory(require)` with a `require`
 * that resolves the shell's platform module table (`react`, `react-dom/client`,
 * …). This module is the single place that touches that ambient `require`, so
 * the rest of the source can import ordinary ES bindings and stay testable.
 *
 * `react` is required eagerly (the bundle cannot render without it) while
 * `react-dom/client` stays lazy: surfaces that only register components keep
 * working in a host whose loader does not expose it.
 */
import type * as ReactNamespace from 'react';

/** The bundle factory's `require` (injected by `window.__ModuleLoader__`). */
declare const require: (id: string) => unknown;

/** Runtime shape of the `react` platform module. */
export type ReactModule = typeof ReactNamespace;

let reactModule: ReactModule | null = null;

/** Require the shell's `react` module (cached). */
export function getReact(): ReactModule {
  if (reactModule === null) reactModule = require('react') as ReactModule;
  return reactModule;
}

/** Shorthand for the `react` module. */
export const React: ReactModule = getReact();

/** `React.createElement`, the factory this bundle renders with (no JSX). */
export const h = React.createElement;

/** Minimal React root returned by `react-dom/client` `createRoot()`. */
export interface ReactRoot {
  render(node: ReactNamespace.ReactNode): void;
  unmount(): void;
}

/** Signature of `react-dom/client` `createRoot()` as this bundle uses it. */
export type CreateRoot = (container: Element | DocumentFragment) => ReactRoot;

/**
 * The shell's `createRoot`, or `null` when `react-dom/client` is unavailable.
 * Lazy so importing this module never throws on a loader without ReactDOM.
 */
export function getCreateRoot(): CreateRoot | null {
  try {
    const client = require('react-dom/client') as { createRoot?: CreateRoot } | null | undefined;
    return client !== null && client !== undefined && typeof client.createRoot === 'function'
      ? client.createRoot
      : null;
  } catch {
    return null;
  }
}
