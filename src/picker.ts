/**
 * Icon picker modal for the model-logos plugin.
 *
 * Opens a centered modal through its own `react-dom/client` root inside a plain
 * `document.body` child, never inside the React tree of the caller. Only one
 * picker may be mounted at a time; opening a second one closes the first.
 *
 * This module also carries the small DOM-free render helpers that
 * `src/section.ts` reuses (`dshmlUiCopy`, `dshmlUiOverrideValue`,
 * `dshmlUiResolve`, `dshmlUiLetterTile`, `dshmlUiLogo`, the letter-icon literal
 * and the two placeholder SVGs). They are exported here instead of being
 * shared through a concatenated scope.
 */
import type { ChangeEvent, ReactElement } from 'react';
import { h, React, getCreateRoot } from './runtime';
import type { BrandLogo, IconState } from './types';
import { dshmlT } from './i18n';
import { letterTile } from './artwork';
import { LOGOS, filterLogoGroups, groupLogoEntries } from './logos';
import { LOGO_RANKS } from './logos/ranking';
import type { GroupedLogoEntry, LogoGroups } from './logos/groups';
import {
  dshmlClearModelIcon,
  dshmlIconState,
  dshmlLetterTextFor,
  dshmlResolveFor,
  dshmlSetModelIcon,
  dshmlUseIconState,
} from './overrides';

/** Persisted override value meaning "render a deterministic letter tile". */
export const DSHML_LETTER_ICON = 'letter';

/** Neutral "let the heuristic decide" mark (sparkle in a rounded square). */
const DSHML_PICKER_AUTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="1.2" y="1.2" width="21.6" height="21.6" rx="6.2" fill="none" stroke="#98a1b0" stroke-width="1.3" stroke-dasharray="3 2.4"/>' +
  '<path d="M12 5.4l1.85 4.75L18.6 12l-4.75 1.85L12 18.6l-1.85-4.75L5.4 12l4.75-1.85z" fill="#8a93a3"/>' +
  '</svg>';

/** "No icon" mark (crossed circle). */
export const DSHML_PICKER_NONE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#98a1b0" stroke-width="1.4"/>' +
  '<path d="M6.1 17.9 17.9 6.1" fill="none" stroke="#98a1b0" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';

/** Unique dialog title ids for aria-labelledby. */
let dshmlPickerSerial = 0;

/** The currently mounted picker's close function, or null. */
let dshmlPickerOpenClose: (() => void) | null = null;

/** One validated brand option: artwork key, title, group and prominence rank. */
export type DshmlUiLogoEntry = GroupedLogoEntry;

/** Normalized resolution shape the picker and the settings section render. */
export interface DshmlUiResolution {
  key: string | null;
  source: string;
  disabled: boolean;
  letter: boolean;
}

/** A validated letter tile (generated tile for one model). */
export interface DshmlUiLetterTile {
  title: string;
  svg: string;
}

/** Lazily built, grouped and ranked brand option lists (LOGOS never changes). */
let dshmlUiBrandCache: LogoGroups | null = null;

/**
 * `dshmlT` lookup that degrades to an English fallback instead of showing a raw
 * dictionary key when i18n is missing an entry.
 * @param key - dictionary key.
 * @param fallback - English literal used when the lookup has no entry.
 */
export function dshmlUiCopy(key: string, fallback: string): string {
  try {
    const value: unknown = dshmlT(key);
    if (typeof value === 'string' && value !== '' && value !== key) return value;
  } catch {
    /* fall through to the literal */
  }
  return fallback;
}

/** State rendered while the icon store is missing, broken or still loading. */
function dshmlUiFallbackState(): IconState {
  return { status: 'loading', overrides: {}, writable: false, error: '' };
}

/** Current icon-store snapshot, or the safe fallback state. */
function dshmlUiState(): IconState {
  try {
    const state: unknown = dshmlIconState();
    if (state !== null && typeof state === 'object') return state as IconState;
  } catch {
    /* fall through */
  }
  return dshmlUiFallbackState();
}

/** Latest store error message, or '' — used to explain a failed write. */
export function dshmlUiCurrentError(): string {
  const state = dshmlUiState();
  return typeof state.error === 'string' ? state.error : '';
}

/**
 * The nested override map inside an icon-store state, when it is an object.
 * @param state - icon-store state (defensively treated as unknown).
 */
export function dshmlUiOverrides(state: unknown): Record<string, unknown> | null {
  if (state === null || typeof state !== 'object') return null;
  const overrides = (state as { overrides?: unknown }).overrides;
  return overrides !== null && typeof overrides === 'object' ? (overrides as Record<string, unknown>) : null;
}

/**
 * The stored override value of one pair, or null when unset.
 * @param overrides - validated override map (defensively treated as unknown).
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @returns `'none'`, `'letter'`, a brand key, or null.
 */
export function dshmlUiOverrideValue(overrides: unknown, providerId: string, modelId: string): string | null {
  if (overrides === null || typeof overrides !== 'object') return null;
  try {
    const bucket = (overrides as Record<string, unknown>)[providerId];
    if (bucket === null || typeof bucket !== 'object') return null;
    const value = (bucket as Record<string, unknown>)[modelId];
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

/**
 * One brand mark from the merged artwork set.
 * @param key - artwork key (defensively treated as unknown).
 */
export function dshmlUiLogo(key: unknown): DshmlUiLogoEntry | null {
  if (typeof key !== 'string' || key === '') return null;
  try {
    const entry: BrandLogo | undefined = LOGOS[key];
    if (entry === undefined || typeof entry !== 'object') return null;
    if (typeof entry.svg !== 'string' || entry.svg === '') return null;
    const rawRank = LOGO_RANKS[key];
    const rank = typeof rawRank === 'number' && Number.isFinite(rawRank) ? rawRank : Number.MAX_SAFE_INTEGER;
    return {
      key: key,
      title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : key,
      svg: entry.svg,
      group: entry.group,
      rank: rank,
    };
  } catch {
    return null;
  }
}

/** All selectable brand marks, grouped and sorted by measured prominence. */
function dshmlUiBrandGroups(): LogoGroups {
  if (dshmlUiBrandCache !== null) return dshmlUiBrandCache;
  dshmlUiBrandCache = groupLogoEntries(LOGOS, LOGO_RANKS);
  return dshmlUiBrandCache;
}

/**
 * Letter text exactly as the picker previews it: model name → model id →
 * provider id → '?'. Delegates to `dshmlLetterTextFor` when present.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @param modelName - catalog display name.
 */
function dshmlUiLetterText(providerId: string, modelId: string, modelName: string): string {
  try {
    const text: unknown = dshmlLetterTextFor(
      { id: providerId, name: '' },
      { id: modelId, name: typeof modelName === 'string' ? modelName : '' },
    );
    if (typeof text === 'string' && text !== '') return text;
  } catch {
    /* fall through to the local mirror */
  }
  const name = typeof modelName === 'string' ? modelName.trim() : '';
  if (name !== '') return name;
  if (typeof modelId === 'string' && modelId.trim() !== '') return modelId;
  if (typeof providerId === 'string' && providerId.trim() !== '') return providerId;
  return '?';
}

/**
 * The letter tile the picker previews for one pair, or null when generation failed.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @param modelName - catalog display name.
 */
export function dshmlUiLetterTile(providerId: string, modelId: string, modelName: string): DshmlUiLetterTile | null {
  const text = dshmlUiLetterText(providerId, modelId, modelName);
  try {
    const tile: unknown = letterTile(text);
    if (tile !== null && typeof tile === 'object') {
      const candidate = tile as { title?: unknown; svg?: unknown };
      if (typeof candidate.svg === 'string' && candidate.svg !== '') {
        return {
          title: typeof candidate.title === 'string' && candidate.title !== '' ? candidate.title : text,
          svg: candidate.svg,
        };
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Resolve one pair for rendering, normalizing whatever the store returned.
 * @param providerId - provider route id.
 * @param modelId - model id.
 * @param modelName - catalog display name.
 */
export function dshmlUiResolve(providerId: string, modelId: string, modelName: string): DshmlUiResolution {
  try {
    const result: unknown = dshmlResolveFor(
      { id: providerId, name: '' },
      { id: modelId, name: typeof modelName === 'string' ? modelName : '' },
    );
    if (result !== null && typeof result === 'object') {
      const candidate = result as { key?: unknown; source?: unknown; disabled?: unknown; letter?: unknown };
      return {
        key: typeof candidate.key === 'string' && candidate.key !== '' ? candidate.key : null,
        source: typeof candidate.source === 'string' ? candidate.source : 'none',
        disabled: candidate.disabled === true,
        letter: candidate.letter === true,
      };
    }
  } catch {
    /* fall through */
  }
  return { key: null, source: 'none', disabled: false, letter: false };
}

/** Wrapper around a possibly-missing hook so a broken store renders a state. */
export function dshmlUiUseIconState(): IconState {
  try {
    const state: unknown = dshmlUseIconState();
    if (state !== null && typeof state === 'object') return state as IconState;
  } catch {
    /* fall through */
  }
  return dshmlUiFallbackState();
}

/** The props one picker grid cell accepts. */
interface DshmlPickerOptionProps {
  optionKey: string;
  label?: string | null;
  svg?: string | null;
  ariaLabel?: string | null;
  hint?: string | null;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

/** One grid cell: a sticky-current option with its mark and label. */
function DshmlPickerOption(props: DshmlPickerOptionProps): ReactElement {
  const label = typeof props.label === 'string' && props.label !== '' ? props.label : props.optionKey;
  const svg = typeof props.svg === 'string' ? props.svg : '';
  return h(
    'button',
    {
      type: 'button',
      className: 'dshml-picker-option',
      'aria-pressed': props.selected === true ? 'true' : 'false',
      'aria-label': typeof props.ariaLabel === 'string' && props.ariaLabel !== '' ? props.ariaLabel : label,
      title: typeof props.hint === 'string' && props.hint !== '' ? props.hint : label,
      disabled: props.disabled === true,
      onClick: props.onSelect,
    },
    [
      h('span', {
        key: 'mark',
        className: 'dshml-picker-option-mark',
        'aria-hidden': 'true',
        dangerouslySetInnerHTML: { __html: svg },
      }),
      h('span', { key: 'label', className: 'dshml-picker-option-label' }, label),
    ],
  );
}

/** The props the modal content receives from `dshmlOpenIconPicker`. */
interface DshmlIconPickerAppProps {
  providerId: string;
  modelId: string;
  displayName: string;
  onChanged?: (() => void) | undefined;
  onClose: () => void;
}

/** The modal content. Receives already-validated ids from dshmlOpenIconPicker. */
function DshmlIconPickerApp(props: DshmlIconPickerAppProps): ReactElement {
  const providerId = props.providerId;
  const modelId = props.modelId;
  const displayName = typeof props.displayName === 'string' ? props.displayName : '';

  const state = dshmlUiUseIconState();
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleIdRef = React.useRef<string | null>(null);
  if (titleIdRef.current === null) {
    dshmlPickerSerial += 1;
    titleIdRef.current = 'dshml-picker-title-' + dshmlPickerSerial;
  }
  const titleId = titleIdRef.current;

  React.useEffect(
    function trapKeys() {
      function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (dialog === null || typeof dialog.querySelectorAll !== 'function') return;
        const nodes = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (first === undefined || last === undefined) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          if (typeof last.focus === 'function') last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          if (typeof first.focus === 'function') first.focus();
        }
      }
      document.addEventListener('keydown', onKeyDown, true);
      return function untrapKeys() {
        document.removeEventListener('keydown', onKeyDown, true);
      };
    },
    [props.onClose],
  );

  const overrides = dshmlUiOverrides(state);
  const rawOverride = dshmlUiOverrideValue(overrides, providerId, modelId);
  const resolved = dshmlUiResolve(providerId, modelId, displayName);
  const unavailable = state.status === 'unavailable';
  const letterTileEntry = dshmlUiLetterTile(providerId, modelId, displayName);

  const isAuto = rawOverride === null && resolved.letter !== true;
  const isNone = rawOverride === 'none';
  const isLetter = rawOverride === DSHML_LETTER_ICON || resolved.letter === true;
  const selectedBrandKey =
    rawOverride !== null && rawOverride !== 'none' && rawOverride !== DSHML_LETTER_ICON ? rawOverride : null;

  let autoSvg = DSHML_PICKER_AUTO_SVG;
  if (isAuto && resolved.key !== null) {
    const autoLogo = dshmlUiLogo(resolved.key);
    if (autoLogo !== null) autoSvg = autoLogo.svg;
  }
  const letterSvg = letterTileEntry !== null ? letterTileEntry.svg : DSHML_PICKER_AUTO_SVG;

  const allGroups = dshmlUiBrandGroups();
  const filteredGroups = filterLogoGroups(allGroups, query);
  const vendorBrands = filteredGroups.vendor;
  const modelBrands = filteredGroups.model;

  function explainWriteFailure(): string {
    const message = dshmlUiCurrentError();
    return message !== '' ? message : dshmlUiCopy('picker.saveFailed', 'Could not save — try again');
  }

  function selectIcon(kind: 'auto' | 'none' | 'letter' | 'brand', brandKey: string | null): void {
    if (busy === true) return;
    if (unavailable === true) {
      setError(dshmlUiCopy('picker.unavailable', 'Icon settings unavailable (host plugin not loaded)'));
      return;
    }
    setError('');
    setBusy(true);
    let write: Promise<boolean>;
    try {
      if (kind === 'auto') {
        write = dshmlClearModelIcon(providerId, modelId);
      } else {
        const value = kind === 'none' ? 'none' : kind === 'letter' ? DSHML_LETTER_ICON : brandKey;
        write = dshmlSetModelIcon(providerId, modelId, value ?? '');
      }
    } catch (writeError) {
      write = Promise.reject(writeError);
    }
    Promise.resolve(write).then(
      function saved(ok) {
        if (ok === false) {
          setBusy(false);
          setError(explainWriteFailure());
          return;
        }
        if (typeof props.onChanged === 'function') {
          try {
            props.onChanged();
          } catch {
            /* a failing callback must not keep the modal open */
          }
        }
        props.onClose();
      },
      function failed() {
        setBusy(false);
        setError(explainWriteFailure());
      },
    );
  }

  const disabled = unavailable === true || busy === true;

  const headChildren: ReactElement[] = [
    h('div', { key: 'heading', className: 'dshml-picker-heading' }, [
      h(
        'h2',
        { key: 'title', className: 'dshml-picker-title', id: titleId },
        dshmlUiCopy('picker.title', 'Choose model icon'),
      ),
      h('div', { key: 'subtitle', className: 'dshml-picker-subtitle' }, [
        displayName !== '' ? h('span', { key: 'name', className: 'dshml-picker-subtitle-name' }, displayName) : null,
        displayName !== '' ? h('span', { key: 'sep1', className: 'dshml-picker-subtitle-sep' }, '·') : null,
        h('span', { key: 'provider' }, providerId),
        h('span', { key: 'sep2', className: 'dshml-picker-subtitle-sep' }, '·'),
        h('span', { key: 'model' }, modelId),
      ]),
    ]),
    h(
      'button',
      {
        key: 'close',
        type: 'button',
        className: 'dshml-picker-close',
        'aria-label': dshmlUiCopy('picker.close', 'Close'),
        title: dshmlUiCopy('picker.close', 'Close'),
        onClick: props.onClose,
      },
      '\u00d7',
    ),
  ];

  const specialOptions = [
    h(DshmlPickerOption, {
      key: 'auto',
      optionKey: 'auto',
      svg: autoSvg,
      label: dshmlUiCopy('picker.auto', 'Auto'),
      hint: dshmlUiCopy('picker.autoHint', 'Matched from the model name'),
      ariaLabel: dshmlUiCopy('picker.auto', 'Auto'),
      selected: isAuto,
      disabled: disabled,
      onSelect: function onAuto() {
        selectIcon('auto', null);
      },
    }),
    h(DshmlPickerOption, {
      key: 'none',
      optionKey: 'none',
      svg: DSHML_PICKER_NONE_SVG,
      label: dshmlUiCopy('picker.none', 'No icon'),
      hint: dshmlUiCopy('picker.noneHint', 'Hide the icon entirely'),
      ariaLabel: dshmlUiCopy('picker.none', 'No icon'),
      selected: isNone,
      disabled: disabled,
      onSelect: function onNone() {
        selectIcon('none', null);
      },
    }),
    h(DshmlPickerOption, {
      key: 'letter',
      optionKey: 'letter',
      svg: letterSvg,
      label: dshmlUiCopy('picker.letter', 'Letter icon'),
      hint: dshmlUiCopy('picker.letterHint', 'Generated from the model name'),
      ariaLabel: dshmlUiCopy('picker.letter', 'Letter icon'),
      selected: isLetter,
      disabled: disabled,
      onSelect: function onLetter() {
        selectIcon('letter', null);
      },
    }),
  ];

  function toBrandCell(entry: DshmlUiLogoEntry): ReactElement {
    return h(DshmlPickerOption, {
      key: 'brand-' + entry.key,
      optionKey: entry.key,
      svg: entry.svg,
      label: entry.title,
      hint: entry.title,
      ariaLabel: entry.title,
      selected: selectedBrandKey === entry.key,
      disabled: disabled,
      onSelect: function onBrand() {
        selectIcon('brand', entry.key);
      },
    });
  }

  const vendorCells = vendorBrands.map(toBrandCell);
  const modelCells = modelBrands.map(toBrandCell);
  const vendorTitle = dshmlUiCopy('picker.vendors', 'Vendor icons');
  const modelTitle = dshmlUiCopy('picker.models', 'Model icons');
  const hasBrandMatches = vendorCells.length > 0 || modelCells.length > 0;

  return h(
    'div',
    {
      className: 'dshml-picker-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabIndex: -1,
      ref: dialogRef,
    },
    [
      h('div', { key: 'head', className: 'dshml-picker-head' }, headChildren),
      error !== '' ? h('p', { key: 'error', className: 'dshml-picker-error', role: 'alert' }, error) : null,
      unavailable === true
        ? h(
            'p',
            { key: 'notice', className: 'dshml-picker-notice', role: 'status' },
            dshmlUiCopy('picker.unavailable', 'Icon settings unavailable (host plugin not loaded)'),
          )
        : null,
      h('div', { key: 'search', className: 'dshml-picker-search-row' }, [
        h('input', {
          key: 'input',
          type: 'search',
          className: 'dshml-picker-search',
          placeholder: dshmlUiCopy('picker.search', 'Search icons'),
          'aria-label': dshmlUiCopy('picker.search', 'Search icons'),
          value: query,
          autoFocus: true,
          onChange: function onSearch(event: ChangeEvent<HTMLInputElement>) {
            setQuery(event.target.value);
          },
        }),
      ]),
      h('div', { key: 'body', className: 'dshml-picker-body' }, [
        h('div', { key: 'specials', className: 'dshml-picker-specials' }, specialOptions),
        vendorCells.length > 0
          ? h('h3', { key: 'vendor-title', className: 'dshml-picker-group-title' }, vendorTitle)
          : null,
        vendorCells.length > 0
          ? h(
              'div',
              {
                key: 'vendors',
                className: 'dshml-picker-grid',
                role: 'group',
                'aria-label': vendorTitle,
              },
              vendorCells,
            )
          : null,
        modelCells.length > 0
          ? h('h3', { key: 'model-title', className: 'dshml-picker-group-title' }, modelTitle)
          : null,
        modelCells.length > 0
          ? h(
              'div',
              {
                key: 'models',
                className: 'dshml-picker-grid',
                role: 'group',
                'aria-label': modelTitle,
              },
              modelCells,
            )
          : null,
        hasBrandMatches === false
          ? h(
              'p',
              { key: 'no-brand', className: 'dshml-picker-empty' },
              dshmlUiCopy('picker.noMatch', 'No matching icons'),
            )
          : null,
      ]),
    ],
  );
}

/** Options accepted by {@link dshmlOpenIconPicker}. */
export interface IconPickerOptions {
  /** Provider route id. */
  providerId: string;
  /** Model id. */
  modelId: string;
  /** Catalog display name shown in the modal subtitle. */
  displayName?: string | null;
  /** Element focus is restored to when the modal closes. */
  anchor?: Element | null;
  /** Called after a successful write, before the modal closes. */
  onChanged?: (() => void) | undefined;
}

/**
 * Open the centered icon picker for one provider+model pair.
 * @param options - provider/model identity, optional display name, focus anchor
 *   and a change callback.
 * @returns close function (idempotent; also restores focus).
 */
export function dshmlOpenIconPicker(options: IconPickerOptions | null): () => void {
  const noop = function noopPicker() {};
  if (typeof document === 'undefined') return noop;
  if (options === null || typeof options !== 'object') return noop;
  const providerId = typeof options.providerId === 'string' ? options.providerId.trim() : '';
  const modelId = typeof options.modelId === 'string' ? options.modelId.trim() : '';
  if (providerId === '' || modelId === '') return noop;
  const createRoot = getCreateRoot();
  if (createRoot === null) return noop;

  if (dshmlPickerOpenClose !== null) {
    const previousClose = dshmlPickerOpenClose;
    try {
      previousClose();
    } catch {
      /* the old instance is already gone */
    }
  }

  const previouslyFocused = document.activeElement;
  let anchor: HTMLElement | null = dshmlUiFocusTarget(options.anchor);
  if (anchor === null) anchor = dshmlUiFocusTarget(previouslyFocused);

  const container = document.createElement('div');
  container.className = 'dshml-picker-layer';
  container.setAttribute('data-dshml-picker', '');
  document.body.appendChild(container);

  const root = createRoot(container);
  let closed = false;

  function restoreFocus() {
    if (anchor === null) return;
    try {
      if (anchor.isConnected === false) return;
      anchor.focus();
    } catch {
      /* focus restore is best-effort */
    }
  }

  function close() {
    if (closed === true) return;
    closed = true;
    if (dshmlPickerOpenClose === close) dshmlPickerOpenClose = null;
    try {
      root.unmount();
    } catch {
      /* the root may already be torn down */
    }
    if (container.parentNode !== null) container.parentNode.removeChild(container);
    restoreFocus();
  }

  function onLayerClick(event: MouseEvent) {
    if (event.target === container) close();
  }

  dshmlPickerOpenClose = close;
  container.addEventListener('click', onLayerClick);

  try {
    root.render(
      h(DshmlIconPickerApp, {
        providerId: providerId,
        modelId: modelId,
        displayName: typeof options.displayName === 'string' ? options.displayName : '',
        onChanged: options.onChanged,
        onClose: close,
      }),
    );
  } catch {
    close();
    return noop;
  }

  return close;
}

/** The element to focus, or null when it has no `focus()` method. */
function dshmlUiFocusTarget(value: unknown): HTMLElement | null {
  if (value === null || value === undefined) return null;
  const candidate = value as { focus?: unknown };
  return typeof candidate.focus === 'function' ? (value as HTMLElement) : null;
}
