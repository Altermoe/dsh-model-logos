/**
 * Settings → Model icons section for the model-logos plugin.
 *
 * Registers as the `settings.section` contribution (through `src/client.ts`) and
 * reuses the render helpers/constants shared with the icon picker
 * (`dshmlUiCopy`, `dshmlUiOverrideValue`, `dshmlUiProviderOverrideValue`,
 * `dshmlUiResolve`, `dshmlUiLetterTile`, `dshmlUiLogo`, `DSHML_LETTER_ICON`,
 * `DSHML_PICKER_NONE_SVG`, `dshmlOpenIconPicker`) by importing them from
 * `./picker`, plus `dshmlVendorMark` / `dshmlClearProviderIcon` from
 * `./overrides` for the provider group.
 *
 * The page lists two scopes: a provider group (one vendor mark per provider
 * route) above the provider/model groups, so a channel icon can be configured
 * exactly like a model icon.
 *
 * Resilience rules: every piece of catalog/override data is validated before
 * use; missing services or loading states render a notice/short state instead
 * of throwing; the component never writes outside its own React subtree.
 */
import type { ChangeEvent, FormEvent, MouseEvent, ReactElement } from 'react';
import { h, React } from './runtime';
import type { CatalogState, VendorMark } from './types';
import {
  DSHML_LETTER_ICON,
  DSHML_PICKER_NONE_SVG,
  dshmlOpenIconPicker,
  dshmlUiCopy,
  dshmlUiCurrentError,
  dshmlUiLetterTile,
  dshmlUiLogo,
  dshmlUiOverrideValue,
  dshmlUiOverrides,
  dshmlUiProviderOverrideValue,
  dshmlUiProviderOverrides,
  dshmlUiResolve,
  dshmlUiUseIconState,
} from './picker';
import type { DshmlUiLetterTile } from './picker';
import { dshmlClearModelIcon, dshmlClearProviderIcon, dshmlUseModelCatalog, dshmlVendorMark } from './overrides';
import { dshmlCustomIconsOf, dshmlCustomMarkFor } from './custom-icons';

/** One model row inside a normalized catalog group. */
interface DshmlSectionModel {
  modelId: string;
  name: string;
}

/** One catalog provider group, normalized for rendering. */
interface DshmlSectionGroup {
  providerId: string;
  displayName: string;
  official: boolean;
  declared: boolean;
  models: DshmlSectionModel[];
}

/** A catalog group after search filtering. */
interface DshmlSectionFilteredGroup {
  providerId: string;
  displayName: string;
  models: DshmlSectionModel[];
}

/** One persisted override that is not part of the catalog. */
interface DshmlSectionManualRow {
  providerId: string;
  modelId: string;
  value: string;
}

/** Localized copy with an English fallback (see `dshmlUiCopy` in picker.ts). */
function dshmlSectionCopy(key: string, fallback: string): string {
  return dshmlUiCopy(key, fallback);
}

/** A plain-object guard for host-shaped data (arrays pass, like the old checks). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** An array guard that keeps the elements `unknown` instead of `any`. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Safe wrapper: a missing/broken catalog hook renders the loading state. */
function dshmlSectionUseCatalog(): CatalogState {
  try {
    const catalog: unknown = dshmlUseModelCatalog();
    if (catalog !== null && typeof catalog === 'object') return catalog as CatalogState;
  } catch {
    /* fall through */
  }
  return { status: 'loading', providers: [], error: null };
}

/**
 * Validate and normalize the catalog into `[{ providerId, displayName, official,
 * declared, models: [{ modelId, name }] }]`.
 * @param catalog - catalog snapshot (host-shaped, so unbounded).
 */
function dshmlSectionCatalogGroups(catalog: unknown): DshmlSectionGroup[] {
  const groups: DshmlSectionGroup[] = [];
  const seen: Record<string, boolean> = Object.create(null);
  try {
    const providers = isRecord(catalog) && isUnknownArray(catalog.providers) ? catalog.providers : [];
    for (const provider of providers) {
      if (!isRecord(provider)) continue;
      const providerId = typeof provider.providerId === 'string' ? provider.providerId : '';
      if (providerId === '') continue;
      const models: DshmlSectionModel[] = [];
      const rawModels = isUnknownArray(provider.models) ? provider.models : [];
      for (const model of rawModels) {
        if (!isRecord(model)) continue;
        const modelId = typeof model.modelId === 'string' ? model.modelId : '';
        if (modelId === '') continue;
        const pairKey = providerId + '\u0000' + modelId;
        if (seen[pairKey] === true) continue;
        seen[pairKey] = true;
        models.push({
          modelId: modelId,
          name: typeof model.name === 'string' && model.name !== '' ? model.name : modelId,
        });
      }
      groups.push({
        providerId: providerId,
        displayName:
          typeof provider.displayName === 'string' && provider.displayName !== '' ? provider.displayName : providerId,
        official: provider.official === true,
        declared: provider.declared === true,
        models: models,
      });
    }
  } catch {
    /* keep the groups collected so far */
  }
  return groups;
}

/**
 * Override entries that are not part of the catalog, sorted for stable output.
 * @param overrides - validated override map (host-shaped, so unbounded).
 * @param catalogPairs - `providerId\\u0000modelId` → known-catalog flag.
 * @returns the manual override rows as `{ providerId, modelId, value }`.
 */
function dshmlSectionManualRows(overrides: unknown, catalogPairs: Record<string, boolean>): DshmlSectionManualRow[] {
  const rows: DshmlSectionManualRow[] = [];
  if (!isRecord(overrides)) return rows;
  try {
    for (const providerId of Object.keys(overrides)) {
      const bucket = overrides[providerId];
      if (!isRecord(bucket)) continue;
      for (const modelId of Object.keys(bucket)) {
        const value = bucket[modelId];
        if (typeof value !== 'string' || value === '') continue;
        if (catalogPairs[providerId + '\u0000' + modelId] === true) continue;
        rows.push({ providerId: providerId, modelId: modelId, value: value });
      }
    }
  } catch {
    /* keep the rows collected so far */
  }
  rows.sort(function byPair(a, b) {
    return a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId);
  });
  return rows;
}

/**
 * Count every persisted override, catalogued or manual.
 * @param overrides - validated override map (host-shaped, so unbounded).
 */
function dshmlSectionCountOverrides(overrides: unknown): number {
  let count = 0;
  if (!isRecord(overrides)) return count;
  try {
    for (const providerId of Object.keys(overrides)) {
      const bucket = overrides[providerId];
      if (!isRecord(bucket)) continue;
      for (const modelId of Object.keys(bucket)) {
        if (typeof bucket[modelId] === 'string' && bucket[modelId] !== '') count += 1;
      }
    }
  } catch {
    /* keep the partial count */
  }
  return count;
}

/**
 * Count every persisted provider (vendor) override.
 * @param providerOverrides - flat `providerId → icon` map (host-shaped, so unbounded).
 */
function dshmlSectionCountProviderOverrides(providerOverrides: unknown): number {
  let count = 0;
  if (!isRecord(providerOverrides)) return count;
  try {
    for (const providerId of Object.keys(providerOverrides)) {
      const value = providerOverrides[providerId];
      if (typeof value === 'string' && value !== '') count += 1;
    }
  } catch {
    /* keep the partial count */
  }
  return count;
}

/**
 * The `pending` marker of one provider row.
 *
 * Model rows key on `providerId\\u0000modelId`; the provider scope has no model
 * dimension, so it gets a leading NUL namespace of its own and can never collide
 * with a model row's marker.
 * @param providerId - provider route id.
 */
function dshmlSectionProviderRowKey(providerId: string): string {
  return '\u0000provider\u0000' + providerId;
}

/** `{n}` interpolation for the override summary line. */
function dshmlSectionOverrideSummary(count: number): string {
  const template = dshmlSectionCopy('section.overrides', '{n} manual overrides');
  return template.split('{n}').join(String(count));
}

/** The props one catalog/manual row accepts. */
interface DshmlSectionRowProps {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  override: string | null;
  /** Preview of the row's user-created icon, when the override names one. */
  customMark: DshmlUiLetterTile | null;
  busy: boolean;
  onChoose: (providerId: string, modelId: string, modelName: string, anchor: Element | null) => void;
  onReset: (providerId: string, modelId: string) => void;
}

/** One catalog / manual row: preview, names, current state chip and actions. */
function DshmlSectionRow(props: DshmlSectionRowProps): ReactElement | null {
  const providerId = props.providerId;
  const modelId = props.modelId;
  if (providerId === '' || modelId === '') return null;

  const modelName = props.modelName;
  const providerName = props.providerName !== '' ? props.providerName : providerId;
  const raw = props.override !== null && props.override !== '' ? props.override : null;
  const resolved = dshmlUiResolve(providerId, modelId, modelName);
  const letter = raw === DSHML_LETTER_ICON || resolved.letter === true;

  let svg = '';
  let emptyMark = false;
  if (raw === 'none') {
    svg = DSHML_PICKER_NONE_SVG;
  } else if (letter === true) {
    const tile = dshmlUiLetterTile(providerId, modelId, modelName);
    if (tile !== null) svg = tile.svg;
    emptyMark = svg === '';
  } else if (props.customMark !== null) {
    svg = props.customMark.svg;
  } else if (resolved.key !== null) {
    const logo = dshmlUiLogo(resolved.key);
    if (logo !== null) svg = logo.svg;
    emptyMark = svg === '';
  } else {
    emptyMark = true;
  }

  let chipLabel: string;
  let chipClass = 'dshml-section-chip';
  if (raw === 'none') {
    chipLabel = dshmlSectionCopy('section.none', 'None');
    chipClass += ' dshml-section-chip-none';
  } else if (letter === true) {
    chipLabel = dshmlSectionCopy('picker.letter', 'Letter icon');
    chipClass += ' dshml-section-chip-custom';
  } else if (raw !== null) {
    chipLabel = dshmlSectionCopy('section.custom', 'Custom');
    chipClass += ' dshml-section-chip-custom';
  } else {
    chipLabel = dshmlSectionCopy('section.auto', 'Auto');
  }

  const chooseLabel =
    raw !== null
      ? dshmlSectionCopy('section.change', 'Change icon')
      : dshmlSectionCopy('section.choose', 'Choose icon');
  const displayName = modelName !== '' ? modelName : modelId;
  const busy = props.busy === true;

  const markClass = emptyMark === true ? 'dshml-section-mark dshml-section-mark-empty' : 'dshml-section-mark';
  const mark =
    svg !== ''
      ? h('span', {
          key: 'mark',
          className: markClass,
          'aria-hidden': 'true',
          dangerouslySetInnerHTML: { __html: svg },
        })
      : h('span', { key: 'mark', className: markClass, 'aria-hidden': 'true' }, '\u2013');

  const textChildren: ReactElement[] = [
    h(
      'span',
      { key: 'name', className: 'dshml-section-row-name', title: providerName + ' / ' + displayName },
      displayName,
    ),
  ];
  const secondary = providerName !== '' ? providerName + ' \u00b7 ' + modelId : modelId;
  if (secondary !== '') {
    textChildren.push(h('span', { key: 'id', className: 'dshml-section-row-id' }, secondary));
  }

  const actionChildren: ReactElement[] = [
    h(
      'button',
      {
        key: 'choose',
        type: 'button',
        className: 'dshml-section-btn',
        disabled: busy,
        'aria-label': providerName + ' / ' + displayName + ' \u2014 ' + chooseLabel,
        onClick: function onChoose(event: MouseEvent<HTMLButtonElement>) {
          props.onChoose(providerId, modelId, modelName, event.currentTarget);
        },
      },
      chooseLabel,
    ),
  ];
  if (raw !== null) {
    actionChildren.push(
      h(
        'button',
        {
          key: 'reset',
          type: 'button',
          className: 'dshml-section-btn dshml-section-btn-ghost',
          disabled: busy,
          'aria-label':
            providerName + ' / ' + displayName + ' \u2014 ' + dshmlSectionCopy('section.reset', 'Reset to auto'),
          onClick: function onReset() {
            props.onReset(providerId, modelId);
          },
        },
        dshmlSectionCopy('section.reset', 'Reset to auto'),
      ),
    );
  }

  return h('div', { className: 'dshml-section-row', role: 'listitem' }, [
    mark,
    h('div', { key: 'text', className: 'dshml-section-row-text' }, textChildren),
    h('span', { key: 'chip', className: chipClass }, chipLabel),
    h('div', { key: 'actions', className: 'dshml-section-actions' }, actionChildren),
  ]);
}

/**
 * The vendor mark of one provider row, or null when resolution failed.
 *
 * `allowFallback` mirrors the Settings decorator: an official channel may fall
 * back to its generated letter tile, a hand-declared provider must not, so an
 * unknown custom route keeps an empty (but reserved) 22px seat.
 * @param providerId - provider route id.
 * @param displayName - catalog display name (letter-tile source text).
 * @param allowFallback - enable the generated letter tile.
 */
function dshmlSectionVendorMark(providerId: string, displayName: string, allowFallback: boolean): VendorMark | null {
  try {
    const mark: unknown = dshmlVendorMark(providerId, displayName, allowFallback);
    if (mark === null || typeof mark !== 'object') return null;
    return mark as VendorMark;
  } catch {
    return null;
  }
}

/** The props one provider (vendor) row accepts. */
interface DshmlSectionProviderRowProps {
  providerId: string;
  providerName: string;
  /** Shipped official channel: falls back to a letter tile, unlike a declared one. */
  official: boolean;
  /** Hand-declared route: an official flag on it is not a real official channel. */
  declared: boolean;
  /** Persisted `providerIcons[providerId]` value, or null when unset. */
  override: string | null;
  busy: boolean;
  onChoose: (providerId: string, providerName: string, official: boolean, anchor: Element | null) => void;
  onReset: (providerId: string) => void;
}

/**
 * One provider row: the current vendor mark, the route identity, a state chip
 * and the choose/reset actions.
 *
 * The mark follows the same rule as the Settings decorator: the persisted
 * override wins; otherwise an official channel resolves its artwork; a
 * hand-declared provider stays empty, so no brand is invented for it.
 */
function DshmlSectionProviderRow(props: DshmlSectionProviderRowProps): ReactElement | null {
  const providerId = props.providerId;
  if (providerId === '') return null;

  const providerName = props.providerName !== '' ? props.providerName : providerId;
  const raw = props.override !== null && props.override !== '' ? props.override : null;
  // Mirror the Settings decorator's official rule: a channel that is also
  // hand-declared is a custom route, not an official one.
  const fallback = props.official === true && props.declared !== true;
  const mark = dshmlSectionVendorMark(providerId, providerName, fallback);
  const resolution = mark !== null ? mark.resolved : null;

  let svg = '';
  if (raw === 'none') {
    svg = DSHML_PICKER_NONE_SVG;
  } else if (mark !== null && typeof mark.svg === 'string') {
    svg = mark.svg;
  }
  // A hand-declared provider without an override keeps the same reserved 22px
  // seat the model rows use (an empty mark, never an invented brand).
  const emptyMark = svg === '';
  const markTitle = mark !== null && typeof mark.title === 'string' ? mark.title : '';

  let chipLabel: string;
  let chipClass = 'dshml-section-chip';
  if (raw === 'none') {
    chipLabel = dshmlSectionCopy('section.none', 'None');
    chipClass += ' dshml-section-chip-none';
  } else if (raw === DSHML_LETTER_ICON || (resolution !== null && resolution.letter === true)) {
    chipLabel = dshmlSectionCopy('picker.letter', 'Letter icon');
    chipClass += ' dshml-section-chip-custom';
  } else if (raw !== null || (resolution !== null && resolution.source === 'override')) {
    chipLabel = dshmlSectionCopy('section.custom', 'Custom');
    chipClass += ' dshml-section-chip-custom';
  } else {
    chipLabel = dshmlSectionCopy('section.auto', 'Auto');
  }

  const chooseLabel =
    raw !== null
      ? dshmlSectionCopy('section.changeProvider', 'Change vendor icon')
      : dshmlSectionCopy('section.chooseProvider', 'Choose vendor icon');
  const busy = props.busy === true;

  const markClass = emptyMark === true ? 'dshml-section-mark dshml-section-mark-empty' : 'dshml-section-mark';
  // A hand-declared provider without an override gets a genuinely empty seat —
  // the same reserved 22px the Settings name seat keeps — rather than a dash
  // that would read as a configured "no icon". An unresolvable override still
  // shows the dash, because the user did configure something there.
  const emptySeat = svg === '' && raw === null && fallback === false;
  let markNode: ReactElement;
  if (svg !== '') {
    markNode = h('span', {
      key: 'mark',
      className: markClass,
      title: markTitle !== '' ? markTitle : null,
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: svg },
    });
  } else if (emptySeat === true) {
    markNode = h('span', { key: 'mark', className: markClass, 'aria-hidden': 'true' });
  } else {
    markNode = h('span', { key: 'mark', className: markClass, 'aria-hidden': 'true' }, '\u2013');
  }

  const textChildren: ReactElement[] = [
    h(
      'span',
      { key: 'name', className: 'dshml-section-row-name', title: providerName + ' \u00b7 ' + providerId },
      providerName,
    ),
    h('span', { key: 'id', className: 'dshml-section-row-id' }, providerId),
  ];

  const actionChildren: ReactElement[] = [
    h(
      'button',
      {
        key: 'choose',
        type: 'button',
        className: 'dshml-section-btn',
        disabled: busy,
        'data-dshml-provider-choose': providerId,
        'aria-label': providerName + ' \u2014 ' + chooseLabel,
        onClick: function onChoose(event: MouseEvent<HTMLButtonElement>) {
          props.onChoose(providerId, providerName, fallback, event.currentTarget);
        },
      },
      chooseLabel,
    ),
  ];
  if (raw !== null) {
    actionChildren.push(
      h(
        'button',
        {
          key: 'reset',
          type: 'button',
          className: 'dshml-section-btn dshml-section-btn-ghost',
          disabled: busy,
          'data-dshml-provider-reset': providerId,
          'aria-label': providerName + ' \u2014 ' + dshmlSectionCopy('section.resetProvider', 'Reset vendor to auto'),
          onClick: function onReset() {
            props.onReset(providerId);
          },
        },
        dshmlSectionCopy('section.resetProvider', 'Reset vendor to auto'),
      ),
    );
  }

  return h(
    'div',
    {
      className: 'dshml-section-row',
      role: 'listitem',
      'data-dshml-provider-row': providerId,
    },
    [
      markNode,
      h('div', { key: 'text', className: 'dshml-section-row-text' }, textChildren),
      h('span', { key: 'chip', className: chipClass }, chipLabel),
      h('div', { key: 'actions', className: 'dshml-section-actions' }, actionChildren),
    ],
  );
}

/**
 * The `settings.section` page: searchable list of catalog models with their
 * current icon, plus manual (providerId, modelId) overrides and a pair form.
 * @param _props - slot props (unused).
 */
export function DshmlModelIconsSection(_props: unknown): ReactElement {
  const iconState = dshmlUiUseIconState();
  const catalog = dshmlSectionUseCatalog();
  const [query, setQuery] = React.useState('');
  const [pending, setPending] = React.useState('');
  const [error, setError] = React.useState('');
  const [manualProvider, setManualProvider] = React.useState('');
  const [manualModel, setManualModel] = React.useState('');
  const [manualError, setManualError] = React.useState('');

  const overrides = dshmlUiOverrides(iconState);
  const providerOverrides = dshmlUiProviderOverrides(iconState);
  const customIcons = dshmlCustomIconsOf((iconState as { customIcons?: unknown }).customIcons);
  function customMarkFor(value: string | null): DshmlUiLetterTile | null {
    return value !== null ? dshmlCustomMarkFor(customIcons, value) : null;
  }
  const groups = dshmlSectionCatalogGroups(catalog);
  const catalogPairs: Record<string, boolean> = Object.create(null);
  for (const group of groups) {
    for (const model of group.models) {
      catalogPairs[group.providerId + '\u0000' + model.modelId] = true;
    }
  }
  const manualRows = dshmlSectionManualRows(overrides, catalogPairs);
  const modelOverrideCount = dshmlSectionCountOverrides(overrides);
  const providerOverrideCount = dshmlSectionCountProviderOverrides(providerOverrides);
  // One summary line for both scopes: a provider override is as much a manual
  // override as a model one, and a single localized key stays translatable. The
  // per-scope counts stay on the DOM as data hooks for the DOM gate.
  const overrideCount = modelOverrideCount + providerOverrideCount;

  const normalizedQuery = query.trim().toLowerCase();
  function matchesQuery(text: string): boolean {
    if (normalizedQuery === '') return true;
    return text.toLowerCase().indexOf(normalizedQuery) !== -1;
  }

  // Search parities with the model groups in the other direction too: a query
  // that matches one of a provider's models keeps that provider row, exactly as
  // a provider-name match keeps every model row of that provider.
  const filteredProviders = groups.filter(function byProvider(group) {
    if (matchesQuery(group.displayName) || matchesQuery(group.providerId)) return true;
    return group.models.some(function byModel(model) {
      return matchesQuery(model.name) || matchesQuery(model.modelId);
    });
  });

  const filteredGroups: DshmlSectionFilteredGroup[] = [];
  for (const group of groups) {
    const providerMatches = matchesQuery(group.displayName) || matchesQuery(group.providerId);
    const models =
      providerMatches === true
        ? group.models
        : group.models.filter(function byModel(model) {
            return matchesQuery(model.name) || matchesQuery(model.modelId);
          });
    if (models.length > 0) {
      filteredGroups.push({
        providerId: group.providerId,
        displayName: group.displayName,
        models: models,
      });
    }
  }

  const filteredManual = manualRows.filter(function byManual(row) {
    return matchesQuery(row.providerId) || matchesQuery(row.modelId);
  });

  const hasContent = groups.length > 0 || manualRows.length > 0;
  const hasFiltered = filteredProviders.length > 0 || filteredGroups.length > 0 || filteredManual.length > 0;
  const loading = iconState.status === 'loading' || catalog.status === 'loading';
  const iconUnavailable = iconState.status === 'unavailable';
  const storeError = typeof iconState.error === 'string' ? iconState.error : '';
  const displayError = error !== '' ? error : storeError;

  function explainWriteFailure(): string {
    const message = dshmlUiCurrentError();
    return message !== '' ? message : dshmlSectionCopy('picker.saveFailed', 'Could not save \u2014 try again');
  }

  function resetIcon(providerId: string, modelId: string): void {
    if (pending !== '') return;
    const rowKey = providerId + '\u0000' + modelId;
    setError('');
    setPending(rowKey);
    let write: Promise<boolean>;
    try {
      write = dshmlClearModelIcon(providerId, modelId);
    } catch (writeError) {
      write = Promise.reject(writeError);
    }
    Promise.resolve(write).then(
      function saved(ok) {
        setPending('');
        if (ok === false) setError(explainWriteFailure());
      },
      function failed() {
        setPending('');
        setError(explainWriteFailure());
      },
    );
  }

  function openPicker(providerId: string, modelId: string, displayName: string, anchor: Element | null): void {
    try {
      dshmlOpenIconPicker({
        providerId: providerId,
        modelId: modelId,
        displayName: displayName,
        anchor: anchor,
        onChanged: function onChanged() {
          setError('');
        },
      });
    } catch {
      setError(explainWriteFailure());
    }
  }

  /** Open the picker in `provider` scope: one vendor icon per provider route. */
  function openProviderPicker(
    providerId: string,
    displayName: string,
    allowFallback: boolean,
    anchor: Element | null,
  ): void {
    try {
      dshmlOpenIconPicker({
        scope: 'provider',
        providerId: providerId,
        displayName: displayName,
        fallback: allowFallback,
        anchor: anchor,
        onChanged: function onChanged() {
          setError('');
        },
      });
    } catch {
      setError(explainWriteFailure());
    }
  }

  /** Clear `providerIcons[providerId]`, falling back to the automatic choice. */
  function resetProviderIcon(providerId: string): void {
    if (pending !== '') return;
    const rowKey = dshmlSectionProviderRowKey(providerId);
    setError('');
    setPending(rowKey);
    let write: Promise<boolean>;
    try {
      write = dshmlClearProviderIcon(providerId);
    } catch (writeError) {
      write = Promise.reject(writeError);
    }
    Promise.resolve(write).then(
      function saved(ok) {
        setPending('');
        if (ok === false) setError(explainWriteFailure());
      },
      function failed() {
        setPending('');
        setError(explainWriteFailure());
      },
    );
  }

  function submitManual(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const providerId = manualProvider.trim();
    const modelId = manualModel.trim();
    if (providerId === '' || modelId === '') {
      setManualError(dshmlSectionCopy('section.manualHint', 'Enter a provider id and a model id.'));
      return;
    }
    setManualError('');
    openPicker(providerId, modelId, modelId, null);
  }

  const headChildren: ReactElement[] = [
    h('h2', { key: 'title', className: 'dshml-section-title' }, dshmlSectionCopy('section.title', 'Model icons')),
    h(
      'p',
      { key: 'intro', className: 'dshml-section-intro' },
      dshmlSectionCopy('section.intro', 'Pick an icon for a provider + model pair. Unset pairs use auto-detection.'),
    ),
  ];
  if (overrideCount > 0) {
    headChildren.push(
      h(
        'p',
        {
          key: 'summary',
          className: 'dshml-section-summary',
          'data-dshml-model-overrides': String(modelOverrideCount),
          'data-dshml-provider-overrides': String(providerOverrideCount),
        },
        dshmlSectionOverrideSummary(overrideCount),
      ),
    );
  }

  const notices: ReactElement[] = [];
  if (displayError !== '') {
    notices.push(
      h(
        'p',
        { key: 'error', className: 'dshml-section-notice dshml-section-notice-error', role: 'alert' },
        displayError,
      ),
    );
  }
  if (iconUnavailable === true) {
    notices.push(
      h(
        'p',
        { key: 'unavailable', className: 'dshml-section-notice dshml-section-notice-warn', role: 'status' },
        dshmlSectionCopy('section.unavailable', 'Settings namespace unavailable \u2014 icon changes cannot be saved.'),
      ),
    );
  } else if (loading === true && hasContent === false) {
    notices.push(
      h(
        'p',
        { key: 'loading', className: 'dshml-section-notice', role: 'status' },
        dshmlSectionCopy('section.loading', 'Loading\u2026'),
      ),
    );
  }

  const toolbar = h('div', { key: 'toolbar', className: 'dshml-section-toolbar' }, [
    h('input', {
      key: 'search',
      type: 'search',
      className: 'dshml-section-search',
      placeholder: dshmlSectionCopy('section.search', 'Search providers or models'),
      'aria-label': dshmlSectionCopy('section.search', 'Search providers or models'),
      value: query,
      onChange: function onSearch(event: ChangeEvent<HTMLInputElement>) {
        setQuery(event.target.value);
      },
    }),
  ]);

  const providerRows = filteredProviders.map(function toProviderRow(group) {
    return h(DshmlSectionProviderRow, {
      key: 'provider-' + group.providerId,
      providerId: group.providerId,
      providerName: group.displayName,
      official: group.official,
      declared: group.declared,
      override: dshmlUiProviderOverrideValue(providerOverrides, group.providerId),
      busy: pending === dshmlSectionProviderRowKey(group.providerId),
      onChoose: openProviderPicker,
      onReset: resetProviderIcon,
    });
  });

  const groupElements: ReactElement[] = [];
  if (providerRows.length > 0) {
    groupElements.push(
      h('div', { key: 'provider-group', className: 'dshml-section-group dshml-section-group-providers' }, [
        h('div', { key: 'head', className: 'dshml-section-group-head' }, [
          h(
            'span',
            { key: 'title', className: 'dshml-section-group-title' },
            dshmlSectionCopy('section.providerIcons', 'Provider icons'),
          ),
        ]),
        h(
          'p',
          { key: 'hint', className: 'dshml-section-group-hint' },
          dshmlSectionCopy(
            'section.autoProvider',
            'Auto follows the official channel; hand-declared providers show no icon.',
          ),
        ),
        h('div', { key: 'rows', className: 'dshml-section-rows', role: 'list' }, providerRows),
      ]),
    );
  }

  for (const group of filteredGroups) {
    const rows = group.models.map(function toRow(model) {
      const override = dshmlUiOverrideValue(overrides, group.providerId, model.modelId);
      return h(DshmlSectionRow, {
        key: 'row-' + group.providerId + '-' + model.modelId,
        providerId: group.providerId,
        providerName: group.displayName,
        modelId: model.modelId,
        modelName: model.name,
        override: override,
        customMark: customMarkFor(override),
        busy: pending === group.providerId + '\u0000' + model.modelId,
        onChoose: openPicker,
        onReset: resetIcon,
      });
    });
    groupElements.push(
      h('div', { key: 'group-' + group.providerId, className: 'dshml-section-group' }, [
        h('div', { key: 'head', className: 'dshml-section-group-head' }, [
          h(
            'span',
            { key: 'title', className: 'dshml-section-group-title', title: group.displayName },
            group.displayName,
          ),
          group.displayName === group.providerId
            ? null
            : h(
                'span',
                { key: 'sub', className: 'dshml-section-group-sub', title: group.providerId },
                group.providerId,
              ),
        ]),
        h('div', { key: 'rows', className: 'dshml-section-rows', role: 'list' }, rows),
      ]),
    );
  }

  if (filteredManual.length > 0) {
    groupElements.push(
      h('div', { key: 'manual-group', className: 'dshml-section-group' }, [
        h('div', { key: 'head', className: 'dshml-section-group-head' }, [
          h(
            'span',
            { key: 'title', className: 'dshml-section-group-title' },
            dshmlSectionCopy('section.manualGroup', 'Manual overrides'),
          ),
        ]),
        h(
          'div',
          { key: 'rows', className: 'dshml-section-rows', role: 'list' },
          filteredManual.map(function toManualRow(row) {
            return h(DshmlSectionRow, {
              key: 'manual-' + row.providerId + '-' + row.modelId,
              providerId: row.providerId,
              providerName: row.providerId,
              modelId: row.modelId,
              modelName: row.modelId,
              override: row.value,
              customMark: customMarkFor(row.value),
              busy: pending === row.providerId + '\u0000' + row.modelId,
              onChoose: openPicker,
              onReset: resetIcon,
            });
          }),
        ),
      ]),
    );
  }

  const manualForm = h('form', { key: 'manual', className: 'dshml-section-manual', onSubmit: submitManual }, [
    h(
      'h3',
      { key: 'title', className: 'dshml-section-manual-title' },
      dshmlSectionCopy('section.manual', 'Manual pair'),
    ),
    h(
      'p',
      { key: 'hint', className: 'dshml-section-manual-hint' },
      dshmlSectionCopy(
        'section.manualHint',
        'Enter a provider id and model id to iconise a model outside the catalog.',
      ),
    ),
    h('div', { key: 'fields', className: 'dshml-section-fields' }, [
      h('label', { key: 'provider', className: 'dshml-section-field' }, [
        h(
          'span',
          { key: 'label', className: 'dshml-section-field-label' },
          dshmlSectionCopy('section.providerId', 'Provider ID'),
        ),
        h('input', {
          key: 'input',
          type: 'text',
          className: 'dshml-section-input',
          value: manualProvider,
          placeholder: 'deepseek-account',
          spellCheck: false,
          onChange: function onProvider(event: ChangeEvent<HTMLInputElement>) {
            setManualProvider(event.target.value);
          },
        }),
      ]),
      h('label', { key: 'model', className: 'dshml-section-field' }, [
        h(
          'span',
          { key: 'label', className: 'dshml-section-field-label' },
          dshmlSectionCopy('section.modelId', 'Model ID'),
        ),
        h('input', {
          key: 'input',
          type: 'text',
          className: 'dshml-section-input',
          value: manualModel,
          placeholder: 'my-local-model',
          spellCheck: false,
          onChange: function onModel(event: ChangeEvent<HTMLInputElement>) {
            setManualModel(event.target.value);
          },
        }),
      ]),
      h(
        'button',
        {
          key: 'open',
          type: 'submit',
          className: 'dshml-section-btn dshml-section-btn-primary',
          disabled: manualProvider.trim() === '' || manualModel.trim() === '',
        },
        dshmlSectionCopy('section.openPicker', 'Open picker'),
      ),
    ]),
    manualError !== '' ? h('p', { key: 'error', className: 'dshml-section-error', role: 'alert' }, manualError) : null,
  ]);

  const children: ReactElement[] = [h('div', { key: 'head', className: 'dshml-section-head' }, headChildren)];
  for (const notice of notices) children.push(notice);
  if (hasContent === true) children.push(toolbar);
  if (hasContent === true) {
    children.push(h('div', { key: 'scroll', className: 'dshml-section-scroll' }, groupElements));
  }
  if (hasContent === false && iconUnavailable === false && loading === false) {
    children.push(
      h(
        'p',
        { key: 'empty', className: 'dshml-section-empty' },
        dshmlSectionCopy('section.empty', 'No models available yet.'),
      ),
    );
  }
  if (hasContent === true && hasFiltered === false) {
    children.push(
      h(
        'p',
        { key: 'empty-search', className: 'dshml-section-empty' },
        dshmlSectionCopy('section.emptySearch', 'No matching results.'),
      ),
    );
  }
  children.push(manualForm);

  return h('div', { className: 'dshml-section' }, children);
}
