---
name: go-commit
description: Use when the user asks to commit, finish, land, or save only the current session's changes while unrelated working-tree changes may exist. Also use when the user says "go-commit".
---

# Go Commit

Commit only the changes owned by the current session. The boundary is authorship across the whole session, not whatever happens to be modified, staged, or mentioned in the latest turn.

## Session Scope

"Current session" means the entire task thread since the user started the work being finished:

- Include implementation, tests, docs, review fixes, follow-up fixes, and cleanup from earlier turns.
- Include work done before a context compaction when the summary or conversation history indicates it belongs to this task.
- Do not narrow scope to the latest fix, latest review response, latest prompt, or files touched since compaction.
- Do not include unrelated changes from other agents, other tasks, or earlier abandoned work just because they are in the same worktree.
- When compaction or a long session makes ownership unclear, reconstruct the owned set from summaries, prior tool output, changed-file lists, and direct diff review. Ask only if evidence is still ambiguous.

## Non-Negotiables

- Never use broad staging or committing: `git add .`, `git add -A`, `git add -u`, or `git commit -a`.
- Never use `git stash`, destructive resets, worktree restore commands, or file checkout to isolate the commit.
- Existing staged changes are not automatically yours. Inspect them before committing.
- Stage or commit only paths and hunks you can attribute to the whole current session from conversation history, compaction summaries, tool output, and direct diff review.
- If ownership is ambiguous, ask. Do not guess.

## Workflow

1. Inspect state with `git status --short` and identify:
   - owned paths from the whole session, including pre-compaction and earlier review/fix turns
   - unrelated paths to leave untouched
   - any pre-existing staged changes
   - whether the latest turn is only a subset of the session's work
2. Review every owned diff before staging: `git diff -- <path>` and, if staged content exists, `git diff --cached -- <path>`.
3. Stage deliberately:
   - Whole owned path: `git add -- <path>`.
   - Owned hunks inside a mixed file: stage only those hunks. Prefer a small non-interactive patch applied to the index with `git apply --cached`; remove any temporary patch file afterward.
   - Untracked file: stage only if it was created in this session.
4. If unrelated changes are already staged, do not commit them. Use `git commit --only -- <owned-paths>` only when every owned path can be committed as a whole-file change. For mixed-hunk commits with unrelated staged content, stop and ask for direction.
5. Verify before committing:
   - `git diff --cached --name-status`
   - `git diff --cached --stat`
   - `git diff --cached` when the staged diff is small enough to inspect
6. Commit with a Conventional Commit message. After commit, run `git status --short` and confirm unrelated files remain uncommitted.

## Commit Message

Use `<type>(<scope>): <description>` when a scope is clear. Common types:

| Type | Use |
| --- | --- |
| `feat` | user-visible capability |
| `fix` | bug fix |
| `test` | tests only |
| `docs` | docs or skill changes |
| `chore` | tooling or maintenance |

## Red Flags

- You are about to stage a file you did not inspect.
- A file contains both your changes and someone else's changes.
- `git diff --cached` shows paths outside the current session.
- You are about to commit only the last review fix and omit earlier implementation or tests from the same session.
- You assume compaction reset the ownership boundary.
- A hook fails on unrelated files and you are tempted to stash or rewrite the worktree.
- You cannot explain why each staged path belongs in this commit.

## Common Rationalizations

| Excuse | Reality |
| --- | --- |
| "The user said commit, so all modified files are fair game." | In a shared worktree, modified files may belong to other sessions. Commit only current-session work. |
| "The latest turn only changed a small fix, so only that fix should be committed." | The commit should include all owned work from the whole session unless the user narrows the scope. |
| "The conversation compacted, so only post-compaction changes count." | Compaction does not reset session ownership. Use the summary and available evidence to reconstruct the full owned set. |
| "Untracked files are probably mine." | Untracked files are the easiest to steal from another session. Stage them only with evidence. |
| "This file has one of my changes, so staging the whole file is fine." | Mixed files require hunk-level staging or a pause for clarification. |
| "`git add .` is faster and I can check afterward." | Broad staging is the failure mode this skill exists to prevent. |
| "I can stash unrelated changes temporarily." | Stashing rewrites shared working state and can clobber another session. Do not use it. |

## Report Back

After committing, report the commit hash, the committed paths, the verification performed, and that unrelated working-tree changes were left untouched.
