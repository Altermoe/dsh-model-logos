/**
 * Refuse to publish from anything but `main`.
 *
 * `prepublishOnly` runs this before the verify gate, so a stray `pnpm publish`
 * on a feature branch fails instead of pushing that branch's tarball to the
 * registry. `scripts/release.sh` and `scripts/release-dry-run.sh` enforce the
 * same branch for the commit, push, tag and GitHub release steps; this guard
 * closes the npm entry point they share. The lock is deliberately not an
 * option: a release started on another branch must fail, not publish it.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RELEASE_BRANCH = 'main';

export function assertReleaseBranch(branch: string): void {
  if (branch === RELEASE_BRANCH) return;
  const checkout = branch === 'HEAD' ? 'a detached HEAD' : `branch '${branch}'`;
  throw new Error(
    `releases are cut from '${RELEASE_BRANCH}' only, but this checkout is ${checkout}; switch to '${RELEASE_BRANCH}' and re-run`,
  );
}

export function currentBranch(cwd: string = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('cannot read the current git branch; run this from the repository checkout');
  }
}

function main(): void {
  try {
    assertReleaseBranch(currentBranch());
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`release guard: publishing from '${RELEASE_BRANCH}'`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();
