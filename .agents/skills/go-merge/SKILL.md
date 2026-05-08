---
name: go-merge
description: Use when the user asks to merge a completed local worktree branch back to develop without a PR, mark an associated Linear issue done, and clean up the worktree and branch. Also use when the user says "go-merge".
---

# Go Merge

Merge a completed local worktree branch back to local `develop`, then remove the worktree and merged branch without losing work.

## Scope

Use this when the user wants a local merge instead of a PR. It is for feature or bugfix worktrees, not the main repo worktree.

The expected main worktree for this repo is `/Users/dwitt/Workspace/braket-tickets`, and it should be on `develop`. If it is not on `develop`, stop and report the mismatch before merging.

## Non-Negotiables

- Do not push, rebase, reset, stash, force-delete, or checkout files.
- Do not merge from a dirty source branch. Commit owned work first, preferably with `go-commit`.
- Do not merge into a dirty `develop` worktree. Stop and report the blocking files.
- Use `git merge --no-verify <branch>` when merging into `develop`.
- Mark a Linear issue Done only after the merge succeeds. If no Linear issue was provided or discoverable, skip Linear silently.
- Remove the source worktree only after the merge succeeds and the source branch is fully merged.
- Delete the source branch only with normal `git branch -d`, never `git branch -D`.
- Do not use `git worktree remove --force`. If cleanup is blocked by untracked files, inspect them first.

## Workflow

1. Record the starting point:
   - `git rev-parse --show-toplevel`
   - `git branch --show-current`
   - `git status --short`
   - `git rev-parse HEAD`
   - `git worktree list --porcelain`
2. Confirm source branch:
   - It must not be `develop`, `main`, or empty.
   - It should be checked out in a non-main worktree.
   - If `git status --short` is not clean, commit owned changes first or ask if ownership is ambiguous.
3. Find target `develop` worktree:
   - Prefer `/Users/dwitt/Workspace/braket-tickets` when it is part of this repo.
   - Otherwise use the worktree listed for `branch refs/heads/develop`.
   - If no local `develop` worktree exists, stop and ask.
4. Check target safety:
   - In the target worktree, verify `git branch --show-current` is `develop`.
   - Verify `git status --short` is clean.
   - Verify the source branch exists and points to the expected source commit.
5. Merge locally:
   - `git merge --no-verify <source-branch>`
   - If conflicts occur, resolve them carefully in the target `develop` worktree.
   - After resolving, run targeted validation for conflicted areas when practical, then complete the merge commit with `git commit --no-verify`.
   - If conflicts are unclear or risk dropping work, stop and report the conflicted files and why they need user input.
6. Verify merge:
   - `git status --short` in `develop` is clean.
   - `git branch --merged develop` includes the source branch.
   - `git log --oneline --decorate -n 5` shows the merge or fast-forward result.
7. Mark Linear Done:
   - If a Linear issue identifier was provided by the user or clearly present in the branch/task context, mark it `Done` with the available Linear tool.
   - If no issue is known, do nothing. Do not ask only for Linear.
8. Cleanup:
   - Return to a safe directory outside the source worktree, usually the target `develop` worktree.
   - Remove the source worktree: `git worktree remove <source-worktree-path>`.
   - If removal fails, inspect `git -C <source-worktree-path> status --short --ignored`.
   - Delete only clearly generated or dependency artifacts, such as `node_modules/`, `.angular/cache/`, `dist/`, `coverage/`, or `reports/`, then retry worktree removal.
   - If unknown untracked files remain, stop and report them instead of forcing removal.
   - Delete the source branch only after worktree removal succeeds: `git branch -d <source-branch>`.
   - Run `git worktree list` and `git branch --list <source-branch>` to confirm cleanup.

## Conflict Handling

Merge conflicts are allowed, but work loss is not.

- Inspect each conflicted file with `git status --short` and the conflict markers.
- Keep both sides unless the correct resolution is obvious from tests, types, or surrounding code.
- Do not choose ours/theirs wholesale for convenience.
- Do not clean up the source worktree or delete the branch while the merge is unresolved.
- If the merge cannot be completed safely, leave the source worktree and branch intact and report exact next steps.

## Red Flags

- The current directory is `/Users/dwitt/Workspace/braket-tickets` and the current branch is not `develop`.
- The target `develop` worktree has unrelated changes.
- The source worktree has uncommitted changes that have not gone through `go-commit`.
- The source worktree has unknown untracked files during cleanup.
- `git branch --merged develop` does not list the source branch after merge.
- You are tempted to use `git branch -D`, `git reset`, `git stash`, or `git worktree remove --force`.
- Linear is marked Done before the merge succeeds.
- Cleanup is skipped because the merge was the main goal.

## Common Rationalizations

| Excuse | Reality |
| --- | --- |
| "The branch merged, cleanup can wait." | Cleanup is part of the task. Verify safety, then remove the worktree and delete the merged branch. |
| "The worktree remove failed, so I'll force it." | A failed removal may mean uncommitted or untracked work. Stop and inspect. |
| "Untracked files are probably generated." | Verify them. Only remove known generated or dependency artifacts; preserve unknown files. |
| "The main worktree is probably develop." | Verify it. Merging into the wrong branch is worse than stopping. |
| "Conflicts are small, choose ours/theirs." | Conflict resolution needs file-level reasoning. Escalate when the correct result is unclear. |
| "The user mentioned a Linear bug, mark it done now." | Mark Done only after the local merge succeeds. |

## Report Back

Report the source branch, source worktree path, target `develop` path, merge commit or fast-forward commit, Linear update if any, cleanup results, and any validation run. If cleanup was blocked, report exactly what remains and why.
