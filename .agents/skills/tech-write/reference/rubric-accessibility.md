# Accessibility Rubric

This rubric is **conditional**. Run it only when the document contains at least one image, link, table, or code block. If the document is plain prose with none of these elements, skip this evaluator entirely and report "Accessibility — skipped (no applicable elements)."

## Checks

| # | Check | Severity | Trigger |
|---|-------|----------|---------|
| A1 | Alt text present for every non-decorative image | Error | Images |
| A2 | Link text is meaningful in isolation (no "click here," "this page," "read more") | Error | Links |
| A3 | Tables use header rows (`th`) with scope | Warning | Tables |
| A4 | No information conveyed only through images — provide text equivalent | Warning | Images |
| A5 | No directional language ("above," "below," "right-hand side") — use "preceding" or "following" | Suggestion | Any |
| A6 | Color or formatting is not the sole indicator of meaning — pair with text labels | Suggestion | Any |

## Inline Examples

<examples>
<pair id="link-text">
<bad>
For setup instructions, [click here](setup.md).
</bad>
<good>
Follow the [setup instructions](setup.md) to configure your environment.
</good>
<why>Screen readers often list links out of context. "Click here" conveys no meaning when read alone; the link text should describe the destination.</why>
</pair>

<pair id="directional-language">
<bad>
See the diagram below for the authentication flow.
</bad>
<good>
See the following diagram for the authentication flow.
</good>
<why>"Below" depends on visual layout, which varies across devices and screen readers. "Following" describes document order, which is stable regardless of presentation.</why>
</pair>
</examples>

## Output Format

```
## Accessibility — [pass/warn/fail]

### Errors (N)
- Line X: [issue]. Fix: [positive instruction].

### Warnings (N)
- Line X: [issue]. Fix: [positive instruction].

### Suggestions (N)
- Line X: [issue]. Consider: [alternative].
```

If no findings exist for a severity level, omit that section.
