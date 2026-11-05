/**
 * Shared domain and host-surface types.
 *
 * This module is type-only by design: it is erased from the shipped `client.js`
 * and `index.js` bundles, so every module (pure helpers, browser fragments, host
 * half, scripts and tests) may import from it without affecting runtime output.
 *
 * Three groups live here:
 *
 *  1. artwork — the shape every brand mark satisfies;
 *  2. icon resolution — overrides, resolutions and the render-ready mark data;
 *  3. DSH runtime surfaces — the Cordis-like plugin context and the services the
 *     browser half reads (`slots`, `configForms`, `remote.llm`, `locale`). They
 *     are structural: the real packages are injected by the shell at runtime and
 *     are not dependencies of this repository.
 */

/* -------------------------------------------------------------------------- */
/* Artwork                                                                    */
/* -------------------------------------------------------------------------- */

/** One hand-drawn or generated brand mark, inlined into the DOM as SVG. */
export interface Logo {
  /** Human-readable brand name, used as the `title` attribute. */
  readonly title: string;
  /** 24×24 self-contained SVG source (`<svg viewBox="0 0 24 24">…`). */
  readonly svg: string;
}

/** The picker group a brand mark belongs to. */
export type LogoGroup = 'vendor' | 'model';

/**
 * One brand mark in the merged artwork set.
 *
 * Every brand belongs to exactly one picker group: `vendor` marks identify a
 * company or channel, `model` marks identify a model product. Generated letter
 * tiles are plain {@link Logo}s and carry no group.
 */
export interface BrandLogo extends Logo {
  readonly group: LogoGroup;
}

/** A named artwork collection (`src/logos/official.generated.ts` and friends). */
export type LogoSet = Readonly<Record<string, BrandLogo>>;

/** Logo key the matcher can return; each one needs artwork. */
export type LogoKey = string;

/* -------------------------------------------------------------------------- */
/* Identities and icon resolution                                             */
/* -------------------------------------------------------------------------- */

/** A provider or model identity as the composer slot and the settings page pass it. */
export interface Identity {
  readonly id?: string | null;
  readonly name?: string | null;
}

/** Provider identity (route id + display name). */
export type ProviderIdentity = Identity;

/** Model identity (catalog id + display name). */
export type ModelIdentity = Identity;

/** One `conversation.input.model.label` slot occurrence. */
export interface ModelLabelInput {
  readonly provider?: Identity | null;
  readonly model?: Identity | null;
  readonly placement?: string | null;
  readonly selected?: boolean | null;
}

/** Where a resolved mark came from. */
export type IconSource = 'override' | 'heuristic' | 'none';

/** Result of resolving one provider + model pair. */
export interface IconResolution {
  /** Artwork key, `null` when there is no brand mark. */
  key: string | null;
  source: IconSource;
  /** The user explicitly disabled the mark (`none` sentinel). */
  disabled: boolean;
  /** The user asked for the generated letter tile (`letter` sentinel). */
  letter: boolean;
}

/**
 * Persisted override document, nested as `providerId → modelId → icon`.
 *
 * A value is a brand key, the `none` sentinel (disabled) or the `letter` sentinel
 * (generated tile). An absent pair means "auto".
 */
export type OverrideDocument = Record<string, Record<string, IconKeyValue>>;

/** One persisted override value. */
export type IconKeyValue = string;

/** Render-ready model mark. `svg === null` means "draw no icon". */
export interface ModelMark {
  resolved: IconResolution;
  svg: string | null;
  title: string | null;
}

/** Render-ready vendor mark for an official channel row / dropdown option. */
export interface VendorMark {
  key: string | null;
  svg: string | null;
  title: string | null;
}

/* -------------------------------------------------------------------------- */
/* Browser-side stores                                                        */
/* -------------------------------------------------------------------------- */

/** Status of the icon-override store. */
export type IconStatus = 'loading' | 'ready' | 'unavailable';

/** Snapshot consumed by every surface that draws model marks. */
export interface IconState {
  status: IconStatus;
  overrides: OverrideDocument;
  writable: boolean;
  error: string | null;
}

/** Status of the provider/model catalog store. */
export type CatalogStatus = 'loading' | 'ready' | 'unavailable';

/** One model row in the icon picker's catalog. */
export interface CatalogModel {
  modelId: string;
  name: string;
  /** Present only because a manual override names a model outside the catalog. */
  manual: boolean;
}

/** One provider group in the icon picker's catalog. */
export interface CatalogProvider {
  providerId: string;
  displayName: string;
  /** Shipped official channel (gets a vendor mark). */
  official: boolean;
  /** Hand-declared provider (no vendor mark). */
  declared: boolean;
  models: CatalogModel[];
}

/** Snapshot consumed by the icon picker's settings section. */
export interface CatalogState {
  status: CatalogStatus;
  providers: CatalogProvider[];
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* DSH runtime surfaces                                                       */
/* -------------------------------------------------------------------------- */

/** One write operation handed to `configForms` `mutate()`. */
export interface ConfigMutateOp {
  op: 'set' | 'unset';
  path: readonly (string | number)[];
  value?: unknown;
}

/** `cmd.configForms` form controller snapshot for our settings namespace. */
export interface ConfigFormSnapshot {
  status?: string;
  value?: unknown;
  base?: unknown;
  user?: unknown;
  revision?: number;
  writable?: boolean;
  error?: unknown;
}

/** `cmd.configForms` form controller for one settings namespace. */
export interface ConfigForm {
  getSnapshot(): ConfigFormSnapshot;
  subscribe?(listener: () => void): (() => void) | void;
  mutate(ops: readonly ConfigMutateOp[], expectedRevision?: number): Promise<boolean>;
  set?(field: string, value: unknown): Promise<boolean>;
  unset?(field: string): Promise<boolean>;
}

/** One settings namespace inside the `configForms.describe()` mirror. */
export interface SettingsNamespaceView {
  ns?: string;
  value?: unknown;
  base?: unknown;
  user?: unknown;
  revision?: number;
  schema?: unknown;
  [key: string]: unknown;
}

/** `configForms.describe()` mirror snapshot. */
export interface SettingsMirrorSnapshot {
  view?: {
    namespaces?: readonly SettingsNamespaceView[];
    [key: string]: unknown;
  } | null;
  status?: string;
  [key: string]: unknown;
}

/** `configForms.describe()` mirror controller. */
export interface SettingsMirror {
  ensure?(): Promise<unknown> | unknown;
  getSnapshot?(): SettingsMirrorSnapshot | null;
  subscribe?(listener: () => void): (() => void) | void;
}

/** The `configForms` client service. */
export interface ConfigFormsService {
  get(id: string): ConfigForm | null;
  describe?(): SettingsMirror | null;
}

/** One row of `remote.llm.listConfigurableProviders()`. */
export interface ProviderDirectoryRow {
  provider: string;
  displayName?: string | null;
  declared?: boolean;
  settingsNs?: string | null;
  settingsPath?: readonly string[] | null;
  nativeAuth?: unknown;
  defaultBaseURL?: string | null;
  baseURLEnv?: string | null;
}

/** One row of `remote.llm.listProviders()` (live adapter routes). */
export interface RegisteredRoute {
  id: string;
  name?: string | null;
}

/** The `remote.llm` projected namespace. */
export interface RemoteLlmService {
  listConfigurableProviders?(): Promise<unknown>;
  listProviders?(): Promise<unknown>;
}

/** The `remote` root service (event forwarding + projected namespaces). */
export interface RemoteService {
  llm?: RemoteLlmService;
  $on?(event: string, handler: () => void): unknown;
}

/** `locale.getSnapshot()` result. */
export interface LocaleSnapshot {
  active?: string | null;
  [key: string]: unknown;
}

/** The `locale` client service. */
export interface LocaleService {
  getSnapshot?(): LocaleSnapshot | null;
  subscribe?(listener: () => void): (() => void) | void;
}

/** Options accepted by `ctx.slots.register()`. */
export interface SlotRegistrationOptions {
  name?: string;
  id?: string;
  order?: number;
  priority?: number;
  label?: () => string;
}

/** The `slots` client service the bundle declares in its `inject` list. */
export interface SlotsService {
  inject?(slot: string, callback: () => unknown): unknown;
  register(options: SlotRegistrationOptions, component: unknown): unknown;
}

/**
 * The plugin context (`ctx`) handed to `apply()`.
 *
 * Only the members this bundle touches are modelled; every optional member is
 * probed defensively at runtime because a deployment may lack the service.
 */
export interface DshContext {
  effect?(callback: () => unknown, label?: string): unknown;
  on?(event: string, handler: (...args: unknown[]) => void): unknown;
  get?(name: string): unknown;
  inject?(deps: readonly string[], callback: (scope: DshContext) => unknown): unknown;
  slots: SlotsService;
}

/* -------------------------------------------------------------------------- */
/* Diagnostics surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Read-only diagnostics published on `globalThis` by `apply()` for maintainers
 * and the live-verification harness.
 */
export interface ModelLogosDiagnostics {
  iconState(): IconState;
  catalog(): CatalogState;
  refreshCatalog(): Promise<void>;
  decorate(): void;
  requestDecorate(): void;
}

declare global {
  /** Set by the plugin's `apply()`; absent when the bundle never mounted. */
  var __dshModelLogos: ModelLogosDiagnostics | undefined;
}
