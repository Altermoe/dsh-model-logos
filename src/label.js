/**
 * Client half of the model-logos bundle.
 *
 * One contribution to `conversation.input.model.label` draws a brand mark before
 * the catalog name in every placement the composer uses it for: the trigger
 * caption, the root menu's current-value row, and each model option. The plugin
 * owns only this inline content; clicks, focus, search, check marks, effort
 * labels and trigger accessibility text stay with the shipped selector.
 *
 * This file is a fragment: `scripts/build-client.mjs` wraps it in the browser
 * module factory and supplies `h` (React.createElement), `LOGOS`, and
 * `matchModelLogo` (inlined from src/match.mjs).
 */

const LABEL_STYLE_ID = 'dsh-model-logos/label.css';

const LABEL_CSS = `
.dshml-root { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; vertical-align: baseline; }
.dshml-mark { flex: none; width: 14px; height: 14px; display: inline-block; line-height: 0; }
.dshml-mark > svg { display: block; width: 100%; height: 100%; }
.dshml-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshml-menu { gap: 5px; }
.dshml-option { gap: 6px; }
.dshml-option .dshml-mark { width: 16px; height: 16px; }
.dshml-badge { flex: none; margin-left: 1px; padding: 0 5px; border-radius: 5px; font-size: 10px; font-weight: 600; line-height: 16px; letter-spacing: .01em; background: rgba(86, 134, 254, .16); color: var(--dsw-alias-state-business-primary, #5686FE); }
`;

/**
 * Inject the label stylesheet once; returns a disposer that removes it.
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
  tag.textContent = LABEL_CSS;
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
 * Falls back to the plain catalog name (the slot's own fallback) when neither a
 * mark nor the release badge applies.
 */
function ModelLogoLabel(props) {
  const provider = props !== null && props !== undefined && props.provider !== undefined ? props.provider : null;
  const model = props !== null && props !== undefined && props.model !== undefined ? props.model : null;
  const placement = props !== null && props !== undefined && typeof props.placement === 'string' ? props.placement : 'trigger';
  const text = dshModelLabelText(model);
  const key = matchModelLogo({ provider: provider, model: model });
  const mark = key !== null && LOGOS[key] !== undefined ? LOGOS[key] : null;
  const badge = isOfficialFlashReleaseBadge(provider, model);
  if (mark === null && !badge) return text;
  const children = [];
  if (mark !== null) {
    children.push(
      h('span', {
        key: 'mark',
        className: 'dshml-mark',
        'aria-hidden': 'true',
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
 * Register the label contribution.
 *
 * Priority -1 shadows the shipped release-badge label (registered at the default
 * priority 0) — the register API rejects two single-slot contributions at the
 * same priority, and the lowest priority renders. The shadow is intentional: this
 * contribution serves every model, not just one release.
 */
function apply(ctx) {
  ctx.effect(function mountStyles() {
    return mountLabelStyles();
  }, 'dsh-model-logos: label styles');
  ctx.slots.inject('conversation.input.model.label', function injectLabelSlot() {
    return ctx.slots.register(
      {
        name: 'conversation.input.model.label',
        priority: -1,
      },
      ModelLogoLabel,
    );
  });
}
