/**
 * The motion sampling studio.
 *
 * One screen takes an animated image or a short video from file to a stored
 * motion record: import → frame → trim → sample → size budget → true-size
 * preview. The heavy browser work lives in `src/media-source.ts` (decode one
 * frame at a time) and `src/sprite.ts` (render, encode, slim, with the four-stage
 * sampling cache); this component owns the state machine, the interactions and
 * the copy.
 *
 * Layout follows one rule: **the picture is the workspace**. A single canvas
 * panel holds the stage — the baked playback in `Result`, the cropper over the
 * playhead frame in `Source` — with the transport underneath and the framing
 * zoom floating over the stage, so switching sides never moves the picture. The
 * right column carries the source timeline, the frame count and the true-size
 * tiles; a sticky dock under both keeps the size meter and the status line in
 * view while the modal scrolls.
 *
 * Design rules from the plan, in code: the crop is static geometry applied to
 * every frame; only the frame count and the clip change the sampling window
 * (crop changes reuse the decoded frames); a new result never blanks the old
 * stage while it is being produced; every automatic change is listed and can be
 * undone; and the four true-size tiles render the same mark strings the real
 * surfaces render.
 *
 * Nothing here may resize the modal outside a deliberate state change: the stage
 * is a fixed-aspect box, the status line reserves its row, scrollers reserve
 * their scrollbar, and every conditional control sits in a `nowrap` row.
 */
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { h, React } from './runtime';
import { dshmlT } from './i18n';
import type { CustomIconMotion } from './types';
import { dshmlBudgetPlan, dshmlCropRect, dshmlPosterSvg } from './custom-icons';
import type { DshmlCropPixels } from './custom-icons';
import {
  DSHML_MEDIA_ACCEPT,
  DshmlMediaError,
  dshmlMediaErrorCode,
  dshmlMediaFormatLabel,
  dshmlMediaKindOf,
  dshmlOpenMediaSource,
  dshmlReadFileDataUrl,
} from './media-source';
import type { DshmlMediaSource } from './media-source';
import {
  DSHML_MOTION_MAX_FRAMES,
  DSHML_MOTION_MAX_IMAGE_BYTES,
  DSHML_MOTION_MAX_RANGE_MS,
  DSHML_MOTION_MAX_VIDEO_BYTES,
  DSHML_MOTION_MIN_RANGE_MS,
  DSHML_MOTION_SAMPLE_MIN_FRAMES,
  DSHML_MOTION_THUMB_BANK,
  DSHML_MOTION_TIMELINE_ZOOMS,
  dshmlAtlasSvg,
  dshmlClampRange,
  dshmlEffectiveFps,
  dshmlInitialFrameCount,
  dshmlTimelineCellSource,
  dshmlTimelineCells,
} from './motion';
import type { DshmlMotionRange } from './motion';
import {
  DSHML_SPRITE_ATLAS_LIMIT,
  DSHML_SPRITE_DEFAULT_OPTIONS,
  dshmlCreateSampleCache,
  dshmlEncodeMotionIcon,
  dshmlFitMotionBudget,
} from './sprite';
import type { DshmlEncodedMotion, DshmlSampleCache, DshmlSlimChange } from './sprite';

/** One ready-to-store motion payload. */
export interface DshmlMotionPayload {
  poster: string;
  motion: CustomIconMotion;
}

/** What the editor needs to enable/disable its Save button. */
export interface DshmlMotionReadyState {
  payload: DshmlMotionPayload | null;
  busy: boolean;
  overBudget: boolean;
}

/** Props of {@link DshmlMotionStudio}. */
export interface DshmlMotionStudioProps {
  /** Disable every control while the editor is writing the icon. */
  disabled?: boolean;
  /** Publish the current sample to the editor (null while it is not usable). */
  onReady: (state: DshmlMotionReadyState) => void;
  /** Hand a single-frame image over to the static crop tab. */
  onUseStatic: (dataUrl: string) => void;
}

/** Studio states, mirroring the plan's state machine. */
type DshmlStudioStatus = 'idle' | 'reading' | 'ready' | 'failed';

/** Which range handle (or the playhead) is being dragged. */
type DshmlDragTarget = 'in' | 'out' | 'playhead' | 'range';

/** What the stage shows: the sampled result or the source frame with the crop. */
type DshmlStageView = 'result' | 'source';

/** Copy lookup with an English fallback, so a missing key never shows a raw key. */
function dshmlCopy(key: string, fallback: string, vars?: Readonly<Record<string, string | number>>): string {
  try {
    const value = dshmlT(key, vars);
    if (typeof value === 'string' && value !== '' && value !== key) return value;
  } catch {
    /* fall through to the literal */
  }
  return fallback;
}

/** Whether the system asks for reduced motion. */
function dshmlReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** `0.80s`, `2.00s` — the plan's transport / handle format. */
function dshmlClock(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(2) + 's';
}

/** Data-URL characters rendered as a rounded KiB size. */
function dshmlSize(chars: number): string {
  const kb = chars / 1024;
  return (kb < 10 ? kb.toFixed(1) : String(Math.round(kb))) + ' KB';
}

/** `92%` for the slimming note. */
function dshmlQuality(value: number): string {
  return Math.round(value * 100) + '%';
}

/** A primitive signature of everything a sample depends on. */
function dshmlSampleKey(
  range: DshmlMotionRange,
  frames: number,
  frameWidth: number,
  quality: number,
  crop: DshmlCropPixels | null,
): string {
  const cropKey = crop !== null ? [crop.sx, crop.sy, crop.sw, crop.sh].join(':') : '';
  return [range.inMs, range.outMs, frames, frameWidth, quality, cropKey].join('|');
}

/** Compare two crop rectangles without comparing object identity. */
function dshmlSameCrop(left: DshmlCropPixels | null, right: DshmlCropPixels | null): boolean {
  if (left === null || right === null) return left === right;
  return left.sx === right.sx && left.sy === right.sy && left.sw === right.sw && left.sh === right.sh;
}

/**
 * Move one range handle, pushing the opposite edge when the 2 s / 120 ms limits
 * are hit (the plan's "dragged past the limit pushes the other handle" rule).
 */
function dshmlMoveHandle(
  range: DshmlMotionRange,
  side: 'in' | 'out',
  target: number,
  durationMs: number,
): DshmlMotionRange {
  const duration = Math.max(DSHML_MOTION_MIN_RANGE_MS, durationMs);
  const minSpan = Math.min(DSHML_MOTION_MIN_RANGE_MS, duration);
  const maxSpan = Math.min(DSHML_MOTION_MAX_RANGE_MS, duration);
  if (side === 'in') {
    let start = Math.min(Math.max(0, target), duration - minSpan);
    let end = range.outMs;
    if (end - start < minSpan) end = Math.min(duration, start + minSpan);
    if (end - start > maxSpan) end = Math.min(duration, start + maxSpan);
    if (end - start < minSpan) start = Math.max(0, end - minSpan);
    if (end - start > maxSpan) start = Math.max(0, end - maxSpan);
    return { inMs: Math.round(start), outMs: Math.round(end) };
  }
  let end = Math.min(Math.max(target, minSpan), duration);
  let start = range.inMs;
  if (end - start < minSpan) start = Math.max(0, end - minSpan);
  if (end - start > maxSpan) start = Math.max(0, end - maxSpan);
  if (end - start < minSpan) start = Math.min(duration, start + minSpan);
  if (end - start > maxSpan) end = start + maxSpan;
  return { inMs: Math.round(start), outMs: Math.round(end) };
}

/** Localized, actionable line for a media failure. */
function dshmlMediaMessage(error: unknown): string {
  if (error instanceof DshmlMediaError && error.code === 'too-large') {
    return error.message.includes('video')
      ? dshmlCopy('picker.motionTooLargeVideo', 'The video is too large (64 MB max)')
      : dshmlCopy('picker.motionTooLargeImage', 'The animated image is too large (24 MB max)');
  }
  const code = dshmlMediaErrorCode(error);
  if (code === 'decode-unavailable') {
    return dshmlCopy(
      'picker.motionDecoderUnavailable',
      'This browser cannot decode animated images — use a video or a still image',
    );
  }
  if (code === 'single-frame') {
    return dshmlCopy('picker.motionSingleFrame', 'This image has only one frame — use the still-image tab');
  }
  if (code === 'too-long') {
    return dshmlCopy('picker.motionTooLong', 'This source is too long — trim it or choose a shorter clip');
  }
  if (code === 'no-frames') return dshmlCopy('picker.motionNoFrames', 'No frames to sample');
  if (code === 'unsupported-type') {
    return dshmlCopy('picker.motionUnsupported', 'Unsupported file — choose an animated image or an MP4 / WebM video');
  }
  return dshmlCopy('picker.motionDecodeFailed', 'Could not decode this file — try an H.264 MP4 or a GIF / WebP');
}

/** Draw one source frame into a small thumbnail canvas, letterboxed. */
function dshmlThumbFrom(work: HTMLCanvasElement, size: number): string {
  const thumb = document.createElement('canvas');
  thumb.width = size;
  thumb.height = size;
  const context = thumb.getContext('2d');
  if (context === null) return '';
  context.fillStyle = '#11151d';
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / work.width, size / work.height);
  const width = Math.max(1, Math.round(work.width * scale));
  const height = Math.max(1, Math.round(work.height * scale));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(work, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  return thumb.toDataURL('image/webp', 0.7);
}

/** One source frame as a still data URL (the cropper's image). */
function dshmlStillFrom(work: HTMLCanvasElement): string {
  return work.toDataURL('image/webp', 0.84);
}

/** Shared props of the small transport / panel buttons. */
interface DshmlIconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}

/** A square 16px glyph button with a localized accessible name. */
function DshmlIconButton(props: DshmlIconButtonProps): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      className: 'dshml-motion-icon-btn',
      'aria-label': props.label,
      title: props.label,
      disabled: props.disabled === true,
      onClick: props.onClick,
    },
    props.children,
  );
}

/** Props of the large empty-state dropzone. */
interface DshmlDropProps {
  disabled: boolean;
  onPick: () => void;
  onFile: (file: File | null) => void;
}

/** The empty-state dropzone. */
function DshmlMotionDrop(props: DshmlDropProps): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      className: 'dshml-custom-drop dshml-motion-drop',
      disabled: props.disabled,
      onClick: props.onPick,
      onDragOver: function onDragOver(event: DragEvent<HTMLButtonElement>) {
        event.preventDefault();
      },
      onDrop: function onDrop(event: DragEvent<HTMLButtonElement>) {
        event.preventDefault();
        const files = event.dataTransfer !== null ? event.dataTransfer.files : null;
        props.onFile(files !== null && files.length > 0 ? (files[0] ?? null) : null);
      },
    },
    [
      h(
        'svg',
        {
          key: 'icon',
          className: 'dshml-custom-drop-icon',
          viewBox: '0 0 24 24',
          width: 28,
          height: 28,
          fill: 'none',
          'aria-hidden': 'true',
        },
        [
          h('rect', {
            key: 'frame',
            x: 3.2,
            y: 4.4,
            width: 17.6,
            height: 15.2,
            rx: 2.6,
            stroke: 'currentColor',
            strokeWidth: 1.5,
          }),
          h('path', {
            key: 'wave',
            d: 'M6.5 14.2c1.6-3.4 3.1-3.4 4.6 0s3 3.4 4.6 0',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
          }),
          h('path', {
            key: 'play',
            d: 'M15.6 8.2l2.6 1.6-2.6 1.6z',
            fill: 'currentColor',
          }),
        ],
      ),
      h(
        'span',
        { key: 'label', className: 'dshml-custom-drop-label' },
        dshmlCopy('picker.motionDrop', 'Drop an animated image or video, or choose one'),
      ),
      h(
        'span',
        { key: 'hint', className: 'dshml-custom-drop-hint' },
        dshmlCopy('picker.motionDropHint', 'GIF / WebP / APNG / AVIF / MP4 / WebM; up to 2 seconds are sampled'),
      ),
    ],
  );
}

/** One segment of a two-state switch. */
function DshmlStageMode(props: { active: boolean; label: string; onClick: () => void }): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      className: 'dshml-motion-seg-btn' + (props.active ? ' dshml-motion-seg-active' : ''),
      'aria-pressed': props.active ? 'true' : 'false',
      onClick: props.onClick,
    },
    props.label,
  );
}

/** Props of the merged canvas panel. */
interface DshmlCanvasProps {
  source: DshmlMediaSource;
  fileName: string;
  format: string;
  range: DshmlMotionRange;
  encoded: DshmlEncodedMotion | null;
  view: DshmlStageView;
  playing: boolean;
  playhead: number;
  canvasRef: { current: HTMLCanvasElement | null };
  /** Playhead frame the cropper works on; `''` until the first decode lands. */
  stillUrl: string;
  crop: Point;
  zoom: number;
  disabled: boolean;
  onView: (view: DshmlStageView) => void;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  onCrop: (point: Point) => void;
  onZoom: (zoom: number) => void;
  onArea: (area: DshmlCropPixels | null) => void;
  onCenter: () => void;
}

/** Highest crop zoom; the framing slider and the cropper must agree. */
const DSHML_MOTION_MAX_ZOOM = 5;

/** Wheel zoom is opt-in per gesture so the modal keeps its scroll wheel. */
function dshmlZoomOnWheelOnly(event: WheelEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * The stage, its mode switch and the transport: the one place the clip is
 * watched, framed and scrubbed.
 */
function DshmlMotionCanvas(props: DshmlCanvasProps): ReactElement {
  const span = Math.max(0, props.range.outMs - props.range.inMs);
  const head = Math.min(span, Math.max(0, props.playhead - props.range.inMs));
  const time = dshmlClock(head) + ' / ' + dshmlClock(span);
  const playLabel = props.playing ? dshmlCopy('picker.motionPause', 'Pause') : dshmlCopy('picker.motionPlay', 'Play');
  const zoomLabel = dshmlCopy('picker.motionFraming', 'Framing');
  const source = props.view === 'source';
  return h(
    'section',
    {
      className: 'dshml-motion-panel dshml-motion-canvas-panel',
      'aria-label': dshmlCopy('picker.motionMonitor', 'Monitor'),
    },
    [
      h('div', { key: 'head', className: 'dshml-motion-canvas-head' }, [
        h('span', { key: 'name', className: 'dshml-motion-file', title: props.fileName }, [
          h('span', { key: 'text', className: 'dshml-motion-file-name' }, props.fileName),
          props.format !== '' ? h('span', { key: 'badge', className: 'dshml-motion-format' }, props.format) : null,
        ]),
        h('div', { key: 'modes', className: 'dshml-motion-seg' }, [
          h(DshmlStageMode, {
            key: 'result',
            active: !source,
            label: dshmlCopy('picker.motionBaked', 'Result'),
            onClick: function onResult() {
              props.onView('result');
            },
          }),
          h(DshmlStageMode, {
            key: 'source',
            active: source,
            label: dshmlCopy('picker.motionOriginal', 'Source'),
            onClick: function onSource() {
              props.onView('source');
            },
          }),
        ]),
      ]),
      h('div', { key: 'stage', className: 'dshml-motion-stage' }, [
        source
          ? props.stillUrl !== ''
            ? h(Cropper, {
                key: 'cropper',
                image: props.stillUrl,
                crop: props.crop,
                zoom: props.zoom,
                rotation: 0,
                aspect: 1,
                minZoom: 1,
                maxZoom: DSHML_MOTION_MAX_ZOOM,
                cropShape: 'rect',
                showGrid: true,
                zoomSpeed: 0.5,
                // Ctrl / ⌘ + wheel (and a trackpad pinch, which reports ctrlKey)
                // zooms; a plain wheel still scrolls the dialog.
                zoomWithScroll: true,
                onWheelRequest: dshmlZoomOnWheelOnly,
                restrictPosition: true,
                style: {},
                classes: {},
                mediaProps: {},
                cropperProps: {},
                keyboardStep: 10,
                onCropChange: props.onCrop,
                onZoomChange: props.onZoom,
                onCropComplete: function onCropComplete(_percentages: Area, pixels: Area) {
                  props.onArea({ sx: pixels.x, sy: pixels.y, sw: pixels.width, sh: pixels.height });
                },
              })
            : h(
                'span',
                { key: 'wait', className: 'dshml-motion-stage-empty' },
                dshmlCopy('picker.motionReading', 'Reading the source…'),
              )
          : h('canvas', {
              key: 'canvas',
              ref: props.canvasRef,
              className: 'dshml-motion-canvas',
              width: 240,
              height: 240,
              'aria-label': dshmlCopy('picker.motionBaked', 'Result'),
              role: 'img',
            }),
        source
          ? h(
              'div',
              {
                key: 'zoom',
                className: 'dshml-motion-zoom',
                title: dshmlCopy('picker.wheelZoom', 'Ctrl / ⌘ + wheel to zoom'),
              },
              [
                h('span', { key: 'label', className: 'dshml-motion-zoom-label' }, zoomLabel),
                h('input', {
                  key: 'range',
                  type: 'range',
                  className: 'dshml-motion-zoom-range',
                  min: 1,
                  max: DSHML_MOTION_MAX_ZOOM,
                  step: 0.01,
                  value: props.zoom,
                  disabled: props.disabled,
                  'aria-label': zoomLabel,
                  onChange: function onZoom(event: ChangeEvent<HTMLInputElement>) {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) props.onZoom(next);
                  },
                }),
                h(
                  'button',
                  {
                    key: 'center',
                    type: 'button',
                    className: 'dshml-motion-zoom-fit',
                    disabled: props.disabled,
                    onClick: props.onCenter,
                  },
                  dshmlCopy('picker.motionCenter', 'Centre'),
                ),
              ],
            )
          : null,
        !source && props.encoded === null
          ? h(
              'span',
              { key: 'empty', className: 'dshml-motion-stage-empty' },
              dshmlCopy('picker.motionReading', 'Reading the source…'),
            )
          : null,
      ]),
      h('div', { key: 'transport', className: 'dshml-motion-transport' }, [
        h(
          DshmlIconButton,
          {
            key: 'start',
            label: dshmlCopy('picker.motionToIn', 'Go to in point'),
            onClick: function toIn() {
              props.onSeek(props.range.inMs);
            },
          },
          h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' }, [
            h('path', { key: 'bar', d: 'M6 5v14', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
            h('path', { key: 'tri', d: 'M18 5.5 9.5 12l8.5 6.5z', fill: 'currentColor' }),
          ]),
        ),
        h(
          DshmlIconButton,
          {
            key: 'play',
            label: playLabel,
            onClick: props.onTogglePlay,
          },
          props.playing
            ? h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' }, [
                h('path', {
                  key: 'pause',
                  d: 'M8 5v14M16 5v14',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                }),
              ])
            : h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' }, [
                h('path', { key: 'tri', d: 'M8 5.5 19 12 8 18.5z', fill: 'currentColor' }),
              ]),
        ),
        h(
          DshmlIconButton,
          {
            key: 'end',
            label: dshmlCopy('picker.motionToOut', 'Go to out point'),
            onClick: function toOut() {
              props.onSeek(props.range.outMs);
            },
          },
          h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' }, [
            h('path', { key: 'tri', d: 'M6 5.5 14.5 12 6 18.5z', fill: 'currentColor' }),
            h('path', { key: 'bar', d: 'M18 5v14', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
          ]),
        ),
        h('span', { key: 'time', className: 'dshml-motion-time' }, time),
      ]),
    ],
  );
}

/** Props of the timeline panel. */
interface DshmlTimelineProps {
  durationMs: number;
  range: DshmlMotionRange;
  playhead: number;
  /** Whole-source thumbnails; the strip picks the cells each zoom step needs. */
  thumbs: readonly string[];
  /** Index into {@link DSHML_MOTION_TIMELINE_ZOOMS}. */
  zoomIndex: number;
  disabled: boolean;
  trackRef: { current: HTMLDivElement | null };
  scrollerRef: { current: HTMLDivElement | null };
  onDragStart: (target: DshmlDragTarget, event: ReactPointerEvent<HTMLElement>) => void;
  onHandleKey: (side: 'in' | 'out', key: string, shift: boolean) => void;
  onHandleReset: (side: 'in' | 'out') => void;
  onTrackPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onZoom: (index: number) => void;
  onChangeSource: () => void;
}

/** One range handle (in or out). */
function DshmlRangeHandle(props: {
  side: 'in' | 'out';
  label: string;
  value: number;
  durationMs: number;
  percent: number;
  edge: boolean;
  onDragStart: (target: DshmlDragTarget, event: ReactPointerEvent<HTMLElement>) => void;
  onKey: (side: 'in' | 'out', event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onReset: (side: 'in' | 'out') => void;
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      className: 'dshml-motion-handle dshml-motion-handle-' + props.side,
      role: 'slider',
      'aria-label': props.label,
      'aria-valuemin': 0,
      'aria-valuemax': props.durationMs,
      'aria-valuenow': props.value,
      'aria-valuetext': dshmlClock(props.value),
      style: { left: props.percent + '%' },
      onPointerDown: function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();
        props.onDragStart(props.side, event);
      },
      onKeyDown: function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
        props.onKey(props.side, event);
      },
      onDoubleClick: function onDoubleClick(event: React.MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        props.onReset(props.side);
      },
    },
    props.edge ? h('span', { className: 'dshml-motion-handle-mark', 'aria-hidden': 'true' }) : null,
  );
}

/**
 * Source filmstrip, range handles and the playhead.
 *
 * Zoom widens the strip's own content (native horizontal scroll, so wheel and
 * trackpad panning work) and the cell count follows the zoomed width, which
 * keeps a constant thumbnail density instead of stretching sixteen thumbs over a
 * longer lane. The bank itself is scanned once when the source opens, so zooming
 * never decodes a frame.
 */
function DshmlMotionTimeline(props: DshmlTimelineProps): ReactElement {
  const duration = Math.max(1, props.durationMs);
  const zoom = DSHML_MOTION_TIMELINE_ZOOMS[props.zoomIndex] ?? 1;
  const cells = dshmlTimelineCells(zoom);
  const bank = props.thumbs.length;
  const inPct = (props.range.inMs / duration) * 100;
  const outPct = (props.range.outMs / duration) * 100;
  const headPct = (Math.min(Math.max(props.playhead, props.range.inMs), props.range.outMs) / duration) * 100;
  const strips: ReactElement[] = [];
  for (let index = 0; index < cells; index += 1) {
    const source = bank > 0 ? props.thumbs[dshmlTimelineCellSource(index, cells, bank)] : undefined;
    strips.push(
      h('span', {
        key: 'thumb-' + index,
        className: 'dshml-motion-thumb' + (source === undefined ? ' dshml-motion-thumb-empty' : ''),
        style: source !== undefined ? { backgroundImage: 'url(' + source + ')' } : undefined,
      }),
    );
  }
  const zoomLabel = dshmlCopy('picker.motionTimelineZoom', 'Timeline zoom');
  const canZoomOut = props.zoomIndex > 0;
  const canZoomIn = props.zoomIndex < DSHML_MOTION_TIMELINE_ZOOMS.length - 1;
  const lastZoom = DSHML_MOTION_TIMELINE_ZOOMS.length - 1;
  return h('section', { className: 'dshml-motion-timeline' }, [
    h('div', { key: 'head', className: 'dshml-motion-panel-head' }, [
      h('span', { key: 'title', className: 'dshml-motion-panel-title' }, dshmlCopy('picker.motionTimeline', 'Source')),
      h(
        'span',
        { key: 'total', className: 'dshml-motion-total' },
        dshmlCopy('picker.motionTotal', 'Total {t}', { t: dshmlClock(duration) }),
      ),
      h('div', { key: 'zoom', className: 'dshml-motion-zoomctl', role: 'group', 'aria-label': zoomLabel }, [
        h(
          DshmlIconButton,
          {
            key: 'out',
            label: dshmlCopy('picker.motionZoomOut', 'Zoom the timeline out'),
            disabled: !canZoomOut,
            onClick: function zoomOut() {
              props.onZoom(Math.max(0, props.zoomIndex - 1));
            },
          },
          h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true' }, [
            h('path', { key: 'bar', d: 'M6 12h12', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
          ]),
        ),
        h(
          'button',
          {
            key: 'fit',
            type: 'button',
            className: 'dshml-motion-zoom-value',
            title: dshmlCopy('picker.motionZoomFit', 'Fit the whole clip'),
            'aria-label': dshmlCopy('picker.motionZoomFit', 'Fit the whole clip'),
            onClick: function fit() {
              props.onZoom(0);
            },
          },
          zoom + '×',
        ),
        h(
          DshmlIconButton,
          {
            key: 'in',
            label: dshmlCopy('picker.motionZoomIn', 'Zoom the timeline in'),
            disabled: !canZoomIn,
            onClick: function zoomIn() {
              props.onZoom(Math.min(lastZoom, props.zoomIndex + 1));
            },
          },
          h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true' }, [
            h('path', {
              key: 'bar',
              d: 'M6 12h12M12 6v12',
              stroke: 'currentColor',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
            }),
          ]),
        ),
      ]),
      h(
        'button',
        {
          key: 'change',
          type: 'button',
          className: 'dshml-custom-link',
          disabled: props.disabled,
          onClick: props.onChangeSource,
        },
        dshmlCopy('picker.motionChange', 'Change source'),
      ),
    ]),
    h('div', { key: 'scroller', ref: props.scrollerRef, className: 'dshml-motion-scroller' }, [
      h('div', { key: 'lane', className: 'dshml-motion-lane', style: { width: zoom * 100 + '%' } }, [
        h(
          'div',
          {
            key: 'thumbs',
            className: 'dshml-motion-thumbs',
            style: { gridTemplateColumns: 'repeat(' + cells + ', minmax(0, 1fr))' },
            'aria-hidden': 'true',
          },
          strips,
        ),
        h(
          'div',
          {
            key: 'track',
            ref: props.trackRef,
            className: 'dshml-motion-track',
            onPointerDown: props.onTrackPointerDown,
          },
          [
            h('span', { key: 'rail', className: 'dshml-motion-rail', 'aria-hidden': 'true' }),
            h('span', {
              key: 'range',
              className: 'dshml-motion-range',
              'aria-hidden': 'true',
              style: { left: inPct + '%', width: Math.max(0, outPct - inPct) + '%' },
              onPointerDown: function onRangePointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
                event.preventDefault();
                event.stopPropagation();
                props.onDragStart('range', event);
              },
            }),
            h('span', {
              key: 'head',
              className: 'dshml-motion-playhead',
              'aria-hidden': 'true',
              style: { left: headPct + '%' },
            }),
            h(DshmlRangeHandle, {
              key: 'in',
              side: 'in',
              label: dshmlCopy('picker.motionIn', 'In point'),
              value: props.range.inMs,
              durationMs: props.durationMs,
              percent: inPct,
              edge: props.range.inMs > 0,
              onDragStart: props.onDragStart,
              onKey: function onInKey(side, event) {
                props.onHandleKey(side, event.key, event.shiftKey);
                if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                }
              },
              onReset: props.onHandleReset,
            }),
            h(DshmlRangeHandle, {
              key: 'out',
              side: 'out',
              label: dshmlCopy('picker.motionOut', 'Out point'),
              value: props.range.outMs,
              durationMs: props.durationMs,
              percent: outPct,
              edge: props.range.outMs < props.durationMs,
              onDragStart: props.onDragStart,
              onKey: function onOutKey(side, event) {
                props.onHandleKey(side, event.key, event.shiftKey);
                if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                }
              },
              onReset: props.onHandleReset,
            }),
          ],
        ),
      ]),
    ]),
    h('div', { key: 'labels', className: 'dshml-motion-range-labels' }, [
      h('span', { key: 'in' }, dshmlCopy('picker.motionIn', 'In') + ' ' + dshmlClock(props.range.inMs)),
      h('span', { key: 'out' }, dshmlCopy('picker.motionOut', 'Out') + ' ' + dshmlClock(props.range.outMs)),
    ]),
  ]);
}

/** Props of the sample panel. */
interface DshmlSamplesProps {
  encoded: DshmlEncodedMotion | null;
  range: DshmlMotionRange;
  frames: number;
  playhead: number;
  disabled: boolean;
  stripRef: { current: HTMLDivElement | null };
  overflowing: boolean;
  onFrames: (frames: number) => void;
  onSeek: (ms: number) => void;
  onScroll: () => void;
}

/** Frame-count slider and the sampled strip. */
function DshmlMotionSamples(props: DshmlSamplesProps): ReactElement {
  const fps = dshmlEffectiveFps(props.range, props.frames);
  const valueText = dshmlCopy('picker.motionFramesValue', '{n} frames, about {fps} fps', {
    n: props.frames,
    fps: fps,
  });
  const cells: ReactElement[] = [];
  if (props.encoded !== null) {
    const span = Math.max(1, props.range.outMs - props.range.inMs);
    for (let index = 0; index < props.encoded.frames; index += 1) {
      const time = props.range.inMs + (index * span) / props.encoded.frames;
      const active = props.playhead >= time && props.playhead < time + span / props.encoded.frames;
      cells.push(
        h('button', {
          key: 'sample-' + index,
          type: 'button',
          className: 'dshml-motion-sample' + (active ? ' dshml-motion-sample-active' : ''),
          'aria-label': dshmlClock(time),
          title: dshmlClock(time),
          style: {
            backgroundImage: 'url(' + props.encoded.atlas + ')',
            backgroundSize: props.encoded.frames * 44 + 'px 44px',
            backgroundPosition: -index * 44 + 'px 0',
          },
          onClick: function onSeekSample() {
            props.onSeek(time);
          },
        }),
      );
    }
  }
  return h('section', { className: 'dshml-motion-samples' }, [
    h('div', { key: 'head', className: 'dshml-motion-sample-head' }, [
      h('label', { key: 'label', className: 'dshml-motion-sample-label' }, dshmlCopy('picker.motionFrames', 'Frames')),
      h('input', {
        key: 'range',
        type: 'range',
        className: 'dshml-motion-frames-range',
        min: DSHML_MOTION_SAMPLE_MIN_FRAMES,
        max: DSHML_MOTION_MAX_FRAMES,
        step: 1,
        value: props.frames,
        disabled: props.disabled,
        'aria-label': dshmlCopy('picker.motionFrames', 'Frames'),
        'aria-valuetext': valueText,
        onChange: function onFrames(event: ChangeEvent<HTMLInputElement>) {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.onFrames(Math.round(next));
        },
      }),
      h('span', { key: 'value', className: 'dshml-motion-sample-value' }, valueText),
    ]),
    h(
      'div',
      { key: 'strip-wrap', className: 'dshml-motion-strip-wrap' + (props.overflowing ? ' dshml-motion-more' : '') },
      h(
        'div',
        {
          key: 'strip',
          ref: props.stripRef,
          className: 'dshml-motion-strip',
          role: 'group',
          onScroll: props.onScroll,
        },
        cells,
      ),
    ),
  ]);
}

/** Props of the true-size preview row. */
interface DshmlTilesProps {
  encoded: DshmlEncodedMotion | null;
  reducedMotion: boolean;
}

/** The 20 / 22 / 36 / 64 px tiles rendered from the real mark strings. */
function DshmlMotionTiles(props: DshmlTilesProps): ReactElement {
  const sizes = [20, 22, 36, 64];
  let html = '';
  if (props.encoded !== null) {
    const animated =
      props.reducedMotion === false
        ? dshmlAtlasSvg({
            motion: {
              atlas: props.encoded.atlas,
              frames: props.encoded.frames,
              fps: props.encoded.fps,
              frameWidth: props.encoded.frameWidth,
            },
          })
        : '';
    html = animated !== '' ? animated : dshmlPosterSvg({ image: props.encoded.poster });
  }
  const tiles = sizes.map(function toTile(size) {
    return h('span', { key: 'size-' + size, className: 'dshml-motion-tile dshml-motion-tile-' + size }, [
      h('span', {
        key: 'mark',
        className: 'dshml-motion-tile-mark',
        'aria-hidden': 'true',
        dangerouslySetInnerHTML: { __html: html },
      }),
      h('span', { key: 'label', className: 'dshml-motion-tile-label' }, String(size)),
    ]);
  });
  return h('section', { className: 'dshml-motion-preview' }, [
    h(
      'div',
      { key: 'head', className: 'dshml-motion-panel-head' },
      h(
        'span',
        { key: 'title', className: 'dshml-motion-panel-title' },
        dshmlCopy('picker.motionActualSize', 'Actual size'),
      ),
    ),
    h('div', { key: 'tiles', className: 'dshml-motion-tiles' }, tiles),
  ]);
}

/** Props of the sticky size dock. */
interface DshmlDockProps {
  encoded: DshmlEncodedMotion | null;
  sampling: boolean;
  slimming: boolean;
  progress: { done: number; total: number } | null;
  changes: readonly DshmlSlimChange[];
  userSettings: { frames: number; frameWidth: number } | null;
  overBudget: boolean;
  disabled: boolean;
  /** The one status line: error, live notice or the most useful hint. */
  status: { text: string; tone: 'error' | 'warn' | 'muted'; detail: string };
  onSlim: () => void;
  onUndo: () => void;
  onCancel: () => void;
}

/**
 * The sticky bottom bar: the size meter, the slimming action and the single
 * status line. Both rows are always present — an error, a live notice or a
 * progress tick changes the text of an existing line instead of growing the
 * dialog.
 */
function DshmlMotionDock(props: DshmlDockProps): ReactElement {
  const atlasChars = props.encoded !== null ? props.encoded.atlasChars : 0;
  const posterChars = props.encoded !== null ? props.encoded.posterChars : 0;
  const verdict = dshmlBudgetPlan(atlasChars, posterChars);
  const pct = Math.min(100, (atlasChars / DSHML_SPRITE_ATLAS_LIMIT) * 100);
  const barClass =
    'dshml-motion-bar' +
    (verdict === 'over' ? ' dshml-motion-bar-over' : verdict === 'warn' ? ' dshml-motion-bar-warn' : '');
  const active = props.sampling || props.slimming;
  return h('section', { className: 'dshml-motion-dock' }, [
    h(
      'p',
      {
        key: 'status',
        className: 'dshml-motion-status dshml-motion-status-' + props.status.tone,
        role: props.status.tone === 'error' ? 'alert' : 'status',
        'aria-live': active ? 'off' : 'polite',
        title: props.status.detail,
      },
      [
        h('span', { key: 'text', className: 'dshml-motion-status-text' }, props.status.text),
        props.changes.length > 0 && props.userSettings !== null && props.status.tone !== 'error'
          ? h(
              'button',
              {
                key: 'undo',
                type: 'button',
                className: 'dshml-custom-link',
                disabled: props.disabled,
                onClick: props.onUndo,
              },
              dshmlCopy('picker.motionUndo', 'Restore my settings'),
            )
          : null,
        active
          ? h(
              'button',
              {
                key: 'cancel',
                type: 'button',
                className: 'dshml-custom-link',
                onClick: props.onCancel,
              },
              dshmlCopy('picker.cancel', 'Cancel'),
            )
          : null,
      ],
    ),
    h('div', { key: 'row', className: 'dshml-motion-budget-row' }, [
      h('span', { key: 'label', className: 'dshml-motion-budget-label' }, dshmlCopy('picker.motionVolume', 'Size')),
      h(
        'div',
        {
          key: 'meter',
          className: 'dshml-motion-meter',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': DSHML_SPRITE_ATLAS_LIMIT,
          'aria-valuenow': atlasChars,
        },
        h('span', { key: 'bar', className: barClass, style: { width: pct + '%' } }),
      ),
      h(
        'span',
        { key: 'value', className: 'dshml-motion-budget-value' },
        dshmlCopy('picker.motionBudget', '{used} / {max}', {
          used: dshmlSize(atlasChars),
          max: dshmlSize(DSHML_SPRITE_ATLAS_LIMIT),
        }),
      ),
      h(
        'span',
        { key: 'estimate', className: 'dshml-motion-note' },
        props.encoded !== null
          ? dshmlCopy('picker.motionEstimate', '{n} frames · {fps} fps', {
              n: props.encoded.frames,
              fps: props.encoded.fps,
            })
          : '',
      ),
      props.overBudget && !active
        ? h(
            'button',
            {
              key: 'slim',
              type: 'button',
              className: 'dshml-custom-btn dshml-custom-btn-primary dshml-motion-slim',
              disabled: props.disabled,
              onClick: props.onSlim,
            },
            dshmlCopy('picker.motionSlim', 'Shrink automatically'),
          )
        : null,
    ]),
  ]);
}

/**
 * The motion sampling studio body.
 * @param props - disabled flag, ready-state publisher and the still-image hand-off.
 */
export function DshmlMotionStudio(props: DshmlMotionStudioProps): ReactElement {
  const [status, setStatus] = React.useState<DshmlStudioStatus>('idle');
  const [readingVisible, setReadingVisible] = React.useState(false);
  const [errorText, setErrorText] = React.useState('');
  const [singleFrame, setSingleFrame] = React.useState<File | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [format, setFormat] = React.useState('');
  const [source, setSource] = React.useState<DshmlMediaSource | null>(null);
  const [range, setRange] = React.useState<DshmlMotionRange>({ inMs: 0, outMs: 1000 });
  const [frames, setFrames] = React.useState(8);
  const [frameWidth, setFrameWidth] = React.useState(DSHML_SPRITE_DEFAULT_OPTIONS.frameWidth);
  const [quality, setQuality] = React.useState(DSHML_SPRITE_DEFAULT_OPTIONS.quality);
  const [cropArea, setCropArea] = React.useState<DshmlCropPixels | null>(null);
  const [stillUrl, setStillUrl] = React.useState('');
  const [thumbs, setThumbs] = React.useState<string[]>([]);
  const [encoded, setEncoded] = React.useState<DshmlEncodedMotion | null>(null);
  const [sampledKey, setSampledKey] = React.useState('');
  const [sampling, setSampling] = React.useState(false);
  const [slimming, setSlimming] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [changes, setChanges] = React.useState<DshmlSlimChange[]>([]);
  const [userSettings, setUserSettings] = React.useState<{ frames: number; frameWidth: number } | null>(null);
  const [playhead, setPlayhead] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [view, setView] = React.useState<DshmlStageView>('result');
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [zoomIndex, setZoomIndex] = React.useState(0);
  const [drag, setDrag] = React.useState<DshmlDragTarget | null>(null);
  const [liveMessage, setLiveMessage] = React.useState('');
  const [stripOverflows, setStripOverflows] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cacheRef = React.useRef<DshmlSampleCache | null>(null);
  const importGeneration = React.useRef(0);
  const encodeGeneration = React.useRef(0);
  const stillGeneration = React.useRef(0);
  const thumbsGeneration = React.useRef(0);
  /**
   * Sample key the slimming ladder already produced, so the effect it triggers
   * does not run the same encode again. Stored as the key rather than a boolean:
   * a flag could survive a change that never fires the effect and then swallow
   * the next real edit.
   */
  const skipEncodeKey = React.useRef<string | null>(null);
  const autoPlayed = React.useRef(false);
  const reducedMotion = React.useRef(dshmlReducedMotion());
  const playheadRef = React.useRef(0);
  const acceptRef = React.useRef<(file: File | null) => void>(function noop() {});
  const onReadyRef = React.useRef(props.onReady);
  const dragStartRef = React.useRef<{ time: number; range: DshmlMotionRange } | null>(null);
  const cropAreaRef = React.useRef<DshmlCropPixels | null>(null);
  const liveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  playheadRef.current = playhead;
  cropAreaRef.current = cropArea;

  const currentKey = dshmlSampleKey(range, frames, frameWidth, quality, cropArea);
  const matched = encoded !== null && sampledKey === currentKey;
  const overBudget = matched && encoded !== null && encoded.verdict === 'over';
  const busy = sampling || slimming || status === 'reading' || (encoded !== null && !matched);

  React.useEffect(
    function keepCallback() {
      onReadyRef.current = props.onReady;
    },
    [props.onReady],
  );

  React.useEffect(
    function publishReady() {
      let payload: DshmlMotionPayload | null = null;
      if (matched && encoded !== null && encoded.verdict !== 'over') {
        payload = {
          poster: encoded.poster,
          motion: {
            atlas: encoded.atlas,
            frames: encoded.frames,
            fps: encoded.fps,
            frameWidth: encoded.frameWidth,
          },
        };
      }
      onReadyRef.current({ payload, busy, overBudget });
    },
    [matched, encoded, busy, overBudget],
  );

  React.useEffect(
    function disposeSource() {
      return function dispose() {
        cacheRef.current = null;
        if (source !== null) source.dispose();
      };
    },
    [source],
  );

  React.useEffect(function acceptLatest() {
    acceptRef.current = acceptFile;
  });

  /** Center the zoomed strip on the playhead so a zoom step never hides it. */
  React.useLayoutEffect(
    function keepPlayheadInView() {
      const scroller = scrollerRef.current;
      if (scroller === null || source === null) return;
      const ratio = source.durationMs > 0 ? playheadRef.current / source.durationMs : 0;
      scroller.scrollLeft = Math.max(0, ratio * scroller.scrollWidth - scroller.clientWidth / 2);
    },
    [zoomIndex, source],
  );

  /** Track whether the sampled strip has more cells off the right edge. */
  React.useEffect(
    function watchStripOverflow() {
      const strip = stripRef.current;
      if (strip === null) return;
      const update = function update() {
        setStripOverflows(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
      };
      update();
      strip.addEventListener('scroll', update, { passive: true });
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
      if (observer !== null) observer.observe(strip);
      return function stop() {
        strip.removeEventListener('scroll', update);
        if (observer !== null) observer.disconnect();
      };
    },
    [encoded, frames, status],
  );

  function showLive(message: string): void {
    setLiveMessage(message);
    if (liveTimer.current !== null) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(function clearLive() {
      liveTimer.current = null;
      setLiveMessage('');
    }, 2000);
  }

  function pickFile(): void {
    const input = fileRef.current;
    if (input === null) return;
    try {
      input.click();
    } catch {
      setErrorText(dshmlCopy('picker.imageRead', 'Could not read that file'));
    }
  }

  /**
   * Scan the source into the thumbnail bank the timeline picks from.
   *
   * One pass over the whole clip at open time means zooming the timeline (and
   * dragging a handle) never decodes anything: the strip only re-picks indices.
   */
  async function loadThumbs(next: DshmlMediaSource, generation: number): Promise<void> {
    const own = ++thumbsGeneration.current;
    const work = document.createElement('canvas');
    work.width = next.width;
    work.height = next.height;
    const count = DSHML_MOTION_THUMB_BANK;
    const loaded: string[] = [];
    for (let index = 0; index < count; index += 1) {
      if (generation !== importGeneration.current || own !== thumbsGeneration.current) return;
      const time = (next.durationMs * (index + 0.5)) / count;
      try {
        await next.drawFrame(time, work);
      } catch {
        return;
      }
      const url = dshmlThumbFrom(work, 48);
      if (url !== '') loaded.push(url);
      if (index % 8 === 0) setThumbs([...loaded]);
    }
    setThumbs(loaded);
  }

  async function refreshStill(next: DshmlMediaSource, time: number, generation: number): Promise<void> {
    const work = document.createElement('canvas');
    work.width = next.width;
    work.height = next.height;
    try {
      await next.drawFrame(time, work);
    } catch {
      return;
    }
    if (generation !== stillGeneration.current) return;
    setStillUrl(dshmlStillFrom(work));
  }

  function resetForSource(next: DshmlMediaSource): void {
    const duration = Math.max(DSHML_MOTION_MIN_RANGE_MS, next.durationMs);
    const initial = dshmlClampRange(0, Math.min(duration, DSHML_MOTION_MAX_RANGE_MS), duration);
    cacheRef.current = dshmlCreateSampleCache(next);
    setSource(next);
    setRange(initial);
    setFrames(dshmlInitialFrameCount(initial));
    setFrameWidth(DSHML_SPRITE_DEFAULT_OPTIONS.frameWidth);
    setQuality(DSHML_SPRITE_DEFAULT_OPTIONS.quality);
    setCropArea(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setZoomIndex(0);
    setStillUrl('');
    setThumbs([]);
    setEncoded(null);
    setSampledKey('');
    setChanges([]);
    setUserSettings(null);
    setPlayhead(initial.inMs);
    setPlaying(false);
    setView('result');
    autoPlayed.current = false;
    setStatus('ready');
    setErrorText('');
    setSingleFrame(null);
    setReadingVisible(false);
    void loadThumbs(next, importGeneration.current);
    void refreshStill(next, initial.inMs, ++stillGeneration.current);
  }

  async function acceptFile(file: File | null): Promise<void> {
    if (file === null || props.disabled === true) return;
    const kind = dshmlMediaKindOf(file);
    if (kind === null) {
      setErrorText(
        dshmlCopy('picker.motionUnsupported', 'Unsupported file — choose an animated image or an MP4 / WebM video'),
      );
      setStatus('failed');
      setReadingVisible(false);
      return;
    }
    if (kind === 'animated' && file.size > DSHML_MOTION_MAX_IMAGE_BYTES) {
      setErrorText(dshmlCopy('picker.motionTooLargeImage', 'The animated image is too large (24 MB max)'));
      setStatus('failed');
      return;
    }
    if (kind === 'video' && file.size > DSHML_MOTION_MAX_VIDEO_BYTES) {
      setErrorText(dshmlCopy('picker.motionTooLargeVideo', 'The video is too large (64 MB max)'));
      setStatus('failed');
      return;
    }
    const generation = ++importGeneration.current;
    setStatus('reading');
    setReadingVisible(false);
    setErrorText('');
    setSingleFrame(null);
    setFileName(typeof file.name === 'string' ? file.name : '');
    setFormat(dshmlMediaFormatLabel(file));
    const readingTimer = setTimeout(function showReading() {
      if (generation === importGeneration.current) setReadingVisible(true);
    }, 400);
    try {
      const next = await dshmlOpenMediaSource(file, function cancelled() {
        return generation !== importGeneration.current;
      });
      clearTimeout(readingTimer);
      if (generation !== importGeneration.current) {
        next.dispose();
        return;
      }
      resetForSource(next);
    } catch (error) {
      clearTimeout(readingTimer);
      if (generation !== importGeneration.current) return;
      const code = dshmlMediaErrorCode(error);
      setReadingVisible(false);
      if (code === 'cancelled') return;
      setStatus('failed');
      if (code === 'single-frame') {
        setSingleFrame(file);
        setErrorText(dshmlCopy('picker.motionSingleFrame', 'This image has only one frame — use the still-image tab'));
      } else {
        setErrorText(dshmlMediaMessage(error));
      }
    }
  }

  React.useEffect(
    function refreshStillOnPlayhead() {
      if (source === null || status !== 'ready' || playing) return;
      const generation = ++stillGeneration.current;
      const timer = setTimeout(function refresh() {
        void refreshStill(source, playhead, generation);
      }, 60);
      return function cancel() {
        clearTimeout(timer);
      };
    },
    [source, status, playhead, playing],
  );

  React.useEffect(
    function sample() {
      if (source === null || status !== 'ready') return;
      if (skipEncodeKey.current === currentKey) {
        skipEncodeKey.current = null;
        return;
      }
      const key = currentKey;
      const generation = ++encodeGeneration.current;
      setSampling(true);
      setProgress(null);
      // `cropArea` is null until the Source stage mounts the cropper; the
      // sampler reads that as the centred maximal square, so the first sample
      // does not wait for the user to open the framing surface.
      const crop = cropArea;
      const timer = setTimeout(function run() {
        void (async function encode() {
          try {
            const result = await dshmlEncodeMotionIcon(
              source,
              { range, frames, frameWidth, quality, crop },
              function onProgress(done, total) {
                if (generation === encodeGeneration.current) setProgress({ done, total });
              },
              function cancelled() {
                return generation !== encodeGeneration.current;
              },
              cacheRef.current,
            );
            if (generation !== encodeGeneration.current) return;
            setEncoded(result);
            setSampledKey(key);
            setSampling(false);
            setProgress(null);
          } catch (error) {
            if (generation !== encodeGeneration.current) return;
            setSampling(false);
            setProgress(null);
            if (dshmlMediaErrorCode(error) === 'cancelled') return;
            setErrorText(dshmlCopy('picker.motionError', 'Could not sample this source — try again'));
          }
        })();
      }, 150);
      return function cancel() {
        clearTimeout(timer);
      };
    },
    [source, status, currentKey],
  );

  React.useEffect(
    function autoPlayOnce() {
      if (encoded === null || autoPlayed.current) return;
      autoPlayed.current = true;
      if (!reducedMotion.current) setPlaying(true);
    },
    [encoded],
  );

  React.useEffect(
    function loopRange() {
      if (playhead < range.inMs || playhead > range.outMs) setPlayhead(range.inMs);
    },
    [range.inMs, range.outMs],
  );

  const drawBaked = React.useCallback(
    function drawBaked(image: HTMLImageElement, index: number): void {
      const canvas = canvasRef.current;
      if (canvas === null || encoded === null) return;
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        index * encoded.frameWidth,
        0,
        encoded.frameWidth,
        encoded.frameWidth,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    },
    [encoded],
  );

  React.useEffect(
    function drawPausedFrame() {
      if (view !== 'result' || encoded === null || playing) return;
      const span = Math.max(1, range.outMs - range.inMs);
      const index = Math.min(
        encoded.frames - 1,
        Math.max(0, Math.floor(((playhead - range.inMs) / span) * encoded.frames)),
      );
      const image = new Image();
      let disposed = false;
      image.addEventListener('load', function onLoad() {
        if (disposed) return;
        drawBaked(image, index);
      });
      image.src = encoded.atlas;
      return function stop() {
        disposed = true;
      };
    },
    [view, encoded, playing, playhead, range.inMs, range.outMs, drawBaked],
  );

  React.useEffect(
    function loopBaked() {
      if (view !== 'result' || encoded === null || !playing) return;
      const image = new Image();
      let disposed = false;
      let raf = 0;
      const span = Math.max(1, range.outMs - range.inMs);
      const startIndex = Math.min(
        encoded.frames - 1,
        Math.max(0, Math.floor(((playheadRef.current - range.inMs) / span) * encoded.frames)),
      );
      image.addEventListener('load', function onLoad() {
        if (disposed) return;
        const started = performance.now();
        let lastPaint = 0;
        const step = function step(now: number): void {
          if (disposed) return;
          const elapsed = (now - started) / 1000;
          const index = Math.floor((elapsed * encoded.fps + startIndex) % encoded.frames);
          drawBaked(image, index);
          if (now - lastPaint > 80) {
            lastPaint = now;
            setPlayhead(range.inMs + (index / encoded.frames) * span);
          }
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
      image.src = encoded.atlas;
      return function stop() {
        disposed = true;
        if (raf !== 0) cancelAnimationFrame(raf);
      };
    },
    [view, encoded, playing, range.inMs, range.outMs, drawBaked],
  );

  React.useEffect(
    function dragListeners() {
      if (drag === null || source === null) return;
      const duration = Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs);
      const move = function move(event: PointerEvent): void {
        const track = trackRef.current;
        if (track === null) return;
        const rect = track.getBoundingClientRect();
        const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
        const target = Math.min(1, Math.max(0, ratio)) * duration;
        if (drag === 'playhead') {
          setPlayhead(target);
          return;
        }
        if (drag === 'range') {
          const start = dragStartRef.current;
          if (start === null) return;
          const span = Math.max(DSHML_MOTION_MIN_RANGE_MS, start.range.outMs - start.range.inMs);
          const delta = target - start.time;
          const nextIn = Math.min(Math.max(0, start.range.inMs + delta), Math.max(0, duration - span));
          updateRange({ inMs: Math.round(nextIn), outMs: Math.round(nextIn + span) });
          setPlayhead(Math.round(nextIn));
          return;
        }
        const next = dshmlMoveHandle(range, drag, target, duration);
        if (next.inMs !== range.inMs || next.outMs !== range.outMs) {
          if (next.outMs - next.inMs >= DSHML_MOTION_MAX_RANGE_MS) {
            showLive(dshmlCopy('picker.motionRangeLimit', 'The clip is limited to 2 seconds'));
          }
          updateRange(next);
        }
        setPlayhead(drag === 'in' ? next.inMs : next.outMs);
      };
      const up = function up(): void {
        setDrag(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
      return function stop() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
    },
    [drag, source, range.inMs, range.outMs],
  );

  React.useEffect(
    function keyboard() {
      if (status !== 'ready') return;
      const onKeyDown = function onKeyDown(event: KeyboardEvent): void {
        const target = event.target;
        const tag = target instanceof HTMLElement ? target.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const sourceDuration =
          source !== null ? Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs) : DSHML_MOTION_MAX_RANGE_MS;
        if (event.key === ' ') {
          event.preventDefault();
          setPlaying(function toggle(value) {
            return !value;
          });
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const step = event.shiftKey
            ? 100
            : Math.max(20, Math.round((range.outMs - range.inMs) / Math.max(1, frames)));
          const delta = event.key === 'ArrowLeft' ? -step : step;
          setPlayhead(function move(value) {
            return Math.min(Math.max(value + delta, range.inMs), range.outMs);
          });
          return;
        }
        if (event.key === 'i' || event.key === 'I') {
          event.preventDefault();
          updateRange(dshmlMoveHandle(range, 'in', playhead, sourceDuration));
          return;
        }
        if (event.key === 'o' || event.key === 'O') {
          event.preventDefault();
          updateRange(dshmlMoveHandle(range, 'out', playhead, sourceDuration));
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return function off() {
        window.removeEventListener('keydown', onKeyDown);
      };
    },
    [status, source, range.inMs, range.outMs, frames, playhead],
  );

  React.useEffect(function paste() {
    const onPaste = function onPaste(event: ClipboardEvent): void {
      const files = event.clipboardData?.files;
      if (files === undefined || files === null || files.length === 0) return;
      event.preventDefault();
      void acceptRef.current(files[0] ?? null);
    };
    window.addEventListener('paste', onPaste);
    return function off() {
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  React.useEffect(function clearLiveTimer() {
    return function clear() {
      if (liveTimer.current !== null) clearTimeout(liveTimer.current);
    };
  }, []);

  /** The time at a pointer position on the range track. */
  function timeAtPointer(event: ReactPointerEvent<HTMLElement>): number {
    const track = trackRef.current;
    if (track === null || source === null) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.min(1, Math.max(0, ratio)) * Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs);
  }

  /** Clamp the framing crop into the work canvas and de-duplicate Cropper updates. */
  function onCropArea(area: DshmlCropPixels | null): void {
    const next =
      area === null || source === null
        ? null
        : dshmlCropRect({ x: area.sx, y: area.sy, width: area.sw, height: area.sh }, source.width, source.height);
    if (dshmlSameCrop(cropAreaRef.current, next)) return;
    setCropArea(next);
    setChanges([]);
    setUserSettings(null);
  }

  function updateFrames(next: number): void {
    const clamped = Math.min(DSHML_MOTION_MAX_FRAMES, Math.max(DSHML_MOTION_SAMPLE_MIN_FRAMES, Math.round(next)));
    setFrames(clamped);
    setChanges([]);
    setUserSettings(null);
  }

  function updateRange(next: DshmlMotionRange): void {
    setRange(next);
    setPlayhead(function keepInside(value) {
      return Math.min(Math.max(value, next.inMs), next.outMs);
    });
    setChanges([]);
    setUserSettings(null);
  }

  function handleKey(side: 'in' | 'out', key: string, shift: boolean): void {
    if (source === null) return;
    const duration = Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs);
    if (key === 'Home' || key === 'End') {
      const target = key === 'Home' ? 0 : duration;
      updateRange(dshmlMoveHandle(range, side, target, duration));
      return;
    }
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const step = shift ? 100 : 20;
    const delta = key === 'ArrowLeft' ? -step : step;
    const target = (side === 'in' ? range.inMs : range.outMs) + delta;
    updateRange(dshmlMoveHandle(range, side, target, duration));
  }

  function startDrag(target: DshmlDragTarget, event: ReactPointerEvent<HTMLElement>): void {
    if (source === null) return;
    dragStartRef.current = { time: timeAtPointer(event), range };
    setDrag(target);
    if (target === 'playhead') setPlayhead(timeAtPointer(event));
  }

  /** Double-click a handle: the in point goes to the start, the out point to the end. */
  function resetHandle(side: 'in' | 'out'): void {
    if (source === null) return;
    const duration = Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs);
    updateRange(dshmlMoveHandle(range, side, side === 'in' ? 0 : duration, duration));
  }

  /** Abort the current sample / slimming run; the worker stops at its next frame. */
  function cancelWork(): void {
    encodeGeneration.current += 1;
    setSampling(false);
    setSlimming(false);
    setProgress(null);
  }

  async function slim(): Promise<void> {
    if (source === null || slimming || props.disabled === true) return;
    const generation = ++encodeGeneration.current;
    setSlimming(true);
    setSampling(false);
    setErrorText('');
    setUserSettings({ frames, frameWidth });
    try {
      const result = await dshmlFitMotionBudget(
        source,
        { range, frames, frameWidth, quality, crop: cropArea },
        function onProgress(done, total) {
          if (generation === encodeGeneration.current) setProgress({ done, total });
        },
        function cancelled() {
          return generation !== encodeGeneration.current;
        },
        cacheRef.current,
      );
      if (generation !== encodeGeneration.current) return;
      const settledKey = dshmlSampleKey(
        range,
        result.encoded.frames,
        result.encoded.frameWidth,
        result.encoded.quality,
        cropArea,
      );
      skipEncodeKey.current = settledKey;
      setFrames(result.encoded.frames);
      setFrameWidth(result.encoded.frameWidth);
      setQuality(result.encoded.quality);
      setEncoded(result.encoded);
      setSampledKey(settledKey);
      setChanges(result.changes);
      setSlimming(false);
      setProgress(null);
      if (result.encoded.verdict === 'over') {
        setErrorText(
          dshmlCopy('picker.motionOverBudget', 'Over the size budget — shrink automatically or reduce the frames'),
        );
      }
    } catch (error) {
      if (generation !== encodeGeneration.current) return;
      setSlimming(false);
      setProgress(null);
      if (dshmlMediaErrorCode(error) !== 'cancelled') {
        setErrorText(dshmlCopy('picker.motionError', 'Could not sample this source — try again'));
      }
    }
  }

  function undo(): void {
    if (userSettings === null) return;
    skipEncodeKey.current = null;
    setFrames(userSettings.frames);
    setFrameWidth(userSettings.frameWidth);
    setQuality(DSHML_SPRITE_DEFAULT_OPTIONS.quality);
    setChanges([]);
    setUserSettings(null);
  }

  async function useStatic(): Promise<void> {
    if (singleFrame === null) return;
    try {
      const url = await dshmlReadFileDataUrl(singleFrame);
      props.onUseStatic(url);
    } catch {
      setErrorText(dshmlCopy('picker.imageRead', 'Could not read that file'));
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files;
    void acceptFile(files !== null && files.length > 0 ? (files[0] ?? null) : null);
    try {
      event.target.value = '';
    } catch {
      /* some engines make file inputs read-only */
    }
  }

  function onTrackPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (source === null) return;
    startDrag('playhead', event);
  }

  const fileInput = h('input', {
    key: 'file',
    type: 'file',
    ref: fileRef,
    accept: DSHML_MEDIA_ACCEPT,
    className: 'dshml-custom-file',
    tabIndex: -1,
    'aria-hidden': 'true',
    onChange: onFileChange,
  });

  /** The full sentences behind the slimming summary, for the status tooltip. */
  function changeDetail(): string {
    const lines: string[] = [];
    for (const change of changes) {
      if (change.kind === 'quality') {
        lines.push(
          dshmlCopy('picker.motionSlimQuality', 'Quality lowered from {from} to {to} to fit the budget', {
            from: dshmlQuality(change.from),
            to: dshmlQuality(change.to),
          }),
        );
      } else if (change.kind === 'frames') {
        lines.push(
          dshmlCopy('picker.motionSlimFrames', 'Frames reduced from {from} to {to} to fit the budget', {
            from: change.from,
            to: change.to,
          }),
        );
      } else {
        lines.push(
          dshmlCopy('picker.motionSlimSize', 'Frame edge reduced from {from}px to {to}px to fit the budget', {
            from: change.from,
            to: change.to,
          }),
        );
      }
    }
    return lines.join('\n');
  }

  /**
   * The one line the dock shows: an error beats a live notice, which beats the
   * progress of a running job, the over-budget explanation, the slimming summary
   * and finally the contextual hints. Rendering it in a reserved row is what
   * keeps a warning from resizing the dialog.
   */
  function statusLine(): { text: string; tone: 'error' | 'warn' | 'muted'; detail: string } {
    if (errorText !== '') return { text: errorText, tone: 'error', detail: errorText };
    if (liveMessage !== '') return { text: liveMessage, tone: 'warn', detail: '' };
    if (slimming) {
      return {
        text:
          progress !== null
            ? dshmlCopy('picker.motionSampling', 'Sampling frame {done}/{total}…', {
                done: progress.done,
                total: progress.total,
              })
            : dshmlCopy('picker.motionSlimming', 'Shrinking…'),
        tone: 'muted',
        detail: '',
      };
    }
    if (sampling) {
      return {
        text: dshmlCopy('picker.motionSampling', 'Sampling frame {done}/{total}…', {
          done: progress !== null ? progress.done : 0,
          total: progress !== null ? progress.total : frames,
        }),
        tone: 'muted',
        detail: '',
      };
    }
    if (overBudget) {
      const text = dshmlCopy(
        'picker.motionOverBudget',
        'Over the size budget — shrink automatically or reduce the frames',
      );
      return { text, tone: 'warn', detail: text };
    }
    if (changes.length > 0) {
      return {
        text: dshmlCopy('picker.motionSlimSummary', '{n} automatic adjustments to fit the budget', {
          n: changes.length,
        }),
        tone: 'muted',
        detail: changeDetail(),
      };
    }
    if (matched && encoded !== null && encoded.fps < 4) {
      return {
        text: dshmlCopy('picker.motionLowFps', 'Low frame rate — motion may look jumpy'),
        tone: 'warn',
        detail: '',
      };
    }
    if (matched && encoded !== null && encoded.distinctFrames < encoded.frames) {
      const text = dshmlCopy('picker.motionDistinct', 'Distinct frames {n}/{m}', {
        n: encoded.distinctFrames,
        m: encoded.frames,
      });
      return { text, tone: 'muted', detail: '' };
    }
    if (view === 'source') {
      return {
        text: dshmlCopy('picker.motionCropHint', 'The crop applies to all {n} frames', { n: frames }),
        tone: 'muted',
        detail: '',
      };
    }
    if (reducedMotion.current) {
      return {
        text: dshmlCopy('picker.motionReduced', 'Reduced motion is on; playback starts paused.'),
        tone: 'muted',
        detail: '',
      };
    }
    return { text: '', tone: 'muted', detail: '' };
  }

  if (status !== 'ready' || source === null) {
    const idleStatus =
      errorText !== ''
        ? errorText
        : status === 'reading' && readingVisible
          ? dshmlCopy('picker.motionReading', 'Reading the source…')
          : '';
    return h('div', { className: 'dshml-motion' }, [
      h(DshmlMotionDrop, {
        key: 'drop',
        disabled: props.disabled === true,
        onPick: pickFile,
        onFile: function onFile(file) {
          void acceptFile(file);
        },
      }),
      // The line is reserved even while it is empty: a delayed "reading" notice
      // then replaces the text instead of pushing the dropzone up.
      h(
        'p',
        {
          key: 'status',
          className:
            'dshml-motion-status' + (errorText !== '' ? ' dshml-motion-status-error' : ' dshml-motion-status-muted'),
          role: errorText !== '' ? 'alert' : 'status',
        },
        idleStatus,
      ),
      singleFrame !== null
        ? h(
            'div',
            { key: 'static', className: 'dshml-motion-static-switch' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshml-custom-btn',
                onClick: function onUseStatic() {
                  void useStatic();
                },
              },
              dshmlCopy('picker.motionSwitchStatic', 'Use a still image'),
            ),
          )
        : null,
      fileInput,
    ]);
  }

  return h('div', { className: 'dshml-motion dshml-motion-ready' }, [
    h('div', { key: 'work', className: 'dshml-motion-work' }, [
      h(DshmlMotionCanvas, {
        key: 'canvas',
        source,
        fileName,
        format,
        range,
        encoded,
        view,
        playing,
        playhead,
        canvasRef,
        stillUrl,
        crop,
        zoom,
        disabled: props.disabled === true,
        onView: function onView(next) {
          setView(next);
          if (next === 'source') setPlaying(false);
        },
        onTogglePlay: function togglePlay() {
          setView('result');
          setPlaying(function toggle(value) {
            return !value;
          });
        },
        onSeek: function onSeek(ms) {
          setPlaying(false);
          setPlayhead(Math.min(Math.max(ms, range.inMs), range.outMs));
        },
        onCrop: setCrop,
        onZoom: setZoom,
        onArea: onCropArea,
        onCenter: function center() {
          setCrop({ x: 0, y: 0 });
          setZoom(1);
        },
      }),
      h('div', { key: 'side', className: 'dshml-motion-side' }, [
        h(DshmlMotionTimeline, {
          key: 'timeline',
          durationMs: Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs),
          range,
          playhead,
          thumbs,
          zoomIndex,
          disabled: props.disabled === true,
          trackRef,
          scrollerRef,
          onDragStart: startDrag,
          onHandleKey: handleKey,
          onHandleReset: resetHandle,
          onTrackPointerDown,
          onZoom: setZoomIndex,
          onChangeSource: pickFile,
        }),
        h(DshmlMotionSamples, {
          key: 'samples',
          encoded,
          range,
          frames,
          playhead,
          disabled: props.disabled === true,
          stripRef,
          overflowing: stripOverflows,
          onFrames: updateFrames,
          onSeek: function onSeek(ms) {
            setPlaying(false);
            setPlayhead(ms);
          },
          onScroll: function onScroll() {
            const strip = stripRef.current;
            if (strip === null) return;
            setStripOverflows(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
          },
        }),
        h(DshmlMotionTiles, {
          key: 'tiles',
          encoded,
          reducedMotion: reducedMotion.current,
        }),
      ]),
    ]),
    h(DshmlMotionDock, {
      key: 'dock',
      encoded,
      sampling,
      slimming,
      progress,
      changes,
      userSettings,
      overBudget,
      disabled: props.disabled === true,
      status: statusLine(),
      onSlim: function onSlim() {
        void slim();
      },
      onUndo: undo,
      onCancel: cancelWork,
    }),
    fileInput,
  ]);
}
