---
description: Instructions for autonomous agent sessions (headless Claude Code)
---

# Autonomous Mode

When you are running autonomously (no interactive user — e.g.,
headless `claude -p`, or any non-interactive session), follow these rules:

## Use the /go Skill

Invoke the `/go` skill with the Linear issue identifier. The `/go` skill defines
the full development pipeline including research, planning, implementation,
verification, and code review.

## Skip All Pause Points

The `/go` skill has pause points (⏸) for interactive approval. In autonomous mode,
proceed through ALL of them without waiting:

1. **Brainstorm questions** — Make reasonable assumptions based on the ticket
   description, codebase conventions, and CLAUDE.md instructions. Do NOT ask
   clarifying questions.
2. **Plan approval** — Auto-approve the plan you generate. If the plan looks
   risky (touches payments, auth, or production config), scale down scope rather
   than pausing.
3. **Code review findings** — Fix all high-severity issues automatically.
   Skip cosmetic suggestions.
4. **Land confirmation** — Commit automatically after verification passes.

## Safety Boundaries

Even in autonomous mode, NEVER:

- Push to `main` or deploy to production
- Modify payment processing logic without explicit ticket instructions
- Delete data or drop database tables
- Modify environment files or secrets
- Skip `pnpm validate` before committing

## How to Detect Autonomous Mode

You are in autonomous mode if ANY of these are true:

- The prompt contains a Linear issue and no interactive user is present
- You were started with `--dangerously-skip-permissions` or `--print` flags
- There is no user responding to your questions after your first message
