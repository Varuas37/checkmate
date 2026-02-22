#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"
COMMIT_MSG_HOOK="$HOOKS_DIR/commit-msg"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "hooks install failed: missing $HOOKS_DIR" >&2
  exit 1
fi

if [[ ! -f "$COMMIT_MSG_HOOK" ]]; then
  echo "hooks install failed: missing $COMMIT_MSG_HOOK" >&2
  exit 1
fi

chmod +x "$COMMIT_MSG_HOOK"
git -C "$REPO_ROOT" config core.hooksPath .githooks

echo "Installed git hooks path: .githooks"
echo "commit-msg hook: enabled"
