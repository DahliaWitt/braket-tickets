# Structure Evaluator

Checks document organization: whether the reader can identify the audience, understand the scope, and follow a logical path through the content. Runs as the first of three sequential evaluation passes during self-review (write mode) or decomposed evaluation (review/rewrite mode). Load this file alone -- do not load other rubrics in the same pass.

## Checks

| # | Check | Severity | Rule |
|---|-------|----------|------|
| S1 | Audience defined | Error | Document states who it is for and what prior knowledge they need. |
| S2 | Scope stated | Error | Document declares what it covers and, where useful, what it does not cover. |
| S3 | Logical flow (why before how) | Warning | Conceptual context appears before procedural steps. Readers understand *why* before they act. |
| S4 | Task-based headings | Warning | Headings describe what the reader will *do*, not unfamiliar jargon they have not yet learned. |
| S5 | Progressive disclosure | Warning | Simple concepts and examples precede advanced ones. New terms appear near the instructions that use them. |
| S6 | Text between heading and first subheading | Suggestion | A brief introduction sits between a heading and its first subheading so readers are not dropped into a sub-topic without context. |
| S7 | Navigation aids for docs > 500 words | Suggestion | Documents over 500 words include at least one navigation aid: a table of contents, a summary, or cross-reference links. |

## Inline Examples

<examples>
<example id="audience-definition" check="S1" severity="Error">
<bad>
## Overview
The Frambus API lets you create and publish Fwidgets.
</bad>
<good>
## Overview
This guide is for backend engineers who maintain Fwidget pipelines. It assumes familiarity with REST conventions and OAuth 2.0.

The Frambus API lets you create and publish Fwidgets.
</good>
<why>Without an audience statement the reader cannot judge whether the document applies to them or whether they have the prerequisite knowledge to follow it.</why>
</example>

<example id="scope-statement" check="S2" severity="Error">
<bad>
# Deployment Guide
Follow these steps to deploy the service.
</bad>
<good>
# Deployment Guide
This document walks through deploying the Acme service to a staging cluster. It does not cover production rollout or rollback procedures.
</good>
<why>A scope statement sets expectations up front. Declaring non-scope prevents the writer from drifting and the reader from searching for content that is not there.</why>
</example>

<example id="task-based-headings" check="S4" severity="Warning">
<bad>
## The Carambola Command
## Froobus Framework Initialization
</bad>
<good>
## Run the migration
## Set up the development environment
</good>
<why>Task-based headings use verbs the reader already knows. Jargon-heavy headings force the reader to decode terminology before understanding the section's purpose.</why>
</example>
</examples>

## Output Format

```
## Structure -- [pass|warn|fail]

### Errors (N)
- Line X: [issue]. Fix: [positive instruction].

### Warnings (N)
- Line X: [issue]. Fix: [positive instruction].

### Suggestions (N)
- Line X: [issue]. Consider: [alternative].
```

Verdict logic: **fail** if any Error exists, **warn** if no Errors but at least one Warning, **pass** otherwise.
