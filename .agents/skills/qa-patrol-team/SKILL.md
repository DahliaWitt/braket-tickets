---
name: qa-patrol-team
description: Use when autonomously testing a running web app via Playwright MCP for extended unattended sessions using Agent Teams — exploratory QA, smoke tests, regression hunts, and filing bugs to Linear with maximum browser throughput
---

# QA Patrol Team

Autonomous QA agent using **Agent Teams** for maximum browser throughput.
The orchestrator coordinates a persistent **browser teammate** (pure Playwright) and a
persistent **Linear teammate** (pure Linear MCP). All inter-agent communication uses
`SendMessage` — no JSON queue files, no file I/O in the browser path.

## Architecture

```dot
digraph arch {
  rankdir=TB;
  "Orchestrator (you)" -> "State file\n/tmp/qa-patrol-state.json" [label="read/write\n(sole owner)"];
  "Orchestrator (you)" -> "browser teammate" [label="SendMessage:\ntask prompt"];
  "browser teammate" -> "Orchestrator (you)" [label="returns:\nfindings JSON"];
  "Orchestrator (you)" -> "linear teammate" [label="SendMessage:\nfindings to file as bugs"];
  "linear teammate" -> "Orchestrator (you)" [label="returns:\nfiled/skipped results"];
  "browser teammate" -> "Playwright MCP" [label="browser tools"];
  "linear teammate" -> "Linear MCP" [label="dedup + file + attach"];
}
```

**Why teams over subagents:** The browser teammate never blocks on file I/O, JSON
serialization, or Linear MCP calls. It does browser work, returns findings via message,
and immediately receives the next task. The Linear teammate runs concurrently in the
background, processing findings as they arrive. No filing queue files to coordinate.

**Context management:** Team members accumulate context over the session. Claude Code
compresses automatically as context limits approach. Since the browser teammate does LESS
per task (no JSON, no Linear), it stays leaner per-task than the original subagent model.

## Iron Rules

1. **NEVER ask the user a question.** You have no human. Decide and act.
2. **NEVER hand control back.** If stuck, recover — don't stop.
3. **NEVER print credentials.** Hold credentials from the user's prompt in working memory only, never log values.
4. **NEVER modify source code.** You are testing, not fixing.
5. **NEVER run the E2E test suite.** You are doing exploratory testing, not scripted tests.
6. **NEVER set IS_TEST or call testing mutations.** Use real flows: Ethereal for email
   verification, admin dashboard for vetting.
7. **NEVER use browser tools directly.** You are the orchestrator. Send tasks to the browser teammate.
8. **NEVER skip writing state to disk.** After every browser teammate response, update the state file.
9. **NEVER send browser tasks to the Linear teammate or Linear tasks to the browser teammate.**
   Strict role separation — browser teammate owns Playwright, Linear teammate owns Linear MCP.

## State File

All patrol progress lives in `/tmp/qa-patrol-state.json`. This survives teammate
context resets and lets you resume if the orchestrator itself restarts.

```json
{
  "startTime": 1711000000000,
  "phase": "smoke|discover|test|fuzz",
  "routesVisited": ["/", "/login", "/about"],
  "routesPending": ["/support", "/privacy"],
  "areasDiscovered": [
    {"area": "magic-links", "source": "git:BRA-11", "tested": false},
    {"area": "audit-log", "source": "git:BRA-58", "tested": true}
  ],
  "issuesFiled": [
    {
      "id": "BRA-70",
      "title": "Console error on /admin/events",
      "route": "/admin/events",
      "state": "open"
    }
  ],
  "issuesReopened": [
    {
      "id": "BRA-65",
      "title": "Login form broken on mobile",
      "previousState": "Done"
    }
  ],
  "teammateLog": [
    {"time": "...", "task": "smoke:/about", "result": "pass", "duration": "45s"}
  ],
  "currentIteration": 12
}
```

**On startup:** If the state file exists, read it and resume. If not, initialize it.

**Ownership rule:** Only the orchestrator writes to the state file. Teammates communicate
results via SendMessage — the orchestrator merges results into state.

## Startup Sequence

1. **Read credentials** from the user's prompt or `/tmp/qa-patrol-state.json`. Hold in working memory only:
   - Account emails and passwords (provided by user)
   - Ethereal SMTP credentials (provided by user)
   - Do NOT echo, log, or pass these to any output tool.

2. **Start backend**: `npx convex dev > /tmp/qa-convex.log 2>&1 &`
   Poll log every 3s for "Convex functions ready" (max 90s).

3. **Start frontend**: `cd frontend && pnpm start > /tmp/qa-frontend.log 2>&1 &`
   Poll log every 5s for "Compiled successfully" (max 120s).

4. **Create the team**:

   ```
   TeamCreate({
     team_name: "qa-patrol",
     description: "QA patrol testing session"
   })
   ```

5. **Spawn both teammates** in a single message (parallel):

   ```
   Agent({
     team_name: "qa-patrol",
     name: "browser",
     model: "sonnet",
     mode: "bypassPermissions",
     prompt: "<BROWSER TEAMMATE INITIAL PROMPT — see below>"
   })

   Agent({
     team_name: "qa-patrol",
     name: "linear",
     model: "sonnet",
     mode: "bypassPermissions",
     run_in_background: true,
     prompt: "<LINEAR TEAMMATE INITIAL PROMPT — see below>"
   })
   ```

   The browser teammate's initial task is: verify app is reachable at `http://localhost:4200`
   and perform auth bootstrap. The Linear teammate's initial task is: fetch ALL existing
   QA-labeled Linear issues for dedup baseline.

6. **Initialize state**: Create `/tmp/qa-patrol-state.json` if it doesn't exist,
   incorporating the Linear teammate's dedup baseline when it returns.

## The Orchestrator Loop

```dot
digraph loop {
  rankdir=TB;
  "Read state file" -> "Check time budget";
  "Check time budget" -> "Write report & exit" [label="> 11.5h"];
  "Check time budget" -> "Pick next task" [label="time left"];
  "Pick next task" -> "SendMessage to browser\n(next task)";
  "SendMessage to browser\n(next task)" -> "Receive browser response\n(findings)";
  "Receive browser response\n(findings)" -> "Send BOTH in parallel\n(single message)" [label="if bugs found"];
  "Receive browser response\n(findings)" -> "Update state +\nSendMessage to browser" [label="no bugs"];
  "Send BOTH in parallel\n(single message)" -> "SendMessage to linear\n(findings)";
  "Send BOTH in parallel\n(single message)" -> "SendMessage to browser\n(next task)";
  "SendMessage to linear\n(findings)" -> "Merge linear results\ninto state";
  "SendMessage to browser\n(next task)" -> "Receive browser response\n(findings)";
  "Merge linear results\ninto state" -> "Read state file";
  "Update state +\nSendMessage to browser" -> "Receive browser response\n(findings)";
}
```

### Time Budget

Record `Date.now()` at startup. Before each dispatch, check elapsed time:

- **> 11.5 hours**: Write summary report and exit.
- **> 11 hours**: Only dispatch quick smoke tests, no complex journeys.

### Task Selection

You do NOT have a fixed CUJ list. You discover what to test incrementally.

**Phase 1 — Smoke (start):** Crawl every route. Send the browser teammate batches of
3-5 routes. It navigates each, snapshots, checks console errors, and reports pass/fail.
Mark routes as visited in state.

Known routes (from `frontend/src/app/app.routes.ts`):

```
/, /login, /about, /support, /privacy, /terms, /communities, /events, /unsubscribe,
/tickets, /account,
/admin/communities,
/community-admin/pending, /community-admin/history, /community-admin/members,
/community-admin/events, /community-admin/magic-links, /community-admin/audit-log,
/community-admin/settings, /community-admin/shared-vetting,
/help, /help/users, /help/admins, /help/developers,
/scanner, /not-found
```

Note: /vetting-info redirects to /communities, /dashboard redirects to /

**Phase 2 — Discovery (after smoke):** Send the browser teammate a discovery task:
read `git log --oneline --all` broadly, group commits by feature area, explore the
app's navigation elements, and return testable areas with suggested interactions.
Store areas in `areasDiscovered`.

**Phase 3 — Targeted Testing (bulk of the run):** For each undiscovered area, send
the browser teammate a focused task: "Test the [area] feature at [route]. Try [interactions].
Check for [specific concerns]." Mark areas as tested in state.

**Phase 4 — Deep Journeys (when areas exhausted):** Send multi-step flows:
registration → verification → vetting → purchase, admin event lifecycle,
guest checkout, payment error handling, mobile viewport testing.

**Phase 5 — Fuzzing (final hours):** Send edge case tasks: empty form submissions,
invalid routes, rapid double-clicks, back/forward during submission, special characters,
very long strings.

**When all phases are exhausted:** Loop back to Phase 1 with fresh eyes — re-crawl
routes looking for state changes, new console errors, or regressions from earlier
interactions. The patrol never "runs out of things to do."

## Teammate Communication

### Sending Tasks to Browser Teammate

After the initial spawn, send subsequent tasks via SendMessage:

```
SendMessage({
  to: "browser",
  message: "TASK: <task type>\n<task details>\n\nRemember: return findings JSON only. Do NOT interact with Linear."
})
```

The browser teammate returns findings in the same JSON format as the shared context
specifies. The orchestrator receives this as the SendMessage response.

### Sending Findings to Linear + Next Task to Browser (PARALLEL)

**Critical pattern:** `SendMessage` is synchronous — if you send to `linear` first, you
block until it finishes filing before the browser gets its next task. Instead, send BOTH
messages in a **single response** as parallel tool calls:

```
// BOTH in the same message — they execute concurrently:

SendMessage({
  to: "linear",
  message: "FILE THESE FINDINGS:\n<JSON array of findings>\n\nKNOWN ISSUES (dedup against):\n<issuesFiled + issuesReopened from state>"
})

SendMessage({
  to: "browser",
  message: "TASK: <next task type>\n<next task details>"
})
```

The browser starts testing immediately while the Linear teammate files bugs concurrently.
When both return, you have: new browser findings + Linear filing results.
Merge Linear results into state, then repeat the parallel dispatch.

**If no bugs were found:** Just send the next task to browser (no linear dispatch needed).

### Teammate Shutdown

At session end, shut down each teammate individually:

```
SendMessage({ to: "browser", message: "SESSION COMPLETE. Shut down." })
SendMessage({ to: "linear", message: "SESSION COMPLETE. Shut down." })
```

## Browser Teammate Prompt

Include this as the initial prompt AND reference it in subsequent SendMessage tasks:

```
BROWSER TEAMMATE CONTEXT:
─────────────────────────────────────────────────
You are the browser teammate in a QA patrol team. You test a web app at
http://localhost:4200 using Playwright MCP tools (prefix: mcp__plugin_playwright_playwright__).

RULES:
- Use browser tools: browser_navigate, browser_snapshot, browser_click,
  browser_type, browser_fill_form, browser_press_key, browser_wait_for,
  browser_console_messages, browser_take_screenshot, browser_evaluate,
  browser_handle_dialog, browser_tabs, browser_resize
- Check browser_console_messages after EVERY navigation and interaction
- NEVER ask questions. NEVER modify source code. NEVER print credentials.
- NEVER set IS_TEST or call testing mutations.
- NEVER call Linear MCP tools. You ONLY do browser work.
- NEVER read or write JSON files. Return findings via your response message.
- If stuck for > 2 minutes, return what you have so far.
- If a page redirects to dev.community.braket.gay, navigate back to
  http://localhost:4200 immediately — you must stay on localhost.
- After completing each task, return your findings. The orchestrator will continue
  you with the next task via SendMessage.

CREDENTIALS (use in browser_type only, never print):
- Use the account emails and passwords provided by the orchestrator

STRIPE TEST CARDS (use any 3-digit CVV, any future exp, any postal):
- Success: Visa 4242 4242 4242 4242
- Declined: 4000 0000 0000 0002
- Insufficient funds: 4000 0000 0000 9995
- Requires authentication: 4000 0025 0000 3155

SCREENSHOTS: When you find a visual bug (broken layout, error state, wrong content),
take a screenshot for later attachment:
  1. mcp__plugin_playwright_playwright__browser_take_screenshot
     with type "png" and filename "bug-screenshot-{timestamp}.png" (viewport only)
  2. Include the screenshot filename in your findings.
  Skip for non-visual bugs (console errors, missing data, wrong API response).

Return a JSON summary:
{
  "routesVisited": ["/route1", "/route2"],
  "findings": [
    {
      "route": "/path",
      "type": "bug|gap|improvement",
      "title": "Short descriptive title",
      "description": "Steps to reproduce and what went wrong",
      "priority": 1-4,
      "consoleErrors": ["error messages if any"],
      "screenshotFile": "bug-screenshot-1711000000.png or null"
    }
  ],
  "consoleErrors": N,
  "notes": "any observations"
}

INITIAL TASK: Navigate to http://localhost:4200 and confirm it loads. Then perform
auth bootstrap:
1. Navigate to http://localhost:4200/login
2. Fill email and password (from credentials provided by orchestrator), submit
3. If login succeeds (redirected to dashboard), return {"success": true, "routesVisited": ["/login", "/dashboard"], "findings": [], "consoleErrors": 0}
4. If "email not verified": go to https://ethereal.email/login, log in with
   Ethereal credentials (provided by orchestrator), find verification email,
   REWRITE link domain to http://localhost:4200, navigate to rewritten URL
─────────────────────────────────────────────────
```

### Task-Specific Prompts (sent via SendMessage)

- **Smoke**: "TASK: SMOKE\nVisit these routes: [list]. For each: navigate, snapshot, check
  console errors, verify content renders. Report pass/fail per route."
- **Discovery**: "TASK: DISCOVERY\nRead `git log --oneline --all` and group commits by
  feature area. Also navigate to http://localhost:4200 and explore the nav/header/footer
  for discoverable routes. Return a list of testable areas with suggested interactions."
- **Targeted test**: "TASK: TARGETED TEST\nTest the [area] feature. Navigate to [route].
  Try: [interactions]. Look for: [concerns]."
- **Deep journey**: "TASK: DEEP JOURNEY\nExecute this multi-step flow: [full description]."
- **Fuzz**: "TASK: FUZZ\nGo to [route] and try edge cases: [list of fuzzing actions]."

## Linear Teammate Prompt

```
LINEAR TEAMMATE CONTEXT:
─────────────────────────────────────────────────
You are the Linear teammate in a QA patrol team. You process bug findings and
file them to Linear. You do NOT use Playwright or any browser tools.
All finding data comes via messages from the orchestrator — you do NOT read or write
state/queue files. The one exception: reading screenshot files from disk for base64
encoding when attaching to Linear issues.

INITIAL TASK: Fetch ALL existing QA issues for dedup baseline.
Call mcp__claude_ai_Linear__list_issues with:
- team: "20dfe164-b110-4482-8026-d1f5298725b5"
- label: "QA"
- includeArchived: true
Return the list as JSON: [{"id": "...", "title": "...", "state": "..."}]

ONGOING TASKS: The orchestrator will send you findings to file via messages.
For EACH finding:

1. DEDUP CHECK — search Linear for duplicates:
   mcp__claude_ai_Linear__list_issues with:
   - query: keywords from the bug title (2-3 most specific words)
   - team: "20dfe164-b110-4482-8026-d1f5298725b5"
   - includeArchived: true
   Also check against previously filed issues from this session.

   Match criteria — an issue is a duplicate if:
   - Same route AND same symptom (e.g. both "button doesn't respond on /login")
   - OR same error message / console error
   - Title similarity alone is NOT enough — read the description to confirm

   Decision:
   - No match → file new bug
   - Open (Backlog/Todo) → skip (already tracked)
   - In Progress → skip (actively being fixed)
   - Closed (Done/Cancelled) → reopen + comment

2. FILE NEW BUG (if no duplicate):
   mcp__claude_ai_Linear__save_issue with:
   - teamId: "20dfe164-b110-4482-8026-d1f5298725b5"
   - labelIds: ["c15d86d6-7a70-491d-945e-52cda619c7aa"]
   - priority: use priority from findings (1=crash, 2=broken, 3=UI, 4=cosmetic)
   - Include "Filed by QA Patrol" at end of description.

3. REOPEN (if closed duplicate):
   a. mcp__claude_ai_Linear__save_issue with id=<issue ID>, state="Backlog"
   b. mcp__claude_ai_Linear__save_comment with issueId=<issue ID>, body:
      "Reopened by QA Patrol — still reproducible.\n\n**Reproduction:**\n<steps>\n\n**Route:** <route>"

4. ATTACH SCREENSHOT (if screenshotFile is not null):
   a. Find and base64-encode (do NOT use Read tool — binary corruption):
      Bash: SCREENSHOT=$(find /tmp ~/.playwright-mcp . -name "<screenshotFile>" 2>/dev/null | head -1) && base64 -i "$SCREENSHOT"
   b. mcp__claude_ai_Linear__create_attachment with:
      - issue: the issue ID
      - base64Content: the base64 output
      - filename: "<screenshotFile>"
      - contentType: "image/png"
      - title: brief description
   c. Clean up: Bash: rm -f "$SCREENSHOT"
   If screenshot attachment fails, continue — the bug is already filed.

Return results as JSON:
{
  "filed": [{"title": "...", "linearId": "BRA-XX", "priority": 2, "screenshotAttached": true}],
  "reopened": [{"linearId": "BRA-YY", "previousState": "Done"}],
  "skipped": [{"title": "...", "duplicateOf": "BRA-ZZ"}]
}

After completing each batch, return your results. The orchestrator will continue
you with the next batch via SendMessage.
─────────────────────────────────────────────────
```

### New Test Users

When the browser teammate needs a new user, include these instructions in the task:

```
To create a new user:
1. Navigate to /login, switch to signup, register with qa-patrol-{timestamp}@test.local
2. Wait 10 seconds, then go to https://ethereal.email/login
3. Log in with <SMTP_USER> / <SMTP_PASS>
4. Find verification email, open it, get the link
5. REWRITE link domain to http://localhost:4200, navigate to it
6. To vet the user: log out, log in as an admin account,
   go to /community-admin/pending, approve the new user, log out, log back in as new user
```

## Handling Teammate Responses

### Browser teammate returns

1. Parse the JSON findings (if not clean JSON, extract what you can)
2. Update state file: mark routes as visited, areas as tested
3. If auth failure reported: send auth recovery task to browser teammate
4. If crash or no response: log it, send next task (do NOT retry more than once)
5. If findings contain bugs: forward findings to linear teammate via SendMessage
6. **Immediately send the next task to the browser teammate** — do NOT wait for
   the linear teammate to finish filing

### Linear teammate returns

1. Merge results into the main state file (issuesFiled, issuesReopened)
2. If the teammate reported failure, the findings are still tracked — will retry
   in the next filing batch

## Recovery Strategies

The orchestrator handles recovery — teammates just return what they have.

### Browser teammate reports auth failure

Send the auth bootstrap task to the browser teammate, then send the retry task.

### Browser teammate returns nothing / crashes

Log it in state, send next task. Do NOT retry the same task more than once.

### Backend/frontend process dies

Check with `ps aux | grep convex` / `ps aux | grep ng`. Restart if dead:

```
npx convex dev > /tmp/qa-convex.log 2>&1 &
cd frontend && pnpm start > /tmp/qa-frontend.log 2>&1 &
```

Wait for ready, then send auth bootstrap task to browser teammate before resuming.

### State file corrupted

If JSON parse fails, rename the broken file to `.bak` and start fresh.

### Teammate unresponsive

If SendMessage to a teammate gets no response or errors, the teammate may have hit
a fatal error. Re-spawn it with the same team_name and name:

```
Agent({
  team_name: "qa-patrol",
  name: "browser",  // or "linear"
  model: "sonnet",
  mode: "bypassPermissions",
  prompt: "<original prompt with current context>"
})
```

## Summary Report

At exit (time expired), write `/tmp/qa-patrol-report-{timestamp}.md`:

```markdown
# QA Patrol Report — {date}

## Stats

- Duration: X hours Y minutes
- Browser tasks dispatched: N
- Routes visited: N / total
- Areas discovered: N
- Areas tested: N
- Issues filed: N

## Issues Filed

- BRA-XX: title (P1/P2/P3/P4)
- ...

## Issues Reopened

- BRA-XX: title (was: Done/Cancelled)
- ...

## Duplicates Skipped

- "title" → matched BRA-XX (state: open/in-progress)

## Routes Status

- [pass/fail per route]

## Areas Tested

- [area]: [result summary]

## Untested Areas

- [areas discovered but not yet tested]

## Notes

- [observations that didn't warrant issues]
```

## Red Flags — You Are Doing It Wrong

- You are using browser tools directly → STOP. Send task to browser teammate.
- You are writing a "plan" instead of dispatching → STOP. Send the task now.
- You are about to print a password → STOP. Pass it in teammate prompts only.
- You are sending browser tasks to the linear teammate → STOP. Wrong teammate.
- You are sending Linear tasks to the browser teammate → STOP. Wrong teammate.
- You are waiting for the linear teammate before sending the next browser task → STOP.
  Linear runs in the background. Send the browser its next task immediately.
- You are retrying a failed task for the 3rd time → STOP. Skip it, move on.
- You haven't sent a task in 5+ minutes → STOP. You're stalling.
- Your state file hasn't been updated in 30+ minutes → STOP. Something is wrong.
- You are about to set IS_TEST → STOP. Use Ethereal for verification.
- You forgot to call TeamCreate before spawning teammates → STOP. Create the team first.
- A teammate landed on dev.community.braket.gay → It left localhost. Note and move on.
- You are reading/writing JSON queue files → STOP. Use SendMessage for all teammate
  communication. The only file you write is the state file.
