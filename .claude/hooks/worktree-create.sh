#!/usr/bin/env bash
#
# WorktreeCreate hook for Claude Code.
#
# Forces all agent worktrees to branch from `origin/develop` instead of
# `origin/main` (Claude Code's default, which ignores the local checkout).
#
# Workaround for https://github.com/anthropics/claude-code/issues/23622
#
# Input (via stdin, JSON):
#   { name: string, cwd: string, ... }
#
# Output (stdout):
#   The absolute path to the created worktree.
#
# Exit non-zero on failure to abort worktree creation.
set -euo pipefail

INPUT="$(cat)"
WORKTREE_NAME="$(printf '%s' "$INPUT" | jq -r '.name')"
BASE_PATH="$(printf '%s' "$INPUT" | jq -r '.cwd')"

if [[ -z "$WORKTREE_NAME" || "$WORKTREE_NAME" == "null" ]]; then
  echo "worktree-create hook: missing .name in input" >&2
  exit 1
fi
if [[ -z "$BASE_PATH" || "$BASE_PATH" == "null" ]]; then
  echo "worktree-create hook: missing .cwd in input" >&2
  exit 1
fi

WORKTREE_PATH="$BASE_PATH/.claude/worktrees/$WORKTREE_NAME"
BRANCH_NAME="worktree-$WORKTREE_NAME"

# Make sure we have the latest develop ref before branching from it.
git -C "$BASE_PATH" fetch origin develop --quiet >&2 || true

# If the branch already exists (e.g. retry), reuse it; otherwise create it.
if git -C "$BASE_PATH" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git -C "$BASE_PATH" worktree add "$WORKTREE_PATH" "$BRANCH_NAME" >&2
else
  git -C "$BASE_PATH" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" origin/develop >&2
fi

echo "$WORKTREE_PATH"
