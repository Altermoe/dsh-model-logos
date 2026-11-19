import { describe, expect, it } from 'vitest';

import { assertReleaseBranch, RELEASE_BRANCH } from '../scripts/publish-guard';

describe('publish guard', () => {
  it('accepts the release branch', () => {
    expect(RELEASE_BRANCH).toBe('main');
    expect(() => assertReleaseBranch('main')).not.toThrow();
  });

  it('refuses another branch and names it', () => {
    expect(() => assertReleaseBranch('feat/motion-studio')).toThrow(/releases are cut from 'main'/);
    expect(() => assertReleaseBranch('feat/motion-studio')).toThrow(/feat\/motion-studio/);
  });

  it('refuses a detached HEAD', () => {
    expect(() => assertReleaseBranch('HEAD')).toThrow(/detached HEAD/);
  });
});
