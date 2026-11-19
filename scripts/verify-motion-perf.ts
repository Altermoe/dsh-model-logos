/**
 * Manual motion-studio drag probe.
 *
 * `pnpm run verify:dom` asserts the *structural* contract (no sampling inside a
 * drag window, one round after release, asynchronous encodes). This script
 * measures the same gesture and prints the numbers that contract exists to keep
 * down — long tasks and animation-frame gaps — so a change can be compared on a
 * real machine (the plan's 1024×1024 / 24-frame clip, Windows/Edge) without
 * writing absolute milliseconds into a gate that CI would flake on.
 *
 * It reuses the headless-Edge fixture and screenshot driver from
 * `scripts/verify-dom.ts` and asks it for a `--perf-json` report; the browser
 * plumbing and the in-page probe live there, this file is the documented entry
 * point plus the report. Manual only: never part of `pnpm run verify`.
 *
 *   pnpm run verify:motion-perf
 *   pnpm run verify:motion-perf --motion-gif /tmp/clip-1024.gif
 *   pnpm run verify:motion-perf --json .preview/motion-perf.json --screenshot /tmp/shot.png
 *
 * The probe needs Edge (`EDGE` may point at a Chromium binary) and uses the same
 * build the DOM gate uses, so run `pnpm run build` first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | null => {
  const at = args.indexOf(flag);
  if (at < 0) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
};

const gifPath = valueAfter('--motion-gif');
const jsonPath = valueAfter('--json') ?? '.preview/motion-perf.json';
const keepScreenshot = valueAfter('--screenshot');
const scale = valueAfter('--scale') ?? '1';

const tsxCli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(tsxCli)) {
  console.error('error: tsx is not installed; run `pnpm install` first');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'dshml-motion-perf-'));
const screenshotPath = keepScreenshot ?? join(workDir, 'motion-perf.png');
const gateArgs = [
  'scripts/verify-dom.ts',
  '--screenshot',
  screenshotPath,
  '--open',
  'motion',
  '--perf-json',
  jsonPath,
  '--scale',
  scale,
];
if (gifPath !== null) gateArgs.push('--motion-gif', gifPath);

console.log('motion perf: replaying one timeline drag through the DOM harness…');
const run = spawnSync(process.execPath, [tsxCli, ...gateArgs], { cwd: ROOT, stdio: 'inherit', env: process.env });
if (run.status !== 0) {
  rmSync(workDir, { recursive: true, force: true });
  console.error('error: the DOM harness failed; no measurements collected');
  process.exit(run.status ?? 1);
}

const target = resolve(ROOT, jsonPath);
if (!existsSync(target)) {
  rmSync(workDir, { recursive: true, force: true });
  console.error('error: the harness produced no perf report at ' + target);
  process.exit(1);
}
const report = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;

interface EncodeSummary {
  total: number;
  atlas: number;
  poster: number;
  worker: number;
  synchronous: number;
}
interface LongTaskSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}
interface WindowSummary {
  windowMs: number;
  encodes: EncodeSummary;
  longTasks: LongTaskSummary;
  maxFrameGapMs: number;
  pausedDuringDrag?: boolean;
  transportResumed?: boolean;
}
const block = (name: string): WindowSummary | null => {
  const value = report[name];
  if (value === null || typeof value !== 'object') return null;
  return value as unknown as WindowSummary;
};
const drag = block('drag');
const release = block('release');
if (drag === null || release === null) {
  rmSync(workDir, { recursive: true, force: true });
  console.error('error: malformed perf report: ' + JSON.stringify(report).slice(0, 400));
  process.exit(1);
}

console.log('');
console.log(
  'motion perf report (' +
    String(report['gif']) +
    ', ' +
    (keepScreenshot === null ? 'temp screenshot' : screenshotPath) +
    ')',
);
console.log('  viewport            ' + JSON.stringify(report['viewport']));
console.log(
  '  drag window         ' +
    drag.windowMs +
    'ms  encodes=' +
    JSON.stringify(drag.encodes) +
    '  longTasks(>=50ms)=' +
    drag.longTasks.count +
    ' (' +
    drag.longTasks.totalMs +
    'ms total, ' +
    drag.longTasks.maxMs +
    'ms max)  maxFrameGap=' +
    drag.maxFrameGapMs +
    'ms',
);
console.log(
  '  after release       ' +
    release.windowMs +
    'ms  encodes=' +
    JSON.stringify(release.encodes) +
    '  longTasks(>=50ms)=' +
    release.longTasks.count +
    ' (' +
    release.longTasks.totalMs +
    'ms total, ' +
    release.longTasks.maxMs +
    'ms max)  maxFrameGap=' +
    release.maxFrameGapMs +
    'ms',
);

/** Compare one window with the structural contract; timing stays informational. */
const checks: Array<[string, boolean, string]> = [
  [
    'no encode inside the drag window',
    drag.encodes.total === 0,
    'encodes=' + drag.encodes.total + ' (only timing is allowed, never encoding)',
  ],
  [
    'exactly one async sampling round after release',
    release.encodes.atlas === 1 && release.encodes.poster >= 1 && release.encodes.synchronous === 0,
    JSON.stringify(release.encodes),
  ],
  [
    'the worker encoded the round (fallback allowed on engines without it)',
    release.encodes.worker > 0 || release.encodes.synchronous === 0,
    'worker=' + release.encodes.worker + ' toBlob/Worker fallback kept the main thread out',
  ],
  ['drag paused the transport', drag.pausedDuringDrag === true, String(drag.pausedDuringDrag)],
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed += 1;
  console.log('  ' + (ok ? 'OK  ' : 'CHECK') + '  ' + name + '  [' + detail + ']');
}
console.log('  note  absolute milliseconds are machine specific; compare runs on the same box only');
if (keepScreenshot === null) rmSync(workDir, { recursive: true, force: true });
console.log('  json  ' + target);
process.exit(failed > 0 ? 1 : 0);
