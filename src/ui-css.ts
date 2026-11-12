/**
 * Settings surfaces stylesheet for the model-logos plugin.
 *
 * One template-literal string inlined into the generated client bundle after
 * `src/i18n.ts` / `src/overrides.ts`. `src/client.ts` injects it into the same
 * `<style data-plugin-css>` element as the composer label rules.
 *
 * Conventions:
 * - every class is prefixed `dshml-picker-*` (modal) or `dshml-section-*`
 *   (Settings → Model icons page);
 * - colours come from DSW alias variables with light-theme hex fallbacks, so the
 *   dark theme is handled by the variables and an unthemed page still reads;
 * - no `@import`, no external URLs, no backtick or `${` inside the template.
 */

export const DSHML_UI_CSS: string = `
/* ── icon picker modal ─────────────────────────────────────────────── */

.dshml-picker-layer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(15, 18, 25, 0.45));
  animation: dshml-picker-fade 120ms ease-out;
}

@keyframes dshml-picker-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dshml-picker-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(640px, 100%);
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #1c1f26);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-xl, 12px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.24);
}

.dshml-picker-dialog:focus {
  outline: none;
}

.dshml-picker-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 18px 8px;
}

.dshml-picker-heading {
  flex: 1 1 auto;
  min-width: 0;
}

.dshml-picker-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-picker-subtitle {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  margin-top: 2px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  word-break: break-all;
}

.dshml-picker-subtitle-name {
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-picker-subtitle-sep {
  opacity: 0.7;
}

.dshml-picker-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  cursor: pointer;
}

/* The close mark is a drawn 16 px glyph, not a text character: no font-size or
   line-height is involved, so the user's system font cannot move it. It is a
   flex item of the 28 px button, so its box centre is the hit-area centre. */
.dshml-picker-close-icon {
  display: block;
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.dshml-picker-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-picker-close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #5686fe));
}

.dshml-picker-search-row {
  padding: 0 18px 8px;
}

.dshml-picker-search {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  outline: none;
  transition:
    border-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    box-shadow var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-picker-search::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-picker-search:hover:not(:focus) {
  border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
}

.dshml-picker-search:active {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
}

/* One blue interaction family: a single blue border plus the soft focus halo.
   The old rule mixed a near-black brand-primary border with a separate blue
   shadow, which painted the two stacked outlines this popup used to show. */
.dshml-picker-search:focus {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px)
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 24%, transparent);
}

.dshml-picker-notice,
.dshml-picker-error {
  margin: 0 18px 8px;
  padding: 6px 9px;
  border-radius: var(--dsw-radius-sm, 6px);
  font-size: 12px;
  line-height: 18px;
}

.dshml-picker-notice {
  color: var(--dsw-alias-state-warn-label, #a86b00);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
}

.dshml-picker-error {
  color: var(--dsw-alias-state-error-primary, #d92d20);
  background: rgba(217, 45, 32, 0.08);
}

.dshml-picker-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 18px 16px;
}

.dshml-picker-body::-webkit-scrollbar {
  width: 8px;
}

.dshml-picker-body::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.16));
}

.dshml-picker-body::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, 0.28));
}

.dshml-picker-specials {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 6px;
}

.dshml-picker-group-title {
  margin: 14px 0 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-picker-grid + .dshml-picker-group-title {
  margin-top: 16px;
}

.dshml-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: 6px;
}

.dshml-picker-option {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 8px 4px 7px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 11px;
  line-height: 15px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    box-shadow var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-picker-option:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dshml-picker-option:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.1));
}

.dshml-picker-option:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px)
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}

.dshml-picker-option:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Selected mode/brand option: the same blue as an active input, on the theme's
   blue tint instead of the neutral hover fill the old rule inherited. */
.dshml-picker-option[aria-pressed="true"] {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
  background: var(--dsw-alias-state-business-tertiary, rgba(86, 134, 254, 0.12));
}

.dshml-picker-option[aria-pressed="true"]:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 18%, transparent);
}

.dshml-picker-option[aria-pressed="true"]:active:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 26%, transparent);
}

.dshml-picker-option[aria-pressed="true"] .dshml-picker-option-label {
  color: var(--dsw-alias-state-business-primary, #4176e6);
  font-weight: 600;
}

/* The picker preview is the one enlarged surface: 36px base marks. */
.dshml-picker-option-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  line-height: 0;
}

.dshml-picker-option-mark > svg {
  display: block;
  width: 100%;
  height: 100%;
}

.dshml-picker-option-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-picker-empty {
  margin: 0;
  padding: 20px 0 8px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

/* ── Settings → Model icons section ────────────────────────────────── */

.dshml-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 720px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.dshml-section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-intro {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-summary {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-section-notice {
  margin: 0;
  padding: 7px 10px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-section-notice-warn {
  color: var(--dsw-alias-state-warn-label, #a86b00);
}

.dshml-section-notice-error {
  color: var(--dsw-alias-state-error-primary, #d92d20);
  background: rgba(217, 45, 32, 0.08);
}

.dshml-section-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dshml-section-search {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  outline: none;
  transition:
    border-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    box-shadow var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-section-search::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-search:hover:not(:focus) {
  border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
}

.dshml-section-search:active {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
}

.dshml-section-search:focus {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px)
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 24%, transparent);
}

.dshml-section-scroll {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 46vh;
  overflow-y: auto;
  padding-right: 4px;
}

.dshml-section-scroll::-webkit-scrollbar {
  width: 8px;
}

.dshml-section-scroll::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.16));
}

.dshml-section-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, 0.28));
}

.dshml-section-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.dshml-section-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.dshml-section-group-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-group-sub {
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

/* The provider group leads the page, so it carries the one-line rule of how a
   vendor mark is chosen (auto follows the official channel). */
.dshml-section-group-providers {
  padding-bottom: 2px;
}

.dshml-section-group-hint {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-rows {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-settings-card-fill, #ffffff);
}

.dshml-section-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-height: 36px;
  padding: 6px 12px;
}

.dshml-section-row + .dshml-section-row {
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}

/* The mark seat is always rendered (a dash when empty), so a row's name never
   moves when its icon arrives. Keep the seat on the shared 22px base. */
.dshml-section-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  line-height: 0;
}

.dshml-section-mark > svg {
  display: block;
  width: 100%;
  height: 100%;
}

.dshml-section-mark-empty {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  opacity: 0.6;
  font-size: 12px;
  line-height: 1;
}

.dshml-section-row-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.dshml-section-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-row-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-chip {
  flex: none;
  padding: 1px 6px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-xs, 4px);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-section-chip-custom {
  color: var(--dsw-alias-state-business-primary, #5686fe);
  border-color: var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-section-chip-none {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.dshml-section-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 9px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}

.dshml-section-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dshml-section-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #5686fe));
}

.dshml-section-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.dshml-section-btn-ghost {
  border-color: transparent;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-section-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #5686fe);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}

.dshml-section-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #3f6ff0);
}

.dshml-section-empty {
  margin: 0;
  padding: 14px 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-manual {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-settings-card-fill, #ffffff);
}

.dshml-section-manual-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-manual-hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
}

.dshml-section-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 150px;
  min-width: 0;
}

.dshml-section-field-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-section-input {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  outline: none;
  transition:
    border-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    box-shadow var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-section-input::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-input:hover:not(:focus) {
  border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
}

.dshml-section-input:active {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
}

.dshml-section-input:focus {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px)
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 24%, transparent);
}

.dshml-section-error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary, #d92d20);
}

/* ── custom icons: picker group and create/rename editor ───────────── */

.dshml-picker-back {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin-right: 2px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  cursor: pointer;
}

.dshml-picker-back:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-picker-back:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #5686fe));
}

.dshml-picker-back-icon {
  display: block;
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.dshml-picker-custom-cell {
  position: relative;
  min-width: 0;
}

.dshml-picker-custom-cell > .dshml-picker-option {
  width: 100%;
}

/* The pencil is always visible at a low opacity so a custom icon is editable
   without hunting for an invisible hit area; hover/focus brings it up. */
.dshml-picker-custom-edit {
  position: absolute;
  top: 2px;
  right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  opacity: 0.7;
  cursor: pointer;
  transition:
    opacity var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-picker-custom-cell:hover .dshml-picker-custom-edit,
.dshml-picker-custom-edit:focus-visible {
  opacity: 1;
}

.dshml-picker-custom-edit:hover {
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  color: var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-picker-custom-edit:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #5686fe));
}

.dshml-picker-custom-edit:disabled {
  opacity: 0.3;
  cursor: default;
}

.dshml-picker-custom-edit > svg {
  display: block;
}

.dshml-picker-create {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 76px;
  padding: 8px 4px 7px;
  border: 1px dashed var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.18));
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  font: inherit;
  font-size: 11px;
  line-height: 15px;
  cursor: pointer;
}

.dshml-picker-create:hover:not(:disabled) {
  border-color: var(--dsw-alias-state-business-primary, #5686fe);
  background: var(--dsw-alias-state-business-tertiary, rgba(86, 134, 254, 0.1));
  color: var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-picker-create:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}

.dshml-picker-create:disabled {
  opacity: 0.5;
  cursor: default;
}

.dshml-picker-create-icon {
  display: block;
}

.dshml-picker-create-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dshml-picker-editor-body {
  padding-top: 4px;
}

.dshml-custom-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.dshml-custom-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
}

.dshml-custom-tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6472);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.dshml-custom-tab-active {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 20, 28, 0.12);
}

.dshml-custom-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}

.dshml-custom-tab-soon {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  cursor: not-allowed;
}

.dshml-custom-tab-soon .dshml-custom-tab-label {
  opacity: 0.55;
}

.dshml-custom-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dshml-custom-tab-badge {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  white-space: nowrap;
}

.dshml-custom-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.dshml-custom-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-custom-input {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  outline: none;
  transition:
    border-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease),
    box-shadow var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-custom-input::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-custom-input:hover:not(:focus) {
  border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
}

.dshml-custom-input:focus {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px)
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 24%, transparent);
}

.dshml-custom-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-custom-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 150px;
  padding: 14px;
  border: 1px dashed var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.18));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  color: var(--dsw-alias-label-secondary, #5c6472);
  font: inherit;
  cursor: pointer;
}

.dshml-custom-drop:hover:not(:disabled) {
  border-color: var(--dsw-alias-state-business-primary, #5686fe);
  background: var(--dsw-alias-state-business-tertiary, rgba(86, 134, 254, 0.08));
  color: var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-custom-drop:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}

.dshml-custom-drop:disabled {
  opacity: 0.6;
  cursor: default;
}

.dshml-custom-drop-icon {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-custom-drop-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.dshml-custom-drop-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-custom-image {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* react-easy-crop positions its own container absolutely; this box is the
   sized, clipped viewport it measures. The library injects the crop-area /
   backdrop rules on mount (MIT, see THIRD_PARTY_LICENSES.md). */
.dshml-custom-cropper {
  position: relative;
  width: 100%;
  height: 220px;
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 10px);
  background: #151922;
}

.dshml-custom-zoom {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dshml-custom-zoom-label {
  flex: none;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-custom-zoom-range {
  flex: 1 1 auto;
  accent-color: var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-custom-image-actions {
  display: flex;
  justify-content: flex-end;
}

.dshml-custom-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-business-primary, #5686fe);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.dshml-custom-link:hover {
  text-decoration: underline;
}

.dshml-custom-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}

.dshml-custom-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

.dshml-custom-btn {
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}

.dshml-custom-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dshml-custom-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}

.dshml-custom-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.dshml-custom-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #5686fe);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}

.dshml-custom-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #3f6ff0);
}

.dshml-custom-btn-danger {
  border-color: transparent;
  background: var(--dsw-alias-state-error-primary, #d92d20);
  color: #ffffff;
}

.dshml-custom-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 86%, #000000);
}

.dshml-custom-btn-ghost {
  border-color: transparent;
  background: transparent;
}

.dshml-custom-btn-danger-ghost {
  color: var(--dsw-alias-state-error-primary, #d92d20);
}

.dshml-custom-danger {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 2px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}

.dshml-custom-danger-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-custom-danger-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dshml-custom-danger-text {
  flex: 1 1 100%;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary, #d92d20);
}

.dshml-custom-file {
  display: none;
}

.dshml-custom-editor .dshml-picker-error {
  margin: 0;
}

/* ── motion sampling studio ────────────────────────────────────────── */

.dshml-picker-dialog.dshml-picker-dialog-wide {
  width: min(760px, 100%);
  max-height: min(880px, 100%);
}

.dshml-picker-motion-badge {
  position: absolute;
  left: 2px;
  top: 2px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, #5686fe);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  pointer-events: none;
}

.dshml-motion {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.dshml-motion-ready {
  gap: 14px;
}

.dshml-motion-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.dshml-motion-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
}

.dshml-motion-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}

.dshml-motion-panel-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-motion-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, 0.05));
}

.dshml-motion-seg-btn {
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}

.dshml-motion-seg-active {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 20, 28, 0.12);
}

.dshml-motion-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: var(--dsw-radius-md, 8px);
  background: #11151d;
}

.dshml-motion-canvas,
.dshml-motion-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.dshml-motion-stage-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  font-size: 11px;
  text-align: center;
}

.dshml-motion-transport {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
}

.dshml-motion-icon-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6472);
  cursor: pointer;
}

.dshml-motion-icon-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-motion-icon-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #5686fe);
  outline-offset: 1px;
}

.dshml-motion-play {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
}

.dshml-motion-time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-note {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-cropper {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: var(--dsw-radius-md, 8px);
  background: #11151d;
}

.dshml-motion-framing-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dshml-motion-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dshml-motion-tiles {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 4px 2px 2px;
}

.dshml-motion-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.dshml-motion-tile-mark {
  display: block;
  line-height: 0;
}

.dshml-motion-tile-mark > svg {
  display: block;
  width: 100%;
  height: 100%;
}

.dshml-motion-tile-label {
  font-size: 10px;
  line-height: 12px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-tile-20 .dshml-motion-tile-mark { width: 20px; height: 20px; }
.dshml-motion-tile-22 .dshml-motion-tile-mark { width: 22px; height: 22px; }
.dshml-motion-tile-36 .dshml-motion-tile-mark { width: 36px; height: 36px; }
.dshml-motion-tile-64 .dshml-motion-tile-mark { width: 64px; height: 64px; }

.dshml-motion-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
}

.dshml-motion-thumbs {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 2px;
  height: 44px;
  overflow: hidden;
  border-radius: 5px;
}

.dshml-motion-thumb {
  display: block;
  background-color: #1a1f29;
  background-position: center;
  background-size: cover;
}

.dshml-motion-thumb-empty {
  background-image: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.09));
}

.dshml-motion-track {
  position: relative;
  height: 24px;
  cursor: pointer;
  touch-action: none;
}

.dshml-motion-rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 10px;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
}

.dshml-motion-range {
  position: absolute;
  top: 10px;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-state-business-primary, #5686fe);
  cursor: grab;
}

.dshml-motion-range:active {
  cursor: grabbing;
}

.dshml-motion-playhead {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 1px;
  transform: translateX(-0.5px);
  background: var(--dsw-alias-label-primary, #1c1f26);
  opacity: 0.65;
  pointer-events: none;
}

.dshml-motion-handle {
  position: absolute;
  top: 3px;
  box-sizing: border-box;
  width: 14px;
  height: 18px;
  margin-left: -7px;
  padding: 0;
  border: 1px solid var(--dsw-alias-state-business-primary, #5686fe);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  cursor: ew-resize;
  touch-action: none;
}

.dshml-motion-handle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #5686fe);
  outline-offset: 1px;
}

.dshml-motion-handle-mark {
  display: block;
  width: 1px;
  height: 10px;
  margin: 0 auto;
  background: var(--dsw-alias-state-business-primary, #5686fe);
  opacity: 0.55;
}

.dshml-motion-range-labels {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-live {
  min-height: 14px;
  color: var(--dsw-alias-state-warning-primary, #b25e09);
}

.dshml-motion-samples {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dshml-motion-sample-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dshml-motion-sample-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-motion-frames-range {
  flex: 1 1 120px;
  min-width: 100px;
  accent-color: var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-motion-sample-value {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-strip {
  display: flex;
  gap: 4px;
  min-height: 44px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.dshml-motion-sample {
  box-sizing: border-box;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background-color: #11151d;
  background-repeat: no-repeat;
  cursor: pointer;
}

.dshml-motion-sample-active {
  border-color: var(--dsw-alias-state-business-primary, #5686fe);
  box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary, #5686fe);
}

.dshml-motion-sample:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #5686fe);
  outline-offset: 1px;
}

.dshml-motion-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dshml-motion-progress {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-budget {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}

.dshml-motion-budget-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.dshml-motion-budget-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6472);
}

.dshml-motion-meter {
  flex: 1 1 140px;
  min-width: 100px;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, 0.07));
}

.dshml-motion-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, #5686fe);
  transition: width var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}

.dshml-motion-bar-warn {
  background: var(--dsw-alias-state-warning-primary, #d97706);
}

.dshml-motion-bar-over {
  background: var(--dsw-alias-state-error-primary, #d92d20);
}

.dshml-motion-budget-value {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-motion-notes {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.dshml-motion-note-list {
  flex: 1 1 100%;
  margin: 0;
  padding-left: 16px;
}

.dshml-motion-error {
  margin: 0;
}

.dshml-motion-static-switch {
  display: flex;
  justify-content: flex-end;
}

.dshml-motion-source-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 2px;
}

.dshml-motion-source-actions .dshml-custom-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .dshml-motion-top {
    grid-template-columns: minmax(0, 1fr);
  }

  .dshml-motion-tiles {
    gap: 12px;
  }
}

/* ── per-surface motion playback ───────────────────────────────────── */

.dshml-section-playback {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}

.dshml-section-playback-rows {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-settings-card-fill, #ffffff);
}

.dshml-section-playback-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 6px 12px;
}

.dshml-section-playback-row + .dshml-section-playback-row {
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}

.dshml-section-playback-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-modes {
  flex: none;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
}

.dshml-section-mode {
  box-sizing: border-box;
  min-height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6472);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}

.dshml-section-mode:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary, #1c1f26);
}

.dshml-section-mode-active {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1c1f26);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 20, 28, 0.12);
}

.dshml-section-mode:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #5686fe);
  outline-offset: 1px;
}

.dshml-section-mode:disabled {
  opacity: 0.5;
  cursor: default;
}
`;
