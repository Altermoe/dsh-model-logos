#!/usr/bin/env bash
# Shared helpers for the interactive release scripts.
#
# Sourced by scripts/release.sh and scripts/release-dry-run.sh; never executed
# directly. Nothing here reads, writes or assumes a credential store: every
# authentication path either relies on the publishing tool's own login (validated
# through that same tool) or on a token the developer exports for this run. No
# secret is ever printed, and no secret is written outside a 0600 temp file that
# a trap removes.
#
# shellcheck shell=bash

set -euo pipefail

RELEASE_SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd -- "$RELEASE_SCRIPT_DIR/.." && pwd -P)
cd -- "$REPO_ROOT"

# ------------------------------------------------------------------ output --

if [[ -t 1 && -z ${NO_COLOR:-} ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
else
  C_RESET='' C_BOLD='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi

step() { printf '\n%s==>%s %s\n' "$C_BOLD$C_BLUE" "$C_RESET" "$*"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %sok%s  %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '    %swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die() {
  printf '\n%serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2
  exit 1
}

# ------------------------------------------------------------------- input --

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
  done
}

require_tty() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    die "this step needs an interactive terminal$1"
  fi
}

confirm() { # confirm <question>; default is "no"
  local prompt=$1 answer
  if [[ ${ASSUME_YES:-0} == 1 ]]; then
    return 0
  fi
  [[ -t 0 ]] || die "confirmation required but stdin is not a terminal: $prompt"
  read -r -p "    $prompt [y/N] " answer || true
  [[ $answer == [yY] || $answer == [yY][eE][sS] ]]
}

confirm_exact() { # confirm_exact <question> <word>
  local prompt=$1 word=$2 answer
  if [[ ${ASSUME_YES:-0} == 1 ]]; then
    return 0
  fi
  [[ -t 0 ]] || die "confirmation required but stdin is not a terminal: $prompt"
  read -r -p "    $prompt Type '$word' to continue: " answer || true
  [[ $answer == "$word" ]]
}

read_secret() { # read_secret <prompt> -> prints the value (prompt on stderr)
  local prompt=$1 value
  [[ -t 0 ]] || die "cannot prompt for a secret without a terminal"
  printf '    %s' "$prompt" >&2
  IFS= read -r -s value || true
  printf '\n' >&2
  printf '%s' "$value"
}

ask_choice() { # ask_choice <question> <option>... -> echoes the option
  local question=$1
  shift
  local options=("$@") index choice i
  printf '\n%s\n' "$question" >&2
  for i in "${!options[@]}"; do
    printf '    %d) %s\n' "$((i + 1))" "${options[$i]}" >&2
  done
  while true; do
    printf '    choose [1-%d]: ' "${#options[@]}" >&2
    IFS= read -r choice || die "no answer"
    if [[ $choice =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#options[@]})); then
      printf '%s' "${options[$((choice - 1))]}"
      return 0
    fi
    printf '    invalid choice\n' >&2
  done
}

# ------------------------------------------------------------------ context --

init_release_context() {
  require_cmd git node curl
  [[ -f package.json ]] || die "package.json not found; run from the repository"

  PKG=$(node -p "require('./package.json').name")
  VERSION=$(node -p "require('./package.json').version")
  TAG="v$VERSION"
  ASSET_NAME="$(basename -- "$PKG").tgz"
  RELEASE_TITLE="v$VERSION"

  if node -p "require('./package.json').private === true" | grep -qx true; then
    die "package.json is private; remove the flag before publishing"
  fi

  REGISTRY_URL=$(npm config get registry 2>/dev/null | tail -n1)
  REGISTRY_URL=${REGISTRY_URL%/}
  [[ -n $REGISTRY_URL ]] || die "cannot determine the npm registry URL"
  REGISTRY_HOST=${REGISTRY_URL#*://}
  REGISTRY_HOST=${REGISTRY_HOST%%/*}

  EXPECTED_BRANCH=${EXPECTED_BRANCH:-main}
  RELEASE_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/dshml-release.XXXXXX")
  TEMP_PROJECT_NPMRC=""
  GITHUB_HEADERS_FILE=""
  trap release_cleanup EXIT
  trap 'release_cleanup; exit 130' INT TERM
}

release_cleanup() {
  if [[ -n ${TEMP_PROJECT_NPMRC:-} && -f $TEMP_PROJECT_NPMRC ]]; then
    rm -f -- "$TEMP_PROJECT_NPMRC"
  fi
  if [[ -n ${GITHUB_HEADERS_FILE:-} && -f $GITHUB_HEADERS_FILE ]]; then
    rm -f -- "$GITHUB_HEADERS_FILE"
  fi
  if [[ -n ${RELEASE_TMPDIR:-} && -d $RELEASE_TMPDIR ]]; then
    rm -rf -- "$RELEASE_TMPDIR"
  fi
}

# ---------------------------------------------------------------------- git --

git_current_branch() { git rev-parse --abbrev-ref HEAD; }

git_tree_dirty() { [[ -n $(git status --porcelain --untracked-files=no) ]]; }

git_untracked() { git ls-files --others --exclude-standard; }

git_commit_of() { # <ref>
  git rev-list -n1 "$1" 2>/dev/null || true
}

git_tag_exists() { git rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1; }

git_remote_tag_exists() { # <tag>; requires an up-to-date fetch
  git ls-remote --tags --exit-code origin "refs/tags/$1" >/dev/null 2>&1
}

git_fetch_origin() {
  git fetch --quiet --prune origin || die "git fetch failed (check your git credentials and network)"
}

git_sync_state() { # prints "ahead behind"
  local ahead behind
  ahead=$(git rev-list --count "origin/$EXPECTED_BRANCH..HEAD" 2>/dev/null || echo 0)
  behind=$(git rev-list --count "HEAD..origin/$EXPECTED_BRANCH" 2>/dev/null || echo 0)
  printf '%s %s\n' "$ahead" "$behind"
}

# ---------------------------------------------------------------------- npm --

registry_u() { printf '%s' "$REGISTRY_URL"; }

npm_authenticated_user() { # prints the user or nothing
  local out
  if out=$(pnpm whoami 2>&1); then
    printf '%s\n' "$out" | tail -n1
    return 0
  fi
  return 1
}

npm_token_user() { # <token>; validates a token without writing any config
  curl --silent --show-error --connect-timeout 10 --max-time 30 \
    -H "Authorization: Bearer $1" "$(registry_u)/-/whoami"
}

npm_latest_version() {
  local out
  out=$(npm view "$PKG" version --loglevel=error 2>/dev/null | tail -n1) || true
  printf '%s\n' "$out"
}

npm_version_meta() { # <version> -> JSON body; fails when absent
  curl --silent --show-error --fail --connect-timeout 10 --max-time 60 \
    "$(registry_u)/$PKG/$1"
}

npm_version_published() {
  npm_version_meta "$VERSION" >/dev/null 2>&1
}

npm_read_dist() { # sets NPM_SHASUM / NPM_INTEGRITY / NPM_FILE_COUNT
  local meta
  meta=$(npm_version_meta "$VERSION") || die "cannot read $PKG@$VERSION from the registry"
  read -r NPM_SHASUM NPM_INTEGRITY NPM_FILE_COUNT < <(printf '%s' "$meta" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const dist = JSON.parse(s).dist || {}
  console.log([dist.shasum || "", dist.integrity || "", dist.fileCount || ""].join(" "))
})')
}

poll_npm_version() { # <seconds>
  local timeout=$1 deadline=$((SECONDS + $1)) dots=0
  info "waiting up to ${timeout}s for $PKG@$VERSION to appear on the registry..."
  while ((SECONDS < deadline)); do
    if npm_version_published; then
      [[ $dots -gt 0 ]] && printf '\n'
      ok "registry now serves $PKG@$VERSION"
      return 0
    fi
    printf '.'
    dots=$((dots + 1))
    sleep 15
  done
  [[ $dots -gt 0 ]] && printf '\n'
  return 1
}

# ------------------------------------------------------------------- github --

github_repo_slug() {
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 1
  url=${url%.git}
  case $url in
    *github.com:*) url=${url#*github.com:} ;;
    *github.com/*) url=${url#*github.com/} ;;
    *) return 1 ;;
  esac
  printf '%s\n' "$url"
}

github_api() { # github_api <METHOD> <path> [curl args...]
  local method=$1 path=$2
  shift 2
  curl --silent --show-error --connect-timeout 15 --max-time 120 \
    -H @"$GITHUB_HEADERS_FILE" -X "$method" "https://api.github.com$path" "$@"
}

github_upload_asset() { # github_upload_asset <release-id> <file> <name>
  curl --silent --show-error --connect-timeout 20 --max-time 900 --retry 3 --retry-delay 5 \
    -H @"$GITHUB_HEADERS_FILE" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$2" \
    "https://uploads.github.com/repos/$REPO_SLUG/releases/$1/assets?name=$3"
}

github_setup_token() { # github_setup_token <token>; never prints it
  GITHUB_TOKEN_VALUE=$1
  if [[ -n ${GITHUB_HEADERS_FILE:-} && -f $GITHUB_HEADERS_FILE ]]; then
    rm -f -- "$GITHUB_HEADERS_FILE"
  fi
  GITHUB_HEADERS_FILE=$(mktemp "${TMPDIR:-/tmp}/dshml-gh-headers.XXXXXX")
  chmod 600 "$GITHUB_HEADERS_FILE"
  {
    printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN_VALUE"
    printf 'Accept: application/vnd.github+json\n'
    printf 'X-GitHub-Api-Version: 2022-11-28\n'
    printf 'User-Agent: %s\n' "$PKG"
  } >"$GITHUB_HEADERS_FILE"
}

github_token_from_env() {
  if [[ -n ${GH_TOKEN:-} ]]; then
    printf '%s' "$GH_TOKEN"
  elif [[ -n ${GITHUB_TOKEN:-} ]]; then
    printf '%s' "$GITHUB_TOKEN"
  fi
}

github_validate_token() { # github_validate_token <token> <slug>; own temp headers, prints "user permission"
  local token=$1 slug=$2 tmp user permissions
  tmp=$(mktemp "${TMPDIR:-/tmp}/dshml-gh-probe.XXXXXX")
  chmod 600 "$tmp"
  {
    printf 'Authorization: Bearer %s\n' "$token"
    printf 'Accept: application/vnd.github+json\n'
    printf 'X-GitHub-Api-Version: 2022-11-28\n'
    printf 'User-Agent: %s\n' "$PKG"
  } >"$tmp"

  user=$(curl --silent --show-error --fail --connect-timeout 10 --max-time 30 \
    -H @"$tmp" "https://api.github.com/user") || {
    rm -f -- "$tmp"
    return 1
  }
  user=$(printf '%s' "$user" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).login))') || {
    rm -f -- "$tmp"
    return 1
  }
  permissions=$(curl --silent --show-error --fail --connect-timeout 10 --max-time 30 \
    -H @"$tmp" "https://api.github.com/repos/$slug") || {
    rm -f -- "$tmp"
    return 1
  }
  permissions=$(printf '%s' "$permissions" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s)
  if (!r.permissions) { console.log("none"); return }
  const p = r.permissions
  console.log(p.admin ? "admin" : p.maintain ? "maintain" : p.push ? "push" : p.triage ? "triage" : "pull")
})') || {
    rm -f -- "$tmp"
    return 1
  }
  rm -f -- "$tmp"
  printf '%s %s\n' "$user" "$permissions"
}

github_validate_gh() { # prints "<user> <permission>"
  local user permissions
  user=$(gh api user --jq .login 2>/dev/null) || return 1
  permissions=$(gh api "repos/$REPO_SLUG" --jq '.permissions | if .admin then "admin" elif .maintain then "maintain" elif .push then "push" else "read" end' 2>/dev/null) || return 1
  printf '%s %s\n' "$user" "$permissions"
}

github_api_status() { # github_api_status <METHOD> <path>; prints the HTTP status
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 15 --max-time 60 \
    -H @"$GITHUB_HEADERS_FILE" -X "$1" "https://api.github.com$2"
}

github_release_by_tag() {
  case ${GITHUB_MODE:-} in
    gh) gh api "repos/$REPO_SLUG/releases/tags/$TAG" 2>/dev/null ;;
    token)
      curl --silent --show-error --fail --connect-timeout 15 --max-time 60 \
        -H @"$GITHUB_HEADERS_FILE" "https://api.github.com/repos/$REPO_SLUG/releases/tags/$TAG" 2>/dev/null
      ;;
    *) return 1 ;;
  esac
}

# ------------------------------------------------------------------- tools --

detect_edge() {
  local candidate
  if [[ -n ${EDGE:-} ]]; then
    [[ -x $EDGE ]] || die "EDGE=$EDGE is not an executable file (verify:dom needs an absolute path)"
    printf '%s\n' "$EDGE"
    return 0
  fi
  for candidate in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge msedge; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  for candidate in \
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
    if [[ -x $candidate ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

detect_live_url() {
  if [[ -n ${LIVE_URL:-} ]]; then
    printf '%s\n' "$LIVE_URL"
    return 0
  fi
  if [[ -n ${DSH_WEB_URL:-} ]]; then
    printf '%s\n' "$DSH_WEB_URL"
    return 0
  fi
  return 1
}

# -------------------------------------------------------------------- pack --

pack_release() {
  local tgz
  step "Pack the release asset"
  info "running pnpm pack from the tagged tree..."
  (cd -- "$REPO_ROOT" && pnpm pack --pack-destination "$RELEASE_TMPDIR" >/dev/null) ||
    die "pnpm pack failed"
  tgz=$(find "$RELEASE_TMPDIR" -maxdepth 1 -name '*.tgz' -print -quit)
  [[ -n $tgz ]] || die "pnpm pack produced no tarball"
  mv -- "$tgz" "$RELEASE_TMPDIR/$ASSET_NAME"
  ASSET_PATH="$RELEASE_TMPDIR/$ASSET_NAME"

  PACK_SHA256=$(sha256sum "$ASSET_PATH" | cut -d' ' -f1)
  PACK_SHA1=$(sha1sum "$ASSET_PATH" | cut -d' ' -f1)
  PACK_INTEGRITY=$(node -e '
const { createHash } = require("node:crypto")
const { readFileSync } = require("node:fs")
const body = readFileSync(process.argv[1])
process.stdout.write("sha512-" + createHash("sha512").update(body).digest("base64"))
' "$ASSET_PATH")
  PACK_BYTES=$(wc -c <"$ASSET_PATH" | tr -d ' ')
  PACK_FILES=$(tar -tzf "$ASSET_PATH" | wc -l | tr -d ' ')

  ok "asset: $ASSET_PATH"
  info "bytes       $PACK_BYTES"
  info "files       $PACK_FILES"
  info "sha256      $PACK_SHA256"
  info "sha1        $PACK_SHA1"
  info "integrity   $PACK_INTEGRITY"
}

compare_pack_with_registry() {
  npm_read_dist
  if [[ $NPM_SHASUM == "$PACK_SHA1" ]]; then
    ok "asset is byte-identical to the published npm tarball"
    return 0
  fi
  warn "asset SHA-1 $PACK_SHA1 differs from the registry tarball $NPM_SHASUM"
  warn "using the registry tarball as the release asset keeps them byte-identical"
  if confirm "download the published tarball and attach that instead?"; then
    curl --silent --show-error --fail --location --connect-timeout 15 --max-time 300 \
      "$(registry_u)/$PKG/-/$(basename -- "$PKG")-$VERSION.tgz" -o "$RELEASE_TMPDIR/$ASSET_NAME" ||
      die "cannot download the published tarball"
    ASSET_PATH="$RELEASE_TMPDIR/$ASSET_NAME"
    PACK_SHA256=$(sha256sum "$ASSET_PATH" | cut -d' ' -f1)
    PACK_SHA1=$(sha1sum "$ASSET_PATH" | cut -d' ' -f1)
    PACK_BYTES=$(wc -c <"$ASSET_PATH" | tr -d ' ')
    PACK_FILES=$(tar -tzf "$ASSET_PATH" | wc -l | tr -d ' ')
    ok "asset replaced with the registry tarball"
  else
    warn "keeping the locally packed tarball; the release notes must not claim byte-identity"
  fi
}

# ---------------------------------------------------------------- summary --

print_release_summary() {
  step "Release summary"
  info "package    $PKG"
  info "version    $VERSION"
  info "tag        $TAG"
  info "commit     $(git rev-parse --short HEAD)"
  [[ -n ${ASSET_PATH:-} ]] && info "asset      $(basename -- "$ASSET_PATH") (${PACK_BYTES:-?} bytes, sha256 ${PACK_SHA256:-?})"
  [[ -n ${NPM_SHASUM:-} ]] && info "npm        sha1 $NPM_SHASUM"
  [[ -n ${GITHUB_RELEASE_URL:-} ]] && info "release    $GITHUB_RELEASE_URL"
  return 0
}
