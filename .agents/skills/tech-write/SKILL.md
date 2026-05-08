---
name: tech-write
description: Use when writing documentation from scratch, reviewing existing docs for technical writing quality, or rewriting text for clarity. Covers knowledge base articles, guides, tutorials, READMEs, and user-facing copy.
---

# Technical Writing

<mode-detection>

Detect mode from user intent:

| Signal | Mode |
|--------|------|
| "write docs for...", "document how...", "create a guide for..." | **Write** |
| "review this doc", "check this for...", points at existing file | **Review** |
| "rewrite this", "improve this doc", "fix this writing" | **Rewrite** |
| Ambiguous | Ask the user which mode they want |

</mode-detection>

<context-loading>

Load reference files selectively per pipeline step. Use paths relative to this skill directory. Loading all files at once degrades quality.

**Project voice:** Check the project root for `.impeccable.md`, `STYLE.md`, `VOICE.md`, or `WRITING.md`. If found, Read it as a tone/vocabulary override. If none exist, use neutral technical style.

</context-loading>

## Write Pipeline

1. **Brief** — Read `reference/base-rules.md` and the project voice file (if found). Gather topic, audience, scope, and prerequisites. Ask for anything missing.
2. **Outline** — Read `templates/outline.md`. Generate an outline using that skeleton. Present for user approval before proceeding.
3. **Draft** — Write full prose following base rules and project voice. Output to conversation, not to a file.
4. **Self-Review** — Three sequential evaluation passes. Each pass: Read the rubric, evaluate the draft, produce findings per the output format below.
   - Pass 1: Read `reference/rubric-structure.md`
   - Pass 2: Read `reference/rubric-clarity.md`
   - Pass 3: Read `reference/rubric-voice.md`
   - Conditional: Read `reference/rubric-accessibility.md` only if the draft contains images, links, tables, or code blocks
5. **Revise** — Apply all Error and Warning findings in a single pass. Show what changed.
6. **Confirm** — Present the revised draft. Write to file only after user approval.

## Review Pipeline

1. Read the target file.
2. Run each rubric sequentially against the original text (structure, clarity, voice, then accessibility if the document contains images, links, tables, or code). Read one rubric per pass. Make zero modifications between passes.
3. Aggregate into a single report with a summary header:
   - Total errors, warnings, and suggestions
   - Verdict: **pass** (0 errors, 0 warnings), **warn** (0 errors, 1+ warnings), or **fail** (1+ errors)
4. Present the report. Make zero modifications to the file.

## Rewrite Pipeline

1. Run the full Review pipeline on the target file.
2. Batch all findings. Apply Error and Warning fixes in a single editing pass. Append Suggestions as "Remaining suggestions" in the summary.
3. Re-run Review on the modified text. If new issues appear, apply one more fix pass.
4. Cap at 2 total fix iterations.
5. Show a change summary: what changed, why, and remaining suggestions.

## Output Format

Each rubric produces findings in this structure:

```
## [Dimension] — [pass/warn/fail]

### Errors (N)
- Line X: [issue]. Fix: [positive instruction].

### Warnings (N)
- Line X: [issue]. Fix: [positive instruction].

### Suggestions (N)
- Line X: [issue]. Consider: [alternative].
```

Use positive fix instructions ("use X" rather than "remove Y"). Every finding references a line number and a concrete action.
