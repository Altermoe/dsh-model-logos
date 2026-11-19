/**
 * Media-source maths that does not need a browser.
 *
 * The video frame-rate probe (D3) reduces a short sequence of presentation times
 * to a frame rate; that decision is pure and is what the studio's initial frame
 * count keys on, so it is pinned here instead of behind the DOM gate.
 */
import { describe, expect, it } from 'vitest';

import { dshmlFrameRateFromTimes } from '../src/media-source';

describe('source frame-rate estimate', () => {
  it('reads the rate from evenly spaced presentation times', () => {
    expect(dshmlFrameRateFromTimes([0, 0.2, 0.4, 0.6, 0.8])).toBe(5);
    expect(dshmlFrameRateFromTimes([0, 1 / 30, 2 / 30, 3 / 30, 4 / 30])).toBe(30);
    expect(dshmlFrameRateFromTimes([0, 1 / 12, 2 / 12, 3 / 12])).toBe(12);
  });

  it('uses the median delta so a dropped frame or a long tail does not skew it', () => {
    expect(dshmlFrameRateFromTimes([0, 0.1, 0.2, 0.3, 1.0, 1.7])).toBe(10);
    expect(dshmlFrameRateFromTimes([0, 0.25, 0.5, 1.5])).toBe(4);
  });

  it('answers null when there is nothing to measure', () => {
    expect(dshmlFrameRateFromTimes([])).toBeNull();
    expect(dshmlFrameRateFromTimes([0.4])).toBeNull();
    expect(dshmlFrameRateFromTimes([0.4, 0.4, 0.4])).toBeNull();
    expect(dshmlFrameRateFromTimes([0, 2, 4])).toBeNull();
  });

  it('clamps the measurement to a sane range', () => {
    expect(dshmlFrameRateFromTimes([0, 0.001, 0.002, 0.003])).toBe(60);
    expect(dshmlFrameRateFromTimes([0, 0.4, 0.8, 1.2])).toBe(2.5);
  });
});
