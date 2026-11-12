/**
 * Create / rename / delete dialog for user-created custom icons.
 *
 * Rendered **inside** the icon picker modal (the picker owns the layer, the
 * focus trap and the close button); this component only owns the form body and
 * its footer. The dialog is reached from the picker's `自定义` group: the
 * `+` cell opens it in `create` mode, a custom cell's pencil opens `rename`.
 *
 * The image path is real cropping, not a hand-rolled drag handle: the chosen
 * file is shown in `react-easy-crop` (MIT) inside a fixed square viewport, the
 * user pans/zooms the image, and the encoded result is
 * {@link DSHML_CUSTOM_ICON_PX}² pixels of PNG (WebP when the PNG would exceed
 * the stored payload budget). The crop rectangle maths lives in
 * `src/custom-icons.ts` so it is unit-tested without a browser.
 *
 * Tabs: `静态图片` keeps the original cropper and `动态` opens the motion
 * sampling studio (`src/motion-studio.ts`), which handles both animated images
 * and short videos. A rename of an icon that already carries a `motion` record
 * only edits the name: the source file was never stored, so it cannot be
 * re-sampled.
 */
import type { ChangeEvent, DragEvent, ReactElement } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { h, React } from './runtime';
import type { CustomIconMotion, IconScope } from './types';
import { dshmlT } from './i18n';
import {
  DSHML_CUSTOM_ICON_PX,
  DSHML_CUSTOM_MAX_DATA_URL,
  DSHML_CUSTOM_MAX_NAME,
  DSHML_CUSTOM_MAX_SOURCE_BYTES,
  dshmlCropRect,
  dshmlCustomIconsOf,
  dshmlIsAcceptedImageType,
  dshmlIsCustomImageDataUrl,
  dshmlValidateCustomName,
} from './custom-icons';
import type { DshmlCustomNameProblem } from './custom-icons';
import { DshmlMotionStudio } from './motion-studio';
import type { DshmlMotionReadyState } from './motion-studio';
import { dshmlCreateCustomIcon, dshmlDeleteCustomIcon, dshmlRenameCustomIcon, dshmlUseIconState } from './overrides';

/** Copy lookup with an English fallback, so a missing key never shows a raw key. */
function dshmlEditorCopy(key: string, fallback: string, vars?: Readonly<Record<string, string | number>>): string {
  try {
    const value = dshmlT(key, vars);
    if (typeof value === 'string' && value !== '' && value !== key) return value;
  } catch {
    /* fall through to the literal */
  }
  return fallback;
}

/** Which editor the picker asked for. */
export type DshmlCustomIconEditorMode = 'create' | 'rename';

/** Where a created icon is applied immediately. */
export interface DshmlCustomIconEditorApply {
  scope: IconScope;
  providerId: string;
  modelId?: string | null;
}

/** The rename target, as the picker normalizes it. */
export interface DshmlCustomIconEditorTarget {
  id: string;
  name: string;
  /** Present when the target already carries a sampled animation. */
  motion?: CustomIconMotion;
}

/** Props of {@link DshmlCustomIconEditor}. */
export interface DshmlCustomIconEditorProps {
  mode: DshmlCustomIconEditorMode;
  /** Rename target; null in create mode. */
  icon: DshmlCustomIconEditorTarget | null;
  /** Picker target a created icon is applied to in the same write. */
  apply: DshmlCustomIconEditorApply;
  /** Return to the picker without writing anything. */
  onCancel: () => void;
  /** Called after a successful write; the picker decides whether to close. */
  onDone: (result: 'created' | 'renamed' | 'deleted') => void;
}

/** Encoded crop exceeded the stored payload budget. */
const DSHML_ENCODE_TOO_BIG = 'dshml-custom-icon-too-big';

/** Read a browser File as a data URL (the cropper accepts data URLs directly). */
function dshmlReadFile(file: File): Promise<string> {
  return new Promise<string>(function executor(resolve, reject) {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      function onLoad() {
        const result = reader.result;
        if (typeof result === 'string' && result !== '') resolve(result);
        else reject(new Error('empty data url'));
      },
      { once: true },
    );
    reader.addEventListener(
      'error',
      function onError() {
        reject(reader.error ?? new Error('file read failed'));
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

/** Decode a data URL into an `<img>` element. */
function dshmlLoadImage(source: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>(function executor(resolve, reject) {
    const image = new Image();
    image.addEventListener(
      'load',
      function onLoad() {
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      'error',
      function onError() {
        reject(new Error('image decode failed'));
      },
      { once: true },
    );
    image.src = source;
  });
}

/** Keep a file drop on the upload button from navigating the page. */
function dshmlPreventDragOver(event: DragEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/**
 * Draw the cropped square into a {@link DSHML_CUSTOM_ICON_PX}² canvas and encode
 * it. PNG keeps logos crisp; a PNG above the payload budget is re-encoded as
 * WebP, and only a payload that still exceeds the budget is rejected.
 * @param source - data URL of the file the user picked.
 * @param area - crop rectangle in natural image pixels (from `react-easy-crop`).
 */
async function dshmlEncodeCroppedIcon(source: string, area: Area): Promise<string> {
  const image = await dshmlLoadImage(source);
  const rect = dshmlCropRect(area, image.naturalWidth, image.naturalHeight);
  if (rect === null) throw new Error('crop out of bounds');
  const canvas = document.createElement('canvas');
  canvas.width = DSHML_CUSTOM_ICON_PX;
  canvas.height = DSHML_CUSTOM_ICON_PX;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, DSHML_CUSTOM_ICON_PX, DSHML_CUSTOM_ICON_PX);
  context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, DSHML_CUSTOM_ICON_PX, DSHML_CUSTOM_ICON_PX);
  let data = canvas.toDataURL('image/png');
  if (data.length > DSHML_CUSTOM_MAX_DATA_URL || !dshmlIsCustomImageDataUrl(data)) {
    const webp = canvas.toDataURL('image/webp', 0.92);
    if (dshmlIsCustomImageDataUrl(webp)) data = webp;
  }
  if (!dshmlIsCustomImageDataUrl(data)) throw new Error(DSHML_ENCODE_TOO_BIG);
  return data;
}

/** Localized message for one rejected name. */
function dshmlNameProblemText(problem: DshmlCustomNameProblem): string {
  if (problem === 'empty') return dshmlEditorCopy('picker.nameEmpty', 'Enter an icon name');
  if (problem === 'too-long') {
    return dshmlEditorCopy('picker.nameTooLong', 'The name is limited to {n} characters', {
      n: DSHML_CUSTOM_MAX_NAME,
    });
  }
  return dshmlEditorCopy('picker.nameDuplicate', 'An icon with this name already exists');
}

/** The two payload types the editor offers (animated images and videos share one). */
type DshmlCustomKind = 'image' | 'motion';

/** One tab of the icon-type switch. */
interface DshmlCustomKindTab {
  id: DshmlCustomKind;
  label: string;
}

/** The image upload / crop panel. */
function DshmlCustomImagePanel(props: {
  source: string | null;
  crop: Point;
  zoom: number;
  busy: boolean;
  onPick: () => void;
  onCropChange: (point: Point) => void;
  onZoomChange: (zoom: number) => void;
  onCropComplete: (area: Area) => void;
  onDropped: (file: File | null) => void;
}): ReactElement {
  const zoomLabel = dshmlEditorCopy('picker.zoom', 'Zoom');
  if (props.source === null) {
    return h(
      'div',
      { className: 'dshml-custom-upload' },
      h(
        'button',
        {
          type: 'button',
          className: 'dshml-custom-drop',
          disabled: props.busy,
          onClick: props.onPick,
          onDragOver: dshmlPreventDragOver,
          onDrop: function onDrop(event: DragEvent<HTMLButtonElement>) {
            event.preventDefault();
            const files = event.dataTransfer !== null ? event.dataTransfer.files : null;
            props.onDropped(files !== null && files.length > 0 ? (files[0] ?? null) : null);
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
              h('path', {
                key: 'frame',
                d: 'M4 5.5h16v13H4z M4 16l4.5-4.5L13 16l3-3 4 4',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
              h('circle', { key: 'dot', cx: 16.5, cy: 9, r: 1.4, fill: 'currentColor' }),
            ],
          ),
          h(
            'span',
            { key: 'label', className: 'dshml-custom-drop-label' },
            dshmlEditorCopy('picker.upload', 'Choose an image'),
          ),
          h(
            'span',
            { key: 'hint', className: 'dshml-custom-drop-hint' },
            dshmlEditorCopy('picker.uploadHint', 'PNG / JPEG / WebP, up to 12 MB'),
          ),
        ],
      ),
    );
  }
  return h('div', { className: 'dshml-custom-image' }, [
    h('div', { key: 'cropper', className: 'dshml-custom-cropper' }, [
      h(Cropper, {
        key: 'cropper-inner',
        image: props.source,
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
        onCropChange: props.onCropChange,
        onZoomChange: props.onZoomChange,
        onCropComplete: function onCropComplete(_percentages: Area, pixels: Area) {
          props.onCropComplete(pixels);
        },
      }),
    ]),
    h('label', { key: 'zoom', className: 'dshml-custom-zoom' }, [
      h('span', { key: 'label', className: 'dshml-custom-zoom-label' }, zoomLabel),
      h('input', {
        key: 'range',
        type: 'range',
        className: 'dshml-custom-zoom-range',
        min: 1,
        max: 3,
        step: 0.01,
        value: props.zoom,
        'aria-label': zoomLabel,
        onChange: function onZoom(event: ChangeEvent<HTMLInputElement>) {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.onZoomChange(next);
        },
      }),
    ]),
    h(
      'div',
      { key: 'actions', className: 'dshml-custom-image-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'dshml-custom-link',
          disabled: props.busy,
          onClick: props.onPick,
        },
        dshmlEditorCopy('picker.uploadChange', 'Change image'),
      ),
    ),
  ]);
}

/**
 * The custom-icon editor body.
 * @param props - mode, target icon, picker application target and callbacks.
 */
export function DshmlCustomIconEditor(props: DshmlCustomIconEditorProps): ReactElement {
  const state = dshmlUseIconState();
  const icons = dshmlCustomIconsOf(state.customIcons);
  const mode = props.mode;
  const renameTarget = mode === 'rename' && props.icon !== null ? (icons[props.icon.id] ?? props.icon) : null;
  const [name, setName] = React.useState(renameTarget !== null ? renameTarget.name : '');
  const [kind, setKind] = React.useState<DshmlCustomKind>('image');
  const [source, setSource] = React.useState<string | null>(null);
  const [motionReady, setMotionReady] = React.useState<DshmlMotionReadyState>({
    payload: null,
    busy: false,
    overBudget: false,
  });
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedArea, setCroppedArea] = React.useState<Area | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const unavailable = state.status === 'unavailable';
  const saving = busy || unavailable;
  const motionTarget = renameTarget !== null && renameTarget.motion !== undefined;
  const motionPayload = motionReady.payload;

  const tabs: DshmlCustomKindTab[] = [
    { id: 'image', label: dshmlEditorCopy('picker.kindImage', 'Image') },
    { id: 'motion', label: dshmlEditorCopy('picker.kindMotion', 'Motion') },
  ];

  function explain(problem: DshmlCustomNameProblem): void {
    setError(dshmlNameProblemText(problem));
  }

  function validateName(): string | null {
    const result = dshmlValidateCustomName(name, icons, renameTarget !== null ? renameTarget.id : null);
    if (!result.ok) {
      explain(result.problem);
      return null;
    }
    return result.name;
  }

  function pickFile(): void {
    const input = fileRef.current;
    if (input === null) return;
    try {
      input.click();
    } catch {
      setError(dshmlEditorCopy('picker.imageRead', 'Could not read that image'));
    }
  }

  function acceptFile(file: File | null): void {
    if (file === null) return;
    setError('');
    if (!dshmlIsAcceptedImageType(file.type)) {
      setError(dshmlEditorCopy('picker.imageType', 'Unsupported image type — choose PNG / JPEG / WebP'));
      return;
    }
    if (file.size > DSHML_CUSTOM_MAX_SOURCE_BYTES) {
      setError(dshmlEditorCopy('picker.imageSize', 'The image is too large (12 MB max)'));
      return;
    }
    dshmlReadFile(file).then(
      function loaded(dataUrl) {
        setSource(dataUrl);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedArea(null);
      },
      function failed() {
        setError(dshmlEditorCopy('picker.imageRead', 'Could not read that image'));
      },
    );
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files;
    acceptFile(files !== null && files.length > 0 ? (files[0] ?? null) : null);
    // Allow picking the same file again after a failed crop.
    try {
      event.target.value = '';
    } catch {
      /* some engines make file inputs read-only */
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    const validName = validateName();
    if (validName === null) return;
    if (mode === 'create') {
      if (kind === 'motion') {
        if (motionPayload === null) {
          setError(
            motionReady.overBudget
              ? dshmlEditorCopy(
                  'picker.motionOverBudget',
                  'Over the size budget — shrink automatically or reduce the frames',
                )
              : dshmlEditorCopy('picker.motionNeedSource', 'Choose an animated image or video first'),
          );
          return;
        }
        setError('');
        setBusy(true);
        try {
          const id = await dshmlCreateCustomIcon(validName, motionPayload.poster, props.apply, motionPayload.motion);
          setBusy(false);
          if (id === null) {
            setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
            return;
          }
          props.onDone('created');
        } catch {
          setBusy(false);
          setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
        }
        return;
      }
      if (source === null || croppedArea === null) {
        setError(dshmlEditorCopy('picker.imageEmpty', 'Choose an image first'));
        return;
      }
      setError('');
      setBusy(true);
      try {
        const image = await dshmlEncodeCroppedIcon(source, croppedArea);
        const id = await dshmlCreateCustomIcon(validName, image, props.apply);
        setBusy(false);
        if (id === null) {
          setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
          return;
        }
        props.onDone('created');
      } catch (reason) {
        setBusy(false);
        setError(
          reason instanceof Error && reason.message === DSHML_ENCODE_TOO_BIG
            ? dshmlEditorCopy('picker.imageTooBig', 'The cropped icon is still too large — try a simpler image')
            : dshmlEditorCopy('picker.imageEncode', 'Could not produce the icon — try another image'),
        );
      }
      return;
    }
    if (renameTarget === null) return;
    setError('');
    setBusy(true);
    try {
      const ok = await dshmlRenameCustomIcon(renameTarget.id, validName);
      setBusy(false);
      if (ok !== true) {
        setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
        return;
      }
      props.onDone('renamed');
    } catch {
      setBusy(false);
      setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
    }
  }

  async function remove(): Promise<void> {
    if (saving || renameTarget === null) return;
    setError('');
    setBusy(true);
    try {
      const ok = await dshmlDeleteCustomIcon(renameTarget.id);
      setBusy(false);
      if (ok !== true) {
        setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
        return;
      }
      props.onDone('deleted');
    } catch {
      setBusy(false);
      setError(dshmlEditorCopy('picker.saveFailed', 'Could not save — try again'));
    }
  }

  const nameField = h('label', { key: 'name', className: 'dshml-custom-field' }, [
    h('span', { key: 'label', className: 'dshml-custom-label' }, dshmlEditorCopy('picker.name', 'Icon name')),
    h('input', {
      key: 'input',
      type: 'text',
      className: 'dshml-custom-input',
      value: name,
      maxLength: DSHML_CUSTOM_MAX_NAME,
      placeholder: dshmlEditorCopy('picker.namePlaceholder', 'For example: My local model'),
      'aria-label': dshmlEditorCopy('picker.name', 'Icon name'),
      autoFocus: true,
      spellCheck: false,
      disabled: saving,
      onChange: function onName(event: ChangeEvent<HTMLInputElement>) {
        setName(event.target.value);
        if (error !== '') setError('');
      },
    }),
    mode === 'create'
      ? h(
          'span',
          { key: 'hint', className: 'dshml-custom-hint' },
          dshmlEditorCopy('picker.createHint', 'Upload an image and crop it to a square icon'),
        )
      : null,
  ]);

  const tabRow =
    mode === 'create'
      ? h(
          'div',
          {
            key: 'tabs',
            className: 'dshml-custom-tabs',
            role: 'tablist',
            'aria-label': dshmlEditorCopy('picker.kind', 'Icon type'),
          },
          tabs.map(function toTab(tab) {
            const active = tab.id === kind;
            return h(
              'button',
              {
                key: tab.id,
                type: 'button',
                role: 'tab',
                className: 'dshml-custom-tab' + (active ? ' dshml-custom-tab-active' : ''),
                'aria-selected': active ? 'true' : 'false',
                tabIndex: 0,
                disabled: saving,
                onClick: function onTab() {
                  setKind(tab.id);
                  setError('');
                },
              },
              h('span', { key: 'label', className: 'dshml-custom-tab-label' }, tab.label),
            );
          }),
        )
      : null;

  const imagePanel =
    mode === 'create' && kind === 'image'
      ? h(DshmlCustomImagePanel, {
          key: 'image',
          source,
          crop,
          zoom,
          busy,
          onPick: pickFile,
          onCropChange: setCrop,
          onZoomChange: setZoom,
          onCropComplete: setCroppedArea,
          onDropped: acceptFile,
        })
      : null;
  const motionPanel =
    mode === 'create' && kind === 'motion'
      ? h(DshmlMotionStudio, {
          key: 'motion',
          disabled: saving,
          onReady: setMotionReady,
          onUseStatic: function onUseStatic(dataUrl) {
            setKind('image');
            setSource(dataUrl);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
            setCroppedArea(null);
            setError('');
          },
        })
      : null;
  const motionRenameHint =
    mode === 'rename' && motionTarget
      ? h(
          'p',
          { key: 'motion-hint', className: 'dshml-custom-hint' },
          dshmlEditorCopy(
            'picker.motionRenameHint',
            'A motion icon cannot be re-sampled — create a new one to change it',
          ),
        )
      : null;

  const deleteSection =
    mode === 'rename' && renameTarget !== null
      ? h('div', { key: 'delete', className: 'dshml-custom-danger' }, [
          h(
            'p',
            { key: 'title', className: 'dshml-custom-danger-title' },
            dshmlEditorCopy('picker.deleteConfirmTitle', 'Delete custom icon'),
          ),
          confirmDelete
            ? h('div', { key: 'confirm', className: 'dshml-custom-danger-actions' }, [
                h(
                  'p',
                  { key: 'text', className: 'dshml-custom-danger-text' },
                  dshmlEditorCopy('picker.deleteConfirm', 'Delete "{name}"? Models using it fall back to auto.', {
                    name: renameTarget.name,
                  }),
                ),
                h(
                  'button',
                  {
                    key: 'remove',
                    type: 'button',
                    className: 'dshml-custom-btn dshml-custom-btn-danger',
                    disabled: saving,
                    onClick: remove,
                  },
                  dshmlEditorCopy('picker.delete', 'Delete'),
                ),
                h(
                  'button',
                  {
                    key: 'keep',
                    type: 'button',
                    className: 'dshml-custom-btn',
                    disabled: saving,
                    onClick: function cancelDelete() {
                      setConfirmDelete(false);
                    },
                  },
                  dshmlEditorCopy('picker.cancel', 'Cancel'),
                ),
              ])
            : h(
                'button',
                {
                  key: 'ask',
                  type: 'button',
                  className: 'dshml-custom-btn dshml-custom-btn-ghost dshml-custom-btn-danger-ghost',
                  disabled: saving,
                  onClick: function askDelete() {
                    setConfirmDelete(true);
                  },
                },
                dshmlEditorCopy('picker.delete', 'Delete'),
              ),
        ])
      : null;

  return h('div', { className: 'dshml-custom-editor' }, [
    tabRow,
    nameField,
    motionRenameHint,
    imagePanel,
    motionPanel,
    error !== ''
      ? h('p', { key: 'error', className: 'dshml-picker-error', role: 'alert' }, error)
      : unavailable
        ? h(
            'p',
            { key: 'unavailable', className: 'dshml-picker-notice', role: 'status' },
            dshmlEditorCopy('picker.unavailable', 'Icon settings unavailable (host plugin not loaded)'),
          )
        : null,
    deleteSection,
    h('div', { key: 'actions', className: 'dshml-custom-actions' }, [
      h(
        'button',
        {
          key: 'cancel',
          type: 'button',
          className: 'dshml-custom-btn',
          disabled: saving,
          onClick: props.onCancel,
        },
        dshmlEditorCopy('picker.cancel', 'Cancel'),
      ),
      h(
        'button',
        {
          key: 'save',
          type: 'button',
          className: 'dshml-custom-btn dshml-custom-btn-primary',
          disabled:
            saving || (mode === 'create' && kind === 'motion' && (motionReady.busy || motionReady.payload === null)),
          onClick: save,
        },
        dshmlEditorCopy('picker.save', 'Save'),
      ),
    ]),
    mode === 'create' && kind === 'image'
      ? h('input', {
          key: 'file',
          type: 'file',
          ref: fileRef,
          accept: 'image/png,image/jpeg,image/webp',
          className: 'dshml-custom-file',
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onFileChange,
        })
      : null,
  ]);
}
