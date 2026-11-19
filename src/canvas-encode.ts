/**
 * Asynchronous canvas encoding.
 *
 * The drag-performance investigation pinned the second long task after a
 * timeline drag on `canvas.toDataURL('image/webp')`: the atlas strip (up to
 * 3072 × 128), its poster and, in the original view, one full work-canvas still
 * were all encoded synchronously on the main thread. This module moves that
 * work off the paint path, with three levels that share one result shape:
 *
 *  1. a dedicated Worker, created from an inline Blob (DSH already ships workers
 *     this way — the plugin bundle must stay a single script, so the source is
 *     stringified into the page, not fetched as a second asset). The canvas is
 *     handed over as an `ImageBitmap` and the worker returns a WebP data URL,
 *     falling back to PNG when the engine cannot encode WebP;
 *  2. `canvas.toBlob` + `FileReader` on the main thread — still asynchronous, so
 *     the browser encodes and base64-encodes off the render step;
 *  3. the synchronous `toDataURL` the pipeline used to call directly, kept as the
 *     last-resort fallback for a bare test double or an engine without `toBlob`.
 *
 * The canvases passed here are never painted again by the sampler (the atlas,
 * its poster and the still work canvas are written once and then only read), so
 * an encode may read them asynchronously without a lock. The worker is created
 * lazily on first use: importing this module never touches a browser global, and
 * `test/sprite.test.ts` (node, no Worker / OffscreenCanvas) keeps exercising the
 * synchronous fallback.
 */

/** One encoded image: the data URL the settings document stores plus its length. */
export interface DshmlEncodedCanvas {
  data: string;
  chars: number;
}

/** One encode request sent to the inline worker. */
interface DshmlEncodeWorkerRequest {
  id: number;
  bitmap: ImageBitmap;
  quality: number;
}

/** One worker reply: a data URL, or an error the caller answers with a fallback. */
interface DshmlEncodeWorkerReply {
  id: number;
  data?: string;
  error?: string;
}

/** How long one worker encode may take before the manager gives up on it. */
const DSHML_ENCODE_WORKER_TIMEOUT_MS = 10_000;

/**
 * A dedicated-worker scope, typed structurally: this project compiles against the
 * DOM lib (no `WebWorker` lib), so `self` is `Window` and the real worker shape is
 * described by hand, mirroring the `ImageDecoder` probe in `media-source.ts`.
 */
export interface DshmlEncodeWorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: DshmlEncodeWorkerReply): void;
}

/** Live worker handle; `undefined` means "not tried yet", `null` "unavailable". */
let encodeWorker: Worker | null | undefined;
/** Blob URL the worker was created from, revoked when the worker retires. */
let encodeWorkerUrl = '';
/** Id source for worker requests (the worker echoes it back). */
let encodeRequestId = 1;
/** Pending encodes by request id; resolved `null` when the worker fails. */
const encodeRequests = new Map<number, (data: string | null) => void>();

/** Whether this engine can run the inline encoder worker at all. */
function dshmlEncodeWorkerSupported(): boolean {
  try {
    return (
      typeof Worker === 'function' &&
      typeof Blob === 'function' &&
      typeof URL.createObjectURL === 'function' &&
      typeof createImageBitmap === 'function'
    );
  } catch {
    return false;
  }
}

/** Settle every pending request with a fallback and drop the worker. */
function dshmlRetireEncodeWorker(): void {
  const worker = encodeWorker;
  encodeWorker = null;
  if (worker !== null && worker !== undefined) {
    try {
      worker.terminate();
    } catch {
      /* already gone */
    }
  }
  if (encodeWorkerUrl !== '') {
    try {
      URL.revokeObjectURL(encodeWorkerUrl);
    } catch {
      /* already revoked */
    }
    encodeWorkerUrl = '';
  }
  for (const settle of encodeRequests.values()) settle(null);
  encodeRequests.clear();
}

/** Route one worker reply to the request waiting for it. */
function dshmlOnEncodeWorkerMessage(event: MessageEvent): void {
  const message = event.data as Partial<DshmlEncodeWorkerReply> | null | undefined;
  if (message === null || message === undefined || typeof message.id !== 'number') return;
  const settle = encodeRequests.get(message.id);
  if (settle === undefined) return;
  encodeRequests.delete(message.id);
  settle(typeof message.data === 'string' && message.data.startsWith('data:image/') ? message.data : null);
}

/** Create the inline worker on first use, or null when the page cannot host one. */
function dshmlStartEncodeWorker(): Worker | null {
  if (!dshmlEncodeWorkerSupported()) return null;
  try {
    // `Function.prototype.toString()` keeps the worker body a normal, typechecked
    // function while still shipping it inside the single client bundle. The body
    // must stay self-contained: no imports and no module-scope references.
    const source = '(' + dshmlEncodeWorkerBody.toString() + ')(self);';
    encodeWorkerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(encodeWorkerUrl);
    worker.addEventListener('message', dshmlOnEncodeWorkerMessage);
    worker.addEventListener('error', dshmlRetireEncodeWorker);
    worker.addEventListener('messageerror', dshmlRetireEncodeWorker);
    return worker;
  } catch {
    if (encodeWorkerUrl !== '') {
      try {
        URL.revokeObjectURL(encodeWorkerUrl);
      } catch {
        /* never created */
      }
      encodeWorkerUrl = '';
    }
    return null;
  }
}

/** Encode one canvas in the worker; resolves null when the worker is unusable. */
async function dshmlEncodeCanvasInWorker(canvas: HTMLCanvasElement, quality: number): Promise<string | null> {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  if (encodeWorker === undefined) encodeWorker = dshmlStartEncodeWorker();
  const worker = encodeWorker;
  if (worker === null || worker === undefined) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(canvas);
  } catch {
    return null;
  }
  const id = encodeRequestId;
  encodeRequestId += 1;
  return new Promise<string | null>(function executor(resolve) {
    const timer = setTimeout(function onTimeout() {
      encodeRequests.delete(id);
      resolve(null);
    }, DSHML_ENCODE_WORKER_TIMEOUT_MS);
    encodeRequests.set(id, function settle(data) {
      clearTimeout(timer);
      resolve(data);
    });
    try {
      worker.postMessage({ id, bitmap, quality } satisfies DshmlEncodeWorkerRequest, [bitmap]);
    } catch {
      encodeRequests.delete(id);
      clearTimeout(timer);
      try {
        bitmap.close();
      } catch {
        /* a transferred/closed bitmap cannot be closed twice */
      }
      resolve(null);
    }
  });
}

/** `toBlob` as a promise; null when the engine has no `toBlob` (test doubles). */
function dshmlCanvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise<Blob | null>(function executor(resolve) {
    try {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      canvas.toBlob(
        function onBlob(blob) {
          resolve(blob);
        },
        type,
        quality,
      );
    } catch {
      resolve(null);
    }
  });
}

/** `FileReader.readAsDataURL` as a promise; null when it fails. */
function dshmlBlobDataUrl(blob: Blob): Promise<string | null> {
  return new Promise<string | null>(function executor(resolve) {
    try {
      if (typeof FileReader !== 'function') {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.addEventListener(
        'load',
        function onLoad() {
          const result = reader.result;
          resolve(typeof result === 'string' && result.startsWith('data:image/') ? result : null);
        },
        { once: true },
      );
      reader.addEventListener(
        'error',
        function onError() {
          resolve(null);
        },
        { once: true },
      );
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/** The synchronous `toDataURL` encode, WebP first then PNG (the historical path). */
function dshmlDataUrlSync(canvas: HTMLCanvasElement, quality: number): string {
  let data = canvas.toDataURL('image/webp', quality);
  if (!data.startsWith('data:image/webp;base64,')) data = canvas.toDataURL('image/png');
  return data;
}

/**
 * Encode one canvas to a data URL without blocking the render step.
 *
 * Tries the worker, then `toBlob` + `FileReader`, and only falls back to the
 * synchronous `toDataURL` when neither is available. The data URL semantics (WebP
 * with the requested quality, PNG when WebP is refused) match the synchronous
 * path the settings document was built on.
 * @param canvas - painted canvas; must not be repainted while the encode runs.
 * @param quality - WebP quality, 0…1.
 */
export async function dshmlEncodeCanvasDataUrl(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<DshmlEncodedCanvas> {
  const fromWorker = await dshmlEncodeCanvasInWorker(canvas, quality);
  if (fromWorker !== null) return { data: fromWorker, chars: fromWorker.length };
  const webp = await dshmlCanvasBlob(canvas, 'image/webp', quality);
  if (webp !== null && webp.type === 'image/webp') {
    const data = await dshmlBlobDataUrl(webp);
    if (data !== null) return { data, chars: data.length };
  }
  const png = await dshmlCanvasBlob(canvas, 'image/png');
  if (png !== null) {
    const data = await dshmlBlobDataUrl(png);
    if (data !== null) return { data, chars: data.length };
  }
  const data = dshmlDataUrlSync(canvas, quality);
  return { data, chars: data.length };
}

/**
 * Encode one canvas to an in-memory object URL (the cropper's still).
 *
 * Object URLs skip the base64 round trip entirely: the cropper simply loads the
 * blob, and the URL is revoked by the caller when it is replaced or unmounted.
 * Resolves null when the engine has no `toBlob` / `createObjectURL`, in which
 * case the caller keeps using the data URL it already has.
 * @param canvas - painted work canvas; must not be repainted while encoding.
 * @param quality - WebP quality, 0…1.
 */
export async function dshmlCanvasObjectUrl(canvas: HTMLCanvasElement, quality: number): Promise<string | null> {
  const webp = await dshmlCanvasBlob(canvas, 'image/webp', quality);
  const blob = webp !== null && webp.type === 'image/webp' ? webp : await dshmlCanvasBlob(canvas, 'image/png');
  if (blob === null) return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * The inline encoder worker body.
 *
 * Stringified into a Blob by {@link dshmlStartEncodeWorker}, so it must stay
 * self-contained: browser worker globals only, no imports, no module-scope
 * constants, no DOM access. It receives one `ImageBitmap` per message and answers
 * with a WebP data URL (PNG when the engine refuses WebP) in the same shape the
 * main-thread fallback produces, so callers never branch on where it ran.
 * Exported for the protocol test, which drives it with a fake scope.
 */
export function dshmlEncodeWorkerBody(scope: DshmlEncodeWorkerScope): void {
  const PREFIX = 'data:';

  // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside
  // the stringified worker body: it may not reference module scope.
  function binaryFromBytes(bytes: Uint8Array): string {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0);
    return binary;
  }

  async function dataUrlOf(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return PREFIX + blob.type + ';base64,' + btoa(binaryFromBytes(bytes));
  }

  async function encode(bitmap: ImageBitmap, quality: number): Promise<string | null> {
    try {
      const canvas = new OffscreenCanvas(Math.max(1, bitmap.width), Math.max(1, bitmap.height));
      const context = canvas.getContext('2d');
      if (context === null) return null;
      context.drawImage(bitmap, 0, 0);
      const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
      const blob = webp.type === 'image/webp' ? webp : await canvas.convertToBlob({ type: 'image/png' });
      return await dataUrlOf(blob);
    } finally {
      try {
        bitmap.close();
      } catch {
        /* the bitmap may already be detached */
      }
    }
  }

  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- worker realm contract
  scope.onmessage = function onMessage(event: MessageEvent): void {
    const request = event.data as Partial<DshmlEncodeWorkerRequest> | null | undefined;
    if (
      request === null ||
      request === undefined ||
      typeof request.id !== 'number' ||
      request.bitmap === undefined ||
      request.bitmap === null ||
      typeof request.quality !== 'number'
    ) {
      return;
    }
    const id = request.id;
    const bitmap = request.bitmap;
    void (async function run() {
      try {
        const data = await encode(bitmap, request.quality ?? 0.92);
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker scope
        scope.postMessage(data === null ? { id, error: 'encode-failed' } : { id, data });
      } catch (error) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker scope
        scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  };
}
