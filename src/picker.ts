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
import type { BrandLogo, IconScope, IconState, VendorMark } from './types';
import { dshmlBrandName, dshmlBrandNameAliases, dshmlT } from './i18n';
import { letterTile } from './artwork';
import { LOGOS, filterLogoGroups, groupLogoEntries } from './logos';
import { LOGO_RANKS } from './logos/ranking';
import type { GroupedLogoEntry, LogoGroups } from './logos/groups';
import {
  DSHML_CUSTOM_MAX_ICONS,
  dshmlCustomIconIdOf,
  dshmlCustomIconList,
  dshmlCustomIconsOf,
  dshmlCustomMarkFor,
  dshmlCustomMarkSvg,
} from './custom-icons';
import { DshmlCustomIconEditor } from './custom-icon-editor';
import type { DshmlCustomIconEditorMode } from './custom-icon-editor';
import {
  dshmlClearModelIcon,
  dshmlClearProviderIcon,
  dshmlIconState,
  dshmlLetterTextFor,
  dshmlProviderLetterTextFor,
  dshmlResolveFor,
  dshmlSetModelIcon,
  dshmlSetProviderIcon,
  dshmlUseIconState,
  dshmlVendorMark,
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
  /** User-created icon id (`custom:<id>` sentinel), or null. */
  custom: string | null;
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
  return { status: 'loading', overrides: {}, providerOverrides: {}, customIcons: {}, writable: false, error: '' };
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
 * The flat provider override map inside an icon-store state, when it is an object.
 * @param state - icon-store state (defensively treated as unknown).
 */
export function dshmlUiProviderOverrides(state: unknown): Record<string, unknown> | null {
  if (state === null || typeof state !== 'object') return null;
  const overrides = (state as { providerOverrides?: unknown }).providerOverrides;
  return overrides !== null && typeof overrides === 'object' ? (overrides as Record<string, unknown>) : null;
}

/**
 * The stored model override value of one pair, or null when unset.
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
 * The stored provider override value, or null when unset.
 * @param overrides - validated provider override map (defensively unknown).
 * @param providerId - provider route id.
 * @returns `'none'`, `'letter'`, a brand key, or null.
 */
export function dshmlUiProviderOverrideValue(overrides: unknown, providerId: string): string | null {
  if (overrides === null || typeof overrides !== 'object') return null;
  try {
    const value = (overrides as Record<string, unknown>)[providerId];
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
      const candidate = result as {
        key?: unknown;
        source?: unknown;
        disabled?: unknown;
        letter?: unknown;
        custom?: unknown;
      };
      return {
        key: typeof candidate.key === 'string' && candidate.key !== '' ? candidate.key : null,
        source: typeof candidate.source === 'string' ? candidate.source : 'none',
        disabled: candidate.disabled === true,
        letter: candidate.letter === true,
        custom: typeof candidate.custom === 'string' && candidate.custom !== '' ? candidate.custom : null,
      };
    }
  } catch {
    /* fall through */
  }
  return { key: null, source: 'none', disabled: false, letter: false, custom: null };
}

/** One normalized, sorted custom icon from the icon store. */
export interface DshmlUiCustomIcon {
  id: string;
  name: string;
  image: string;
}

/**
 * Every stored custom icon, validated and sorted by creation time.
 * @param state - icon-store state (defensively treated as unknown).
 */
export function dshmlUiCustomIcons(state: unknown): DshmlUiCustomIcon[] {
  const raw =
    state !== null && typeof state === 'object' ? (state as { customIcons?: unknown }).customIcons : undefined;
  return dshmlCustomIconList(dshmlCustomIconsOf(raw)).map(function toView(icon) {
    return { id: icon.id, name: icon.name, image: icon.image };
  });
}

/**
 * One stored custom icon by id, `custom:<id>` sentinel or bare id.
 * @param state - icon-store state (defensively treated as unknown).
 * @param value - id or `custom:<id>` override value.
 */
export function dshmlUiCustomIcon(state: unknown, value: unknown): DshmlUiCustomIcon | null {
  const raw =
    state !== null && typeof state === 'object' ? (state as { customIcons?: unknown }).customIcons : undefined;
  const icons = dshmlCustomIconsOf(raw);
  const id = dshmlCustomIconIdOf(value) ?? (typeof value === 'string' ? value : null);
  if (id === null || !Object.prototype.hasOwnProperty.call(icons, id)) return null;
  const icon = icons[id];
  return icon !== undefined ? { id: icon.id, name: icon.name, image: icon.image } : null;
}

/**
 * The inline SVG tile a stored custom icon renders as, or null when the id is
 * unknown (e.g. a reference left behind by a hand-edited settings document).
 * @param state - icon-store state (defensively treated as unknown).
 * @param value - id or `custom:<id>` override value.
 */
export function dshmlUiCustomMark(state: unknown, value: unknown): DshmlUiLetterTile | null {
  const raw =
    state !== null && typeof state === 'object' ? (state as { customIcons?: unknown }).customIcons : undefined;
  return dshmlCustomMarkFor(dshmlCustomIconsOf(raw), value);
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

/**
 * The letter tile a provider seat previews (display name → route id), or null.
 * @param providerId - provider route id.
 * @param displayName - directory display name.
 */
export function dshmlUiProviderLetterTile(providerId: string, displayName?: string | null): DshmlUiLetterTile | null {
  let text = typeof displayName === 'string' ? displayName.trim() : '';
  if (text === '') {
    try {
      const fallback: unknown = dshmlProviderLetterTextFor(providerId, displayName);
      if (typeof fallback === 'string' && fallback !== '') text = fallback;
    } catch {
      /* fall through to the local mirror */
    }
  }
  if (text === '') text = typeof providerId === 'string' && providerId !== '' ? providerId : '?';
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
 * Resolve one provider for rendering, normalizing whatever the store returned.
 * `allowFallback` mirrors the decorator's official/declared split: an official
 * channel may fall back to a letter tile, a hand-declared provider may not.
 * @param providerId - provider route id.
 * @param displayName - directory display name (letter-tile text).
 * @param allowFallback - enable the generated letter tile.
 */
export function dshmlUiResolveProvider(
  providerId: string,
  displayName?: string | null,
  allowFallback?: boolean,
): DshmlUiResolution {
  try {
    const result: VendorMark = dshmlVendorMark(providerId, displayName, allowFallback);
    const resolved: unknown = result !== null && typeof result === 'object' ? result.resolved : null;
    if (resolved !== null && typeof resolved === 'object') {
      const candidate = resolved as {
        key?: unknown;
        source?: unknown;
        disabled?: unknown;
        letter?: unknown;
        custom?: unknown;
      };
      return {
        key: typeof candidate.key === 'string' && candidate.key !== '' ? candidate.key : null,
        source: typeof candidate.source === 'string' ? candidate.source : 'none',
        disabled: candidate.disabled === true,
        letter: candidate.letter === true,
        custom: typeof candidate.custom === 'string' && candidate.custom !== '' ? candidate.custom : null,
      };
    }
  } catch {
    /* fall through */
  }
  return { key: null, source: 'none', disabled: false, letter: false, custom: null };
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
  /** `model` targets `modelIcons[provider][model]`, `provider` targets `providerIcons[provider]`. */
  scope: IconScope;
  providerId: string;
  /** Empty in provider scope: a provider has no model dimension. */
  modelId: string;
  displayName: string;
  /** Whether an unknown official channel may fall back to a letter tile. */
  fallback?: boolean;
  onChanged?: (() => void) | undefined;
  onClose: () => void;
}

/** The modal content. Receives already-validated ids from dshmlOpenIconPicker. */
function DshmlIconPickerApp(props: DshmlIconPickerAppProps): ReactElement {
  const scope: IconScope = props.scope === 'provider' ? 'provider' : 'model';
  const providerId = props.providerId;
  const modelId = props.modelId;
  const displayName = typeof props.displayName === 'string' ? props.displayName : '';

  const state = dshmlUiUseIconState();
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [editor, setEditor] = React.useState<{ mode: DshmlCustomIconEditorMode; id: string | null } | null>(null);
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
          if (editor !== null) setEditor(null);
          else props.onClose();
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
    [props.onClose, editor],
  );

  const overrides = dshmlUiOverrides(state);
  const providerOverrides = dshmlUiProviderOverrides(state);
  const rawOverride =
    scope === 'provider'
      ? dshmlUiProviderOverrideValue(providerOverrides, providerId)
      : dshmlUiOverrideValue(overrides, providerId, modelId);
  const resolved =
    scope === 'provider'
      ? dshmlUiResolveProvider(providerId, displayName, props.fallback === true)
      : dshmlUiResolve(providerId, modelId, displayName);
  const unavailable = state.status === 'unavailable';
  const letterTileEntry =
    scope === 'provider'
      ? dshmlUiProviderLetterTile(providerId, displayName)
      : dshmlUiLetterTile(providerId, modelId, displayName);

  const customIcons = dshmlUiCustomIcons(state);
  const selectedCustomId = dshmlCustomIconIdOf(rawOverride);
  const isAuto = rawOverride === null && resolved.letter !== true;
  const isNone = rawOverride === 'none';
  const isLetter = rawOverride === DSHML_LETTER_ICON || resolved.letter === true;
  const selectedBrandKey =
    rawOverride !== null && rawOverride !== 'none' && rawOverride !== DSHML_LETTER_ICON && selectedCustomId === null
      ? rawOverride
      : null;

  let autoSvg = DSHML_PICKER_AUTO_SVG;
  if (isAuto && resolved.key !== null) {
    const autoLogo = dshmlUiLogo(resolved.key);
    if (autoLogo !== null) autoSvg = autoLogo.svg;
  }
  const letterSvg = letterTileEntry !== null ? letterTileEntry.svg : DSHML_PICKER_AUTO_SVG;

  const allGroups = dshmlUiBrandGroups();
  const filteredGroups = filterLogoGroups(allGroups, query, function brandAliases(entry) {
    return dshmlBrandNameAliases(entry.key);
  });
  const vendorBrands = filteredGroups.vendor;
  const modelBrands = filteredGroups.model;

  function explainWriteFailure(): string {
    const message = dshmlUiCurrentError();
    return message !== '' ? message : dshmlUiCopy('picker.saveFailed', 'Could not save — try again');
  }

  function selectIcon(kind: 'auto' | 'none' | 'letter' | 'brand' | 'custom', optionKey: string | null): void {
    if (busy === true) return;
    if (unavailable === true) {
      setError(dshmlUiCopy('picker.unavailable', 'Icon settings unavailable (host plugin not loaded)'));
      return;
    }
    setError('');
    setBusy(true);
    let write: Promise<boolean>;
    try {
      const value =
        kind === 'none'
          ? 'none'
          : kind === 'letter'
            ? DSHML_LETTER_ICON
            : kind === 'custom'
              ? optionKey !== null
                ? 'custom:' + optionKey
                : ''
              : (optionKey ?? '');
      if (scope === 'provider') {
        if (kind === 'auto') write = dshmlClearProviderIcon(providerId);
        else write = dshmlSetProviderIcon(providerId, value);
      } else if (kind === 'auto') {
        write = dshmlClearModelIcon(providerId, modelId);
      } else {
        write = dshmlSetModelIcon(providerId, modelId, value);
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

  // Provider scope names the channel once; model scope keeps the pair subtitle.
  const subtitleParts: Array<ReactElement | null> = [
    displayName !== '' ? h('span', { key: 'name', className: 'dshml-picker-subtitle-name' }, displayName) : null,
    displayName !== '' ? h('span', { key: 'sep1', className: 'dshml-picker-subtitle-sep' }, '·') : null,
    h('span', { key: 'provider' }, providerId),
  ];
  if (scope === 'model') {
    subtitleParts.push(h('span', { key: 'sep2', className: 'dshml-picker-subtitle-sep' }, '·'));
    subtitleParts.push(h('span', { key: 'model' }, modelId));
  }
  const subtitleChildren = subtitleParts.filter(function present(child) {
    return child !== null;
  });

  const editing = editor !== null;
  const dialogTitle = editing
    ? editor !== null && editor.mode === 'rename'
      ? dshmlUiCopy('picker.editCustomTitle', 'Rename custom icon')
      : dshmlUiCopy('picker.createCustom', 'Create custom icon')
    : scope === 'provider'
      ? dshmlUiCopy('picker.providerTitle', 'Choose vendor icon')
      : dshmlUiCopy('picker.title', 'Choose model icon');
  const backButton = editing
    ? h(
        'button',
        {
          key: 'back',
          type: 'button',
          className: 'dshml-picker-back',
          'aria-label': dshmlUiCopy('picker.back', 'Back'),
          title: dshmlUiCopy('picker.back', 'Back'),
          onClick: function onBack() {
            setEditor(null);
          },
        },
        h(
          'svg',
          {
            className: 'dshml-picker-back-icon',
            viewBox: '0 0 24 24',
            width: 16,
            height: 16,
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
          },
          h('path', {
            d: 'M15 5l-7 7 7 7',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      )
    : null;

  const headChildren: Array<ReactElement | null> = [
    backButton,
    h('div', { key: 'heading', className: 'dshml-picker-heading' }, [
      h('h2', { key: 'title', className: 'dshml-picker-title', id: titleId }, dialogTitle),
      editing ? null : h('div', { key: 'subtitle', className: 'dshml-picker-subtitle' }, subtitleChildren),
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
      // The close mark is drawn, never typed: a text `×` follows the user's system
      // font, so its ink size and position drift away from the 28 px hit-area
      // centre. The 16 px glyph is a flex item of the button, which centres it.
      h(
        'svg',
        {
          className: 'dshml-picker-close-icon',
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          focusable: 'false',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M18 6 6 18M6 6l12 12',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
        }),
      ),
    ),
  ];

  const specialOptions = [
    h(DshmlPickerOption, {
      key: 'auto',
      optionKey: 'auto',
      svg: autoSvg,
      label: dshmlUiCopy('picker.auto', 'Auto'),
      hint:
        scope === 'provider'
          ? dshmlUiCopy('picker.autoProviderHint', 'Matched from the official channel')
          : dshmlUiCopy('picker.autoHint', 'Matched from the model name'),
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
      hint:
        scope === 'provider'
          ? dshmlUiCopy('picker.letterProviderHint', 'Generated from the provider name')
          : dshmlUiCopy('picker.letterHint', 'Generated from the model name'),
      ariaLabel: dshmlUiCopy('picker.letter', 'Letter icon'),
      selected: isLetter,
      disabled: disabled,
      onSelect: function onLetter() {
        selectIcon('letter', null);
      },
    }),
  ];

  function toBrandCell(entry: DshmlUiLogoEntry): ReactElement {
    // The cell shows the brand's official name in the active language; the
    // artwork title is the English fallback and the option key never changes.
    const brandTitle = dshmlBrandName(entry.key, entry.title);
    return h(DshmlPickerOption, {
      key: 'brand-' + entry.key,
      optionKey: entry.key,
      svg: entry.svg,
      label: brandTitle,
      hint: brandTitle,
      ariaLabel: brandTitle,
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

  // User-created icons: always reachable through the trailing "+" cell, and
  // filtered by name while the search box has text (the create cell is a
  // browse action, so it hides during a search).
  const customTitle = dshmlUiCopy('picker.custom', 'Custom icons');
  const customQuery = query.trim().toLowerCase();
  const customMatches =
    customQuery === ''
      ? customIcons
      : customIcons.filter(function matchesCustom(icon) {
          return (
            icon.name.toLowerCase().indexOf(customQuery) !== -1 || icon.id.toLowerCase().indexOf(customQuery) !== -1
          );
        });
  const customCells = customMatches.map(function toCustomCell(icon): ReactElement {
    const optionKey = 'custom:' + icon.id;
    return h('div', { key: 'custom-' + icon.id, className: 'dshml-picker-custom-cell' }, [
      h(DshmlPickerOption, {
        key: 'option',
        optionKey: optionKey,
        svg: dshmlCustomMarkSvg(icon),
        label: icon.name,
        hint: icon.name,
        ariaLabel: icon.name,
        selected: selectedCustomId === icon.id,
        disabled: disabled,
        onSelect: function onCustom() {
          selectIcon('custom', icon.id);
        },
      }),
      h(
        'button',
        {
          key: 'edit',
          type: 'button',
          className: 'dshml-picker-custom-edit',
          'aria-label': dshmlUiCopy('picker.editCustom', 'Rename') + ' ' + icon.name,
          title: dshmlUiCopy('picker.editCustom', 'Rename'),
          disabled: disabled,
          onClick: function onEdit(event: { stopPropagation: () => void }) {
            event.stopPropagation();
            setEditor({ mode: 'rename', id: icon.id });
          },
        },
        // Pencil glyph; 12px inside the 18px hit area.
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M4 20h4L19 9l-4-4L4 16v4Z',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinejoin: 'round',
          }),
        ),
      ),
    ]);
  });
  const createCell =
    customQuery === '' && customIcons.length < DSHML_CUSTOM_MAX_ICONS
      ? h(
          'button',
          {
            key: 'custom-create',
            type: 'button',
            className: 'dshml-picker-create',
            'aria-label': dshmlUiCopy('picker.createCustom', 'Create custom icon'),
            title: dshmlUiCopy('picker.createHint', 'Upload an image and crop it to a square icon'),
            disabled: disabled,
            onClick: function onCreate() {
              setEditor({ mode: 'create', id: null });
            },
          },
          [
            h(
              'svg',
              {
                key: 'plus',
                className: 'dshml-picker-create-icon',
                viewBox: '0 0 24 24',
                width: 22,
                height: 22,
                fill: 'none',
                'aria-hidden': 'true',
              },
              h('path', {
                d: 'M12 5v14M5 12h14',
                stroke: 'currentColor',
                strokeWidth: 1.8,
                strokeLinecap: 'round',
              }),
            ),
            h(
              'span',
              { key: 'label', className: 'dshml-picker-create-label' },
              dshmlUiCopy('picker.createShort', 'New'),
            ),
          ],
        )
      : null;

  const editorId = editor !== null ? editor.id : null;
  const editorTarget =
    editorId !== null
      ? (customIcons.find(function byEditorId(icon) {
          return icon.id === editorId;
        }) ?? null)
      : null;
  const editorBody =
    editing && editor !== null
      ? h(
          'div',
          { key: 'editor', className: 'dshml-picker-body dshml-picker-editor-body' },
          h(DshmlCustomIconEditor, {
            mode: editor.mode,
            icon: editorTarget !== null ? { id: editorTarget.id, name: editorTarget.name } : null,
            apply: { scope: scope, providerId: providerId, modelId: modelId },
            onCancel: function onCancelEditor() {
              setEditor(null);
            },
            onDone: function onEditorDone(result: 'created' | 'renamed' | 'deleted') {
              if (result === 'created') {
                if (typeof props.onChanged === 'function') {
                  try {
                    props.onChanged();
                  } catch {
                    /* a failing callback must not keep the modal open */
                  }
                }
                props.onClose();
                return;
              }
              // Rename/delete keep the picker open so the updated group is visible.
              setEditor(null);
            },
          }),
        )
      : null;

  const showCustomGroup = customCells.length > 0 || createCell !== null;
  const bodyChildren: Array<ReactElement | null> = [
    h('div', { key: 'specials', className: 'dshml-picker-specials' }, specialOptions),
    showCustomGroup ? h('h3', { key: 'custom-title', className: 'dshml-picker-group-title' }, customTitle) : null,
    showCustomGroup
      ? h(
          'div',
          {
            key: 'customs',
            className: 'dshml-picker-grid dshml-picker-custom-grid',
            role: 'group',
            'aria-label': customTitle,
          },
          createCell !== null ? [...customCells, createCell] : customCells,
        )
      : null,
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
    modelCells.length > 0 ? h('h3', { key: 'model-title', className: 'dshml-picker-group-title' }, modelTitle) : null,
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
    hasBrandMatches === false && customCells.length === 0
      ? h('p', { key: 'no-brand', className: 'dshml-picker-empty' }, dshmlUiCopy('picker.noMatch', 'No matching icons'))
      : null,
  ];

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
      !editing && error !== '' ? h('p', { key: 'error', className: 'dshml-picker-error', role: 'alert' }, error) : null,
      !editing && unavailable === true
        ? h(
            'p',
            { key: 'notice', className: 'dshml-picker-notice', role: 'status' },
            dshmlUiCopy('picker.unavailable', 'Icon settings unavailable (host plugin not loaded)'),
          )
        : null,
      editing
        ? editorBody
        : h('div', { key: 'search', className: 'dshml-picker-search-row' }, [
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
      editing ? null : h('div', { key: 'body', className: 'dshml-picker-body' }, bodyChildren),
    ],
  );
}

/** Options accepted by {@link dshmlOpenIconPicker}. */
export interface IconPickerOptions {
  /** Which override document the picker edits. Defaults to `model`. */
  scope?: IconScope;
  /** Provider route id. */
  providerId: string;
  /** Model id; optional (and ignored) in `provider` scope. */
  modelId?: string | null;
  /** Catalog display name shown in the modal subtitle. */
  displayName?: string | null;
  /** Element focus is restored to when the modal closes. */
  anchor?: Element | null;
  /** Called after a successful write, before the modal closes. */
  onChanged?: (() => void) | undefined;
  /** Provider scope only: an unknown official channel may use a letter tile. */
  fallback?: boolean;
}

/**
 * Open the centered icon picker for one provider+model pair, or for one provider.
 * @param options - scope, provider/model identity, optional display name, focus
 *   anchor and a change callback.
 * @returns close function (idempotent; also restores focus).
 */
export function dshmlOpenIconPicker(options: IconPickerOptions | null): () => void {
  const noop = function noopPicker() {};
  if (typeof document === 'undefined') return noop;
  if (options === null || typeof options !== 'object') return noop;
  const scope: IconScope = options.scope === 'provider' ? 'provider' : 'model';
  const providerId = typeof options.providerId === 'string' ? options.providerId.trim() : '';
  const modelId = typeof options.modelId === 'string' ? options.modelId.trim() : '';
  if (providerId === '') return noop;
  if (scope === 'model' && modelId === '') return noop;
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
        scope: scope,
        providerId: providerId,
        modelId: modelId,
        displayName: typeof options.displayName === 'string' ? options.displayName : '',
        fallback: options.fallback === true,
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
