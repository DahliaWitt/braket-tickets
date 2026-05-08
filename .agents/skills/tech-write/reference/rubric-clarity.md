# Clarity Evaluator

Evaluates sentence-level and word-level clarity. Runs as the second decomposed
review pass (after structure, before voice). Flags passive procedures, ambiguous
references, bloated sentences, filler, inconsistent terms, unexplained jargon,
and unnecessarily complex words.

## Checks

| # | Check | Severity | Trigger |
|---|-------|----------|---------|
| C1 | Active voice in procedures | Error | A numbered step or imperative instruction uses passive voice ("the file is saved" instead of "save the file"). Passive voice in explanatory prose is acceptable. |
| C2 | Ambiguous pronouns | Error | A pronoun (it, they, this, that) has more than one possible antecedent within five words, or appears before its referent is introduced. |
| C3 | Sentence length > 26 words | Warning | Any sentence exceeds 26 words. Count contractions as one word. Code spans and URLs count as one word each. |
| C4 | Filler phrases | Warning | Sentence contains a phrase that adds no meaning: "in order to", "it is important to note that", "as a matter of fact", "at the end of the day", "it should be noted that", "due to the fact that". |
| C5 | Consistent terminology | Warning | The same concept is referred to by two or more different terms without an explicit alias ("X, also known as Y"). |
| C6 | Jargon without definition | Warning | A domain-specific term appears without a prior definition, glossary entry, or hyperlink to a definition. |
| C7 | Simple word preference | Suggestion | A complex word has a simpler substitute: "utilize" -> "use", "commence" -> "start", "terminate" -> "stop", "facilitate" -> "help", "leverage" -> "use", "subsequently" -> "then". |

## Severity meanings

- **Error** -- violates a hard rule; must fix before publishing.
- **Warning** -- deviates from best practice; fix unless there is a documented reason to keep.
- **Suggestion** -- could improve; apply at author discretion.

<examples>

### Active voice in procedures (Error)

Bad:
> 1. The configuration file should be opened.
> 2. The new value is entered in the `timeout` field.
> 3. The file is saved.

Good:
> 1. Open the configuration file.
> 2. Enter the new value in the `timeout` field.
> 3. Save the file.

Why: Passive voice in steps hides the actor and forces the reader to infer who
performs the action. Imperative active voice ("Open", "Enter", "Save") is direct
and unambiguous.

### Filler phrases (Warning)

Bad:
> In order to install the package, run `pnpm add zod`. It is important to note
> that this requires Node 18 or later.

Good:
> To install the package, run `pnpm add zod`. This requires Node 18 or later.

Why: "In order to" and "it is important to note that" add words without adding
meaning. Removing them shortens the sentence and reaches the point faster.

### Ambiguous pronouns (Error)

Bad:
> The server sends the payload to the client and it processes the response.

Good:
> The server sends the payload to the client. The client processes the response.

Why: "it" could refer to the server or the client. Replacing the pronoun with
the explicit noun removes ambiguity.

</examples>

## Output format

```
## Clarity -- [pass | warn | fail]

### Errors (N)
- Line X: [issue]. Fix: [positive instruction].

### Warnings (N)
- Line X: [issue]. Fix: [positive instruction].

### Suggestions (N)
- Line X: [issue]. Consider: [simpler alternative].
```

Verdict logic: **fail** if any Error exists, **warn** if no Errors but at least
one Warning, **pass** if only Suggestions or no findings.
