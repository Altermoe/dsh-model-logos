/**
 * Settings-navigation glyph: the artwork contract and the row matcher.
 *
 * The shell paints a fixed glyph per known section id and only the localized
 * label text identifies a row in the DOM, so these tests pin the pieces a future
 * harness change would break visibly: the glyph's 16 px `currentColor` style, the
 * CSS mask encoding, the row marking rules (label in any shipped language, an
 * existing glyph as the row signature), and the removal path.
 */
import { describe, expect, it } from 'vitest';

import {
  DSHML_NAV_ICON_CSS,
  DSHML_NAV_ICON_SVG,
  DSHML_NAV_ICON_URL,
  DSHML_NAV_MARKER,
  dshmlDecorateNavIcon,
  dshmlNavIconLabels,
} from '../src/nav-icon';

/** The five SVG attributes that must never appear in an inlined / masked glyph. */
const UNSAFE = /<script|\sid\s*=|\son[a-z]+\s*=|https?:/i;

describe('settings nav glyph', () => {
  it('is a 16 px, currentColor glyph in the shipped icon style', () => {
    expect(DSHML_NAV_ICON_SVG.startsWith('<svg')).toBe(true);
    expect(DSHML_NAV_ICON_SVG).toContain('viewBox="0 0 16 16"');
    expect(DSHML_NAV_ICON_SVG).toContain('width="16"');
    expect(DSHML_NAV_ICON_SVG).toContain('height="16"');
    expect(DSHML_NAV_ICON_SVG).toContain('aria-hidden="true"');
    expect(DSHML_NAV_ICON_SVG).toContain('stroke-width="1.3"');
    expect(DSHML_NAV_ICON_SVG).toContain('currentColor');
    // A solid tile next to three outlined ones: the "one mark chosen" reading.
    expect(DSHML_NAV_ICON_SVG).toContain('fill="currentColor"');
  });

  it('stays self-contained (no ids, scripts, event handlers or external references)', () => {
    expect(UNSAFE.test(DSHML_NAV_ICON_SVG.replace(/\sxmlns[^=]*="[^"]*"/gi, ''))).toBe(false);
  });

  it('encodes the glyph into a quoted, escaping-free CSS mask url', () => {
    expect(DSHML_NAV_ICON_URL.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(DSHML_NAV_ICON_URL.endsWith('")')).toBe(true);
    expect(DSHML_NAV_ICON_URL).toContain(encodeURIComponent(DSHML_NAV_ICON_SVG));
    // Exactly the two quotes of the CSS url() itself — nothing in the payload is
    // left raw, so the declaration cannot be terminated early.
    expect(DSHML_NAV_ICON_URL.split('"')).toHaveLength(3);
  });

  it('hides the shell glyph and paints ours only on the marked row', () => {
    expect(DSHML_NAV_ICON_CSS).toContain(`[data-dshml-nav="${DSHML_NAV_MARKER}"] > svg`);
    expect(DSHML_NAV_ICON_CSS).toContain(`[data-dshml-nav="${DSHML_NAV_MARKER}"]::before`);
    expect(DSHML_NAV_ICON_CSS).toContain('display: none;');
    expect(DSHML_NAV_ICON_CSS).toContain('content: "";');
    expect(DSHML_NAV_ICON_CSS).toContain('background-color: currentColor;');
    expect(DSHML_NAV_ICON_CSS).toContain('width: 16px;');
    expect(DSHML_NAV_ICON_CSS).toContain('height: 16px;');
    expect(DSHML_NAV_ICON_CSS).toContain('-webkit-mask: ');
    expect(DSHML_NAV_ICON_CSS).toContain('mask: ');
    expect(DSHML_NAV_ICON_CSS).not.toContain('AnXs9G');
  });

  it('recognises the row label in every shipped language', () => {
    expect(dshmlNavIconLabels()).toEqual(expect.arrayContaining(['Model icons', '模型图标']));
    expect(dshmlNavIconLabels().length).toBeGreaterThanOrEqual(2);
  });
});

/** A minimal `Element` stand-in: just the DOM surface `dshmlDecorateNavIcon` reads. */
interface FakeRow {
  firstElementChild: { tagName: string } | null;
  children: Array<{ tagName: string; textContent: string }>;
  attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
}

function fakeRow(label: string): FakeRow {
  const attributes = new Map<string, string>();
  return {
    firstElementChild: { tagName: 'SVG' },
    children: [{ tagName: 'SPAN', textContent: label }],
    attributes,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => void attributes.set(name, value),
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => void attributes.delete(name),
  };
}

/** The smallest `Element` stand-in the matcher needs for a settings panel root. */
function fakeRoot(buttons: FakeRow[]): Element {
  const nav = { querySelectorAll: () => buttons } as unknown as Element;
  const root = {
    querySelector: (selector: string) => (selector === ':scope > nav' ? nav : null),
  } as unknown as Element;
  return root;
}

describe('nav row marking', () => {
  it('marks only the row whose label is this plugin section title', () => {
    const oursEn = fakeRow('Model icons');
    const oursZh = fakeRow('模型图标');
    const general = fakeRow('General');
    dshmlDecorateNavIcon(fakeRoot([general, oursEn, oursZh]));
    expect(general.getAttribute('data-dshml-nav')).toBe(null);
    expect(oursEn.getAttribute('data-dshml-nav')).toBe(DSHML_NAV_MARKER);
    expect(oursZh.getAttribute('data-dshml-nav')).toBe(DSHML_NAV_MARKER);
  });

  it('does not mark a label match that is not a nav row (no glyph child)', () => {
    const impostor = fakeRow('Model icons');
    impostor.firstElementChild = null;
    dshmlDecorateNavIcon(fakeRoot([impostor]));
    expect(impostor.getAttribute('data-dshml-nav')).toBe(null);
  });

  it('is idempotent and clears a stale marker when the label stops matching', () => {
    const row = fakeRow('Model icons');
    const root = fakeRoot([row]);
    dshmlDecorateNavIcon(root);
    dshmlDecorateNavIcon(root);
    expect(row.getAttribute('data-dshml-nav')).toBe(DSHML_NAV_MARKER);
    row.children[0] = { tagName: 'SPAN', textContent: 'Something else' };
    dshmlDecorateNavIcon(root);
    expect(row.hasAttribute('data-dshml-nav')).toBe(false);
  });

  it('does nothing without a settings nav', () => {
    const empty = { querySelector: () => null } as unknown as Element;
    expect(() => dshmlDecorateNavIcon(empty)).not.toThrow();
  });
});
