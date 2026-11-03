/**
 * Icon picker modal for the model-logos plugin.
 *
 * Fragment (no imports/require): `scripts/build-client.mjs` concatenates this
 * file into the browser module factory after `src/i18n.js` and
 * `src/overrides.js`, so the following names are in scope and must not be
 * redefined here: `React`, `h`, `createRoot`, `LOGOS`, `letterTile`, `dshmlT`,
 * `dshmlLang`, `dshmlIconState`, `dshmlSubscribeIconState`,
 * `dshmlUseIconState`, `dshmlResolveFor`, `dshmlLetterTextFor`,
 * `dshmlSetModelIcon`, `dshmlClearModelIcon`, `dshmlUseModelCatalog`.
 *
 * This file also carries the small DOM-free helpers that `src/section.js`
 * reuses (`dshmlUiCopy`, `dshmlUiOverrideValue`, `dshmlUiResolve`,
 * `dshmlUiLetterTile`, `dshmlUiBrandOptions`, `dshmlUiLogo`, the letter-icon
 * literal and the two placeholder SVGs). Function declarations hoist across
 * the concatenated factory, so `section.js` can call them safely.
 *
 * Only one picker may be mounted at a time; opening a second one closes the
 * first. The modal lives in its own `react-dom/client` root inside a plain
 * `document.body` child, never inside the React tree of the caller.
 */

/** Persisted override value meaning "render a deterministic letter tile". */
const DSHML_LETTER_ICON = 'letter';

/** Neutral "let the heuristic decide" mark (sparkle in a rounded square). */
const DSHML_PICKER_AUTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="1.2" y="1.2" width="21.6" height="21.6" rx="6.2" fill="none" stroke="#98a1b0" stroke-width="1.3" stroke-dasharray="3 2.4"/>' +
  '<path d="M12 5.4l1.85 4.75L18.6 12l-4.75 1.85L12 18.6l-1.85-4.75L5.4 12l4.75-1.85z" fill="#8a93a3"/>' +
  '</svg>';

/** "No icon" mark (crossed circle). */
const DSHML_PICKER_NONE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#98a1b0" stroke-width="1.4"/>' +
  '<path d="M6.1 17.9 17.9 6.1" fill="none" stroke="#98a1b0" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';

/** Unique dialog title ids for aria-labelledby. */
let dshmlPickerSerial = 0;

/** The currently mounted picker's close function, or null. */
let dshmlPickerOpenClose = null;

/** Lazily built, sorted brand option list (LOGOS never changes after load). */
let dshmlUiBrandCache = null;

/**
 * `dshmlT` lookup that degrades to an English fallback instead of showing a raw
 * dictionary key when i18n is missing an entry.
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function dshmlUiCopy(key, fallback) {
  try {
    if (typeof dshmlT === 'function') {
      const value = dshmlT(key);
      if (typeof value === 'string' && value !== '' && value !== key) return value;
    }
  } catch (error) {
    /* fall through to the literal */
  }
  return fallback;
}

/** @returns {{ status: string, overrides: any, writable: boolean, error: string }} */
function dshmlUiFallbackState() {
  return { status: 'loading', overrides: null, writable: false, error: '' };
}

/** @returns {{ status: string, overrides: any, writable: boolean, error: string }} */
function dshmlUiState() {
  try {
    if (typeof dshmlIconState === 'function') {
      const state = dshmlIconState();
      if (state !== null && typeof state === 'object') return state;
    }
  } catch (error) {
    /* fall through */
  }
  return dshmlUiFallbackState();
}

/** Latest store error message, or '' — used to explain a failed write. */
function dshmlUiCurrentError() {
  const state = dshmlUiState();
  return typeof state.error === 'string' ? state.error : '';
}

/**
 * @param {any} state icon-store state
 * @returns {Record<string, Record<string, string>> | null}
 */
function dshmlUiOverrides(state) {
  if (state === null || typeof state !== 'object') return null;
  const overrides = state.overrides;
  return overrides !== null && typeof overrides === 'object' ? overrides : null;
}

/**
 * @param {Record<string, any> | null} overrides
 * @param {string} providerId
 * @param {string} modelId
 * @returns {string | null} stored override value (`'none'` / `'letter'` / brand key)
 */
function dshmlUiOverrideValue(overrides, providerId, modelId) {
  if (overrides === null || typeof overrides !== 'object') return null;
  try {
    const bucket = overrides[providerId];
    if (bucket === null || typeof bucket !== 'object') return null;
    const value = bucket[modelId];
    return typeof value === 'string' && value !== '' ? value : null;
  } catch (error) {
    return null;
  }
}

/**
 * @param {string} key
 * @returns {{ key: string, title: string, svg: string } | null}
 */
function dshmlUiLogo(key) {
  if (typeof key !== 'string' || key === '') return null;
  try {
    if (typeof LOGOS !== 'object' || LOGOS === null) return null;
    const entry = LOGOS[key];
    if (entry === null || typeof entry !== 'object') return null;
    if (typeof entry.svg !== 'string' || entry.svg === '') return null;
    return {
      key: key,
      title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : key,
      svg: entry.svg,
    };
  } catch (error) {
    return null;
  }
}

/** All selectable brand marks, sorted by title, built once. */
function dshmlUiBrandOptions() {
  if (dshmlUiBrandCache !== null) return dshmlUiBrandCache;
  const options = [];
  try {
    if (typeof LOGOS === 'object' && LOGOS !== null) {
      for (const key of Object.keys(LOGOS)) {
        const entry = dshmlUiLogo(key);
        if (entry !== null) options.push(entry);
      }
    }
  } catch (error) {
    /* keep whatever was collected */
  }
  options.sort(function byTitle(a, b) {
    return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  });
  dshmlUiBrandCache = options;
  return options;
}

/**
 * Letter text exactly as the picker previews it: model name → model id →
 * provider id → '?'. Delegates to `dshmlLetterTextFor` when present.
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} modelName
 * @returns {string}
 */
function dshmlUiLetterText(providerId, modelId, modelName) {
  try {
    if (typeof dshmlLetterTextFor === 'function') {
      const text = dshmlLetterTextFor(
        { id: providerId, name: '' },
        { id: modelId, name: typeof modelName === 'string' ? modelName : '' },
      );
      if (typeof text === 'string' && text !== '') return text;
    }
  } catch (error) {
    /* fall through to the local mirror */
  }
  const name = typeof modelName === 'string' ? modelName.trim() : '';
  if (name !== '') return name;
  if (typeof modelId === 'string' && modelId.trim() !== '') return modelId;
  if (typeof providerId === 'string' && providerId.trim() !== '') return providerId;
  return '?';
}

/**
 * @returns {{ title: string, svg: string } | null}
 */
function dshmlUiLetterTile(providerId, modelId, modelName) {
  const text = dshmlUiLetterText(providerId, modelId, modelName);
  try {
    if (typeof letterTile === 'function') {
      const tile = letterTile(text);
      if (tile !== null && typeof tile === 'object' && typeof tile.svg === 'string' && tile.svg !== '') {
        return {
          title: typeof tile.title === 'string' && tile.title !== '' ? tile.title : text,
          svg: tile.svg,
        };
      }
    }
  } catch (error) {
    /* fall through */
  }
  return null;
}

/**
 * @returns {{ key: string | null, source: string, disabled: boolean, letter: boolean }}
 */
function dshmlUiResolve(providerId, modelId, modelName) {
  try {
    if (typeof dshmlResolveFor === 'function') {
      const result = dshmlResolveFor(
        { id: providerId, name: '' },
        { id: modelId, name: typeof modelName === 'string' ? modelName : '' },
      );
      if (result !== null && typeof result === 'object') {
        return {
          key: typeof result.key === 'string' && result.key !== '' ? result.key : null,
          source: typeof result.source === 'string' ? result.source : 'none',
          disabled: result.disabled === true,
          letter: result.letter === true,
        };
      }
    }
  } catch (error) {
    /* fall through */
  }
  return { key: null, source: 'none', disabled: false, letter: false };
}

/** Wrapper around a possibly-missing hook so a broken store renders a state. */
function dshmlUiUseIconState() {
  try {
    if (typeof dshmlUseIconState === 'function') {
      const state = dshmlUseIconState();
      if (state !== null && typeof state === 'object') return state;
    }
  } catch (error) {
    /* fall through */
  }
  return dshmlUiFallbackState();
}

/**
 * One grid cell: a sticky-current option with its mark and label.
 * @param {any} props
 */
function DshmlPickerOption(props) {
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

/**
 * The modal content. Receives already-validated ids from dshmlOpenIconPicker.
 * @param {any} props
 */
function DshmlIconPickerApp(props) {
  const providerId = props.providerId;
  const modelId = props.modelId;
  const displayName = typeof props.displayName === 'string' ? props.displayName : '';

  const state = dshmlUiUseIconState();
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const dialogRef = React.useRef(null);
  const titleIdRef = React.useRef(null);
  if (titleIdRef.current === null) {
    dshmlPickerSerial += 1;
    titleIdRef.current = 'dshml-picker-title-' + dshmlPickerSerial;
  }

  React.useEffect(function trapKeys() {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null || typeof dialog.querySelectorAll !== 'function') return;
      const nodes = dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
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
  }, [props.onClose]);

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
  const letterSvg =
    letterTileEntry !== null ? letterTileEntry.svg : DSHML_PICKER_AUTO_SVG;

  const allBrands = dshmlUiBrandOptions();
  const normalizedQuery = query.trim().toLowerCase();
  const brands =
    normalizedQuery === ''
      ? allBrands
      : allBrands.filter(function matchesBrand(entry) {
          return (
            entry.key.toLowerCase().indexOf(normalizedQuery) !== -1 ||
            entry.title.toLowerCase().indexOf(normalizedQuery) !== -1
          );
        });

  function explainWriteFailure() {
    const message = dshmlUiCurrentError();
    return message !== '' ? message : dshmlUiCopy('picker.saveFailed', 'Could not save — try again');
  }

  function selectIcon(kind, brandKey) {
    if (busy === true) return;
    if (unavailable === true) {
      setError(dshmlUiCopy('picker.unavailable', 'Icon settings unavailable (host plugin not loaded)'));
      return;
    }
    setError('');
    setBusy(true);
    let write;
    try {
      if (kind === 'auto') {
        if (typeof dshmlClearModelIcon !== 'function') {
          throw new Error('dshmlClearModelIcon is unavailable');
        }
        write = dshmlClearModelIcon(providerId, modelId);
      } else {
        if (typeof dshmlSetModelIcon !== 'function') {
          throw new Error('dshmlSetModelIcon is unavailable');
        }
        const value = kind === 'none' ? 'none' : kind === 'letter' ? DSHML_LETTER_ICON : brandKey;
        write = dshmlSetModelIcon(providerId, modelId, value);
      }
    } catch (error) {
      write = Promise.reject(error);
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
          } catch (callbackError) {
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

  const headChildren = [
    h('div', { key: 'heading', className: 'dshml-picker-heading' }, [
      h('h2', { key: 'title', className: 'dshml-picker-title', id: titleIdRef.current }, dshmlUiCopy('picker.title', 'Choose model icon')),
      h('div', { key: 'subtitle', className: 'dshml-picker-subtitle' }, [
        displayName !== ''
          ? h('span', { key: 'name', className: 'dshml-picker-subtitle-name' }, displayName)
          : null,
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

  const brandCells = brands.map(function toCell(entry) {
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
  });

  return h(
    'div',
    {
      className: 'dshml-picker-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleIdRef.current,
      tabIndex: -1,
      ref: dialogRef,
    },
    [
      h('div', { key: 'head', className: 'dshml-picker-head' }, headChildren),
      error !== ''
        ? h('p', { key: 'error', className: 'dshml-picker-error', role: 'alert' }, error)
        : null,
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
          onChange: function onSearch(event) {
            setQuery(event.target.value);
          },
        }),
      ]),
      h('div', { key: 'body', className: 'dshml-picker-body' }, [
        h('div', { key: 'specials', className: 'dshml-picker-specials' }, specialOptions),
        h('h3', { key: 'brand-title', className: 'dshml-picker-group-title' }, dshmlUiCopy('picker.brands', 'Brand marks')),
        brandCells.length > 0
          ? h('div', { key: 'brands', className: 'dshml-picker-grid' }, brandCells)
          : h(
              'p',
              { key: 'no-brand', className: 'dshml-picker-empty' },
              dshmlUiCopy('picker.noMatch', 'No matching icons'),
            ),
      ]),
    ],
  );
}

/**
 * Open the centered icon picker for one provider+model pair.
 *
 * @param {{ providerId: string, modelId: string, displayName?: string, anchor?: Element | null, onChanged?: () => void }} options
 * @returns {() => void} close function (idempotent; also restores focus)
 */
function dshmlOpenIconPicker(options) {
  const noop = function noopPicker() {};
  if (typeof document === 'undefined') return noop;
  if (options === null || typeof options !== 'object') return noop;
  const providerId = typeof options.providerId === 'string' ? options.providerId.trim() : '';
  const modelId = typeof options.modelId === 'string' ? options.modelId.trim() : '';
  if (providerId === '' || modelId === '') return noop;
  if (typeof createRoot !== 'function') return noop;

  if (dshmlPickerOpenClose !== null) {
    const previousClose = dshmlPickerOpenClose;
    try {
      previousClose();
    } catch (error) {
      /* the old instance is already gone */
    }
  }

  const previouslyFocused = document.activeElement;
  let anchor = null;
  const candidate = options.anchor;
  if (candidate !== null && candidate !== undefined && typeof candidate.focus === 'function') {
    anchor = candidate;
  } else if (previouslyFocused !== null && previouslyFocused !== undefined && typeof previouslyFocused.focus === 'function') {
    anchor = previouslyFocused;
  }

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
    } catch (error) {
      /* focus restore is best-effort */
    }
  }

  function close() {
    if (closed === true) return;
    closed = true;
    if (dshmlPickerOpenClose === close) dshmlPickerOpenClose = null;
    try {
      root.unmount();
    } catch (error) {
      /* the root may already be torn down */
    }
    if (container.parentNode !== null) container.parentNode.removeChild(container);
    restoreFocus();
  }

  function onLayerClick(event) {
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
  } catch (error) {
    close();
    return noop;
  }

  return close;
}
