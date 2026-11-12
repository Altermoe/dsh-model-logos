/**
 * Motion playback for every mark surface.
 *
 * A mark that carries an `animatedSvg` may play, depending on the surface and the
 * user's policy: `always` plays immediately, `hover` swaps the poster for the
 * animation on pointer enter / keyboard focus, `never` keeps the poster. The
 * system's `prefers-reduced-motion: reduce` is honoured independently of the
 * stored policy (allowing motion is a user preference; reducing it is an
 * accessibility one), and the animation is never written when the atlas is absent.
 *
 * Two entry points share one HTML resolver:
 *  - `DshmlPlayableMark` for React surfaces (composer label, picker, Model icons
 *    page);
 *  - `dshmlAttachPlayableMark` for the Settings decoration, which owns plain DOM
 *    nodes and must not re-write identical markup on every pass.
 */
import type { ReactElement } from 'react';
import { h, React } from './runtime';
import { dshmlIconState, dshmlUseIconState } from './overrides';
import { dshmlPlaybackOf, dshmlPlayableMarkHtml } from './motion';
import type { DshmlPlaybackSurface } from './types';

/** The render data a playable mark needs (structurally ModelMark / VendorMark). */
export interface DshmlPlayableMarkData {
  svg: string | null;
  animatedSvg?: string | null;
  title?: string | null;
}

/** Whether the system currently asks for reduced motion. */
export function dshmlPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Props of {@link DshmlPlayableMark}. */
export interface DshmlPlayableMarkProps {
  mark: DshmlPlayableMarkData | null;
  surface: DshmlPlaybackSurface;
  className?: string;
  /** Overrides the mark's own title (the picker keeps its label on the button). */
  title?: string | null;
}

/**
 * A decorative span whose inner SVG follows the surface's playback policy.
 *
 * The span subscribes to the icon store (policy changes repaint every surface) and
 * to the reduced-motion media query. The nearest focusable ancestor is watched for
 * `focusin`/`focusout` so keyboard users get the same preview as pointer users
 * without making the mark itself a tab stop.
 * @param props - mark data, surface and optional class/title.
 */
export function DshmlPlayableMark(props: DshmlPlayableMarkProps): ReactElement | null {
  // Subscribing keeps the mode in sync when the Settings group changes it.
  const iconState = dshmlUseIconState();
  const [active, setActive] = React.useState(false);
  const [reduced, setReduced] = React.useState(dshmlPrefersReducedMotion);
  const ref = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(function watchReducedMotion() {
    try {
      if (typeof matchMedia !== 'function') return undefined;
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = function onChange(): void {
        setReduced(query.matches);
      };
      query.addEventListener('change', onChange);
      return function stop() {
        query.removeEventListener('change', onChange);
      };
    } catch {
      return undefined;
    }
  }, []);

  React.useEffect(function watchFocusWithin() {
    const node = ref.current;
    if (node === null || typeof node.closest !== 'function') return undefined;
    const host = node.closest('button, [role="button"], [tabindex]') ?? node.parentElement;
    if (host === null) return undefined;
    const enter = function enter(): void {
      setActive(true);
    };
    const leave = function leave(): void {
      setActive(false);
    };
    host.addEventListener('focusin', enter);
    host.addEventListener('focusout', leave);
    return function stop() {
      host.removeEventListener('focusin', enter);
      host.removeEventListener('focusout', leave);
    };
  }, []);

  const mark = props.mark;
  if (mark === null || (mark.svg === null && (mark.animatedSvg === undefined || mark.animatedSvg === null))) {
    return null;
  }
  const mode = dshmlPlaybackOf(iconState.playback)[props.surface];
  const html = dshmlPlayableMarkHtml(mark, mode, active, reduced);
  return h('span', {
    ref,
    className: props.className,
    title: props.title ?? mark.title ?? undefined,
    'aria-hidden': 'true',
    dangerouslySetInnerHTML: { __html: html },
    onPointerEnter: function onPointerEnter() {
      setActive(true);
    },
    onPointerLeave: function onPointerLeave() {
      setActive(false);
    },
  });
}

/** One live playback attachment for a plain DOM node. */
interface DshmlPlayableAttachment {
  render(): void;
  update(mark: DshmlPlayableMarkData | null, surface: DshmlPlaybackSurface): void;
}

/** Attachments owned per node, so decorator passes reuse listeners and state. */
const dshmlPlayableAttachments = new WeakMap<HTMLElement, DshmlPlayableAttachment>();

/** Every live attachment; the one global media listener iterates this set. */
const dshmlPlayableLive = new Set<DshmlPlayableAttachment>();

/** Current reduced-motion preference (updated by the one global listener). */
let dshmlPlayableReduced = dshmlPrefersReducedMotion();

/** One `matchMedia` listener shared by every decorated node. */
function dshmlEnsureReducedMotionWatch(): void {
  try {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change', function onChange() {
      dshmlPlayableReduced = query.matches;
      for (const attachment of Array.from(dshmlPlayableLive)) attachment.render();
    });
  } catch {
    /* a platform without matchMedia keeps the initial preference */
  }
}

dshmlEnsureReducedMotionWatch();

/**
 * Bind one plain DOM node (a Settings mark seat / mark span) to the playback
 * policy. Re-called on every decoration pass: the existing attachment only updates
 * its mark/surface and re-renders when the markup actually changes.
 * @param node - the owned element whose inner HTML is the mark.
 * @param mark - poster + optional playing markup.
 * @param surface - playback surface.
 */
export function dshmlAttachPlayableMark(
  node: HTMLElement,
  mark: DshmlPlayableMarkData | null,
  surface: DshmlPlaybackSurface,
): void {
  const existing = dshmlPlayableAttachments.get(node);
  if (existing !== undefined) {
    existing.update(mark, surface);
    return;
  }
  let current = mark;
  let currentSurface = surface;
  let active = false;
  let lastHtml = '\u0000';
  let everConnected = node.isConnected !== false;
  const attachment: DshmlPlayableAttachment = {
    render(): void {
      const connected = typeof node.isConnected !== 'boolean' || node.isConnected;
      if (!connected && everConnected) {
        dshmlPlayableLive.delete(attachment);
        dshmlPlayableAttachments.delete(node);
        return;
      }
      if (connected) everConnected = true;
      const mode = dshmlPlaybackOf(dshmlIconState().playback)[currentSurface];
      const html = dshmlPlayableMarkHtml(current, mode, active, dshmlPlayableReduced);
      if (html !== lastHtml) {
        node.innerHTML = html;
        lastHtml = html;
      }
    },
    update(next, nextSurface): void {
      current = next;
      currentSurface = nextSurface;
      attachment.render();
    },
  };
  const enter = function enter(): void {
    active = true;
    attachment.render();
  };
  const leave = function leave(): void {
    active = false;
    attachment.render();
  };
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('focusin', enter);
  node.addEventListener('focusout', leave);
  dshmlPlayableAttachments.set(node, attachment);
  dshmlPlayableLive.add(attachment);
  attachment.render();
}

/** Forget one node's attachment (the decorator calls this before removing it). */
export function dshmlDetachPlayableMark(node: HTMLElement): void {
  const attachment = dshmlPlayableAttachments.get(node);
  if (attachment === undefined) return;
  dshmlPlayableAttachments.delete(node);
  dshmlPlayableLive.delete(attachment);
}
