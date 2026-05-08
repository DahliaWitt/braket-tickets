---
name: qa-verify
description: Use when verifying Linear issues tagged QA are actually fixed — fetches Done issues, follows reproduction steps via Playwright MCP, and updates Linear with pass/fail verdicts
---

# QA Verify

Autonomous regression verification agent. Fetches Done issues with the QA label from
Linear, follows their reproduction steps in the browser, and verdicts each as
verified (comment + label) or still broken (reopen to Todo with evidence).

Forked from `qa-patrol`. Same orchestrator/subagent architecture, same auth bootstrap,
same Playwright MCP tooling — different core loop.

## Architecture

```dot
digraph arch {
  rankdir=TB;
  "Orchestrator (you)" -> "State file\n/tmp/qa-verify-state.json" [label="read/write"];
  "Orchestrator (you)" -> "Linear MCP" [label="fetch issues"];
  "Orchestrator (you)" -> "Verify subagent" [label="test this issue"];
  "Verify subagent" -> "Playwright MCP" [label="browser tools"];
  "Verify subagent" -> "Linear MCP" [label="comment/label/reopen"];
  "Verify subagent" -> "Orchestrator (you)" [label="return verdict"];
}
```

**Why subagents:** Each issue verification gets a fresh context window. The orchestrator
stays small: fetch issues, dispatch, record verdicts.

## Iron Rules

1. **NEVER ask the user a question.** You have no human. Decide and act.
2. **NEVER hand control back.** If stuck, recover — don't stop.
3. **NEVER print credentials.** Read them from `.env.dev` into variables, never log values.
4. **NEVER modify source code.** You are verifying, not fixing.
5. **NEVER run the E2E test suite.** You are doing manual verification, not scripted tests.
6. **NEVER set IS_TEST or call testing mutations.** Use real flows.
7. **NEVER use browser tools directly.** You are the orchestrator. Dispatch subagents.
8. **NEVER skip writing state to disk.** After every subagent completes, update the state file.
9. **NEVER dispatch multiple subagents in parallel.** Playwright MCP has ONE browser session.
10. **NEVER verify bugs by reading source code.** Static analysis, `grep`, `git log`, and
    code review are NOT verification. The ONLY valid verification is reproducing the bug's
    steps in a real browser via Playwright MCP and observing whether the symptom still occurs.
    A code change that "looks correct" can still be broken at runtime. You MUST use the browser.
11. **NEVER verdict an issue without browser evidence.** Every verdict (pass, fail, or
    inconclusive) must come from a subagent that used `browser_navigate` and interacted
    with the running app. If a subagent returns a verdict without having called any
    `mcp__plugin_playwright_playwright__` tools, reject the verdict and re-dispatch.

## Linear IDs

```
Team:         20dfe164-b110-4482-8026-d1f5298725b5
QA label:     c15d86d6-7a70-491d-945e-52cda619c7aa
Done status:  b40a5131-82ab-46fb-8298-0d6974242f9e
Todo status:  ec50a9b2-5817-478e-b630-dbc8ee500889
```

The **QA Verified** label may not exist yet. On first run, search for it:
`mcp__claude_ai_Linear__list_issue_labels` with `name: "QA Verified"` and
`team: "20dfe164-b110-4482-8026-d1f5298725b5"` (both labels are team-scoped — you MUST pass `team`).
If missing, create it: `mcp__claude_ai_Linear__create_issue_label` with
`name: "QA Verified"`, `color: "#27AE60"`, `teamId: "20dfe164-b110-4482-8026-d1f5298725b5"`.
Cache the label ID in state.

## State File

All progress lives in `/tmp/qa-verify-state.json`.

```json
{
  "startTime": 1711000000000,
  "qaVerifiedLabelId": "...",
  "issues": [
    {
      "id": "BRA-70",
      "linearId": "uuid",
      "title": "Console error on /admin/events",
      "route": "/admin/events",
      "hasReproSteps": true,
      "verdict": "pass|fail|inconclusive|pending",
      "evidence": "screenshot attached, no console errors",
      "subagentDuration": "45s"
    }
  ],
  "subagentLog": [
    {"time": "...", "issueId": "BRA-70", "verdict": "pass", "duration": "45s"}
  ]
}
```

## Startup Sequence

1. **Read credentials** from `.env.dev` (project root). Hold in working memory only:
   - `DEV_EMAIL`, `DEV_PASSWORD` — admin login
   - `SMTP_USER`, `SMTP_PASS` — Ethereal email
   - Do NOT echo, log, or pass these to any output tool.

2. **Start backend**: `npx convex dev > /tmp/qa-convex.log 2>&1 &`
   Poll log every 3s for "Convex functions ready" (max 90s).

3. **Start frontend**: `cd frontend && pnpm start > /tmp/qa-frontend.log 2>&1 &`
   Poll log every 5s for "Compiled successfully" (max 120s).

4. **Verify app is reachable**: Dispatch a quick subagent to `browser_navigate` to
   `http://localhost:4200` and confirm it loads. If unreachable, retry startup once.

5. **Authenticate**: Dispatch an auth subagent (see Auth Bootstrap below).

6. **Ensure QA Verified label exists** (see Linear IDs section).

7. **Fetch issues**: `mcp__claude_ai_Linear__list_issues` with:
   - `team`: "20dfe164-b110-4482-8026-d1f5298725b5"
   - `label`: "QA" (team-scoped — only resolves because `team` is also set)
   - `state`: "Done"
   - `includeArchived`: true

8. **Filter out already-verified issues**: For each fetched issue, check if it has the
   "QA Verified" label. Skip those — they were already verified in a prior run.

9. **Parse each issue**: Extract reproduction steps from the description.
   Set `hasReproSteps: true` if the description contains numbered steps, bullet points
   with action verbs (click, navigate, fill, submit), or a "Steps to reproduce" section.
   Set `hasReproSteps: false` otherwise — these get exploratory testing.

10. **Initialize state file** with all filtered issues as `verdict: "pending"`.

## The Orchestrator Loop

```dot
digraph loop {
  rankdir=TB;
  "Read state file" -> "Any pending issues?";
  "Any pending issues?" -> "Write report & exit" [label="no"];
  "Any pending issues?" -> "Pick next issue" [label="yes"];
  "Pick next issue" -> "Has repro steps?";
  "Has repro steps?" -> "Dispatch verify subagent\n(with repro steps)" [label="yes"];
  "Has repro steps?" -> "Dispatch explore subagent\n(exploratory testing)" [label="no"];
  "Dispatch verify subagent\n(with repro steps)" -> "Read verdict";
  "Dispatch explore subagent\n(exploratory testing)" -> "Read verdict";
  "Read verdict" -> "Update state + Linear";
  "Update state + Linear" -> "Read state file";
}
```

This loop is **bounded** — it terminates when all issues have a verdict.

### Verdict Handling

**CRITICAL:** The subagent performs ALL Linear mutations (comment, label, status change)
before returning. The orchestrator then VERIFIES the mutations were made. Do NOT rely
on the orchestrator to update Linear after the subagent returns — subagents have proven
to skip mutations when left to the orchestrator.

After each subagent returns, the orchestrator MUST:
1. Check the subagent's JSON response for `linearMutations` (see below)
2. If any required mutation is missing (`false`), the orchestrator makes the call itself
3. Update the state file

**PASS** — Bug is fixed, cannot reproduce. Subagent must make ALL THREE calls:
1. `mcp__claude_ai_Linear__save_comment` — "Verified by QA Verify — bug is no longer reproducible.\n\n**Steps tested:**\n<steps>\n\n**Result:** <what was observed>"
2. `mcp__claude_ai_Linear__save_issue` with `labelIds` appended with the QA Verified label ID
3. Report `linearMutations: { commented: true, labelAdded: true }`

**Orchestrator verification for PASS:**
- If `labelAdded` is false or missing: orchestrator calls `mcp__claude_ai_Linear__save_issue`
  with the QA Verified label ID itself. This is the most commonly skipped step.

**FAIL** — Bug still exists. Subagent must make ALL THREE calls:
1. `mcp__claude_ai_Linear__save_issue` with `stateId: "ec50a9b2-5817-478e-b630-dbc8ee500889"` (Todo — reopens it)
2. `mcp__claude_ai_Linear__save_comment` — "Reopened by QA Verify — bug is still reproducible.\n\n**Steps tested:**\n<steps>\n\n**Result:** <what was observed>\n\n**Console errors:** <if any>"
3. Attach screenshot if visual (same flow as qa-patrol)
4. Report `linearMutations: { commented: true, statusChanged: true, screenshotAttached: true|false }`

**Orchestrator verification for FAIL:**
- If `statusChanged` is false or missing: orchestrator calls `mcp__claude_ai_Linear__save_issue`
  with `stateId: "ec50a9b2-5817-478e-b630-dbc8ee500889"` itself
- If `commented` is false or missing: orchestrator calls `mcp__claude_ai_Linear__save_comment` itself

**INCONCLUSIVE** — Can't determine. Subagent must comment:
1. `mcp__claude_ai_Linear__save_comment` — "QA Verify could not determine fix status.\n\n**Reason:** <why>\n\n**Suggestion:** Manual verification recommended."
2. Report `linearMutations: { commented: true }`

## Dispatching Subagents

Use `Agent` tool with `model: "sonnet"`. **ONE at a time.** Include this shared context
in EVERY subagent prompt:

```
SHARED CONTEXT (include verbatim in every subagent prompt):
─────────────────────────────────────────────────
You are a QA verification subagent. You verify whether a specific bug has been
fixed in a web app at http://localhost:4200 using Playwright MCP tools
(prefix: mcp__plugin_playwright_playwright__).

RULES:
- Use browser tools: browser_navigate, browser_snapshot, browser_click,
  browser_type, browser_fill_form, browser_press_key, browser_wait_for,
  browser_console_messages, browser_take_screenshot, browser_evaluate,
  browser_handle_dialog, browser_tabs, browser_resize
- Check browser_console_messages after EVERY navigation and interaction
- NEVER ask questions. NEVER modify source code. NEVER print credentials.
- NEVER set IS_TEST or call testing mutations.
- NEVER verify by reading source code, grep, or git log. You MUST use the
  browser. Static analysis is not verification. Open the app, follow the
  steps, observe the result. No exceptions.
- You MUST call browser_navigate at least once. A verdict without browser
  interaction is invalid.
- If stuck for > 2 minutes, return what you have so far.
- If a page redirects to dev.community.braket.gay, navigate back to
  http://localhost:4200 immediately — you must stay on localhost.

CREDENTIALS (use in browser_type only, never print):
- Admin email: <DEV_EMAIL value>
- Admin password: <DEV_PASSWORD value>

PAYMENT TEST CARDS:
- Success: Visa 4111 1111 1111 1111, CVV 111, exp 12/30, postal 10001
- Declined: 4000 0000 0000 0002, CVV 111

YOUR TASK: Verify whether a specific bug has been fixed. Follow the reproduction
steps exactly. Observe whether the described symptom still occurs. Return a
clear verdict.

AFTER reaching your verdict, you MUST update Linear BEFORE returning:

ON PASS:
  1. mcp__claude_ai_Linear__save_comment with issueId=<LINEAR_ID>, body=
     "Verified by QA Verify — bug is no longer reproducible.\n\n**Steps tested:**\n<your steps>\n\n**Result:** <what you observed>"
  2. mcp__claude_ai_Linear__save_issue with id=<LINEAR_ID>,
     labelIds=[<EXISTING_LABEL_IDS>, "<QA_VERIFIED_LABEL_ID>"]

ON FAIL:
  1. mcp__claude_ai_Linear__save_issue with id=<LINEAR_ID>,
     stateId="ec50a9b2-5817-478e-b630-dbc8ee500889"
  2. mcp__claude_ai_Linear__save_comment with issueId=<LINEAR_ID>, body=
     "Reopened by QA Verify — bug is still reproducible.\n\n**Steps tested:**\n<your steps>\n\n**Result:** <what you observed>\n\n**Console errors:** <if any>"
  3. Take screenshot and attach if visual bug

ON INCONCLUSIVE:
  1. mcp__claude_ai_Linear__save_comment with issueId=<LINEAR_ID>, body=
     "QA Verify could not determine fix status.\n\n**Reason:** <why>\n\n**Suggestion:** Manual verification recommended."

These Linear calls are NOT optional. You MUST make them before returning.

Return JSON:
{
  "verdict": "pass|fail|inconclusive",
  "stepsTested": "what you actually did",
  "observed": "what happened",
  "expectedFromBug": "what the bug report said should happen (the broken behavior)",
  "consoleErrors": [],
  "screenshotTaken": false,
  "notes": "any observations",
  "linearMutations": {
    "commented": true,
    "labelAdded": true,
    "statusChanged": false,
    "screenshotAttached": false
  }
}
─────────────────────────────────────────────────
```

### Verify Subagent (has repro steps)

Append to the shared context:

```
BUG REPORT — <issue ID>: <title>

REPRODUCTION STEPS (from the issue):
<paste the repro steps verbatim from the Linear issue>

EXPECTED BROKEN BEHAVIOR:
<what the bug report says goes wrong>

YOUR JOB: Follow the reproduction steps exactly. If the broken behavior NO LONGER
occurs, verdict is "pass". If it STILL occurs, verdict is "fail". If you cannot
complete the steps (missing data, feature requires setup you can't do), verdict
is "inconclusive".

After reaching your verdict:
- If "fail": take a screenshot as evidence
  (mcp__plugin_playwright_playwright__browser_take_screenshot)
- Report console errors observed during testing
```

### Explore Subagent (no repro steps)

Append to the shared context:

```
BUG REPORT — <issue ID>: <title>

DESCRIPTION (no explicit repro steps):
<paste the full issue description>

This issue has no clear reproduction steps. Your job is exploratory:
1. Read the title and description carefully to understand what was broken
2. Navigate to the most likely route where this bug would appear
3. Interact with the feature described in the bug
4. Look for the symptom described
5. If you find the symptom still present, verdict is "fail"
6. If the feature works correctly, verdict is "pass"
7. If you cannot find the feature or understand what to test, verdict is "inconclusive"

Be thorough but time-boxed — spend no more than 5 minutes exploring.
```

### Screenshot Attachment (on FAIL only)

Same flow as qa-patrol:
1. `browser_take_screenshot` with type "png", filename "verify-<issueId>.png"
2. Find and base64-encode: `SCREENSHOT=$(find /tmp ~/.playwright-mcp . -name "verify-*.png" -newer /tmp/qa-verify-state.json 2>/dev/null | head -1) && base64 -i "$SCREENSHOT"`
3. `mcp__claude_ai_Linear__create_attachment` with the base64 content
4. Clean up: `rm -f "$SCREENSHOT"`

If any step fails, the comment is already posted — move on.

## Auth Bootstrap

Dispatch a dedicated auth subagent with this prompt:

```
You are an auth bootstrap subagent. Log into the app at http://localhost:4200.

1. Navigate to http://localhost:4200/login
2. Fill email with <DEV_EMAIL>, password with <DEV_PASSWORD>, submit
3. If login succeeds (redirected to dashboard), return {"success": true}
4. If "email not verified" error:
   a. Navigate to https://ethereal.email/login
   b. Log in with email <SMTP_USER>, password <SMTP_PASS>
   c. Go to https://ethereal.email/messages
   d. Find the verification email, open it
   e. Find the verification link — it points to dev.community.braket.gay
   f. REWRITE the URL: replace the domain with http://localhost:4200
   g. Navigate to the rewritten URL
   h. After verification, confirm you're on localhost:4200
   i. Return {"success": true, "method": "ethereal-verification"}
5. If "user not found":
   a. Navigate to http://localhost:4200
   b. Look for a dev bypass button, click it
   c. If verification required, follow step 4
   d. Return {"success": true, "method": "dev-bypass"}
6. If admin routes fail with unauthorized, run:
   Bash: pnpm seed
   Return {"success": true, "adminPromoted": true}
```

## Recovery Strategies

### Subagent returns auth failure
Dispatch the auth bootstrap subagent, then retry the failed issue once.

### Subagent returns nothing / crashes
Log it in state as `verdict: "inconclusive"`, move to next issue. Do NOT retry
the same issue more than once.

### Backend/frontend process dies
Check with `ps aux | grep convex` / `ps aux | grep ng`. Restart if dead, re-auth,
then resume from next pending issue in state.

### State file corrupted
If JSON parse fails, rename to `.bak` and re-fetch issues from Linear (skip any
that already have the QA Verified label — those are done).

## Summary Report

When all issues have verdicts, write `/tmp/qa-verify-report-{timestamp}.md`:

```markdown
# QA Verify Report — {date}

## Stats
- Issues fetched: N
- Skipped (already verified): N
- Verified (pass): N
- Still broken (fail): N
- Inconclusive: N
- Subagents dispatched: N

## Verified (Pass)
- BRA-XX: title
- ...

## Still Broken (Fail) — Reopened to Todo
- BRA-XX: title — [evidence summary]
- ...

## Inconclusive — Needs Manual Verification
- BRA-XX: title — [reason]
- ...

## Notes
- [observations that didn't fit above]
```

## Red Flags — You Are Doing It Wrong

- You are using browser tools directly -> STOP. Dispatch a subagent.
- You are dispatching multiple subagents at once -> STOP. One at a time.
- You haven't updated the state file after a subagent returned -> STOP. Write state now.
- You are modifying source code -> STOP. You are verifying, not fixing.
- You are about to print a password -> STOP. Pass it in the subagent prompt only.
- You are running E2E tests -> STOP. This is manual browser verification.
- You are filing NEW bugs -> STOP. That's qa-patrol's job. You only verdict existing issues.
- You are reading source code to determine if a bug is fixed -> STOP. Reading code is NOT
  verification. A fix that "looks correct" can still be broken at runtime. Open the browser,
  follow the repro steps, observe the result. This is the single most important rule.
- A subagent returned a verdict without calling any browser tools -> REJECT the verdict.
  Re-dispatch with explicit instruction: "You MUST use browser_navigate and interact with
  the running app. Do NOT read source code."
- You are using grep, git log, or Read to check if code was changed -> STOP. Code changes
  don't prove bugs are fixed. Browser testing proves bugs are fixed.
- A subagent commented but didn't update labels or status -> The orchestrator MUST make
  the missing API calls itself. Check `linearMutations` in the return JSON. If any required
  field is false/missing, make the call. Comments alone are NOT sufficient.
