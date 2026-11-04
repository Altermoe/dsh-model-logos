/**
 * Settings-navigation glyph for this plugin's own section.
 *
 * The shipped Settings shell chooses a nav glyph with a hard-coded id switch
 * (`account`, `models`, `plugins`, …) and falls back to the settings gear for
 * every other section id, so `settings.section` cannot carry an icon: the slot
 * accepts only `id`/`order`/`label`, and the slot core silently drops any other
 * option. The row button also carries no section id in the DOM — its
 * `navLabel` text is the only signal that survives React.
 *
 * This module therefore decorates the rendered row instead of registering
 * anything: it sets a `data-dshml-nav` marker on the button whose label matches
 * this plugin's section title in any shipped language, and the plugin stylesheet
 * hides the gear and paints this glyph through a `::before` mask.
 *
 * Why that shape:
 *  - a `data-*` attribute is not a React prop, so it survives the shell's
 *    re-renders (React rewrites `class` on every selection change);
 *  - nothing is inserted into the button's React-owned children;
 *  - the gear is hidden visually only, so the button keeps its accessible name
 *    (the label span) and its focus/selection behaviour;
 *  - `currentColor` through a mask tracks light/dark and the active-row colour
 *    exactly like the shipped glyphs.
 */
import { dshmlTAll } from './i18n';

/** `data-dshml-nav` value marking this plugin's row (also its section id). */
export const DSHML_NAV_MARKER = 'model-logos';

/**
 * The glyph: four rounded tiles in a 2×2 set with the first one solid. It is the
 * plugin's own mark — the four-tile `icon.svg` that identifies it in the Plugins
 * page — reduced to what a 16 px nav rail can carry, in `currentColor` and the
 * shell's "medium" 1.3 stroke so it sits beside the shipped glyphs.
 */
export const DSHML_NAV_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">' +
  '<rect x="3.15" y="3.15" width="3.2" height="3.2" rx="1" fill="currentColor"/>' +
  '<rect x="9.15" y="2.65" width="4.2" height="4.2" rx="1.2" stroke="currentColor" stroke-width="1.3"/>' +
  '<rect x="2.65" y="9.15" width="4.2" height="4.2" rx="1.2" stroke="currentColor" stroke-width="1.3"/>' +
  '<rect x="9.15" y="9.15" width="4.2" height="4.2" rx="1.2" stroke="currentColor" stroke-width="1.3"/>' +
  '</svg>';

/** The glyph as a CSS `mask` URL (percent-encoded so it needs no quoting). */
export const DSHML_NAV_ICON_URL = 'url("data:image/svg+xml,' + encodeURIComponent(DSHML_NAV_ICON_SVG) + '")';

/**
 * Stylesheet rules appended to the plugin stylesheet: hide the shell's glyph on
 * the marked row and draw ours in its place with the inherited text colour.
 */
export const DSHML_NAV_ICON_CSS = `
/* Settings navigation: this plugin's own section glyph. */
[data-dshml-nav="${DSHML_NAV_MARKER}"] > svg { display: none; }
[data-dshml-nav="${DSHML_NAV_MARKER}"]::before { content: ""; flex: none; width: 16px; height: 16px; background-color: currentColor; -webkit-mask: ${DSHML_NAV_ICON_URL} center / 16px 16px no-repeat; mask: ${DSHML_NAV_ICON_URL} center / 16px 16px no-repeat; }
`;

/** Label texts this plugin's nav row can show, in every language it ships. */
export function dshmlNavIconLabels(): string[] {
  return dshmlTAll('section.title');
}

/** The label span the shell renders as the row's second child (empty when absent). */
function dshmlNavRowLabel(button: Element): string {
  for (const child of button.children) {
    if (child.tagName === 'SPAN') return String(child.textContent ?? '').trim();
  }
  return '';
}

/**
 * Mark this plugin's nav row (and only that row) so the stylesheet can paint the
 * glyph. Idempotent: it re-runs on every decorator pass, which is what keeps the
 * row correct when the shell re-renders the nav after a locale or ledger change.
 * @param root - the settings dialog root (`[data-shortcut-modal="settings"]`).
 */
export function dshmlDecorateNavIcon(root: Element): void {
  const nav = root.querySelector(':scope > nav') ?? root.querySelector('nav');
  if (nav === null) return;
  const labels = dshmlNavIconLabels();
  for (const button of nav.querySelectorAll('button')) {
    // The shell always renders the glyph first; a row without one is not a nav
    // row. SVG element names keep their authored case, so compare lowercased.
    const first = button.firstElementChild;
    const decorated = first !== null && first.tagName.toLowerCase() === 'svg';
    const label = dshmlNavRowLabel(button);
    const matched = decorated && label !== '' && labels.includes(label);
    if (matched) {
      if (button.getAttribute('data-dshml-nav') !== DSHML_NAV_MARKER) {
        button.setAttribute('data-dshml-nav', DSHML_NAV_MARKER);
      }
    } else if (button.hasAttribute('data-dshml-nav')) {
      button.removeAttribute('data-dshml-nav');
    }
  }
}

/** Remove every nav-row marker this plugin set (disposal). */
export function dshmlClearNavIcon(): void {
  if (typeof document === 'undefined') return;
  for (const button of document.querySelectorAll('[data-dshml-nav]')) {
    button.removeAttribute('data-dshml-nav');
  }
}
