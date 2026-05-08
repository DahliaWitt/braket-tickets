import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LlmDesignReview, Severity } from './audit-types';

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LlmProvider {
  reviewScreenshot(
    screenshotBase64: string,
    routeLabel: string,
    viewport: 'desktop' | 'mobile',
    designContext: string,
  ): Promise<LlmDesignReview | null>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function loadPrompt(routeLabel: string, viewport: 'desktop' | 'mobile', designContext: string): string {
  const templatePath = resolve(__dirname, 'prompts/design-review.md');
  const template = readFileSync(templatePath, 'utf-8');
  return template
    .replaceAll('{routeLabel}', routeLabel)
    .replaceAll('{viewport}', viewport)
    .replaceAll('{designContext}', designContext);
}

const SEVERITY_VALUES = new Set<Severity>(['critical', 'serious', 'moderate', 'minor', 'info']);

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && SEVERITY_VALUES.has(value as Severity);
}

function parseLlmResponse(raw: string, source: string): LlmDesignReview | null {
  // Try progressively more aggressive extraction:
  // 1. Raw text as JSON
  // 2. Strip markdown code fences
  // 3. Extract first { ... } block from mixed text
  let jsonStr = raw.trim();

  // Strip markdown code fences (```json ... ```)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // If it still doesn't start with {, try to extract the first JSON object
  if (!jsonStr.startsWith('{')) {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(`[audit-llm] ${source}: response is not valid JSON — skipping. First 300 chars: ${raw.slice(0, 300)}`);
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    console.warn(`[audit-llm] ${source}: parsed value is not an object — skipping`);
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['overallScore'] !== 'number') {
    console.warn(`[audit-llm] ${source}: missing or invalid "overallScore" — skipping`);
    return null;
  }

  if (!Array.isArray(obj['findings'])) {
    console.warn(`[audit-llm] ${source}: missing or invalid "findings" array — skipping`);
    return null;
  }

  if (typeof obj['summary'] !== 'string') {
    console.warn(`[audit-llm] ${source}: missing or invalid "summary" — skipping`);
    return null;
  }

  const findings: LlmDesignReview['findings'] = [];
  for (const item of obj['findings'] as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    if (
      isSeverity(f['severity']) &&
      typeof f['area'] === 'string' &&
      typeof f['issue'] === 'string' &&
      typeof f['suggestion'] === 'string'
    ) {
      findings.push({
        severity: f['severity'],
        area: f['area'],
        issue: f['issue'],
        suggestion: f['suggestion'],
      });
    }
  }

  return {
    overallScore: obj['overallScore'] as number,
    findings,
    summary: obj['summary'] as string,
  };
}

// ---------------------------------------------------------------------------
// OpenRouter provider (default, uses Gemini 2.5 Flash)
// ---------------------------------------------------------------------------

class OpenRouterProvider implements LlmProvider {
  async reviewScreenshot(
    screenshotBase64: string,
    routeLabel: string,
    viewport: 'desktop' | 'mobile',
    designContext: string,
  ): Promise<LlmDesignReview | null> {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      console.warn('[audit-llm] OpenRouterProvider: OPENROUTER_API_KEY is not set — skipping');
      return null;
    }

    const prompt = loadPrompt(routeLabel, viewport, designContext);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-3.1-flash-lite-preview',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${screenshotBase64}`,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '(unreadable)');
        console.warn(`[audit-llm] OpenRouterProvider: HTTP ${response.status} — ${body.slice(0, 200)}`);
        return null;
      }

      const data: unknown = await response.json();
      if (
        typeof data !== 'object' ||
        data === null ||
        !Array.isArray((data as Record<string, unknown>)['choices'])
      ) {
        console.warn('[audit-llm] OpenRouterProvider: unexpected response shape — skipping');
        return null;
      }

      const choices = (data as Record<string, unknown>)['choices'] as unknown[];
      const first = choices[0];
      if (typeof first !== 'object' || first === null) {
        console.warn('[audit-llm] OpenRouterProvider: empty choices array — skipping');
        return null;
      }

      const message = (first as Record<string, unknown>)['message'];
      if (typeof message !== 'object' || message === null) {
        console.warn('[audit-llm] OpenRouterProvider: missing message in choice — skipping');
        return null;
      }

      const content = (message as Record<string, unknown>)['content'];
      if (typeof content !== 'string') {
        console.warn('[audit-llm] OpenRouterProvider: message content is not a string — skipping');
        return null;
      }

      return parseLlmResponse(content, 'OpenRouterProvider');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[audit-llm] OpenRouterProvider: request timed out after 30s');
      } else {
        console.warn('[audit-llm] OpenRouterProvider: request failed —', err);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Claude SDK provider (fallback)
// ---------------------------------------------------------------------------

class ClaudeProvider implements LlmProvider {
  async reviewScreenshot(
    screenshotBase64: string,
    routeLabel: string,
    viewport: 'desktop' | 'mobile',
    designContext: string,
  ): Promise<LlmDesignReview | null> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      console.warn('[audit-llm] ClaudeProvider: ANTHROPIC_API_KEY is not set — skipping');
      return null;
    }

    const prompt = loadPrompt(routeLabel, viewport, designContext);

    // Minimal interface for the subset of the Anthropic SDK we need.
    // Using this instead of importing the full SDK avoids a hard compile-time dep
    // when the package is not installed (ClaudeProvider is opt-in).
    interface AnthropicLike {
      messages: {
        create(
          params: {
            model: string;
            max_tokens: number;
            messages: Array<{
              role: string;
              content: Array<Record<string, unknown>>;
            }>;
          },
          options: { signal: AbortSignal },
        ): Promise<unknown>;
      };
    }
    interface AnthropicModule {
      default: new (opts: { apiKey: string }) => AnthropicLike;
    }

    let AnthropicCtor: AnthropicModule['default'];
    try {
      // Dynamic require keeps the SDK out of the module graph when not installed.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@anthropic-ai/sdk') as AnthropicModule;
      AnthropicCtor = mod.default;
    } catch {
      console.warn('[audit-llm] ClaudeProvider: @anthropic-ai/sdk is not installed — skipping');
      return null;
    }

    const client = new AnthropicCtor({ apiKey });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const message: unknown = await client.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: screenshotBase64,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        },
        { signal: controller.signal },
      );

      // Narrow the response shape manually (no SDK types available at compile time).
      if (
        typeof message !== 'object' ||
        message === null ||
        !Array.isArray((message as Record<string, unknown>)['content'])
      ) {
        console.warn('[audit-llm] ClaudeProvider: unexpected response shape — skipping');
        return null;
      }

      const contentBlocks = (message as Record<string, unknown>)['content'] as unknown[];
      const textBlock = contentBlocks.find(
        (b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text',
      );

      if (!textBlock) {
        console.warn('[audit-llm] ClaudeProvider: no text block in response — skipping');
        return null;
      }

      const textContent = (textBlock as Record<string, unknown>)['text'];
      if (typeof textContent !== 'string') {
        console.warn('[audit-llm] ClaudeProvider: text block has non-string content — skipping');
        return null;
      }

      return parseLlmResponse(textContent, 'ClaudeProvider');
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
        console.warn('[audit-llm] ClaudeProvider: request timed out after 30s');
      } else {
        console.warn('[audit-llm] ClaudeProvider: request failed —', err);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Skip provider
// ---------------------------------------------------------------------------

class SkipProvider implements LlmProvider {
  reviewScreenshot(): Promise<LlmDesignReview | null> {
    return Promise.resolve(null);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLlmProvider(provider: 'openrouter' | 'claude' | 'skip'): LlmProvider {
  switch (provider) {
    case 'openrouter':
      return new OpenRouterProvider();
    case 'claude':
      return new ClaudeProvider();
    case 'skip':
      return new SkipProvider();
  }
}
