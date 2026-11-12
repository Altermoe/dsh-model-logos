#!/usr/bin/env bash
# Rehearse a release without publishing anything.
#
# Runs the same preflight checks as scripts/release.sh, validates the npm and
# GitHub credentials you choose, proves that the release asset packs, and prints
# the exact plan. Nothing is committed, pushed, tagged, published or uploaded.
#
# Credentials are never hardcoded: validation uses the tool's own login (pnpm /
# gh), a token you export (NPM_TOKEN, GH_TOKEN or GITHUB_TOKEN), or one you type
# for this check only (it is not stored). No secret is printed.
#
# Usage: bash scripts/release-dry-run.sh [options]
#   --npm | --no-npm            validate / skip npm checks (default: both)
#   --github | --no-github      validate / skip GitHub checks (default: both)
#   --gates                     also run verify and verify:dom (and verify:live
#                               when a GUI is reachable); off by default
#   --live-url <url>            running DSH Web GUI for the live gate
#   --timeout <sec>             npm visibility timeout the real run would use
#   --branch <name>             expected branch (default main)
#   -h, --help
#
# Exit codes: 0 = ready, 2 = blockers found, 1 = usage/environment error.
#
# shellcheck shell=bash

source "$(dirname -- "${BASH_SOURCE[0]}")/release-lib.sh"

export GIT_TERMINAL_PROMPT=0

EXPECTED_BRANCH=main
GITHUB_MODE=""
REPO_SLUG=""
DO_NPM=1
DO_GITHUB=1
RUN_GATES=0
RUN_LIVE=0
LIVE_URL=""
NPM_VISIBILITY_TIMEOUT=900
BLOCKERS=()
WARNINGS=()

usage() {
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
}

while (($#)); do
  case $1 in
    --npm) DO_NPM=1; shift ;;
    --no-npm) DO_NPM=0; shift ;;
    --github) DO_GITHUB=1; shift ;;
    --no-github) DO_GITHUB=0; shift ;;
    --gates) RUN_GATES=1; shift ;;
    --live-url) LIVE_URL=${2:-}; RUN_LIVE=1; shift 2 ;;
    --timeout) NPM_VISIBILITY_TIMEOUT=${2:-}; shift 2 ;;
    --branch) EXPECTED_BRANCH=${2:-}; shift 2 ;;
    --) shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

blocker() {
  BLOCKERS+=("$1")
  printf '    %sBLOCKER%s %s\n' "$C_RED" "$C_RESET" "$1"
}

note() {
  WARNINGS+=("$1")
  printf '    %swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$1"
}

# --------------------------------------------------------------- repository --

check_repository() {
  step "Repository"
  init_release_context
  require_cmd git node pnpm npm curl

  branch=$(git_current_branch)
  if [[ $branch != "$EXPECTED_BRANCH" ]]; then
    blocker "on branch '$branch', expected '$EXPECTED_BRANCH'"
  else
    ok "branch $branch"
  fi

  if git_tree_dirty; then
    note "working tree has uncommitted changes; the real run would commit them"
    git --no-pager diff --stat | sed 's/^/      /'
  else
    ok "working tree clean"
  fi
  untracked=$(git_untracked) || true
  [[ -n $untracked ]] && note "untracked files are ignored by the release commit: $(printf '%s ' $untracked)"

  if ! git fetch --quiet --prune origin 2>/dev/null; then
    blocker "cannot fetch origin (git credentials or network)"
  fi
  if git rev-parse -q --verify "origin/$EXPECTED_BRANCH" >/dev/null 2>&1; then
    read -r ahead behind < <(git_sync_state)
    if ((behind > 0)); then
      blocker "local $EXPECTED_BRANCH is $behind commit(s) behind origin/$EXPECTED_BRANCH"
    else
      ok "local is $ahead commit(s) ahead of origin/$EXPECTED_BRANCH"
    fi
  else
    blocker "origin/$EXPECTED_BRANCH does not exist"
  fi

  ok "$PKG@$VERSION, tag $TAG"
}

check_git_credentials() {
  step "Git transport"
  if git ls-remote --heads origin "$EXPECTED_BRANCH" >/dev/null 2>&1; then
    ok "git can read origin"
  else
    blocker "git cannot read origin; configure your git credentials"
  fi
  if git push --dry-run --quiet origin "HEAD:refs/heads/$EXPECTED_BRANCH" >/dev/null 2>&1; then
    ok "git can push a dry-run to origin/$EXPECTED_BRANCH"
  else
    note "git push --dry-run failed; pushing may need credentials (the real run will ask git, not this script)"
  fi
}

# --------------------------------------------------------------------- npm --

check_npm() {
  step "npm"
  [[ $DO_NPM == 0 ]] && {
    info "skipped (--no-npm)"
    return 0
  }

  local latest
  latest=$(npm_latest_version)
  if [[ -n $latest ]]; then
    newest=$(printf '%s\n%s\n' "$latest" "$VERSION" | sort -V | tail -n1)
    if [[ $newest != "$VERSION" ]]; then
      blocker "package.json version $VERSION is not greater than the published $latest"
    else
      ok "published version: $latest"
    fi
  else
    note "no published version found for $PKG"
  fi

  if npm_version_published; then
    blocker "$PKG@$VERSION is already published; the real publish step would be skipped"
  else
    ok "$PKG@$VERSION is not published yet"
  fi

  local user
  if [[ -n ${NPM_TOKEN:-} ]]; then
    if user=$(npm_token_user "$NPM_TOKEN" 2>/dev/null); then
      user=$(printf '%s' "$user" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).username)}catch{console.log("")}})')
      ok "NPM_TOKEN is valid for $user"
    else
      blocker "NPM_TOKEN was rejected by $REGISTRY_HOST"
    fi
  elif user=$(npm_authenticated_user); then
    ok "pnpm is logged in as $user (publish would use this login)"
  else
    blocker "pnpm is not logged in; use 'pnpm login' or export NPM_TOKEN"
    info "note: pnpm keeps its own credential store, so an npm-only login may not reach it"
  fi

  if command -v npm >/dev/null 2>&1 && npm_user=$(npm whoami 2>/dev/null); then
    if [[ -n ${user:-} && $npm_user != "$user" ]]; then
      note "npm resolves a different account ($npm_user) than pnpm ($user); the publisher is pnpm"
    fi
  fi

  local tfa
  if tfa=$(npm profile get --json 2>/dev/null | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  try { console.log(JSON.parse(s).tfa?.mode || "") } catch { console.log("") }
})'); then
    case $tfa in
      auth-and-writes) info "account 2FA mode: auth-and-writes; pnpm prints an authorization URL when publishing" ;;
      "") info "2FA mode unavailable without a session login" ;;
      *) info "account 2FA mode: $tfa" ;;
    esac
  fi

  if [[ -t 0 ]]; then
    ok "interactive terminal available (npm 2FA can be completed)"
  else
    blocker "stdin is not a terminal; npm's 2FA authorization needs one"
  fi

  if [[ -e .npmrc ]]; then
    note "a project .npmrc exists; the NPM_TOKEN path refuses to overwrite it"
  fi
}

# ------------------------------------------------------------------ github --

check_github() {
  step "GitHub"
  [[ $DO_GITHUB == 0 ]] && {
    info "skipped (--no-github)"
    return 0
  }

  REPO_SLUG=$(github_repo_slug) || {
    blocker "origin is not a GitHub remote"
    return 0
  }
  ok "repository $REPO_SLUG"

  local mode="" user permission token
  if command -v gh >/dev/null 2>&1; then
    if gh auth status >/dev/null 2>&1; then
      mode=gh
      ok "gh CLI is logged in"
    else
      info "gh is installed but not logged in ('gh auth login')"
    fi
  else
    info "gh CLI not installed; token authentication only"
  fi

  if [[ $mode == gh ]]; then
    read -r user permission < <(github_validate_gh) || {
      blocker "gh is not authenticated for $REPO_SLUG"
      return 0
    }
    report_github_permission "$user" "$permission"
    check_release_endpoint gh
    return 0
  fi

  if [[ -n $(github_token_from_env) ]]; then
    github_setup_token "$(github_token_from_env)"
    read -r user permission < <(github_validate_token "$(github_token_from_env)" "$REPO_SLUG") || {
      blocker "GH_TOKEN/GITHUB_TOKEN was rejected"
      return 0
    }
    report_github_permission "$user" "$permission"
    check_release_endpoint token
    return 0
  fi

  if [[ -t 0 ]]; then
    token=$(read_secret "GitHub token for this check only (empty = skip): ")
    if [[ -n $token ]]; then
      github_setup_token "$token"
      read -r user permission < <(github_validate_token "$token" "$REPO_SLUG") || {
        blocker "the GitHub token was rejected"
        return 0
      }
      report_github_permission "$user" "$permission"
      check_release_endpoint token
      return 0
    fi
  fi
  blocker "no GitHub credential: log in with gh, or export GH_TOKEN/GITHUB_TOKEN"
}

report_github_permission() {
  local user=$1 permission=$2
  case $permission in
    admin | maintain | push) ok "authenticated as $user with $permission access" ;;
    *) blocker "credential for $user has only '$permission' access; releases need push" ;;
  esac
}

check_release_endpoint() { # <mode>
  local mode=$1 previous=$GITHUB_MODE
  GITHUB_MODE=$mode
  if [[ $mode == gh ]]; then
    if gh api "repos/$REPO_SLUG/releases?per_page=1" >/dev/null 2>&1; then
      ok "can list releases"
    else
      blocker "cannot list releases with gh"
    fi
    if gh api "repos/$REPO_SLUG/releases/tags/$TAG" >/dev/null 2>&1; then
      blocker "release $TAG already exists"
    else
      ok "release $TAG does not exist yet"
    fi
  else
    local list_status tag_status
    list_status=$(github_api_status GET "/repos/$REPO_SLUG/releases?per_page=1") || list_status="000"
    if [[ $list_status == 200 ]]; then
      ok "can list releases"
    else
      blocker "cannot list releases with the token (HTTP $list_status)"
    fi
    tag_status=$(github_api_status GET "/repos/$REPO_SLUG/releases/tags/$TAG") || tag_status="000"
    case $tag_status in
      404) ok "release $TAG does not exist yet" ;;
      200) blocker "release $TAG already exists" ;;
      *) blocker "cannot check release $TAG (HTTP $tag_status)" ;;
    esac
  fi
  GITHUB_MODE=$previous
}

# -------------------------------------------------------------------- tags --

check_tag() {
  step "Git tag"
  if git_tag_exists "$TAG"; then
    if [[ $(git_commit_of "$TAG") == "$(git rev-parse HEAD)" ]]; then
      ok "tag $TAG already names HEAD (the tag step would be skipped)"
    else
      blocker "tag $TAG exists at another commit"
    fi
  else
    ok "tag $TAG is free locally"
  fi
  if git_remote_tag_exists "$TAG"; then
    blocker "tag $TAG already exists on origin"
  else
    ok "tag $TAG is free on origin"
  fi
}

# ------------------------------------------------------------------- pack --

check_pack() {
  pack_release
  ok "pnpm pack produced $ASSET_NAME"
  info "bytes     $PACK_BYTES"
  info "files     $PACK_FILES"
  info "sha256    $PACK_SHA256"
  if npm_version_published; then
    npm_read_dist
    if [[ $NPM_SHASUM == "$PACK_SHA1" ]]; then
      ok "packed asset is byte-identical to the published npm tarball"
    else
      note "packed asset differs from the registry tarball (the real run can attach the registry copy)"
    fi
  fi
}

# ------------------------------------------------------------------ gates --

check_gates() {
  step "Gates"
  [[ $RUN_GATES == 0 ]] && {
    info "skipped (pass --gates to run them)"
    return 0
  }
  pnpm run verify || blocker "pnpm run verify failed"

  local edge
  if edge=$(detect_edge); then
    if EDGE="$edge" pnpm run verify:dom; then
      ok "verify:dom passed"
    else
      blocker "pnpm run verify:dom failed"
    fi
  else
    blocker "no Edge/Chrome found for verify:dom; set EDGE=<absolute path>"
  fi

  local live
  if [[ $RUN_LIVE == 1 && -n $LIVE_URL ]]; then
    if DSH_WEB_URL="$LIVE_URL" pnpm run verify:live; then
      ok "verify:live passed"
    else
      note "verify:live failed (the real run would fail here too)"
    fi
  elif live=$(detect_live_url); then
    if DSH_WEB_URL="$live" pnpm run verify:live; then
      ok "verify:live passed against $live"
    else
      note "verify:live failed against $live"
    fi
  else
    info "no running Web GUI; verify:live would be skipped"
  fi
}

# ------------------------------------------------------------------- plan --

print_plan() {
  step "Plan for scripts/release.sh"
  info "1. commit the release tree as 'chore: cut the $VERSION release tree'"
  info "2. push $EXPECTED_BRANCH and create the annotated tag $TAG"
  if [[ $DO_NPM == 1 ]]; then
    info "3. pnpm publish --access public (2FA link printed when needed), then wait up to ${NPM_VISIBILITY_TIMEOUT}s"
  else
    info "3. npm publish skipped"
  fi
  info "4. pnpm pack -> $ASSET_NAME, compared with the registry tarball"
  if [[ $DO_GITHUB == 1 ]]; then
    info "5. GitHub release $TAG with $ASSET_NAME attached"
  else
    info "5. GitHub release skipped"
  fi
  info "6. post-release checks (npm latest, latest release, latest/download)"
}

main() {
  check_repository
  check_git_credentials
  check_npm
  check_github
  check_tag
  check_pack
  check_gates
  print_plan

  step "Result"
  if ((${#BLOCKERS[@]} > 0)); then
    local item
    for item in "${BLOCKERS[@]}"; do
      printf '  %sBLOCKER%s %s\n' "$C_RED" "$C_RESET" "$item"
    done
    printf '\n  %snot ready%s: fix the blockers above, then re-run\n' "$C_RED$C_BOLD" "$C_RESET"
    exit 2
  fi
  if ((${#WARNINGS[@]} > 0)); then
    printf '  %s%d warning(s)%s; review them before releasing\n' "$C_YELLOW" "${#WARNINGS[@]}" "$C_RESET"
  fi
  printf '  %sready%s: no blockers found (nothing was published)\n' "$C_GREEN$C_BOLD" "$C_RESET"
}

main
