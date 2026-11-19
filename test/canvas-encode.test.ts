/**
 * Canvas encoding: the three levels of the async encoder.
 *
 * These tests do not need a browser: the node environment has no `Worker`,
 * `OffscreenCanvas`, `createImageBitmap` or `FileReader`, which is exactly the
 * "bare engine" case, so the fallback ladder is observable by counting which API
 * the encoder reaches. The worker body is a plain function on purpose; it is
 * driven here with a fake scope and a fake `OffscreenCanvas` to pin the message
 * protocol the main thread relies on.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dshmlCanvasObjectUrl, dshmlEncodeCanvasDataUrl, dshmlEncodeWorkerBody } from '../src/canvas-encode';
import type { DshmlEncodeWorkerScope } from '../src/canvas-encode';

/** One canvas stand-in with the minimum the encoder touches. */
interface FakeCanvas {
  width: number;
  height: number;
  toDataURL(type?: string, quality?: number): string;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

/** What the fake world remembers between assertions. */
interface Counters {
  toDataURL: number;
  toBlob: number;
  fileReader: number;
}

let counters: Counters = { toDataURL: 0, toBlob: 0, fileReader: 0 };
let restores: Array<() => void> = [];

/** Install one global for the duration of one test. */
function stubGlobal(name: string, value: unknown): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(scope, name);
  const previous = scope[name];
  scope[name] = value;
  restores.push(function restore() {
    if (had) scope[name] = previous;
    else delete scope[name];
  });
}

/** A canvas that renders a deterministic data URL, optionally with `toBlob`. */
function fakeCanvas(withToBlob: boolean): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 32,
    height: 32,
    toDataURL: function toDataURL(_type?: string, quality?: number): string {
      counters.toDataURL += 1;
      return 'data:image/webp;base64,' + 'A'.repeat(Math.max(16, Math.round((quality ?? 1) * 100)));
    },
  };
  if (withToBlob) {
    canvas.toBlob = function toBlob(callback: (blob: Blob | null) => void, type?: string): void {
      counters.toBlob += 1;
      callback(new Blob([new Uint8Array([1, 2, 3, 4])], { type: type ?? 'image/webp' }));
    };
  }
  return canvas;
}

/**
 * A `FileReader` stand-in: turns the blob's type into a data URL on the next
 * microtask, so the test proves the encoder awaits it instead of assuming a
 * synchronous value.
 */
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  readAsDataURL(blob: Blob): void {
    counters.fileReader += 1;
    void blob.arrayBuffer().then((buffer) => {
      this.result = 'data:' + blob.type + ';base64,' + btoa(String.fromCharCode(...new Uint8Array(buffer)));
      for (const listener of this.listeners.get('load') ?? []) listener();
    });
  }
}

/** Install the fake `FileReader` (node has none). */
function installFileReader(): void {
  stubGlobal('FileReader', FakeFileReader);
}

afterEach(() => {
  for (const restore of restores.slice().reverse()) restore();
  restores = [];
  counters = { toDataURL: 0, toBlob: 0, fileReader: 0 };
});

describe('asynchronous canvas encoding', () => {
  it('falls back to the synchronous toDataURL when no async API exists', async () => {
    const encoded = await dshmlEncodeCanvasDataUrl(fakeCanvas(false) as unknown as HTMLCanvasElement, 0.92);
    expect(encoded.data.startsWith('data:image/webp;base64,')).toBe(true);
    expect(encoded.chars).toBe(encoded.data.length);
    expect(counters.toDataURL).toBe(1);
  });

  it('prefers toBlob + FileReader over toDataURL', async () => {
    installFileReader();
    const encoded = await dshmlEncodeCanvasDataUrl(fakeCanvas(true) as unknown as HTMLCanvasElement, 0.8);
    expect(encoded.data.startsWith('data:image/webp;base64,')).toBe(true);
    expect(counters.toBlob).toBe(1);
    expect(counters.fileReader).toBe(1);
    expect(counters.toDataURL).toBe(0);
  });

  it('floors an object URL encode to null when toBlob is unavailable', async () => {
    installFileReader();
    const url = await dshmlCanvasObjectUrl(fakeCanvas(false) as unknown as HTMLCanvasElement, 0.84);
    expect(url).toBeNull();
  });

  it('hands the still to the cropper as a revocable object URL', async () => {
    const url = await dshmlCanvasObjectUrl(fakeCanvas(true) as unknown as HTMLCanvasElement, 0.84);
    expect(url).not.toBeNull();
    expect(String(url).startsWith('blob:')).toBe(true);
    expect(counters.toBlob).toBe(1);
    URL.revokeObjectURL(String(url));
  });
});

describe('inline encoder worker', () => {
  /** The replies the fake worker scope collected. */
  let replies: Array<{ id: number; data?: string; error?: string }> = [];

  /**
   * Run the worker body against a fake `OffscreenCanvas` that always reports the
   * given blob type, then send one request and wait for its reply.
   */
  async function driveWorker(blobType: string, request: unknown): Promise<{ data?: string; error?: string }> {
    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): { drawImage: () => void } {
        return { drawImage: function drawImage() {} };
      }
      convertToBlob(options: { type: string }): Promise<Blob> {
        return Promise.resolve(
          new Blob([new Uint8Array([9, 8, 7])], { type: options.type === 'image/webp' ? blobType : 'image/png' }),
        );
      }
    }
    stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    replies = [];
    const scope: DshmlEncodeWorkerScope = {
      onmessage: null,
      postMessage: function postMessage(message): void {
        replies.push(message as { id: number; data?: string; error?: string });
      },
    };
    dshmlEncodeWorkerBody(scope);
    const onMessage = scope.onmessage;
    expect(onMessage).not.toBeNull();
    if (onMessage !== null) onMessage(new MessageEvent('message', { data: request }));
    for (let attempt = 0; attempt < 50 && replies.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    return replies[0] ?? { error: 'no reply' };
  }

  /** A bitmap stand-in: the worker only needs the size and `close`. */
  function fakeBitmap(): { width: number; height: number; close: () => void } {
    return { width: 8, height: 8, close: function close() {} };
  }

  it('answers with a WebP data URL for one ImageBitmap', async () => {
    const reply = await driveWorker('image/webp', { id: 7, bitmap: fakeBitmap(), quality: 0.92 });
    expect(reply.error).toBeUndefined();
    expect(String(reply.data).startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('re-encodes as PNG when the engine refuses WebP', async () => {
    const reply = await driveWorker('image/png', { id: 8, bitmap: fakeBitmap(), quality: 0.92 });
    expect(String(reply.data).startsWith('data:image/png;base64,')).toBe(true);
  });

  it('ignores a malformed request', async () => {
    const reply = await driveWorker('image/webp', { id: 'nope' });
    expect(reply).toEqual({ error: 'no reply' });
  });
});
