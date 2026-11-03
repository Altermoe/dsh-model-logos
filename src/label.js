/**
 * Client half of the model-logos bundle.
 *
 * Contributions:
 *  - `conversation.input.model.label` draws a brand mark (or a configured
 *    override / letter tile) before the catalog name in every placement the
 *    composer uses it for.
 *  - `settings.section` adds the "Model icons" settings page.
 *  - A settings-page decorator adds vendor marks to the Models provider rows and
 *    the add-provider dropdown, and a model-icon buttons to the model rows.
 *
 * This file is a fragment: `scripts/build-client.mjs` wraps it in the browser
 * module factory and supplies `React`, `h`, `createRoot`, `LOGOS`, and the
 * inlined pure/fragment modules that precede it.
 */

const LABEL_STYLE_ID = 'dsh-model-logos/label.css';

const LABEL_CSS = `
/* Composer model label. */
.dshml-root { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; vertical-align: baseline; }
.dshml-mark { flex: none; width: 14px; height: 14px; display: inline-block; line-height: 0; }
.dshml-mark > svg { display: block; width: 100%; height: 100%; }
.dshml-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshml-menu { gap: 5px; }
.dshml-option { gap: 6px; }
.dshml-option .dshml-mark { width: 16px; height: 16px; }
.dshml-badge { flex: none; margin-left: 1px; padding: 0 5px; border-radius: 5px; font-size: 10px; font-weight: 600; line-height: 16px; letter-spacing: .01em; background: rgba(86, 134, 254, .16); color: var(--dsw-alias-state-business-primary, #5686FE); }

/* Settings → Models: inserted vendor / model marks. */
.dshml-insert { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 0; }
.dshml-vendor { width: 1em; height: 1em; font-size: 14px; }
.dshml-vendor > svg, .dshml-model-mark > svg { display: block; width: 100%; height: 100%; }
.dshml-model-icon-btn { box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 3px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #8a90a0); cursor: pointer; line-height: 0; }
.dshml-model-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); }
.dshml-model-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #5686FE); outline-offset: 1px; }
.dshml-model-icon-btn .dshml-model-mark { width: 16px; height: 16px; display: inline-flex; }
.dshml-model-placeholder { opacity: .55; }
.dshml-model-icon-disabled .dshml-model-mark { opacity: .35; }
[data-dshml-model-row="1"] { grid-template-columns: auto minmax(0, 1.4fr) minmax(0, 1fr) auto auto !important; }

/* Settings → Models: custom provider combobox over the native select. */
.dshml-combo { position: relative; width: 100%; max-width: 240px; }
.dshml-combo-button { box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4, #d9dbe1); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1b1f27); font: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer; }
.dshml-combo-button:hover { border-color: var(--dsw-alias-border-l3, #c9ccd4); }
.dshml-combo-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #5686FE); outline-offset: 1px; }
.dshml-combo-mark { flex: none; display: inline-flex; width: 16px; height: 16px; line-height: 0; }
.dshml-combo-mark > svg { display: block; width: 100%; height: 100%; }
.dshml-combo-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshml-combo-chevron { flex: none; display: inline-flex; width: 14px; height: 14px; opacity: .6; color: var(--dsw-alias-menu-icon, currentColor); }
.dshml-combo-chevron > svg { display: block; width: 100%; height: 100%; }
.dshml-combo-menu { position: absolute; z-index: 60; top: calc(100% + 4px); left: 0; right: 0; max-height: 280px; overflow-y: auto; padding: 4px; border: .5px solid var(--dsw-alias-border-l3, #dcdde2); border-radius: var(--dsw-radius-lg, 10px); background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 10px 30px rgba(16, 20, 28, .18); }
.dshml-combo-item { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 8px; border-radius: 6px; color: var(--dsw-alias-label-primary, #1b1f27); font-size: 14px; line-height: 22px; cursor: pointer; }
.dshml-combo-item:hover, .dshml-combo-item[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); }
.dshml-combo-item[aria-selected="true"] { color: var(--dsw-alias-state-business-primary, #5686FE); }
.dshml-combo-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/**
 * Inject the plugin stylesheet once; returns a disposer that removes it.
 * @returns {() => void}
 */
function mountLabelStyles() {
  if (typeof document === 'undefined') return function noop() {};
  if (document.querySelector('style[data-plugin-css="' + LABEL_STYLE_ID + '"]') !== null) {
    return function noop() {};
  }
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-model-logos';
  tag.dataset.pluginCss = LABEL_STYLE_ID;
  tag.textContent = LABEL_CSS + (typeof DSHML_UI_CSS === 'string' ? DSHML_UI_CSS : '');
  document.head.appendChild(tag);
  return function unmountLabelStyles() {
    tag.remove();
  };
}

/** Localized catalog display name, falling back to the raw model id. */
function dshModelLabelText(model) {
  if (model === null || typeof model !== 'object') return '';
  const name = typeof model.name === 'string' ? model.name.trim() : '';
  if (name !== '') return name;
  return typeof model.id === 'string' ? model.id : '';
}

/**
 * Mirror of the shipped temporary release marker: the 1017 release of the
 * official DeepSeek Flash entry. This contribution shadows that label for every
 * model, so it must keep the badge it would otherwise render.
 */
function isOfficialFlashReleaseBadge(provider, model) {
  if (provider === null || typeof provider !== 'object') return false;
  if (model === null || typeof model !== 'object') return false;
  const providerId = typeof provider.id === 'string' ? provider.id : '';
  const modelId = typeof model.id === 'string' ? model.id : '';
  const modelName = typeof model.name === 'string' ? model.name : '';
  return (
    (providerId === 'deepseek-account' || providerId === 'deepseek-official') &&
    modelId === 'deepseek-flash' &&
    modelName === 'DeepSeek-V4.1-Flash'
  );
}

/**
 * The label contribution: `<logo> <name> [badge]` in all three placements.
 * The mark is the per-model resolved icon (explicit override / letter tile /
 * heuristic initial icon); falls back to the plain catalog name.
 */
function ModelLogoLabel(props) {
  // Subscribe so an icon picked anywhere re-renders every placement.
  dshmlUseIconState();
  const provider = props !== null && props !== undefined && props.provider !== undefined ? props.provider : null;
  const model = props !== null && props !== undefined && props.model !== undefined ? props.model : null;
  const placement = props !== null && props !== undefined && typeof props.placement === 'string' ? props.placement : 'trigger';
  const text = dshModelLabelText(model);
  const mark = dshmlModelMark(provider, model);
  const badge = isOfficialFlashReleaseBadge(provider, model);
  if (mark.svg === null && !badge) return text;
  const children = [];
  if (mark.svg !== null) {
    children.push(
      h('span', {
        key: 'mark',
        className: 'dshml-mark',
        'aria-hidden': 'true',
        title: mark.title ?? undefined,
        dangerouslySetInnerHTML: { __html: mark.svg },
      }),
    );
  }
  children.push(h('span', { key: 'text', className: 'dshml-text' }, text));
  if (badge) children.push(h('span', { key: 'badge', className: 'dshml-badge' }, '1017'));
  return h('span', { className: 'dshml-root dshml-' + placement }, children);
}

const INJECT = ['slots'];

/**
 * Register every contribution.
 *
 * The label contribution keeps priority -1: it shadows the shipped
 * release-badge label (registered at the default priority 0), and the lowest
 * priority renders in a single slot.
 */
function apply(ctx) {
  ctx.effect(function mountStyles() {
    return mountLabelStyles();
  }, 'dsh-model-logos: label styles');

  // Icon overrides + catalog; each service is optional so a deployment without
  // settings still gets heuristic marks in the composer.
  dshmlMountIconStore(ctx);

  ctx.slots.inject('conversation.input.model.label', function injectLabelSlot() {
    return ctx.slots.register(
      {
        name: 'conversation.input.model.label',
        priority: -1,
      },
      ModelLogoLabel,
    );
  });

  ctx.slots.inject('settings.section', function injectSettingsSection() {
    return ctx.slots.register(
      {
        name: 'settings.section',
        id: 'model-logos',
        order: 35,
        label: () => dshmlT('section.title'),
      },
      DshmlModelIconsSection,
    );
  });

  ctx.effect(function mountSettingsDecorator() {
    return dshmlMountSettingsDecorator(ctx);
  }, 'dsh-model-logos: settings decoration');

  // Read-only diagnostics for maintainers and the live verification harness.
  try {
    globalThis.__dshModelLogos = {
      iconState: () => dshmlIconState(),
      catalog: () => dshmlCatalogState(),
      refreshCatalog: () => dshmlRefreshCatalog(),
      decorate: () => dshmlDecorateNow(),
      requestDecorate: () => dshmlRequestDecorate(),
    };
  } catch (error) {
    console.warn('[dsh-model-logos] diagnostics unavailable', error);
  }
}
