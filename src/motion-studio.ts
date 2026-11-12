/**
 * The motion sampling studio.
 *
 * One screen takes an animated image or a short video from file to a stored
 * motion record: import → framing → range → frame count → sample → size budget →
 * true-size preview. The heavy browser work lives in `src/media-source.ts`
 * (decode one frame at a time) and `src/sprite.ts` (render, encode, slim); this
 * component owns the state machine, the interactions and the copy.
 *
 * Design rules from the plan, in code: the crop is static geometry applied to
 * every frame; only the frame count and the clip change resampling; a new result
 * never blanks the old strip while it is being produced; every automatic change
 * is listed and can be undone; and the four true-size tiles render the same mark
 * strings the real surfaces will render.
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
  dshmlAtlasSvg,
  dshmlClampRange,
  dshmlEffectiveFps,
  dshmlInitialFrameCount,
} from './motion';
import type { DshmlMotionRange } from './motion';
import {
  DSHML_SPRITE_ATLAS_LIMIT,
  DSHML_SPRITE_DEFAULT_OPTIONS,
  dshmlEncodeMotionIcon,
  dshmlFitMotionBudget,
} from './sprite';
import type { DshmlEncodedMotion, DshmlSlimChange } from './sprite';

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
type DshmlDragTarget = 'in' | 'out' | 'playhead';

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
  if (end - start < minSpan) end = Math.min(duration, start + minSpan);
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

/** Props of the monitor panel. */
interface DshmlMonitorProps {
  source: DshmlMediaSource;
  range: DshmlMotionRange;
  encoded: DshmlEncodedMotion | null;
  monitor: 'baked' | 'original';
  playing: boolean;
  playhead: number;
  reducedMotion: boolean;
  canvasRef: { current: HTMLCanvasElement | null };
  videoRef: { current: HTMLVideoElement | null };
  onMonitor: (mode: 'baked' | 'original') => void;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
}

/** One segment of the monitor-mode switch. */
function DshmlMonitorMode(props: { active: boolean; label: string; onClick: () => void }): ReactElement {
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

/** The square monitor with baked/source modes and the transport row. */
function DshmlMotionMonitor(props: DshmlMonitorProps): ReactElement {
  const time = dshmlClock(props.playhead - props.range.inMs) + ' / ' + dshmlClock(props.range.outMs - props.range.inMs);
  const playLabel = props.playing ? dshmlCopy('picker.motionPause', 'Pause') : dshmlCopy('picker.motionPlay', 'Play');
  return h('section', { className: 'dshml-motion-panel dshml-motion-monitor' }, [
    h('div', { key: 'head', className: 'dshml-motion-panel-head' }, [
      h('span', { key: 'title', className: 'dshml-motion-panel-title' }, dshmlCopy('picker.motionMonitor', 'Monitor')),
      h('div', { key: 'modes', className: 'dshml-motion-seg' }, [
        h(DshmlMonitorMode, {
          key: 'baked',
          active: props.monitor === 'baked',
          label: dshmlCopy('picker.motionBaked', 'Result'),
          onClick: function onBaked() {
            props.onMonitor('baked');
          },
        }),
        h(DshmlMonitorMode, {
          key: 'original',
          active: props.monitor === 'original',
          label: dshmlCopy('picker.motionOriginal', 'Source'),
          onClick: function onOriginal() {
            props.onMonitor('original');
          },
        }),
      ]),
    ]),
    h('div', { key: 'stage', className: 'dshml-motion-stage' }, [
      props.monitor === 'baked'
        ? h('canvas', {
            key: 'canvas',
            ref: props.canvasRef,
            className: 'dshml-motion-canvas',
            width: 240,
            height: 240,
            'aria-label': dshmlCopy('picker.motionBaked', 'Result'),
            role: 'img',
          })
        : props.source.kind === 'video'
          ? h('video', {
              key: 'video',
              ref: props.videoRef,
              className: 'dshml-motion-video',
              src: props.source.previewUrl,
              muted: true,
              playsInline: true,
              preload: 'auto',
            })
          : h('img', {
              key: 'img',
              className: 'dshml-motion-video',
              src: props.source.previewUrl,
              alt: dshmlCopy('picker.motionOriginal', 'Source'),
            }),
      props.monitor === 'baked' && props.encoded === null
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
      props.reducedMotion
        ? h(
            'span',
            { key: 'rm', className: 'dshml-motion-note' },
            dshmlCopy('picker.motionReduced', 'Reduced motion is on; playback starts paused.'),
          )
        : null,
    ]),
  ]);
}

/** Props of the framing panel. */
interface DshmlFramingProps {
  stillUrl: string;
  crop: Point;
  zoom: number;
  frames: number;
  disabled: boolean;
  onCrop: (point: Point) => void;
  onZoom: (zoom: number) => void;
  onArea: (area: DshmlCropPixels | null) => void;
  onCenter: () => void;
}

/** The 1:1 crop viewport over the current playhead frame. */
function DshmlMotionFraming(props: DshmlFramingProps): ReactElement {
  return h('section', { className: 'dshml-motion-panel dshml-motion-framing' }, [
    h(
      'div',
      { key: 'head', className: 'dshml-motion-panel-head' },
      h('span', { key: 'title', className: 'dshml-motion-panel-title' }, dshmlCopy('picker.motionFraming', 'Framing')),
    ),
    h('div', { key: 'crop', className: 'dshml-motion-cropper' }, [
      props.stillUrl !== ''
        ? h(Cropper, {
            key: 'cropper',
            image: props.stillUrl,
            crop: props.crop,
            zoom: props.zoom,
            rotation: 0,
            aspect: 1,
            minZoom: 1,
            maxZoom: 3,
            cropShape: 'rect',
            showGrid: true,
            zoomSpeed: 1,
            zoomWithScroll: false,
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
          ),
    ]),
    h('label', { key: 'zoom', className: 'dshml-custom-zoom' }, [
      h('span', { key: 'label', className: 'dshml-custom-zoom-label' }, dshmlCopy('picker.zoom', 'Zoom')),
      h('input', {
        key: 'range',
        type: 'range',
        className: 'dshml-custom-zoom-range',
        min: 1,
        max: 3,
        step: 0.01,
        value: props.zoom,
        disabled: props.disabled,
        'aria-label': dshmlCopy('picker.zoom', 'Zoom'),
        onChange: function onZoom(event: ChangeEvent<HTMLInputElement>) {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.onZoom(next);
        },
      }),
    ]),
    h('div', { key: 'actions', className: 'dshml-motion-framing-actions' }, [
      h(
        'button',
        {
          key: 'center',
          type: 'button',
          className: 'dshml-custom-link',
          disabled: props.disabled,
          onClick: props.onCenter,
        },
        dshmlCopy('picker.motionCenter', 'Centre'),
      ),
      h(
        'span',
        { key: 'hint', className: 'dshml-custom-hint' },
        dshmlCopy('picker.motionCropHint', 'The crop applies to all {n} frames', { n: props.frames }),
      ),
    ]),
  ]);
}

/** Props of the timeline panel. */
interface DshmlTimelineProps {
  durationMs: number;
  range: DshmlMotionRange;
  playhead: number;
  thumbs: readonly string[];
  liveMessage: string;
  trackRef: { current: HTMLDivElement | null };
  onDragStart: (target: DshmlDragTarget, event: ReactPointerEvent<HTMLElement>) => void;
  onHandleKey: (side: 'in' | 'out', key: string, shift: boolean) => void;
  onTrackPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
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
    },
    props.edge ? h('span', { className: 'dshml-motion-handle-mark', 'aria-hidden': 'true' }) : null,
  );
}

/** Source strip, range handles and the playhead. */
function DshmlMotionTimeline(props: DshmlTimelineProps): ReactElement {
  const duration = Math.max(1, props.durationMs);
  const inPct = (props.range.inMs / duration) * 100;
  const outPct = (props.range.outMs / duration) * 100;
  const headPct = (Math.min(Math.max(props.playhead, props.range.inMs), props.range.outMs) / duration) * 100;
  const thumbs: ReactElement[] = [];
  for (let index = 0; index < 16; index += 1) {
    const source = props.thumbs[index];
    thumbs.push(
      h('span', {
        key: 'thumb-' + index,
        className: 'dshml-motion-thumb' + (source === undefined ? ' dshml-motion-thumb-empty' : ''),
        style: source !== undefined ? { backgroundImage: 'url(' + source + ')' } : undefined,
      }),
    );
  }
  return h('section', { className: 'dshml-motion-timeline' }, [
    h(
      'div',
      { key: 'head', className: 'dshml-motion-panel-head' },
      h('span', { key: 'title', className: 'dshml-motion-panel-title' }, dshmlCopy('picker.motionTimeline', 'Source')),
    ),
    h('div', { key: 'thumbs', className: 'dshml-motion-thumbs', 'aria-hidden': 'true' }, thumbs),
    h(
      'div',
      { key: 'track', ref: props.trackRef, className: 'dshml-motion-track', onPointerDown: props.onTrackPointerDown },
      [
        h('span', { key: 'rail', className: 'dshml-motion-rail', 'aria-hidden': 'true' }),
        h('span', {
          key: 'range',
          className: 'dshml-motion-range',
          'aria-hidden': 'true',
          style: { left: inPct + '%', width: Math.max(0, outPct - inPct) + '%' },
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
        }),
      ],
    ),
    h('div', { key: 'labels', className: 'dshml-motion-range-labels' }, [
      h('span', { key: 'in' }, dshmlCopy('picker.motionIn', 'In') + ' ' + dshmlClock(props.range.inMs)),
      h(
        'span',
        { key: 'live', className: 'dshml-motion-live', role: 'status', 'aria-live': 'polite' },
        props.liveMessage,
      ),
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
  sampling: boolean;
  progress: { done: number; total: number } | null;
  distinct: number | null;
  disabled: boolean;
  onFrames: (frames: number) => void;
  onSeek: (ms: number) => void;
}

/** Frame-count slider, the sampled strip and the effective rate. */
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
  const lowFps = props.encoded !== null && props.encoded.fps < 4;
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
      lowFps
        ? h(
            'span',
            { key: 'low', className: 'dshml-motion-note' },
            dshmlCopy('picker.motionLowFps', 'Low frame rate — motion may look jumpy'),
          )
        : null,
    ]),
    h('div', { key: 'strip', className: 'dshml-motion-strip', role: 'group' }, cells),
    props.sampling
      ? h(
          'p',
          { key: 'progress', className: 'dshml-motion-progress', role: 'status' },
          props.progress !== null
            ? dshmlCopy('picker.motionSampling', 'Sampling frame {done}/{total}…', {
                done: props.progress.done,
                total: props.progress.total,
              })
            : dshmlCopy('picker.motionSampling', 'Sampling frame {done}/{total}…', {
                done: 0,
                total: props.frames,
              }),
        )
      : null,
    props.distinct !== null && props.encoded !== null && props.distinct < props.encoded.frames
      ? h(
          'p',
          { key: 'distinct', className: 'dshml-motion-note' },
          dshmlCopy('picker.motionDistinct', 'Distinct frames {n}/{m}', {
            n: props.distinct,
            m: props.encoded.frames,
          }),
        )
      : null,
  ]);
}

/** Props of the size-budget panel. */
interface DshmlBudgetProps {
  encoded: DshmlEncodedMotion | null;
  slimming: boolean;
  changes: readonly DshmlSlimChange[];
  userSettings: { frames: number; frameWidth: number } | null;
  overBudget: boolean;
  onSlim: () => void;
  onUndo: () => void;
  disabled: boolean;
}

/** The size meter, the slimming action and the change/undo list. */
function DshmlMotionBudget(props: DshmlBudgetProps): ReactElement {
  const atlasChars = props.encoded !== null ? props.encoded.atlasChars : 0;
  const posterChars = props.encoded !== null ? props.encoded.posterChars : 0;
  const verdict = dshmlBudgetPlan(atlasChars, posterChars);
  const pct = Math.min(100, (atlasChars / DSHML_SPRITE_ATLAS_LIMIT) * 100);
  const barClass =
    'dshml-motion-bar' +
    (verdict === 'over' ? ' dshml-motion-bar-over' : verdict === 'warn' ? ' dshml-motion-bar-warn' : '');
  const notes: ReactElement[] = [];
  for (const change of props.changes) {
    let text = '';
    if (change.kind === 'quality') {
      text = dshmlCopy('picker.motionSlimQuality', 'Quality lowered from {from} to {to} to fit the budget', {
        from: dshmlQuality(change.from),
        to: dshmlQuality(change.to),
      });
    } else if (change.kind === 'frames') {
      text = dshmlCopy('picker.motionSlimFrames', 'Frames reduced from {from} to {to} to fit the budget', {
        from: change.from,
        to: change.to,
      });
    } else {
      text = dshmlCopy('picker.motionSlimSize', 'Frame edge reduced from {from}px to {to}px to fit the budget', {
        from: change.from,
        to: change.to,
      });
    }
    notes.push(
      h('li', { key: change.kind + '-' + change.from + '-' + change.to, className: 'dshml-motion-note' }, text),
    );
  }
  return h('section', { className: 'dshml-motion-budget' }, [
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
      props.encoded !== null
        ? h(
            'span',
            { key: 'estimate', className: 'dshml-motion-note' },
            dshmlCopy('picker.motionEstimate', '{n} frames · {fps} fps', {
              n: props.encoded.frames,
              fps: props.encoded.fps,
            }),
          )
        : null,
      props.overBudget
        ? h(
            'button',
            {
              key: 'slim',
              type: 'button',
              className: 'dshml-custom-btn dshml-custom-btn-primary dshml-motion-slim',
              disabled: props.disabled || props.slimming,
              onClick: props.onSlim,
            },
            props.slimming
              ? dshmlCopy('picker.motionSlimming', 'Shrinking…')
              : dshmlCopy('picker.motionSlim', 'Shrink automatically'),
          )
        : null,
    ]),
    notes.length > 0
      ? h('div', { key: 'notes', className: 'dshml-motion-notes', 'aria-live': 'polite' }, [
          h('ul', { key: 'list', className: 'dshml-motion-note-list' }, notes),
          props.userSettings !== null
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
        ])
      : null,
    props.overBudget
      ? h(
          'p',
          { key: 'over', className: 'dshml-motion-error', role: 'alert' },
          dshmlCopy('picker.motionOverBudget', 'Over the size budget — shrink automatically or reduce the frames'),
        )
      : null,
  ]);
}

/** Props of the true-size preview row. */
interface DshmlPreviewProps {
  encoded: DshmlEncodedMotion | null;
  reducedMotion: boolean;
}

/** The 20 / 22 / 36 / 64 px tiles rendered from the real mark strings. */
function DshmlMotionPreview(props: DshmlPreviewProps): ReactElement {
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
  const [monitor, setMonitor] = React.useState<'baked' | 'original'>('baked');
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [drag, setDrag] = React.useState<DshmlDragTarget | null>(null);
  const [liveMessage, setLiveMessage] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const importGeneration = React.useRef(0);
  const encodeGeneration = React.useRef(0);
  const stillGeneration = React.useRef(0);
  const thumbsGeneration = React.useRef(0);
  const skipNextEncode = React.useRef(false);
  const autoPlayed = React.useRef(false);
  const reducedMotion = React.useRef(dshmlReducedMotion());
  const playheadRef = React.useRef(0);
  const acceptRef = React.useRef<(file: File | null) => void>(function noop() {});
  const onReadyRef = React.useRef(props.onReady);
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
        if (source !== null) source.dispose();
      };
    },
    [source],
  );

  React.useEffect(function acceptLatest() {
    acceptRef.current = acceptFile;
  });

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

  async function loadThumbs(next: DshmlMediaSource, generation: number): Promise<void> {
    const own = ++thumbsGeneration.current;
    const work = document.createElement('canvas');
    work.width = next.width;
    work.height = next.height;
    const count = 16;
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
      if (index % 4 === 0) setThumbs([...loaded]);
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
    setSource(next);
    setRange(initial);
    setFrames(dshmlInitialFrameCount(initial));
    setFrameWidth(DSHML_SPRITE_DEFAULT_OPTIONS.frameWidth);
    setQuality(DSHML_SPRITE_DEFAULT_OPTIONS.quality);
    setCropArea(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setStillUrl('');
    setThumbs([]);
    setEncoded(null);
    setSampledKey('');
    setChanges([]);
    setUserSettings(null);
    setPlayhead(initial.inMs);
    setPlaying(false);
    setMonitor('baked');
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
      if (source === null || status !== 'ready' || cropArea === null) return;
      if (skipNextEncode.current) {
        skipNextEncode.current = false;
        return;
      }
      const key = currentKey;
      const generation = ++encodeGeneration.current;
      setSampling(true);
      setProgress(null);
      const timer = setTimeout(function run() {
        void (async function encode() {
          try {
            const result = await dshmlEncodeMotionIcon(
              source,
              { range, frames, frameWidth, quality, crop: cropArea },
              function onProgress(done, total) {
                if (generation === encodeGeneration.current) setProgress({ done, total });
              },
              function cancelled() {
                return generation !== encodeGeneration.current;
              },
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
      if (monitor !== 'baked' || encoded === null || playing) return;
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
    [monitor, encoded, playing, playhead, range.inMs, range.outMs, drawBaked],
  );

  React.useEffect(
    function loopBaked() {
      if (monitor !== 'baked' || encoded === null || !playing) return;
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
    [monitor, encoded, playing, range.inMs, range.outMs, drawBaked],
  );

  React.useEffect(
    function playOriginalVideo() {
      if (monitor !== 'original' || source === null || source.kind !== 'video') return;
      const video = videoRef.current;
      if (video === null) return;
      if (playing) {
        try {
          video.currentTime = range.inMs / 1000;
          void video.play().catch(function ignore() {});
        } catch {
          /* an autoplay refusal is harmless: the transport stays usable */
        }
      } else {
        video.pause();
      }
      const onTime = function onTime() {
        setPlayhead(video.currentTime * 1000);
        if (playing && video.currentTime * 1000 >= range.outMs) {
          video.currentTime = range.inMs / 1000;
        }
      };
      video.addEventListener('timeupdate', onTime);
      return function stop() {
        video.removeEventListener('timeupdate', onTime);
        video.pause();
      };
    },
    [monitor, source, playing, range.inMs, range.outMs],
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
    setDrag(target);
    if (target === 'playhead') setPlayhead(timeAtPointer(event));
  }

  async function slim(): Promise<void> {
    if (source === null || cropArea === null || slimming || props.disabled === true) return;
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
      );
      if (generation !== encodeGeneration.current) return;
      skipNextEncode.current = true;
      setFrames(result.encoded.frames);
      setFrameWidth(result.encoded.frameWidth);
      setQuality(result.encoded.quality);
      setEncoded(result.encoded);
      setSampledKey(
        dshmlSampleKey(range, result.encoded.frames, result.encoded.frameWidth, result.encoded.quality, cropArea),
      );
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
    skipNextEncode.current = false;
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

  const errorLine =
    errorText !== ''
      ? h('p', { key: 'error', className: 'dshml-picker-error dshml-motion-error', role: 'alert' }, errorText)
      : null;

  if (status !== 'ready' || source === null) {
    return h('div', { className: 'dshml-motion' }, [
      h(DshmlMotionDrop, {
        key: 'drop',
        disabled: props.disabled === true,
        onPick: pickFile,
        onFile: function onFile(file) {
          void acceptFile(file);
        },
      }),
      status === 'reading' && readingVisible
        ? h(
            'p',
            { key: 'reading', className: 'dshml-motion-progress', role: 'status' },
            dshmlCopy('picker.motionReading', 'Reading the source…'),
          )
        : null,
      errorLine,
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
    h('div', { key: 'top', className: 'dshml-motion-top' }, [
      h(DshmlMotionMonitor, {
        key: 'monitor',
        source,
        range,
        encoded,
        monitor,
        playing,
        playhead,
        reducedMotion: reducedMotion.current,
        canvasRef,
        videoRef,
        onMonitor: function onMonitor(mode) {
          setMonitor(mode);
          setPlaying(false);
        },
        onTogglePlay: function togglePlay() {
          setMonitor('baked');
          setPlaying(function toggle(value) {
            return !value;
          });
        },
        onSeek: function onSeek(ms) {
          setPlaying(false);
          setPlayhead(Math.min(Math.max(ms, range.inMs), range.outMs));
        },
      }),
      h(DshmlMotionFraming, {
        key: 'framing',
        stillUrl,
        crop,
        zoom,
        frames,
        disabled: props.disabled === true,
        onCrop: setCrop,
        onZoom: setZoom,
        onArea: onCropArea,
        onCenter: function center() {
          setCrop({ x: 0, y: 0 });
          setZoom(1);
        },
      }),
    ]),
    h(DshmlMotionPreview, {
      key: 'preview',
      encoded,
      reducedMotion: reducedMotion.current,
    }),
    h(DshmlMotionTimeline, {
      key: 'timeline',
      durationMs: Math.max(DSHML_MOTION_MIN_RANGE_MS, source.durationMs),
      range,
      playhead,
      thumbs,
      liveMessage,
      trackRef,
      onDragStart: startDrag,
      onHandleKey: handleKey,
      onTrackPointerDown,
    }),
    h(DshmlMotionSamples, {
      key: 'samples',
      encoded,
      range,
      frames,
      playhead,
      sampling,
      progress,
      distinct: matched && encoded !== null ? encoded.distinctFrames : null,
      onFrames: updateFrames,
      onSeek: function onSeek(ms) {
        setPlaying(false);
        setPlayhead(ms);
      },
      disabled: props.disabled === true,
    }),
    h(DshmlMotionBudget, {
      key: 'budget',
      encoded,
      slimming,
      changes,
      userSettings,
      overBudget,
      onSlim: function onSlim() {
        void slim();
      },
      onUndo: undo,
      disabled: props.disabled === true,
    }),
    errorLine,
    h('div', { key: 'source-actions', className: 'dshml-motion-source-actions' }, [
      h('span', { key: 'name', className: 'dshml-custom-hint', title: fileName }, fileName),
      h(
        'button',
        {
          key: 'change',
          type: 'button',
          className: 'dshml-custom-link',
          disabled: props.disabled === true,
          onClick: pickFile,
        },
        dshmlCopy('picker.motionChange', 'Change source'),
      ),
    ]),
    fileInput,
  ]);
}
