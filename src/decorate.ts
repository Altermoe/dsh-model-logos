/**
 * Settings → Models decoration.
 *
 * The shipped Models page offers no extension seat for the names it renders, so
 * this module decorates its live DOM (idempotent, reversible, never wrapping
 * or rewriting React-owned nodes):
 *
 *   - vendor mark before each official provider-row name / editor title;
 *   - model mark (or a "choose icon" placeholder) at the start of every model
 *     configuration row, clickable → the icon picker;
 *   - a custom combobox painted over the add-provider native <select> so each
 *     option can show its vendor mark; the native select stays the React state
 *     source and receives a bubbling `change` event on pick;
 *   - this plugin's own Settings navigation row: the shell renders the gear
 *     fallback for section ids it does not know, so the row is marked here and
 *     `src/nav-icon.ts` paints the plugin glyph through the stylesheet.
 *
 * Every inserted node carries `data-dshml-owner`, so disposal removes only our
 * nodes and restores the native select.
 */
import { dshmlT } from './i18n';
import {
  dshmlCatalogState,
  dshmlModelMark,
  dshmlSubscribeCatalog,
  dshmlSubscribeIconState,
  dshmlVendorMark,
} from './overrides';
import { dshmlOpenIconPicker } from './picker';
import { dshmlClearNavIcon, dshmlDecorateNavIcon } from './nav-icon';
import type { CatalogProvider, DshContext, ModelMark } from './types';

/** Placeholder mark for a model row that has no icon yet (clickable picker seat). */
const DSHML_PLACEHOLDER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.25" y="1.25" width="21.5" height="21.5" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="3 2.4"/><path d="M12 8.2v7.6M8.2 12h7.6" fill="none" stroke="currentColor" stroke-opacity="0.75" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Chevron for the custom provider combobox. */
const DSHML_CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The settings dialog root. */
const DSHML_SETTINGS_ROOT = '[data-shortcut-modal="settings"]';

/**
 * Last markup this module wrote into each inserted element.
 *
 * The decoration is driven by a MutationObserver over `document.body`, and
 * writing into the nodes it inserted is itself a mutation. Re-writing identical
 * markup (with `innerHTML`, which always replaces the children) would therefore
 * feed the observer, schedule the next pass, and loop for as long as the page is
 * open — the marks flash in the devtools inspector while a timer runs ~25 times
 * a second. Comparing against what was last written turns every no-op pass into
 * a pure read.
 */
const dshmlWrittenMarkup = new WeakMap<Element, string>();

/** Replace an element's markup only when it differs from the last markup written. */
function dshmlWriteMarkup(node: Element, markup: string): void {
  if (dshmlWrittenMarkup.get(node) === markup) return;
  node.innerHTML = markup;
  dshmlWrittenMarkup.set(node, markup);
}

/** Last text this module wrote into each inserted element (the combobox face). */
const dshmlWrittenText = new WeakMap<Element, string>();

/** Replace an element's text only when it differs from the last text written. */
function dshmlWriteText(node: Element, value: string): void {
  if (dshmlWrittenText.get(node) === value) return;
  node.textContent = value;
  dshmlWrittenText.set(node, value);
}

/**
 * Whether a mutation record is a write into this module's own inserted nodes
 * (marks, model buttons, the combobox). Those are decoration output, not page
 * state: observing them back would make every pass schedule the next one.
 */
function dshmlIsSelfMutation(record: MutationRecord): boolean {
  const target = record.target;
  const element = target instanceof Element ? target : target.parentElement;
  return element !== null && element.closest('[data-dshml-owner="1"]') !== null;
}

/**
 * Whether a page mutation renders (part of) the settings dialog.
 *
 * True when the record happened inside the dialog, or when it inserted the dialog
 * (or a wrapper around it). Such records are decorated synchronously, because a
 * MutationObserver callback runs in the microtask checkpoint after the task that
 * made the change — before style, layout and paint. A seat inserted there is
 * already present on the dialog's first painted frame, so rows do not shift when
 * the decoration lands a frame or two later.
 * @param record - a mutation record from the body observer.
 */
function dshmlRendersSettingsRoot(record: MutationRecord): boolean {
  const target = record.target;
  const element = target instanceof Element ? target : target.parentElement;
  if (element !== null && element.closest(DSHML_SETTINGS_ROOT) !== null) return true;
  for (const node of record.addedNodes) {
    if (!(node instanceof Element)) continue;
    if (node.matches(DSHML_SETTINGS_ROOT)) return true;
    if (node.querySelector(DSHML_SETTINGS_ROOT) !== null) return true;
  }
  return false;
}

/** Localized aria-label prefixes the shipped Models page writes on its rows. */
const DSHML_ACTION_LABEL = /^(?:Edit|Delete|编辑|删除)\s/i;
const DSHML_MODEL_ID_LABEL = /^(?:Model ID|模型\s*ID|模型ID)\s+\d+$/i;
const DSHML_MODEL_NAME_LABEL = /^(?:Display name|显示名称)\s+\d+$/i;

/** One provider or model identity as resolved for a settings-page row. */
interface RowIdentity {
  id: string;
  name: string;
}

/** Fully resolved identity of one model configuration row. */
interface ModelRowIdentity {
  provider: RowIdentity;
  model: RowIdentity;
  row: HTMLElement;
}

/** Provider owning one element (route id plus its catalog entry, when known). */
interface OwnerProvider {
  providerId: string;
  entry: CatalogProvider | null;
}

/** The custom provider combobox painted over one native <select>. */
interface ProviderCombo {
  select: HTMLSelectElement;
  wrapper: HTMLDivElement;
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  mark: HTMLSpanElement;
  label: HTMLSpanElement;
  open: boolean;
  activeIndex: number;
  items: HTMLDivElement[];
  onSelect: (value: string) => void;
  sync: () => void;
}

/** Mutable state of the mounted settings-page decorator. */
interface DecorState {
  disposed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  combo: ProviderCombo | null;
  lastRoot: Element | null;
}

/**
 * Write one model mark into a row's icon button.
 *
 * A `null` mark (or a mark with `svg === null`) keeps the button — and therefore
 * the 22 px grid column — in place and draws the dashed "choose an icon" seat
 * instead. That is what makes the seat stable: it is inserted from the first
 * decoration pass even while the provider catalogue cannot name the row yet, so
 * the row's text never shifts when the real mark arrives.
 * @param button - the row's icon button.
 * @param mark - resolved mark, or null while the row's identity is unknown.
 */
function dshmlWriteModelMark(button: HTMLButtonElement, mark: ModelMark | null): void {
  let span = button.querySelector<HTMLElement>('.dshml-model-mark');
  if (span === null) {
    span = document.createElement('span');
    span.className = 'dshml-insert dshml-model-mark';
    button.appendChild(span);
  }
  dshmlWriteMarkup(span, mark !== null && mark.svg !== null ? mark.svg : DSHML_PLACEHOLDER_SVG);
  span.classList.toggle('dshml-model-placeholder', mark === null || mark.svg === null);
  button.classList.toggle('dshml-model-icon-disabled', mark !== null && mark.resolved.disabled);
  button.classList.toggle('dshml-model-icon-custom', mark !== null && mark.resolved.source === 'override');
}

/** Build the model-row icon button (brand mark, letter tile, placeholder, or none). */
function dshmlModelButton(mark: ModelMark | null, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dshml-model-icon-btn';
  button.dataset.dshmlOwner = '1';
  button.dataset.dshmlKind = 'model';
  const accessible = dshmlT('section.change');
  button.setAttribute('aria-label', accessible);
  button.setAttribute('title', accessible);
  dshmlWriteModelMark(button, mark);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(button);
  });
  return button;
}

/** Current provider directory (re-read on click instead of reusing a pass snapshot). */
function dshmlCatalogProvidersNow(): readonly CatalogProvider[] {
  const catalog = dshmlCatalogState();
  return Array.isArray(catalog.providers) ? catalog.providers : [];
}

/** Current provider route ids, for re-resolving a row identity on click. */
function dshmlCatalogProviderIdsNow(): ReadonlySet<string> {
  return new Set(dshmlCatalogProvidersNow().map((entry) => entry.providerId));
}

/** Localized display names the shipped Models page substitutes for some routes. */
const DSHML_DISPLAY_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // The Models page renders the account row with its own localized label
  // (`t("deepSeekAccount")`), not the directory's English display name.
  'deepseek-account': ['DeepSeek Account', 'DeepSeek 账号'],
});

/** Read the display name of a provider row / editor title element. */
function dshmlTextOf(element: Element | null): string {
  return element !== null ? String(element.textContent ?? '').trim() : '';
}

/** Find the provider identity whose display name an element shows. */
function dshmlProviderForText(providers: readonly CatalogProvider[], text: string): CatalogProvider | null {
  for (const entry of providers) {
    if (entry.displayName === text) return entry;
  }
  if (text === '') return null;
  for (const entry of providers) {
    const aliases = DSHML_DISPLAY_ALIASES[entry.providerId];
    if (aliases !== undefined && aliases.includes(text)) return entry;
  }
  return null;
}

/** Whether a provider entry is an official channel (vendor mark eligible). */
function dshmlIsOfficial(entry: CatalogProvider | null): boolean {
  return entry !== null && entry.official === true && entry.declared !== true;
}

/** `data-dshml-seat` marks the 22px slot this module reserves before a name. */
const DSHML_SEAT_ATTR = 'data-dshml-seat';

/** Set (or clear) a dataset field only when it differs — an idle pass must not write. */
function dshmlSetDataset(node: HTMLElement, key: string, value: string | null): void {
  const current = node.dataset[key];
  if (value === null) {
    if (current !== undefined) delete node.dataset[key];
    return;
  }
  if (current !== value) node.dataset[key] = value;
}

/** Set (or clear) an attribute only when it differs — an idle pass must not write. */
function dshmlSetAttribute(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * The 22px mark seat this module owns immediately before `target`, if any.
 *
 * The seat is a plain span that stays in place whether or not a vendor mark is
 * known, so a provider name never moves when its mark renders. It is inserted
 * from the first decoration pass, before the catalog can decide official vs
 * hand-declared, and stays put in both cases (official → mark, declared → the
 * empty reserved width).
 */
function dshmlSeatBefore(target: Element): HTMLSpanElement | null {
  const previous = target.previousElementSibling;
  if (previous === null) return null;
  if (previous.getAttribute(DSHML_SEAT_ATTR) === '1') return previous as HTMLSpanElement;
  // Adopt a vendor mark inserted by an earlier build of this module (hot reload):
  // it already sits in the seat position and only needs the seat marker.
  if (previous.getAttribute('data-dshml-owner') === '1' && previous.classList.contains('dshml-vendor')) {
    previous.setAttribute(DSHML_SEAT_ATTR, '1');
    return previous as HTMLSpanElement;
  }
  return null;
}

/** Ensure the 22px mark seat immediately before a provider row name / editor title. */
function dshmlEnsureSeat(target: Element): HTMLSpanElement | null {
  const existing = dshmlSeatBefore(target);
  if (existing !== null) return existing;
  const parent = target.parentElement;
  if (parent === null) return null;
  const seat = document.createElement('span');
  seat.className = 'dshml-insert dshml-vendor';
  seat.dataset.dshmlOwner = '1';
  seat.setAttribute(DSHML_SEAT_ATTR, '1');
  seat.setAttribute('aria-hidden', 'true');
  parent.insertBefore(seat, target);
  return seat;
}

/** Draw the official vendor mark into a seat, or leave it as the reserved width. */
function dshmlPaintSeat(seat: HTMLSpanElement, entry: CatalogProvider | null): void {
  const mark =
    entry !== null && dshmlIsOfficial(entry) ? dshmlVendorMark(entry.providerId, entry.displayName, true) : null;
  if (mark !== null && mark.svg !== null && entry !== null) {
    dshmlWriteMarkup(seat, mark.svg);
    dshmlSetDataset(seat, 'dshmlVendor', entry.providerId);
    dshmlSetAttribute(seat, 'title', dshmlT('badge.provider') + ' · ' + entry.displayName);
    dshmlSetAttribute(seat, 'aria-hidden', 'false');
    return;
  }
  dshmlWriteMarkup(seat, '');
  dshmlSetDataset(seat, 'dshmlVendor', null);
  dshmlSetAttribute(seat, 'title', null);
  dshmlSetAttribute(seat, 'aria-hidden', 'true');
}

/**
 * Reserve (or refresh) the 22px mark seat before a provider name.
 *
 * Official channels fill it with the vendor mark; hand-declared providers keep
 * the empty seat, so the name sits at the same x for both and does not jump when
 * a mark resolves.
 * @param target - provider row name or editor title span.
 * @param entry - matching catalog entry, or null while the directory loads.
 */
function dshmlDecorateVendorSeat(target: Element, entry: CatalogProvider | null): void {
  const seat = dshmlEnsureSeat(target);
  if (seat !== null) dshmlPaintSeat(seat, entry);
}

/** Drop a seat this module inserted before `target` (it is no longer a name seat). */
function dshmlRemoveSeatBefore(target: Element): void {
  const seat = dshmlSeatBefore(target);
  if (seat !== null) seat.remove();
}

/** Whether a text element is a provider row name (has row action buttons beside it). */
function dshmlIsRowName(element: Element): boolean {
  const identity = element.parentElement;
  const head = identity === null ? null : identity.parentElement;
  if (head === null) return false;
  const buttons = head.querySelectorAll<HTMLButtonElement>('button[aria-label]');
  for (const button of buttons) {
    if (DSHML_ACTION_LABEL.test(button.getAttribute('aria-label') ?? '')) return true;
  }
  return false;
}

/** Whether a text element is an editor title (inside a header block, no action buttons). */
function dshmlIsEditorTitle(element: Element): boolean {
  const header = element.parentElement;
  if (header === null) return false;
  if (header.querySelector('button[aria-label]') !== null) return false;
  // Count the page's own children only: the 22px mark seat inserted before the
  // title must not make the header look like a different kind of block on the
  // next pass (that would stop the seat from being refreshed).
  let pageChildren = 0;
  for (const child of header.children) {
    if (child.getAttribute('data-dshml-owner') !== '1') pageChildren += 1;
  }
  return pageChildren <= 2 && element.tagName === 'SPAN';
}

/** Locate a provider <select> anywhere inside `node` (used while climbing a model row). */
function dshmlFindProviderSelectIn(node: Element | null, providerIds: ReadonlySet<string>): HTMLSelectElement | null {
  if (node === null) return null;
  for (const select of node.querySelectorAll<HTMLSelectElement>('select')) {
    const options = [...select.options];
    if (options.length > 0 && options.every((option) => providerIds.has(option.value))) return select;
  }
  return null;
}

/** Locate the hand-declared provider id input ("Provider ID" / "提供方 ID"). */
function dshmlFindProviderIdInput(node: Element | null): HTMLInputElement | null {
  if (node === null) return null;
  for (const input of node.querySelectorAll<HTMLInputElement>('input[aria-label]')) {
    const label = input.getAttribute('aria-label') ?? '';
    if (/^(?:Provider ID|提供方\s*ID|提供方ID)$/i.test(label.trim())) return input;
  }
  return null;
}

/** Locate the provider identity that owns one element (model row / editor card). */
function dshmlOwnerProvider(
  element: Element,
  providers: readonly CatalogProvider[],
  providerIds: ReadonlySet<string>,
): OwnerProvider | null {
  let node: Element | null = element;
  for (let depth = 0; node !== null && depth < 12; depth += 1) {
    const select = dshmlFindProviderSelectIn(node, providerIds);
    if (select !== null && providerIds.has(select.value)) {
      return { providerId: select.value, entry: providers.find((entry) => entry.providerId === select.value) ?? null };
    }
    // Hand-declared (custom API) cards name the route in a free-text field.
    const idInput = dshmlFindProviderIdInput(node);
    if (idInput !== null && idInput.value.trim() !== '') {
      const providerId = idInput.value.trim();
      return { providerId, entry: providers.find((entry) => entry.providerId === providerId) ?? null };
    }
    if (node.tagName === 'LI') {
      for (const span of node.querySelectorAll<HTMLSpanElement>('span')) {
        if (span.childElementCount !== 0) continue;
        const text = dshmlTextOf(span);
        if (text === '') continue;
        const entry = dshmlProviderForText(providers, text);
        if (entry !== null) return { providerId: entry.providerId, entry };
      }
      break;
    }
    node = node.parentElement;
  }
  return null;
}

/** Build model identity data for one row. */
function dshmlModelIdentity(
  row: HTMLElement,
  providers: readonly CatalogProvider[],
  providerIds: ReadonlySet<string>,
): ModelRowIdentity | null {
  const inputs = [...row.querySelectorAll<HTMLInputElement>('input')];
  let idInput: HTMLInputElement | null = null;
  let nameInput: HTMLInputElement | null = null;
  for (const input of inputs) {
    const label = input.getAttribute('aria-label') ?? '';
    if (idInput === null && DSHML_MODEL_ID_LABEL.test(label)) idInput = input;
    else if (nameInput === null && DSHML_MODEL_NAME_LABEL.test(label)) nameInput = input;
  }
  if (idInput === null) return null;
  const modelId = idInput.value.trim();
  if (modelId === '') return null;
  const owner = dshmlOwnerProvider(row, providers, providerIds);
  if (owner === null) return null;
  const displayName = owner.entry !== null ? owner.entry.displayName : owner.providerId;
  const modelName = nameInput !== null && nameInput.value.trim() !== '' ? nameInput.value.trim() : modelId;
  return {
    provider: { id: owner.providerId, name: displayName },
    model: { id: modelId, name: modelName },
    row,
  };
}

/** Update all model rows in the dialog. */
function dshmlDecorateModelRows(
  root: Element,
  providers: readonly CatalogProvider[],
  providerIds: ReadonlySet<string>,
): void {
  const rows = new Set<HTMLElement>();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[aria-label]')) {
    const label = input.getAttribute('aria-label') ?? '';
    if (!DSHML_MODEL_ID_LABEL.test(label)) continue;
    if (input.parentElement !== null) rows.add(input.parentElement);
  }
  for (const row of rows) {
    if (row.dataset.dshmlModelRow !== '1') {
      row.dataset.dshmlModelRow = '1';
    }
    const identity = dshmlModelIdentity(row, providers, providerIds);
    let button = row.querySelector<HTMLButtonElement>(':scope > [data-dshml-kind="model"]');
    if (button === null) {
      button = dshmlModelButton(null, function onOpenPicker(anchor) {
        // Resolve on click: the catalogue may have arrived after this seat was
        // inserted, and the row's inputs may have changed since the last pass.
        const current = dshmlModelIdentity(row, dshmlCatalogProvidersNow(), dshmlCatalogProviderIdsNow());
        if (current === null) return;
        dshmlOpenIconPicker({
          providerId: current.provider.id,
          modelId: current.model.id,
          displayName: current.model.name,
          anchor: anchor,
        });
      });
      row.insertBefore(button, row.firstChild);
    }
    // Keep the seat — and the 22px grid column it occupies — whether or not the
    // row can be resolved yet; the dashed placeholder is the icon skeleton.
    dshmlWriteModelMark(button, identity === null ? null : dshmlModelMark(identity.provider, identity.model));
    if (row.firstElementChild !== button) row.insertBefore(button, row.firstChild);
  }
}

/**
 * Reserve and fill the 22px mark seat before provider-row names and editor titles.
 *
 * Runs on every decoration pass: the seat is created before the catalog can name
 * the provider (a saved row is recognisable from its Edit/Delete actions), filled
 * when the directory resolves an official channel, and left as empty reserved
 * width for hand-declared providers — so a name never moves when a mark appears.
 * @param root - the settings dialog root.
 * @param providers - current provider directory.
 */
function dshmlDecorateProviderNames(root: Element, providers: readonly CatalogProvider[]): void {
  const loading = dshmlCatalogState().status === 'loading';
  // Dedupe by parent element: a row's name span and an editor title span can
  // carry the same text (catalog display names equal route ids in practice), and
  // they live under different parents — text-keyed dedupe would skip the second.
  const seenParents = new WeakSet<HTMLElement>();
  for (const span of root.querySelectorAll<HTMLSpanElement>('span')) {
    if (span.childElementCount !== 0) continue;
    // Never decorate our own inserted UI (the combobox menu reuses plain spans).
    if (span.closest('[data-dshml-owner="1"]') !== null) continue;
    const text = dshmlTextOf(span);
    if (text === '') continue;
    const isRowName = dshmlIsRowName(span);
    const isEditorTitle = dshmlIsEditorTitle(span);
    if (!isRowName && !isEditorTitle) continue;
    const parent = span.parentElement;
    if (parent === null || seenParents.has(parent)) continue;
    const entry = dshmlProviderForText(providers, text);
    if (entry !== null) {
      // Official channels fill the seat; declared providers keep it empty.
      seenParents.add(parent);
      dshmlDecorateVendorSeat(span, entry);
      continue;
    }
    if (loading === true && isRowName) {
      // Directory not resolved yet: reserve the seat now so the saved provider
      // row's name cannot jump when its mark arrives. Editor titles are not
      // guessed structurally — before the directory names the provider, a
      // two-child header block is indistinguishable from a field label.
      seenParents.add(parent);
      dshmlDecorateVendorSeat(span, null);
      continue;
    }
    // A stale seat can only be left by a name element that changed role.
    dshmlRemoveSeatBefore(span);
  }
}

/** Build the custom provider combobox for one native <select>. */
function dshmlBuildCombo(
  select: HTMLSelectElement,
  providers: readonly CatalogProvider[],
  onSelect: (value: string) => void,
): ProviderCombo {
  const wrapper = document.createElement('div');
  wrapper.className = 'dshml-combo';
  wrapper.dataset.dshmlOwner = '1';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dshml-combo-button';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const mark = document.createElement('span');
  mark.className = 'dshml-combo-mark';
  mark.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'dshml-combo-label';

  const chevron = document.createElement('span');
  chevron.className = 'dshml-combo-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = DSHML_CHEVRON_SVG;

  button.append(mark, label, chevron);

  const menu = document.createElement('div');
  menu.className = 'dshml-combo-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  wrapper.append(button, menu);

  const sync = (): void => {
    const options = [...select.options];
    const selected = options.find((option) => option.selected) ?? options[0];
    const value = selected !== undefined ? selected.value : '';
    const entry = providers.find((candidate) => candidate.providerId === value) ?? null;
    const vendor =
      entry !== null && dshmlIsOfficial(entry)
        ? dshmlVendorMark(value, entry.displayName, true)
        : dshmlVendorMark(value, selected !== undefined ? selected.textContent : value, true);
    const labelText = selected !== undefined ? String(selected.textContent ?? '') : '';
    dshmlWriteText(label, labelText);
    dshmlWriteMarkup(mark, vendor.svg !== null ? vendor.svg : '');
    if (mark.hidden !== (vendor.svg === null)) mark.hidden = vendor.svg === null;
    const aria = dshmlT('section.provider') + ': ' + labelText;
    if (button.getAttribute('aria-label') !== aria) button.setAttribute('aria-label', aria);
  };

  const combo: ProviderCombo = {
    select,
    wrapper,
    button,
    menu,
    mark,
    label,
    open: false,
    activeIndex: -1,
    items: [],
    onSelect,
    sync,
  };

  const close = (restoreFocus: boolean): void => {
    if (!combo.open) return;
    combo.open = false;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    combo.activeIndex = -1;
    if (restoreFocus === true) button.focus();
  };

  const setActive = (index: number): void => {
    if (combo.items.length === 0) return;
    combo.activeIndex = (index + combo.items.length) % combo.items.length;
    combo.items.forEach((item, at) => {
      item.dataset.active = at === combo.activeIndex ? 'true' : 'false';
      item.tabIndex = at === combo.activeIndex ? 0 : -1;
    });
    const active = combo.items[combo.activeIndex];
    if (active !== undefined) active.focus({ preventScroll: true });
  };

  const choose = (value: string): void => {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync();
    close(true);
    if (typeof onSelect === 'function') onSelect(value);
  };

  const buildMenu = (): void => {
    menu.replaceChildren();
    combo.items = [];
    const options = [...select.options];
    options.forEach((option) => {
      const value = option.value;
      const vendor = dshmlVendorMark(value, option.textContent, true);
      const item = document.createElement('div');
      item.className = 'dshml-combo-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      item.dataset.value = value;
      item.tabIndex = -1;
      const itemMark = document.createElement('span');
      itemMark.className = 'dshml-combo-mark';
      itemMark.setAttribute('aria-hidden', 'true');
      if (vendor.svg !== null) itemMark.innerHTML = vendor.svg;
      const itemLabel = document.createElement('span');
      itemLabel.className = 'dshml-combo-item-label';
      itemLabel.textContent = String(option.textContent ?? '');
      item.append(itemMark, itemLabel);
      item.addEventListener('click', (event) => {
        event.preventDefault();
        choose(value);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose(value);
        }
      });
      menu.appendChild(item);
      combo.items.push(item);
    });
  };

  const open = (): void => {
    if (combo.open) return;
    buildMenu();
    sync();
    combo.open = true;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const selectedIndex = combo.items.findIndex((item) => item.dataset.value === select.value);
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (combo.open) close(true);
    else open();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape') {
      close(true);
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(combo.activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(combo.activeIndex - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  });
  button.addEventListener('blur', () => {
    // Defer so a click on a menu item still lands.
    setTimeout(() => {
      if (combo.open && !wrapper.contains(document.activeElement)) close(false);
    }, 0);
  });

  sync();
  return combo;
}

/** Hide the native select while keeping it as the React state source. */
function dshmlHideSelect(select: HTMLSelectElement): void {
  if (select.dataset.dshmlHidden === '1') return;
  select.dataset.dshmlHidden = '1';
  select.dataset.dshmlPrevStyle = select.getAttribute('style') ?? '';
  select.dataset.dshmlPrevTabindex = select.getAttribute('tabindex') ?? '';
  select.dataset.dshmlPrevAria = select.getAttribute('aria-hidden') ?? '';
  select.style.cssText =
    'position:absolute;opacity:0;pointer-events:none;width:0;height:0;margin:0;padding:0;border:0;';
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');
}

/** Restore one hidden native select. */
function dshmlRestoreSelect(select: HTMLSelectElement): void {
  if (select.dataset.dshmlHidden !== '1') return;
  delete select.dataset.dshmlHidden;
  const style = select.dataset.dshmlPrevStyle ?? '';
  const tabIndex = select.dataset.dshmlPrevTabindex ?? '';
  const aria = select.dataset.dshmlPrevAria ?? '';
  if (style === '') select.removeAttribute('style');
  else select.setAttribute('style', style);
  if (tabIndex === '') select.removeAttribute('tabindex');
  else select.setAttribute('tabindex', tabIndex);
  if (aria === '') select.removeAttribute('aria-hidden');
  else select.setAttribute('aria-hidden', aria);
  delete select.dataset.dshmlPrevStyle;
  delete select.dataset.dshmlPrevTabindex;
  delete select.dataset.dshmlPrevAria;
}

/** Find the provider <select> in the add card, if any. */
function dshmlFindProviderSelect(root: Element, providerIds: ReadonlySet<string>): HTMLSelectElement | null {
  const selects = [...root.querySelectorAll<HTMLSelectElement>('select')];
  for (const select of selects) {
    const options = [...select.options];
    if (options.length === 0) continue;
    if (options.every((option) => providerIds.has(option.value))) return select;
  }
  return null;
}

/** Decorate (or refresh) the provider select of the add card. */
function dshmlDecorateProviderSelect(
  root: Element,
  state: DecorState,
  providers: readonly CatalogProvider[],
  providerIds: ReadonlySet<string>,
): void {
  const select = dshmlFindProviderSelect(root, providerIds);
  const existing = root.querySelector<HTMLElement>('[data-dshml-owner="1"][data-dshml-combo="1"]');
  if (select === null) {
    if (existing !== null) existing.remove();
    state.combo = null;
    return;
  }
  if (state.combo !== null && state.combo.select === select && select.isConnected) {
    state.combo.sync();
    return;
  }
  if (state.combo !== null) {
    state.combo.wrapper.remove();
    dshmlRestoreSelect(state.combo.select);
    state.combo = null;
  }
  dshmlHideSelect(select);
  const combo = dshmlBuildCombo(select, providers, () => dshmlScheduleDecorate(state));
  combo.wrapper.dataset.dshmlCombo = '1';
  select.insertAdjacentElement('afterend', combo.wrapper);
  state.combo = combo;
  // Keep several combos impossible: any older wrapper is removed.
  for (const stale of root.querySelectorAll<HTMLElement>('[data-dshml-owner="1"][data-dshml-combo="1"]')) {
    if (stale !== combo.wrapper) stale.remove();
  }
}

/** One decoration pass. */
function dshmlDecorate(state: DecorState): void {
  if (state.disposed) return;
  const root = document.querySelector(DSHML_SETTINGS_ROOT);
  state.lastRoot = root;
  const catalog = dshmlCatalogState();
  const providers: readonly CatalogProvider[] = Array.isArray(catalog.providers) ? catalog.providers : [];
  const providerIds = new Set(providers.map((entry) => entry.providerId));
  if (root === null) {
    if (state.combo !== null) {
      dshmlRestoreSelect(state.combo.select);
      state.combo.wrapper.remove();
      state.combo = null;
    }
    return;
  }
  dshmlDecorateProviderNames(root, providers);
  dshmlDecorateModelRows(root, providers, providerIds);
  dshmlDecorateProviderSelect(root, state, providers, providerIds);
  dshmlDecorateNavIcon(root);
}

/** Debounced schedule. */
function dshmlScheduleDecorate(state: DecorState): void {
  if (state.disposed || state.timer !== null) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    dshmlDecorate(state);
  }, 40);
}

/**
 * Decorate an open settings dialog now, without waiting for the debounce timer.
 *
 * Used for the plugin's own mount and for state changes that are not page
 * mutations (icon override, provider catalogue). Doing the pass synchronously
 * from those callbacks keeps the marks on the same frame as the state they show;
 * the debounce stays for keystroke-driven refreshes, where coalescing a burst of
 * `input` events is worth more than saving a frame.
 * @param state - the mounted decorator state.
 */
function dshmlPaintSettingsNow(state: DecorState): void {
  if (state.disposed) return;
  if (document.querySelector(DSHML_SETTINGS_ROOT) === null) return;
  dshmlDecorate(state);
}

/** Remove everything this decorator inserted and restore the native select. */
function dshmlClearDecorations(state: DecorState): void {
  if (state.combo !== null) {
    try {
      dshmlRestoreSelect(state.combo.select);
    } catch {
      // The select may already be gone with the dialog.
    }
    state.combo.wrapper.remove();
    state.combo = null;
  }
  for (const node of document.querySelectorAll('[data-dshml-owner="1"]')) node.remove();
  for (const row of document.querySelectorAll<HTMLElement>('[data-dshml-model-row]')) {
    delete row.dataset.dshmlModelRow;
  }
  dshmlClearNavIcon();
}

/** Currently mounted decorator state (diagnostics / manual re-run). */
let dshmlActiveDecorState: DecorState | null = null;

/** Re-run the decorator now (diagnostics only). */
export function dshmlDecorateNow(): void {
  if (dshmlActiveDecorState !== null) dshmlDecorate(dshmlActiveDecorState);
}

/** Request a debounced decorator re-run (diagnostics only). */
export function dshmlRequestDecorate(): void {
  if (dshmlActiveDecorState !== null) dshmlScheduleDecorate(dshmlActiveDecorState);
}

/**
 * Mount the settings-page decorator.
 * @param _ctx - the plugin context (unused beyond logging).
 * @returns disposer.
 */
export function dshmlMountSettingsDecorator(_ctx: DshContext): () => void {
  if (typeof document === 'undefined') return function noop() {};
  const state: DecorState = {
    disposed: false,
    timer: null,
    combo: null,
    lastRoot: null,
  };
  dshmlActiveDecorState = state;
  const schedule = (): void => dshmlScheduleDecorate(state);
  const observer = new MutationObserver((records) => {
    // Our own passes write into the nodes they inserted; re-scheduling on those
    // records would loop forever. Only page (React-owned) mutations matter.
    let relevant = false;
    let repaint = false;
    for (const record of records) {
      if (dshmlIsSelfMutation(record)) continue;
      relevant = true;
      if (dshmlRendersSettingsRoot(record)) repaint = true;
    }
    if (!relevant) return;
    // A page change inside the open dialog is reflected before the browser
    // paints: this callback is a microtask, so the seats and marks it inserts are
    // already in the layout of the frame that first shows the changed markup.
    // Everything outside the dialog keeps the debounce (a closed dialog has
    // nothing to decorate, and unrelated page churn should not pay for a pass).
    if (repaint) dshmlDecorate(state);
    else schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const onInput = (): void => schedule();
  const onChange = (): void => schedule();
  const onPointerDown = (event: PointerEvent): void => {
    if (state.combo !== null && state.combo.open) {
      const target = event.target;
      if (!(target instanceof Node) || !state.combo.wrapper.contains(target)) {
        state.combo.open = false;
        state.combo.menu.hidden = true;
        state.combo.button.setAttribute('aria-expanded', 'false');
      }
    }
  };
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  const offIcons = dshmlSubscribeIconState(() => dshmlPaintSettingsNow(state));
  const offCatalog = dshmlSubscribeCatalog(() => dshmlPaintSettingsNow(state));
  // The dialog may already be open when the plugin (re)mounts — a hot reload while
  // Settings is visible, or the verification fixture. Paint it in the same task
  // rather than through a timer: the first frame must not show the bare page.
  dshmlPaintSettingsNow(state);
  return function dispose() {
    state.disposed = true;
    if (dshmlActiveDecorState === state) dshmlActiveDecorState = null;
    if (state.timer !== null) clearTimeout(state.timer);
    observer.disconnect();
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    offIcons();
    offCatalog();
    dshmlClearDecorations(state);
  };
}
