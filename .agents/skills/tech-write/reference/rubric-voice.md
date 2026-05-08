# Voice Rubric

This rubric evaluates tone, voice, and register consistency. The voice-match check (V1) is **conditional**: run it only when a project voice file exists (`.impeccable.md`, `STYLE.md`, `VOICE.md`, or `WRITING.md` at the project root). If no voice file is found, skip V1 and default to neutral technical style for all other checks.

## Checks

| # | Check | Severity | Condition |
|---|-------|----------|-----------|
| V1 | Tone and vocabulary match the project voice file | Error | Only if voice file exists |
| V2 | Consistent tone throughout — no shifts between formal and casual within the same document | Warning | Always |
| V3 | Person and tense stay consistent — do not alternate between "you" and "the user," or between present and future tense, without reason | Warning | Always |
| V4 | No AI filler words (see banned list) | Warning | Always |
| V5 | Register matches the stated audience — do not use academic prose for a quickstart, or casual slang for an API reference | Suggestion | Always |

## AI Filler Word List

Flag any of these words. They add no meaning and signal machine-generated text:

"comprehensive", "robust", "seamless", "leverage", "utilize", "ensures", "elegant", "facilitate", "streamline", "cutting-edge"

Replace each with a concrete, specific word that says what you actually mean.

## Inline Examples

<examples>
<pair id="ai-filler">
<bad>
This library provides a robust and comprehensive solution that seamlessly integrates with your existing workflow.
</bad>
<good>
This library handles retries, timeouts, and batching. It works with Express, Fastify, and Koa out of the box.
</good>
<why>The bad version uses three filler words and says nothing specific. The good version names the actual capabilities, giving the reader information they can act on.</why>
</pair>

<pair id="tone-consistency">
<bad>
Configure the database connection string in your environment file. Then you gotta restart the server so the changes take effect. Subsequently, verify the connection by executing the health check endpoint.
</bad>
<good>
Configure the database connection string in your environment file. Restart the server for the changes to take effect. Verify the connection by running the health check endpoint.
</good>
<why>The bad version lurches from formal ("Subsequently, verify") to casual ("you gotta") within three sentences. Pick one register and hold it.</why>
</pair>
</examples>

## Output Format

```
## Voice — [pass/warn/fail]

### Errors (N)
- Line X: [issue]. Fix: [positive instruction].

### Warnings (N)
- Line X: [issue]. Fix: [positive instruction].

### Suggestions (N)
- Line X: [issue]. Consider: [alternative].
```

If no findings exist for a severity level, omit that section.
