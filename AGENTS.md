# AGENTS.md — workflow contract for AI contributors

This repository is a DeepSeek Harness (DSH) Web GUI plugin. Human and AI
contributors follow the same contract: the toolchain lives in
[`docs/engineering.md`](docs/engineering.md), the product contract in
[`docs/architecture.md`](docs/architecture.md), and the build/verification
commands in [`README.md`](README.md).

## Project essentials

- **pnpm only.** The version is pinned by `packageManager` in `package.json`
  (`pnpm@12.16.1`) and is downloaded automatically on first use. Run
  `pnpm install`; never use `npm`, `npx` or `yarn` in this repository.
- **Node.js ≥ 26.13.0** is required by `engines`. The 26.x releases before
  26.12.1 contain the Brotli decoder vulnerability CVE-2026-111497; never lower
  the engine floor into that range.
- `client.js` and `index.js` are **generated, git-ignored build output**. Never
  edit them by hand: change `src/**`, then run `pnpm run build`. A fresh
  `pnpm install` rebuilds them through the `prepare` script.

## Run every gate after every change (mandatory)

A change is not finished until all applicable gates pass. Run them
automatically after each modification, before reporting back, from the
repository root:

| Gate                 | Command                | Required for                                                                                                                  |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Full gate (CI gate)  | `pnpm run verify`      | **every change** — typecheck, lint, fmt:check, unit+bundle tests, build, artifact freshness                                   |
| DOM gate             | `pnpm run verify:dom`  | every change touching `src/**`, `test/**`, `scripts/**` or the bundle — loads the real artifact in headless Edge (needs Edge) |
| Live gate            | `pnpm run verify:live` | `client.js` changed while a DSH Web GUI is running — proves that GUI serves this exact build                                  |
| Artwork/preview gate | `pnpm run preview`     | artwork or CSS changes — refreshes the design sheets in `.preview/` and the `docs/preview*.png` previews                      |

Rules:

- Never report a task as complete while a gate fails. Either fix the failure or
  report the exact failing command and its output.
- Never bypass a gate: no `--no-verify`, no `--frozen-lockfile=false` in CI, no
  skipping or weakening tests, no widening `engines`, no `--no-fix` escape from
  the formatter.
- `pnpm run check` reporting stale artifacts means run `pnpm run build` and then
  re-run the gates.
- Fix formatting/lint first (`pnpm run fmt`, `pnpm run lint:fix`), then run the
  full gate on the final tree.
- `verify` is not a substitute for `verify:dom`: the unit suite evaluates the
  bundle in a DOM/React stand-in, while `verify:dom` drives the real artifact
  against the faithful Settings fixture.

## Commit discipline ("整理提交")

Organize the work into small, self-contained commits as it develops; never leave
a mixed, unexplained working tree behind.

- **One logical change per commit** (migration, feature, fix, docs, CI), and keep
  `pnpm-lock.yaml` in the same commit as the `package.json` dependency change.
- Follow **Conventional Commits**, matching the existing history: `build:`,
  `fix:`, `feat:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. Imperative
  mood, subject ≤ 72 characters, no trailing period.
- Body: explain _why_ and the user-visible effect, then the notable files or
  areas. Finish with a **`Verified:` paragraph** naming the exact gates that ran
  and their results — the existing history does this, keep the convention.
- Stage only source, configuration, lockfile and documentation changes. Never
  stage `node_modules/`, `.preview/`, `coverage/`, `junit.xml`, `client.js` or
  `index.js` (they are git-ignored; if one appears in `git status`, do not force
  it in).
- Run the gates on the exact tree you commit. If the pre-commit hook
  (simple-git-hooks + lint-staged) rewrites a staged file, amend the commit so
  the committed tree is the green one, then re-run the affected gates.
- Do not force-push, do not rewrite published history, and do not commit secrets
  or machine-specific paths (`$env:EDGE`, store directories).

## Reporting

When finishing a task, report concisely:

1. what changed and why;
2. the exact gate commands run and their results (test counts, pass/fail);
3. anything still failing, deferred, or requiring a human decision;
4. the commits made (subjects and hashes).
