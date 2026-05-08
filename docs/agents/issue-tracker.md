# Issue tracker: Linear

Issues and PRDs for this repo live in Linear. Use the Linear MCP tools for all operations.

## Conventions

- **Create an issue**: `mcp__claude_ai_Linear__save_issue` with title, description, and team.
- **Read an issue**: `mcp__claude_ai_Linear__get_issue` by ID or identifier (e.g. `BRA-123`).
- **List issues**: `mcp__claude_ai_Linear__list_issues` with label, status, or team filters.
- **Comment on an issue**: `mcp__claude_ai_Linear__save_comment` with the issue ID.
- **Apply labels**: `mcp__claude_ai_Linear__save_issue` to update labels on an existing issue.
- **Close**: `mcp__claude_ai_Linear__save_issue` to set the status to "Done" or "Canceled".

## When a skill says "publish to the issue tracker"

Create a Linear issue via MCP.

## When a skill says "fetch the relevant ticket"

Call `mcp__claude_ai_Linear__get_issue` with the issue identifier.
