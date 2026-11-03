/**
 * Settings → Model icons section for the model-logos plugin.
 *
 * Fragment (no imports/require): concatenated by `scripts/build-client.mjs`
 * after `src/i18n.js`, `src/overrides.js` and `src/picker.js`, inside the same
 * browser closure. It registers through `label.js` as the `settings.section`
 * contribution and reuses the helpers/constants declared in `picker.js`
 * (`dshmlUiCopy`, `dshmlUiOverrideValue`, `dshmlUiResolve`,
 * `dshmlUiLetterTile`, `dshmlUiLogo`, `DSHML_LETTER_ICON`,
 * `DSHML_PICKER_NONE_SVG`, `dshmlOpenIconPicker`) — function declarations hoist,
 * so the build order is not load-bearing.
 *
 * Resilience rules: every piece of catalog/override data is validated before
 * use; missing services or loading states render a notice/short state instead
 * of throwing; the component never writes outside its own React subtree.
 */

/** Localized copy with an English fallback (see `dshmlUiCopy` in picker.js). */
function dshmlSectionCopy(key, fallback) {
  return dshmlUiCopy(key, fallback);
}

/** Safe wrapper: a missing/broken catalog hook renders the loading state. */
function dshmlSectionUseCatalog() {
  try {
    if (typeof dshmlUseModelCatalog === 'function') {
      const catalog = dshmlUseModelCatalog();
      if (catalog !== null && typeof catalog === 'object') return catalog;
    }
  } catch (error) {
    /* fall through */
  }
  return { status: 'loading', providers: [] };
}

/**
 * Validate and normalize the catalog into `[{ providerId, displayName,
 * official, declared, models: [{ modelId, name }] }]`.
 * @param {any} catalog
 */
function dshmlSectionCatalogGroups(catalog) {
  const groups = [];
  const seen = Object.create(null);
  try {
    const providers =
      catalog !== null && typeof catalog === 'object' && Array.isArray(catalog.providers)
        ? catalog.providers
        : [];
    for (const provider of providers) {
      if (provider === null || typeof provider !== 'object') continue;
      const providerId = typeof provider.providerId === 'string' ? provider.providerId : '';
      if (providerId === '') continue;
      const models = [];
      const rawModels = Array.isArray(provider.models) ? provider.models : [];
      for (const model of rawModels) {
        if (model === null || typeof model !== 'object') continue;
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
          typeof provider.displayName === 'string' && provider.displayName !== ''
            ? provider.displayName
            : providerId,
        official: provider.official === true,
        declared: provider.declared === true,
        models: models,
      });
    }
  } catch (error) {
    /* keep the groups collected so far */
  }
  return groups;
}

/**
 * Override entries that are not part of the catalog, sorted for stable output.
 * @param {Record<string, any> | null} overrides
 * @param {Record<string, boolean>} catalogPairs
 * @returns {Array<{ providerId: string, modelId: string, value: string }>}
 */
function dshmlSectionManualRows(overrides, catalogPairs) {
  const rows = [];
  if (overrides === null || typeof overrides !== 'object') return rows;
  try {
    for (const providerId of Object.keys(overrides)) {
      const bucket = overrides[providerId];
      if (bucket === null || typeof bucket !== 'object') continue;
      for (const modelId of Object.keys(bucket)) {
        const value = bucket[modelId];
        if (typeof value !== 'string' || value === '') continue;
        if (catalogPairs[providerId + '\u0000' + modelId] === true) continue;
        rows.push({ providerId: providerId, modelId: modelId, value: value });
      }
    }
  } catch (error) {
    /* keep the rows collected so far */
  }
  rows.sort(function byPair(a, b) {
    return a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId);
  });
  return rows;
}

/**
 * Count every persisted override, catalogued or manual.
 * @param {Record<string, any> | null} overrides
 * @returns {number}
 */
function dshmlSectionCountOverrides(overrides) {
  let count = 0;
  if (overrides === null || typeof overrides !== 'object') return count;
  try {
    for (const providerId of Object.keys(overrides)) {
      const bucket = overrides[providerId];
      if (bucket === null || typeof bucket !== 'object') continue;
      for (const modelId of Object.keys(bucket)) {
        if (typeof bucket[modelId] === 'string' && bucket[modelId] !== '') count += 1;
      }
    }
  } catch (error) {
    /* keep the partial count */
  }
  return count;
}

/** `{n}` interpolation for the override summary line. */
function dshmlSectionOverrideSummary(count) {
  const template = dshmlSectionCopy('section.overrides', '{n} manual overrides');
  return template.split('{n}').join(String(count));
}

/**
 * One catalog / manual row: preview, names, current state chip and actions.
 * @param {any} props
 */
function DshmlSectionRow(props) {
  const providerId = typeof props.providerId === 'string' ? props.providerId : '';
  const modelId = typeof props.modelId === 'string' ? props.modelId : '';
  if (providerId === '' || modelId === '') return null;

  const modelName = typeof props.modelName === 'string' ? props.modelName : '';
  const providerName =
    typeof props.providerName === 'string' && props.providerName !== '' ? props.providerName : providerId;
  const raw = typeof props.override === 'string' && props.override !== '' ? props.override : null;
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
  } else if (resolved.key !== null) {
    const logo = dshmlUiLogo(resolved.key);
    if (logo !== null) svg = logo.svg;
    emptyMark = svg === '';
  } else {
    emptyMark = true;
  }

  let chipLabel;
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
    raw !== null ? dshmlSectionCopy('section.change', 'Change icon') : dshmlSectionCopy('section.choose', 'Choose icon');
  const displayName = modelName !== '' ? modelName : modelId;
  const busy = props.busy === true;

  const markProps = {
    key: 'mark',
    className: emptyMark === true ? 'dshml-section-mark dshml-section-mark-empty' : 'dshml-section-mark',
    'aria-hidden': 'true',
  };
  if (svg !== '') markProps.dangerouslySetInnerHTML = { __html: svg };
  const mark = svg !== '' ? h('span', markProps) : h('span', markProps, '\u2013');

  const textChildren = [
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

  const actionChildren = [
    h(
      'button',
      {
        key: 'choose',
        type: 'button',
        className: 'dshml-section-btn',
        disabled: busy,
        'aria-label': providerName + ' / ' + displayName + ' \u2014 ' + chooseLabel,
        onClick: function onChoose(event) {
          if (typeof props.onChoose === 'function') {
            props.onChoose(providerId, modelId, modelName, event.currentTarget);
          }
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
            if (typeof props.onReset === 'function') props.onReset(providerId, modelId);
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
 * The `settings.section` page: searchable list of catalog models with their
 * current icon, plus manual (providerId, modelId) overrides and a pair form.
 * @param {any} _props slot props (unused)
 */
function DshmlModelIconsSection(_props) {
  const iconState = dshmlUiUseIconState();
  const catalog = dshmlSectionUseCatalog();
  const [query, setQuery] = React.useState('');
  const [pending, setPending] = React.useState('');
  const [error, setError] = React.useState('');
  const [manualProvider, setManualProvider] = React.useState('');
  const [manualModel, setManualModel] = React.useState('');
  const [manualError, setManualError] = React.useState('');

  const overrides = dshmlUiOverrides(iconState);
  const groups = dshmlSectionCatalogGroups(catalog);
  const catalogPairs = Object.create(null);
  for (const group of groups) {
    for (const model of group.models) {
      catalogPairs[group.providerId + '\u0000' + model.modelId] = true;
    }
  }
  const manualRows = dshmlSectionManualRows(overrides, catalogPairs);
  const overrideCount = dshmlSectionCountOverrides(overrides);

  const normalizedQuery = query.trim().toLowerCase();
  function matchesQuery(text) {
    if (normalizedQuery === '') return true;
    return String(text).toLowerCase().indexOf(normalizedQuery) !== -1;
  }

  const filteredGroups = [];
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
  const hasFiltered = filteredGroups.length > 0 || filteredManual.length > 0;
  const loading = iconState.status === 'loading' || catalog.status === 'loading';
  const iconUnavailable = iconState.status === 'unavailable';
  const storeError = typeof iconState.error === 'string' ? iconState.error : '';
  const displayError = error !== '' ? error : storeError;

  function explainWriteFailure() {
    const message = dshmlUiCurrentError();
    return message !== '' ? message : dshmlSectionCopy('picker.saveFailed', 'Could not save \u2014 try again');
  }

  function resetIcon(providerId, modelId) {
    if (pending !== '') return;
    const rowKey = providerId + '\u0000' + modelId;
    setError('');
    setPending(rowKey);
    let write;
    try {
      if (typeof dshmlClearModelIcon !== 'function') throw new Error('dshmlClearModelIcon is unavailable');
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

  function openPicker(providerId, modelId, displayName, anchor) {
    if (typeof dshmlOpenIconPicker !== 'function') {
      setError(explainWriteFailure());
      return;
    }
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
    } catch (openError) {
      setError(explainWriteFailure());
    }
  }

  function submitManual(event) {
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

  const headChildren = [
    h('h2', { key: 'title', className: 'dshml-section-title' }, dshmlSectionCopy('section.title', 'Model icons')),
    h(
      'p',
      { key: 'intro', className: 'dshml-section-intro' },
      dshmlSectionCopy(
        'section.intro',
        'Pick an icon for a provider + model pair. Unset pairs use auto-detection.',
      ),
    ),
  ];
  if (overrideCount > 0) {
    headChildren.push(
      h(
        'p',
        { key: 'summary', className: 'dshml-section-summary' },
        dshmlSectionOverrideSummary(overrideCount),
      ),
    );
  }

  const notices = [];
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
      onChange: function onSearch(event) {
        setQuery(event.target.value);
      },
    }),
  ]);

  const groupElements = filteredGroups.map(function toGroup(group) {
    const rows = group.models.map(function toRow(model) {
      return h(DshmlSectionRow, {
        key: 'row-' + group.providerId + '-' + model.modelId,
        providerId: group.providerId,
        providerName: group.displayName,
        modelId: model.modelId,
        modelName: model.name,
        override: dshmlUiOverrideValue(overrides, group.providerId, model.modelId),
        busy: pending === group.providerId + '\u0000' + model.modelId,
        onChoose: openPicker,
        onReset: resetIcon,
      });
    });
    return h('div', { key: 'group-' + group.providerId, className: 'dshml-section-group' }, [
      h('div', { key: 'head', className: 'dshml-section-group-head' }, [
        h('span', { key: 'title', className: 'dshml-section-group-title', title: group.displayName }, group.displayName),
        group.displayName === group.providerId
          ? null
          : h('span', { key: 'sub', className: 'dshml-section-group-sub', title: group.providerId }, group.providerId),
      ]),
      h('div', { key: 'rows', className: 'dshml-section-rows', role: 'list' }, rows),
    ]);
  });

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
          onChange: function onProvider(event) {
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
          onChange: function onModel(event) {
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
    manualError !== ''
      ? h('p', { key: 'error', className: 'dshml-section-error', role: 'alert' }, manualError)
      : null,
  ]);

  const children = [
    h('div', { key: 'head', className: 'dshml-section-head' }, headChildren),
  ];
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
