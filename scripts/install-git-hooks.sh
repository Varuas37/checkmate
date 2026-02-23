#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"
COMMIT_MSG_HOOK="$HOOKS_DIR/commit-msg"
ENFORCEMENT_CONFIG_DIR="$REPO_ROOT/.checkmate"
ENFORCEMENT_CONFIG_FILE="$ENFORCEMENT_CONFIG_DIR/enforcement.json"
HOOK_MARKER="# checkmate-managed: commit-msg-hook-v1"
REMOVE_MODE=0
ENFORCEMENT_LEVEL="off"

print_usage() {
  cat <<'USAGE'
Usage:
  scripts/install-git-hooks.sh --level <off|basic|strict>
  scripts/install-git-hooks.sh --remove

Examples:
  scripts/install-git-hooks.sh --level basic
  scripts/install-git-hooks.sh --level strict
  scripts/install-git-hooks.sh --level off
  scripts/install-git-hooks.sh --remove
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)
      if [[ $# -lt 2 ]]; then
        echo "hooks install failed: missing value for --level" >&2
        exit 1
      fi
      ENFORCEMENT_LEVEL="$2"
      shift 2
      ;;
    --remove)
      REMOVE_MODE=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "hooks install failed: unknown argument '$1'" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [[ "$REMOVE_MODE" -eq 0 ]]; then
  case "$ENFORCEMENT_LEVEL" in
    off|basic|strict) ;;
    *)
      echo "hooks install failed: unsupported enforcement level '$ENFORCEMENT_LEVEL'" >&2
      exit 1
      ;;
  esac
fi

current_hooks_path="$(git -C "$REPO_ROOT" config --local --get core.hooksPath || true)"

unset_repo_hooks_path_if_managed() {
  if [[ "$current_hooks_path" == ".githooks" || "$current_hooks_path" == "$HOOKS_DIR" ]]; then
    git -C "$REPO_ROOT" config --local --unset core.hooksPath || true
  fi
}

write_enforcement_config() {
  local level="$1"
  mkdir -p "$ENFORCEMENT_CONFIG_DIR"
  cat > "$ENFORCEMENT_CONFIG_FILE" <<EOF
{
  "schema_version": "checkmate.enforcement.v1",
  "x-checkmate-managed": true,
  "level": "$level"
}
EOF
}

cleanup_enforcement_config_if_managed() {
  if [[ -f "$ENFORCEMENT_CONFIG_FILE" ]] && grep -Fq '"x-checkmate-managed": true' "$ENFORCEMENT_CONFIG_FILE"; then
    rm -f "$ENFORCEMENT_CONFIG_FILE"
  fi
  rmdir "$ENFORCEMENT_CONFIG_DIR" >/dev/null 2>&1 || true
}

cleanup_managed_hook_file() {
  if git -C "$REPO_ROOT" ls-files --error-unmatch ".githooks/commit-msg" >/dev/null 2>&1; then
    return
  fi

  if [[ -f "$COMMIT_MSG_HOOK" ]] && grep -Fq "$HOOK_MARKER" "$COMMIT_MSG_HOOK"; then
    rm -f "$COMMIT_MSG_HOOK"
  fi
  rmdir "$HOOKS_DIR" >/dev/null 2>&1 || true
}

if [[ "$REMOVE_MODE" -eq 1 ]]; then
  unset_repo_hooks_path_if_managed
  cleanup_managed_hook_file
  cleanup_enforcement_config_if_managed
  echo "Removed checkmate-managed commit hook enforcement."
  exit 0
fi

write_enforcement_config "$ENFORCEMENT_LEVEL"

if [[ "$ENFORCEMENT_LEVEL" == "off" ]]; then
  unset_repo_hooks_path_if_managed
  echo "Commit hook enforcement set to off."
  exit 0
fi

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "hooks install failed: missing $HOOKS_DIR" >&2
  exit 1
fi

if [[ ! -f "$COMMIT_MSG_HOOK" ]]; then
  echo "hooks install failed: missing $COMMIT_MSG_HOOK" >&2
  exit 1
fi

if ! grep -Fq "$HOOK_MARKER" "$COMMIT_MSG_HOOK"; then
  echo "hooks install failed: $COMMIT_MSG_HOOK is not checkmate-managed." >&2
  exit 1
fi

chmod +x "$COMMIT_MSG_HOOK"
git -C "$REPO_ROOT" config --local core.hooksPath .githooks

echo "Commit hook enforcement enabled: $ENFORCEMENT_LEVEL"
echo "Installed git hooks path: .githooks"
