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
  font: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
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
}

.dshml-picker-search::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-picker-search:focus {
  border-color: var(--dsw-alias-brand-primary, #5686fe);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, rgba(86, 134, 254, 0.35));
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

.dshml-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
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
}

.dshml-picker-option:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dshml-picker-option:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #5686fe));
}

.dshml-picker-option:disabled {
  opacity: 0.5;
  cursor: default;
}

.dshml-picker-option[aria-pressed="true"] {
  border-color: var(--dsw-alias-brand-primary, #5686fe);
  background: var(--dsw-alias-interactive-bg-hover, rgba(86, 134, 254, 0.1));
}

.dshml-picker-option[aria-pressed="true"] .dshml-picker-option-label {
  color: var(--dsw-alias-state-business-primary, #5686fe);
  font-weight: 600;
}

.dshml-picker-option-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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
}

.dshml-section-search::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-search:focus {
  border-color: var(--dsw-alias-brand-primary, #5686fe);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, rgba(86, 134, 254, 0.35));
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

.dshml-section-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  font-size: 14px;
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
}

.dshml-section-input::placeholder {
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}

.dshml-section-input:focus {
  border-color: var(--dsw-alias-brand-primary, #5686fe);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, rgba(86, 134, 254, 0.35));
}

.dshml-section-error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary, #d92d20);
}
`;
