#!/usr/bin/env bash
# Interactive release flow for this package.
#
# Cuts one release from the current tree: gates, release commit, push, annotated
# tag, npm publish, the version-free release asset, the GitHub release, and the
# post-release checks. Every destructive step asks first; run
# `scripts/release-dry-run.sh` to validate the credentials and the repository
# state without touching anything.
#
# Credentials are never hardcoded and never read out of a store behind the
# tools' backs: npm authentication is validated through pnpm (the publishing
# tool) or supplied through NPM_TOKEN, and GitHub authentication is either the
# `gh` CLI's own login or a GH_TOKEN/GITHUB_TOKEN you export (or type once; it is
# not stored). See docs/engineering.md for the flow and the rationale.
#
# Usage: bash scripts/release.sh [options]
#   --from <step>      resume after an earlier step (commit|push|tag|publish|
#                      pack|release|verify); preflight still runs
#   --to <step>        stop after <step>
#   --gates            run the gates even when --from skips them
#   --skip-gates       skip the gates (the release is not verifiable; asks first)
#   --no-npm           do not publish to npm
#   --no-github        do not create the GitHub release
#   --notes <file>     use an existing release-notes file
#   --live-url <url>   running DSH Web GUI for the live gate (defaults to
#                      $DSH_WEB_URL when set)
#   --timeout <sec>    how long to wait for npm to serve the version (default 900)
#   --branch <name>    expected branch (default main)
#   --message <text>   release commit subject
#   --yes              skip confirmations (an interactive terminal is still
#                      required for npm's 2FA authorization)
#   -h, --help
#
# shellcheck shell=bash

source "$(dirname -- "${BASH_SOURCE[0]}")/release-lib.sh"

EXPECTED_BRANCH=main
ASSUME_YES=0
RUN_GATES=1
STOP_AFTER=""
START_AFTER=""
DO_NPM=1
DO_GITHUB=1
NOTES_FILE=""
LIVE_URL=""
NPM_VISIBILITY_TIMEOUT=900
COMMIT_MESSAGE=""
TAG_READY=0
GITHUB_MODE=""
GITHUB_RELEASE_URL=""

usage() {
  cat <<'EOF'
Interactive release flow: gates, release commit, push, annotated tag, npm
publish, version-free release asset, GitHub release, and post-release checks.
Run scripts/release-dry-run.sh first to validate credentials and state.

Usage: bash scripts/release.sh [options]
  --from <step>      resume after an earlier step (commit|push|tag|publish|pack|release|verify); preflight still runs
  --to <step>        stop after <step>
  --gates            run the gates even when --from skips them
  --skip-gates       skip the gates (asks first; the release is then unverified)
  --no-npm           do not publish to npm
  --no-github        do not create the GitHub release
  --notes <file>     use an existing release-notes file
  --live-url <url>   running DSH Web GUI for the live gate (defaults to $DSH_WEB_URL)
  --timeout <sec>    how long to wait for npm to serve the version (default 900)
  --branch <name>    expected branch (default main)
  --message <text>   release commit subject
  --yes              skip confirmations (npm's 2FA authorization still needs a terminal)
  -h, --help
EOF
}

while (($#)); do
  case $1 in
    --from) START_AFTER=${2:-}; shift 2 ;;
    --to) STOP_AFTER=${2:-}; shift 2 ;;
    --gates) RUN_GATES=1; GATES_FORCED=1; shift ;;
    --skip-gates) RUN_GATES=0; shift ;;
    --no-npm) DO_NPM=0; shift ;;
    --no-github) DO_GITHUB=0; shift ;;
    --notes) NOTES_FILE=${2:-}; shift 2 ;;
    --live-url) LIVE_URL=${2:-}; shift 2 ;;
    --timeout) NPM_VISIBILITY_TIMEOUT=${2:-}; shift 2 ;;
    --branch) EXPECTED_BRANCH=${2:-}; shift 2 ;;
    --message) COMMIT_MESSAGE=${2:-}; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --) shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

GATES_FORCED=${GATES_FORCED:-0}
STEPS=(commit push tag publish pack release verify)

step_index() {
  local name=$1 i
  for i in "${!STEPS[@]}"; do
    [[ ${STEPS[$i]} == "$name" ]] && {
      printf '%s' "$i"
      return 0
    }
  done
  return 1
}

should_run() { # should_run <step>
  local index
  index=$(step_index "$1") || die "unknown step: $1"
  if [[ -n $START_AFTER ]]; then
    local start_index
    start_index=$(step_index "$START_AFTER") || die "unknown --from step: $START_AFTER"
    ((index >= start_index)) || return 1
  fi
  if [[ -n $STOP_AFTER ]]; then
    local stop_index
    stop_index=$(step_index "$STOP_AFTER") || die "unknown --to step: $STOP_AFTER"
    ((index <= stop_index)) || return 1
  fi
  return 0
}

# --------------------------------------------------------------- preflight --

preflight() {
  step "Preflight"
  init_release_context
  need_commands
  check_branch
  check_remote_sync
  check_npm_state
  check_tag_state
  check_release_records
  check_untracked
  ok "$PKG@$VERSION on $EXPECTED_BRANCH at $(git rev-parse --short HEAD)"
}

need_commands() {
  require_cmd git node pnpm npm curl
  pnpm_latest=$(npm_latest_version)
  if [[ -n $pnpm_latest ]]; then
    newest=$(printf '%s\n%s\n' "$pnpm_latest" "$VERSION" | sort -V | tail -n1)
    if [[ $newest != "$VERSION" ]]; then
      die "package.json version $VERSION is not greater than the published version $pnpm_latest"
    fi
    info "published: $pnpm_latest, this tree: $VERSION"
  else
    info "package has no published version yet"
  fi
}

check_branch() {
  local branch
  branch=$(git_current_branch)
  if [[ $branch != "$EXPECTED_BRANCH" ]]; then
    die "on branch '$branch'; releases are cut from '$EXPECTED_BRANCH' (use --branch to override)"
  fi
  ok "branch $branch"
}

check_remote_sync() {
  local ahead behind
  git_fetch_origin
  read -r ahead behind < <(git_sync_state)
  if ((behind > 0)); then
    die "local $EXPECTED_BRANCH is $behind commit(s) behind origin/$EXPECTED_BRANCH; pull or rebase first"
  fi
  if ((ahead > 0)); then
    info "local $EXPECTED_BRANCH is $ahead commit(s) ahead of origin/$EXPECTED_BRANCH"
  else
    ok "in sync with origin/$EXPECTED_BRANCH"
  fi
}

check_npm_state() {
  if npm_version_published; then
    warn "$PKG@$VERSION is already on the registry; the publish step will be skipped"
  else
    ok "$PKG@$VERSION is not published yet"
  fi
}

check_tag_state() {
  if git_tag_exists "$TAG"; then
    local commit
    commit=$(git_commit_of "$TAG")
    if [[ $commit != "$(git rev-parse HEAD)" ]]; then
      die "tag $TAG already exists at $commit; it is not this commit"
    fi
    ok "tag $TAG already names HEAD"
    TAG_READY=1
  else
    ok "tag $TAG is free"
  fi
}

check_release_records() {
  [[ $DO_NPM == 0 && $DO_GITHUB == 0 ]] && return 0
  local missing=()
  if [[ -f docs/awesome-plugin.md ]] && ! grep -qF "$TAG" docs/awesome-plugin.md; then
    missing+=("docs/awesome-plugin.md §8 has no $TAG record")
  fi
  if [[ -f docs/engineering.md ]] && ! grep -qF "$VERSION release run" docs/engineering.md; then
    missing+=("docs/engineering.md has no '$VERSION release run' entry")
  fi
  if ((${#missing[@]} > 0)); then
    warn "the release record is incomplete:"
    local item
    for item in "${missing[@]}"; do
      warn "  - $item"
    done
    confirm "continue without a complete release record?" ||
      die "write the release record first, then re-run"
  else
    ok "release records mention $TAG"
  fi
}

check_untracked() {
  local untracked
  untracked=$(git_untracked) || true
  if [[ -n $untracked ]]; then
    warn "untracked files are ignored by the release commit:"
    printf '%s\n' "$untracked" | sed 's/^/      /'
  fi
}

# ------------------------------------------------------------------- gates --

run_gates() {
  step "Gates on the release tree"
  info "pnpm run verify"
  pnpm run verify

  local edge
  if ! edge=$(detect_edge); then
    die "no Edge/Chrome found for verify:dom; set EDGE=<absolute path to msedge.exe or chrome>"
  fi
  info "EDGE=$edge pnpm run verify:dom"
  EDGE="$edge" pnpm run verify:dom

  local live
  if live=$(detect_live_url); then
    info "DSH_WEB_URL=$live pnpm run verify:live"
    DSH_WEB_URL="$live" pnpm run verify:live
  else
    warn "no running Web GUI found (set DSH_WEB_URL or --live-url); verify:live skipped"
  fi

  check_lockfile_churn
}

check_lockfile_churn() {
  if [[ -n $(git status --porcelain -- pnpm-lock.yaml 2>/dev/null) ]]; then
    warn "pnpm-lock.yaml changed while the gates ran (pnpm tooling can rewrite it)"
    if confirm "restore pnpm-lock.yaml to HEAD?"; then
      git checkout -- pnpm-lock.yaml
      ok "pnpm-lock.yaml restored"
    else
      die "commit or discard the lockfile change, then re-run"
    fi
  fi
}

# ------------------------------------------------------------------ commit --

release_commit() {
  step "Release commit"
  if ! git_tree_dirty; then
    ok "working tree is clean; nothing to commit"
    return 0
  fi
  [[ -n $(git status --porcelain --untracked-files=no) ]] || true
  git --no-pager diff --stat
  local unexpected
  unexpected=$(git diff HEAD --name-only | grep -vE '^(package\.json|README(\.zh)?\.md|docs/[^/]+\.md)$' || true)
  if [[ -n $unexpected ]]; then
    warn "changes outside the usual release files:"
    printf '%s\n' "$unexpected" | sed 's/^/      /'
    confirm "commit them anyway?" || die "release commit aborted"
  fi
  [[ -n $COMMIT_MESSAGE ]] || COMMIT_MESSAGE="chore: cut the $VERSION release tree"
  confirm "commit the release tree as '$COMMIT_MESSAGE'?" || die "release commit aborted"
  git add -u
  git commit -m "$COMMIT_MESSAGE"
  ok "committed $(git rev-parse --short HEAD)"
}

# -------------------------------------------------------------------- push --

push_main() {
  step "Push $EXPECTED_BRANCH"
  local ahead behind
  git_fetch_origin
  read -r ahead behind < <(git_sync_state)
  if ((behind > 0)); then
    die "origin/$EXPECTED_BRANCH moved; pull or rebase and re-run"
  fi
  if ((ahead == 0)); then
    ok "origin/$EXPECTED_BRANCH already has $(git rev-parse --short HEAD)"
    return 0
  fi
  confirm "push $ahead commit(s) to origin/$EXPECTED_BRANCH?" || die "push aborted"
  git push origin "HEAD:refs/heads/$EXPECTED_BRANCH"
  git_fetch_origin
  [[ $(git_commit_of "origin/$EXPECTED_BRANCH") == "$(git rev-parse HEAD)" ]] ||
    die "origin/$EXPECTED_BRANCH does not point at HEAD after the push"
  ok "pushed $(git rev-parse --short HEAD)"
}

# --------------------------------------------------------------------- tag --

cut_tag() {
  step "Annotated tag $TAG"
  [[ $(git_commit_of "origin/$EXPECTED_BRANCH") == "$(git rev-parse HEAD)" ]] ||
    die "push $EXPECTED_BRANCH before tagging (origin does not point at HEAD)"
  if git_tag_exists "$TAG"; then
    if [[ $(git_commit_of "$TAG") != "$(git rev-parse HEAD)" ]]; then
      die "tag $TAG exists at another commit"
    fi
    ok "tag $TAG already names HEAD"
  else
    confirm "create annotated tag $TAG?" || die "tag aborted"
    git tag -a "$TAG" -m "$PKG $VERSION"
    ok "tagged $TAG"
  fi
  if git_remote_tag_exists "$TAG"; then
    ok "origin already has $TAG"
  else
    confirm "push tag $TAG to origin?" || die "tag push aborted"
    git push origin "$TAG"
    ok "pushed $TAG"
  fi
}

# ----------------------------------------------------------------- publish --

publish_npm() {
  step "Publish to $REGISTRY_HOST"
  if npm_version_published; then
    ok "$PKG@$VERSION is already published"
    npm_read_dist
    return 0
  fi
  require_tty " for npm's two-factor authorization"
  info "pnpm publish runs the prepublishOnly gate (pnpm run verify) again"
  info "if the registry asks for a second factor, pnpm prints an authorization URL"
  info "open it, approve, and the publish continues"

  npm_choose_auth
  confirm_exact "publish $PKG@$VERSION?" "$VERSION" || die "publish aborted"

  local status=0
  pnpm publish --access public || status=$?
  npm_cleanup_token
  ((status == 0)) || die "pnpm publish failed"

  if ! poll_npm_version "$NPM_VISIBILITY_TIMEOUT"; then
    die "the registry does not serve $VERSION yet. npm may still show it as 'Validating';
    check https://www.npmjs.com/package/$PKG/v/$VERSION and re-run with --from pack"
  fi
  npm_read_dist
  ok "published $(npm_authenticated_user || echo "$PKG")@$VERSION"
}

npm_choose_auth() {
  local mode user token has_login=0 has_env=0
  local options=()
  if user=$(npm_authenticated_user); then
    has_login=1
    ok "pnpm is logged in as $user"
  else
    warn "pnpm is not logged in to $REGISTRY_HOST"
    info "pnpm keeps its own credential store; an npm login alone may not reach it"
  fi
  if [[ -n ${NPM_TOKEN:-} ]]; then
    if npm_token_user "$NPM_TOKEN" >/dev/null 2>&1; then
      has_env=1
      info "NPM_TOKEN is set and valid"
    else
      warn "NPM_TOKEN is set but rejected by $REGISTRY_HOST; ignoring it"
    fi
  fi

  [[ $has_login == 1 ]] && options+=("Use the login pnpm already has")
  [[ $has_env == 1 ]] && options+=("Use NPM_TOKEN from the environment")
  options+=("Enter an npm token for this run only")
  options+=("Log in now with pnpm login")
  mode=$(ask_choice "npm authentication" "${options[@]}")

  case $mode in
    "Use the login pnpm already has")
      user=$(npm_authenticated_user) || die "pnpm whoami failed; re-authenticate and retry"
      ok "using pnpm login ($user)"
      ;;
    "Use NPM_TOKEN from the environment")
      token=${NPM_TOKEN:-}
      npm_write_token_npmrc "$token"
      user=$(npm_authenticated_user) || die "pnpm does not accept NPM_TOKEN through the temporary .npmrc"
      ok "using NPM_TOKEN for this run ($user)"
      ;;
    "Enter an npm token for this run only")
      token=$(read_secret "npm token for $REGISTRY_HOST (not stored): ")
      [[ -n $token ]] || die "no token entered"
      npm_token_user "$token" >/dev/null || die "the token was rejected by $REGISTRY_HOST"
      npm_write_token_npmrc "$token"
      user=$(npm_authenticated_user) || die "pnpm does not accept the token through the temporary .npmrc"
      ok "using a one-run token ($user)"
      ;;
    "Log in now with pnpm login")
      pnpm login || die "pnpm login failed"
      user=$(npm_authenticated_user) || die "pnpm whoami still fails after login"
      ok "logged in as $user"
      ;;
    *) die "unknown authentication choice" ;;
  esac
}

npm_write_token_npmrc() { # <token>; temporary 0600 project .npmrc, removed after publishing
  local token=$1
  if [[ -e .npmrc ]]; then
    die "a project .npmrc already exists; refusing to overwrite it. Move it away or use another auth method"
  fi
  local old_umask
  old_umask=$(umask)
  umask 077
  TEMP_PROJECT_NPMRC="$REPO_ROOT/.npmrc"
  {
    printf 'registry=%s\n' "$REGISTRY_URL"
    printf '//%s/:_authToken=%s\n' "$REGISTRY_HOST" "$token"
  } >"$TEMP_PROJECT_NPMRC"
  chmod 600 "$TEMP_PROJECT_NPMRC"
  umask "$old_umask"
  info "wrote a temporary, token-only .npmrc (removed when the publish finishes)"
}

npm_cleanup_token() {
  if [[ -n ${TEMP_PROJECT_NPMRC:-} && -f $TEMP_PROJECT_NPMRC ]]; then
    rm -f -- "$TEMP_PROJECT_NPMRC"
    TEMP_PROJECT_NPMRC=""
    ok "temporary .npmrc removed"
  fi
}

# -------------------------------------------------------------------- pack --

pack_asset() {
  pack_release
  if npm_version_published; then
    compare_pack_with_registry
  else
    warn "npm has no $VERSION yet; byte-identity cannot be checked"
  fi
}

# ----------------------------------------------------------------- release --

github_choose_auth() {
  step "GitHub authentication"
  local options=() mode user permission token
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    options+=("Use the gh CLI login")
  fi
  if [[ -n $(github_token_from_env) ]]; then
    options+=("Use GH_TOKEN/GITHUB_TOKEN from the environment")
  fi
  options+=("Enter a token for this run only")
  mode=$(ask_choice "GitHub authentication" "${options[@]}")

  case $mode in
    "Use the gh CLI login")
      read -r user permission < <(github_validate_gh) ||
        die "gh is not authenticated for $REPO_SLUG"
      GITHUB_MODE=gh
      ;;
    "Use GH_TOKEN/GITHUB_TOKEN from the environment")
      token=$(github_token_from_env)
      [[ -n $token ]] || die "no GitHub token in the environment"
      github_setup_token "$token"
      read -r user permission < <(github_validate_token "$token" "$REPO_SLUG") ||
        die "the GitHub token was rejected"
      GITHUB_MODE=token
      ;;
    "Enter a token for this run only")
      token=$(read_secret "GitHub token (not stored): ")
      [[ -n $token ]] || die "no token entered"
      github_setup_token "$token"
      read -r user permission < <(github_validate_token "$token" "$REPO_SLUG") ||
        die "the GitHub token was rejected"
      GITHUB_MODE=token
      ;;
    *) die "unknown authentication choice" ;;
  esac

  case $permission in
    admin | maintain | push) ok "authenticated as $user with $permission access to $REPO_SLUG" ;;
    *) die "the credential has only '$permission' access to $REPO_SLUG; releases need push access" ;;
  esac
}

github_notes_file() {
  local notes=$1 prev
  prev=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || true)
  {
    printf '# %s %s\n\n' "$PKG" "$TAG"
    printf '## What changed'
    [[ -n $prev ]] && printf ' since %s' "$prev"
    printf '\n\n'
    if [[ -n $prev ]]; then
      git log --no-merges --pretty='- %s' "$prev..HEAD"
    else
      git log --no-merges --pretty='- %s' --max-count=30
    fi
    printf '\n## Verification\n\n'
    printf 'Gates on `%s`: `pnpm run verify` and `pnpm run verify:dom` passed.\n' "$(git rev-parse --short HEAD)"
    printf 'See the repository docs for the full gate log.\n'
    printf '\n## Asset\n\n'
    printf '`%s` — SHA-256 `%s` (%s bytes, %s files).\n' "$ASSET_NAME" "$PACK_SHA256" "$PACK_BYTES" "$PACK_FILES"
    if [[ -n ${NPM_SHASUM:-} ]]; then
      printf '\nByte-identical to the published npm tarball: SHA-1 `%s`, integrity `%s`.\n' "$NPM_SHASUM" "$NPM_INTEGRITY"
    fi
    printf '\nThe version-free name keeps `releases/latest/download/%s` stable across releases.\n' "$ASSET_NAME"
  } >"$notes"
}

github_create_release() {
  step "GitHub release $TAG"
  [[ -n $REPO_SLUG ]] || REPO_SLUG=$(github_repo_slug) || die "origin is not a GitHub remote"
  github_choose_auth

  local existing notes
  if existing=$(github_release_by_tag) && [[ -n $existing ]]; then
    GITHUB_RELEASE_URL=$(printf '%s' "$existing" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  console.log(r.html_url)
})')
    warn "release $TAG already exists: $GITHUB_RELEASE_URL"
    if ! github_asset_present "$existing"; then
      warn "the release has no $ASSET_NAME asset yet"
      confirm "upload $ASSET_NAME to the existing release?" || die "release aborted"
      github_upload_to_existing "$existing"
    else
      ok "release already carries $ASSET_NAME"
    fi
    return 0
  fi

  if [[ -n $NOTES_FILE ]]; then
    [[ -f $NOTES_FILE ]] || die "notes file not found: $NOTES_FILE"
    notes=$NOTES_FILE
    ok "using notes file $notes"
  else
    notes="$RELEASE_TMPDIR/release-notes-$TAG.md"
    github_notes_file "$notes"
    if [[ -t 0 ]] && confirm "edit the generated release notes in \${EDITOR:-vi}?"; then
      "${EDITOR:-vi}" "$notes" || die "editor exited with an error"
    fi
  fi
  confirm "create GitHub release $TAG from $(git rev-parse --short HEAD)?" || die "release aborted"

  case $GITHUB_MODE in
    gh)
      gh release create "$TAG" "$ASSET_PATH" --title "$RELEASE_TITLE" --notes-file "$notes" >/dev/null ||
        die "gh release create failed"
      GITHUB_RELEASE_URL=$(gh api "repos/$REPO_SLUG/releases/tags/$TAG" --jq .html_url 2>/dev/null || true)
      ;;
    token)
      local body response release_id
      body=$(node -e '
const fs = require("node:fs")
const notes = fs.readFileSync(process.argv[1], "utf8")
process.stdout.write(JSON.stringify({
  tag_name: process.argv[2],
  name: process.argv[3],
  body: notes,
  draft: false,
  prerelease: false,
}))
' "$notes" "$TAG" "$RELEASE_TITLE")
      response=$(github_api POST "/repos/$REPO_SLUG/releases" \
        -H "Content-Type: application/json" --data "$body") || die "creating the release failed"
      release_id=$(printf '%s' "$response" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  if (!r.id) { console.error(r.message || s); process.exit(1) }
  console.log(r.id)
})') || die "creating the release failed"
      GITHUB_RELEASE_URL=$(printf '%s' "$response" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  console.log(r.html_url)
})')
      local upload asset_digest asset_size
      upload=$(github_upload_asset "$release_id" "$ASSET_PATH" "$ASSET_NAME") ||
        die "uploading $ASSET_NAME failed"
      read -r asset_size asset_digest < <(printf '%s' "$upload" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  if (r.message) { console.error(r.message); process.exit(1) }
  console.log(String(r.size || "") + " " + String(r.digest || ""))
})') || die "the asset upload returned no asset"
      [[ $asset_size == "$PACK_BYTES" ]] || die "uploaded asset is $asset_size bytes, packed asset is $PACK_BYTES"
      if [[ -n $asset_digest && $asset_digest != "sha256:$PACK_SHA256" ]]; then
        die "uploaded digest $asset_digest does not match sha256:$PACK_SHA256"
      fi
      ok "asset uploaded ($asset_size bytes${asset_digest:+, $asset_digest})"
      ;;
    *) die "no GitHub authentication mode selected" ;;
  esac
  ok "release created: ${GITHUB_RELEASE_URL:-https://github.com/$REPO_SLUG/releases/tag/$TAG}"
}

github_asset_present() { # <release json>
  printf '%s' "$1" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  process.exit((r.assets || []).some(a => a.name === process.argv[1]) ? 0 : 1)
})' "$ASSET_NAME"
}

github_upload_to_existing() { # <release json>
  local release_id
  release_id=$(printf '%s' "$1" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => console.log(JSON.parse(s).id))')
  case $GITHUB_MODE in
    gh)
      gh release upload "$TAG" "$ASSET_PATH" --clobber >/dev/null || die "gh release upload failed"
      ;;
    token)
      local upload
      upload=$(github_upload_asset "$release_id" "$ASSET_PATH" "$ASSET_NAME") || die "asset upload failed"
      printf '%s' "$upload" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  if (r.message) { console.error(r.message); process.exit(1) }
  console.log(r.state || "uploaded")
})' >/dev/null
      ;;
  esac
  ok "asset uploaded to the existing release"
}

# ------------------------------------------------------------------ verify --

post_verify() {
  step "Post-release checks"
  local live_version release_tag code
  live_version=$(npm view "$PKG" version --loglevel=error 2>/dev/null | tail -n1) || true
  if [[ $live_version == "$VERSION" ]]; then
    ok "npm latest is $live_version"
  else
    warn "npm latest is '${live_version:-unknown}', expected $VERSION"
  fi

  [[ -n $REPO_SLUG ]] || {
    print_release_summary
    return 0
  }

  case $GITHUB_MODE in
    gh)
      release_tag=$(gh api "repos/$REPO_SLUG/releases/latest" --jq .tag_name 2>/dev/null || true)
      ;;
    token)
      if [[ -f ${GITHUB_HEADERS_FILE:-} ]]; then
        release_tag=$(curl --silent --show-error --connect-timeout 10 --max-time 30 \
          -H @"$GITHUB_HEADERS_FILE" \
          "https://api.github.com/repos/$REPO_SLUG/releases/latest") || release_tag=""
        release_tag=$(printf '%s' "$release_tag" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  try { console.log(JSON.parse(s).tag_name || "") } catch { console.log("") }
})')
      else
        release_tag=""
      fi
      ;;
    *) release_tag="" ;;
  esac
  if [[ $release_tag == "$TAG" ]]; then
    ok "latest GitHub release is $TAG"
  else
    warn "latest GitHub release is '${release_tag:-unknown}', expected $TAG"
  fi

  code=$(curl --silent --output /dev/null --location --connect-timeout 10 --max-time 60 \
    --write-out '%{http_code}' "https://github.com/$REPO_SLUG/releases/latest/download/$ASSET_NAME" || true)
  if [[ $code == 200 ]]; then
    ok "releases/latest/download/$ASSET_NAME serves the asset"
  else
    warn "releases/latest/download/$ASSET_NAME returned '$code'"
  fi

  print_release_summary
}

# -------------------------------------------------------------------- main --

main() {
  preflight

  if ! should_run commit; then
    info "skipping gates (resuming with --from $START_AFTER)"
    RUN_GATES=0
  fi
  if ((RUN_GATES == 1)); then
    if [[ ${GATES_FORCED:-0} == 0 && -n $START_AFTER ]]; then
      info "skipping gates because --from was given (use --gates to force)"
    else
      run_gates
    fi
  else
    warn "gates will be skipped"
    [[ ${GATES_FORCED:-0} == 1 ]] || confirm "continue without running the gates?" || die "aborted"
  fi

  should_run commit && release_commit
  should_run push && push_main
  should_run tag && cut_tag
  if should_run publish; then
    if [[ $DO_NPM == 1 ]]; then publish_npm; else info "npm publish skipped (--no-npm)"; fi
  fi
  if should_run pack; then
    if [[ $DO_NPM == 0 && $DO_GITHUB == 0 ]]; then
      info "skipping pack (no npm and no GitHub release requested)"
    else
      pack_asset
    fi
  fi
  if should_run release; then
    if [[ $DO_GITHUB == 1 ]]; then
      github_create_release
    else
      info "GitHub release skipped (--no-github)"
    fi
  fi
  should_run verify && post_verify

  step "Done"
  [[ -n $GITHUB_RELEASE_URL ]] && info "release: $GITHUB_RELEASE_URL"
  info "npm:     $(registry_u)/$PKG/$VERSION"
}

main
