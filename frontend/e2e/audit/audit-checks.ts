import {expect, type Page, type ConsoleMessage} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import type {
  AuditRoute,
  AuditFinding,
  AuditRouteResult,
  Severity,
} from './audit-types';
import {createLlmProvider} from './audit-llm';

export interface RunChecksConfig {
  llmProvider: 'openrouter' | 'claude' | 'skip';
  screenshotDir: string;
  reportDir: string;
}

// ---------------------------------------------------------------------------
// Static DOM checks — each runs inside page.evaluate()
// ---------------------------------------------------------------------------

/** Verify h1 exists and heading levels don't skip (e.g., h1 → h3 with no h2). */
async function checkHeadingHierarchy(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const headings = Array.from(
        document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
      );
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];

      if (headings.length === 0) {
        findings.push({
          check: 'heading-hierarchy',
          severity: 'serious',
          message: 'No headings found on the page.',
          suggestion:
            'Add at least one <h1> element to establish page structure.',
        });
        return findings;
      }

      const h1s = headings.filter((h) => h.tagName === 'H1');
      if (h1s.length === 0) {
        findings.push({
          check: 'heading-hierarchy',
          severity: 'serious',
          message: 'Page has no <h1> element.',
          suggestion: 'Add an <h1> to define the main page heading.',
        });
      }

      // Check for skipped levels
      const levels = headings.map((h) => parseInt(h.tagName.slice(1), 10));
      for (let i = 1; i < levels.length; i++) {
        const prev = levels[i - 1];
        const curr = levels[i];
        if (curr > prev + 1) {
          const el = headings[i];
          const selector = el.id
            ? `#${el.id}`
            : el.tagName.toLowerCase() +
              (el.className ? '.' + el.className.split(' ')[0] : '');
          findings.push({
            check: 'heading-hierarchy',
            severity: 'serious',
            message: `Heading level skipped: h${prev} followed by h${curr}.`,
            element: selector,
            suggestion: `Use h${prev + 1} instead of h${curr} to avoid skipping heading levels.`,
          });
        }
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/**
 * Tiered touch target check based on WCAG 2.2 SC 2.5.8 (AA).
 *
 * Thresholds per element type:
 *   - Primary CTA (submit, purchase buttons): 36px — critical user paths
 *   - All other interactive elements: 24px — WCAG 2.2 AA minimum
 *
 * WCAG 2.5.8 exceptions implemented:
 *   - Inline text links (inside <p>, <li>, <td>, <span>) — fully exempt
 *   - Native browser controls (unstyled <select>, native checkboxes) — exempt
 *   - Visually hidden / sr-only elements — exempt
 *   - Spacing exception: undersized target OK if 24px circle doesn't overlap neighbors
 */
async function checkTouchTargets(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const WCAG_AA_MIN = 24;
      const CTA_MIN = 36;
      const CTA_PATTERNS =
        /submit|purchase|buy|checkout|pay|confirm|sign.?up|log.?in|register|create.?account|get.?ticket/i;

      const selectors = [
        'button',
        'a[href]',
        'input',
        'select',
        'textarea',
        '[role="button"]',
        '[role="link"]',
      ];
      const allInteractive = Array.from(
        document.querySelectorAll(selectors.join(', ')),
      );
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];

      // Collect all interactive element rects (indexed) for the spacing exception check.
      // We use the same array for iteration and comparison to avoid the reference-equality
      // bug where getBoundingClientRect() returns a new object each call.
      const interactiveRects = allInteractive.map((el) =>
        el.getBoundingClientRect(),
      );

      for (let i = 0; i < allInteractive.length; i++) {
        const el = allInteractive[i];
        const htmlEl = el as HTMLElement;
        const rect = interactiveRects[i];

        // Skip hidden or zero-size elements
        if (rect.width === 0 && rect.height === 0) continue;
        if (htmlEl.offsetParent === null && el.tagName !== 'BODY') continue;

        // Skip visually hidden elements (screen-reader-only)
        const style = window.getComputedStyle(htmlEl);
        if (
          (rect.width <= 1 && rect.height <= 1) ||
          style.clip === 'rect(0px, 0px, 0px, 0px)' ||
          style.getPropertyValue('clip-path') === 'inset(50%)' ||
          (style.position === 'absolute' &&
            style.overflow === 'hidden' &&
            (rect.width <= 1 || rect.height <= 1))
        ) {
          continue;
        }

        // WCAG 2.5.8 "Inline" exception: links within prose are exempt
        if (el.tagName === 'A') {
          const parent = el.parentElement;
          if (
            parent &&
            /^(P|LI|TD|TH|SPAN|LABEL|BLOCKQUOTE|FIGCAPTION)$/.test(
              parent.tagName,
            )
          ) {
            continue;
          }
        }

        // Determine threshold: CTA buttons get a higher bar
        const text =
          (htmlEl.textContent ?? '').trim() +
          ' ' +
          (htmlEl.getAttribute('aria-label') ?? '');
        const isCta =
          (el.tagName === 'BUTTON' ||
            htmlEl.getAttribute('role') === 'button') &&
          CTA_PATTERNS.test(text);
        const threshold = isCta ? CTA_MIN : WCAG_AA_MIN;

        const shortDim = Math.min(rect.width, rect.height);
        if (shortDim >= threshold) continue;

        // WCAG 2.5.8 "Spacing" exception: target is OK if a 24px-diameter circle
        // centered on it doesn't overlap any adjacent target's 24px circle
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const radius = WCAG_AA_MIN / 2; // 12px
        let hasOverlap = false;
        for (let j = 0; j < interactiveRects.length; j++) {
          if (j === i) continue;
          const other = interactiveRects[j];
          const ox = other.left + other.width / 2;
          const oy = other.top + other.height / 2;
          const dist = Math.sqrt((cx - ox) ** 2 + (cy - oy) ** 2);
          if (dist < radius * 2) {
            // circles overlap if distance < 24px
            hasOverlap = true;
            break;
          }
        }
        // If no overlap with neighbors, the spacing exception applies — skip
        if (!hasOverlap && !isCta) continue;

        const severity = isCta
          ? 'critical'
          : shortDim < 16
            ? 'serious'
            : 'moderate';
        const selector = htmlEl.id
          ? `#${htmlEl.id}`
          : `${htmlEl.tagName.toLowerCase()}${htmlEl.className ? '.' + htmlEl.className.split(' ')[0] : ''}`;
        const label = isCta ? 'CTA' : 'interactive element';

        findings.push({
          check: 'touch-target-size',
          severity,
          message: `${label}: ${Math.round(rect.width)}×${Math.round(rect.height)}px (minimum ${threshold}×${threshold}px).`,
          element: selector,
          suggestion: isCta
            ? 'Primary action buttons should be at least 36×36px for usability on touch devices.'
            : shortDim < 16
              ? 'This element is very small and likely unusable on touch devices. Increase size or add padding.'
              : 'Increase the element size or add padding to meet the 24px WCAG 2.2 AA minimum.',
        });
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/** Find elements where scrollWidth > clientWidth (horizontal text overflow). */
async function checkTextOverflow(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];
      const elements = Array.from(
        document.querySelectorAll(
          'p, span, h1, h2, h3, h4, h5, h6, li, td, th, label, a',
        ),
      );

      for (const el of elements) {
        const htmlEl = el as HTMLElement;
        if (htmlEl.scrollWidth > htmlEl.clientWidth + 2) {
          const rect = htmlEl.getBoundingClientRect();
          const style = window.getComputedStyle(htmlEl);

          // Skip visually hidden / sr-only elements — overflow is by design
          if (
            (rect.width <= 1 && rect.height <= 1) ||
            style.clip === 'rect(0px, 0px, 0px, 0px)' ||
            style.getPropertyValue('clip-path') === 'inset(50%)' ||
            (style.position === 'absolute' &&
              style.overflow === 'hidden' &&
              (rect.width <= 1 || rect.height <= 1))
          ) {
            continue;
          }

          // Skip elements that already handle overflow gracefully (truncate, ellipsis).
          // scrollWidth > clientWidth is expected for these — they're deliberately clipping text.
          if (
            style.textOverflow === 'ellipsis' ||
            style.overflow === 'hidden' ||
            style.overflowX === 'hidden'
          ) {
            continue;
          }

          // Skip elements inside an overflow-hidden ancestor with text-overflow handling.
          // Common pattern: parent has truncate, child span inherits clipped layout.
          let ancestor = htmlEl.parentElement;
          let ancestorHandlesOverflow = false;
          while (ancestor && ancestor !== document.body) {
            const aStyle = window.getComputedStyle(ancestor);
            if (
              (aStyle.overflow === 'hidden' || aStyle.overflowX === 'hidden') &&
              (aStyle.textOverflow === 'ellipsis' ||
                ancestor.classList.contains('truncate'))
            ) {
              ancestorHandlesOverflow = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          if (ancestorHandlesOverflow) continue;

          const selector = htmlEl.id
            ? `#${htmlEl.id}`
            : `${htmlEl.tagName.toLowerCase()}${htmlEl.className ? '.' + htmlEl.className.split(' ')[0] : ''}`;
          findings.push({
            check: 'text-overflow',
            severity: 'moderate',
            message: `Element has horizontal text overflow: scrollWidth (${htmlEl.scrollWidth}px) > clientWidth (${htmlEl.clientWidth}px).`,
            element: selector,
            suggestion:
              'Add overflow:hidden, text-overflow:ellipsis, or word-break:break-word to contain text.',
          });
        }
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/** Find <img> elements with naturalWidth === 0 and non-empty src (broken images). */
async function checkBrokenImages(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const images = Array.from(document.querySelectorAll('img'));
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];

      for (const img of images) {
        if (img.src && img.naturalWidth === 0 && img.complete) {
          const selector = img.id
            ? `#${img.id}`
            : `img[src="${img.getAttribute('src')?.slice(0, 40)}"]`;
          findings.push({
            check: 'broken-image',
            severity: 'serious',
            message: `Broken image: src="${img.getAttribute('src')?.slice(0, 80)}".`,
            element: selector,
            suggestion:
              'Verify the image source URL is correct and accessible.',
          });
        }
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/** Find <img> elements without an alt attribute. */
async function checkMissingAltText(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const images = Array.from(document.querySelectorAll('img'));
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];

      for (const img of images) {
        if (!img.hasAttribute('alt')) {
          const selector = img.id
            ? `#${img.id}`
            : `img[src="${img.getAttribute('src')?.slice(0, 40) ?? ''}"]`;
          findings.push({
            check: 'missing-alt-text',
            severity: 'serious',
            message: 'Image is missing the alt attribute.',
            element: selector,
            suggestion:
              'Add alt="" for decorative images or a descriptive alt text for informative images.',
          });
        }
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/** Find <button> elements with no text content and no aria-label. */
async function checkEmptyButtons(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      );
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];

      for (const btn of buttons) {
        const htmlBtn = btn as HTMLElement;
        const hasText = (htmlBtn.textContent ?? '').trim().length > 0;
        const hasAriaLabel =
          htmlBtn.hasAttribute('aria-label') &&
          (htmlBtn.getAttribute('aria-label') ?? '').trim().length > 0;
        const hasAriaLabelledBy = htmlBtn.hasAttribute('aria-labelledby');
        const hasTitle =
          htmlBtn.hasAttribute('title') &&
          (htmlBtn.getAttribute('title') ?? '').trim().length > 0;

        if (!hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
          const selector = htmlBtn.id
            ? `#${htmlBtn.id}`
            : `${htmlBtn.tagName.toLowerCase()}${htmlBtn.className ? '.' + htmlBtn.className.split(' ')[0] : ''}`;
          findings.push({
            check: 'empty-button',
            severity: 'serious',
            message:
              'Button has no accessible label (no text content, aria-label, aria-labelledby, or title).',
            element: selector,
            suggestion: 'Add aria-label or visible text content to the button.',
          });
        }
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/** Find <a> elements with no text content and no aria-label. */
async function checkEmptyLinks(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];

      for (const link of links) {
        const htmlLink = link as HTMLElement;
        const hasText = (htmlLink.textContent ?? '').trim().length > 0;
        const hasAriaLabel =
          htmlLink.hasAttribute('aria-label') &&
          (htmlLink.getAttribute('aria-label') ?? '').trim().length > 0;
        const hasAriaLabelledBy = htmlLink.hasAttribute('aria-labelledby');
        const hasTitle =
          htmlLink.hasAttribute('title') &&
          (htmlLink.getAttribute('title') ?? '').trim().length > 0;

        if (!hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
          const href = htmlLink.getAttribute('href') ?? '';
          const selector = htmlLink.id
            ? `#${htmlLink.id}`
            : `a[href="${href.slice(0, 40)}"]`;
          findings.push({
            check: 'empty-link',
            severity: 'serious',
            message: `Link has no accessible label (no text, aria-label, aria-labelledby, or title). href="${href.slice(0, 80)}".`,
            element: selector,
            suggestion:
              'Add descriptive text content or aria-label to the link.',
          });
        }
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

/**
 * Find elements whose bounding box extends beyond the viewport width.
 * This catches layout bugs where fixed-width children push the page wider
 * than the screen, causing unwanted horizontal scroll on mobile.
 */
async function checkViewportOverflow(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(
    (): Array<{
      check: string;
      severity: string;
      message: string;
      element?: string;
      suggestion?: string;
    }> => {
      const viewportWidth = document.documentElement.clientWidth;
      const findings: Array<{
        check: string;
        severity: string;
        message: string;
        element?: string;
        suggestion?: string;
      }> = [];
      // Check semantic containers and common layout elements — not every single element
      const selectors =
        'section, nav, header, footer, main, aside, article, div, form, table, ul, ol';
      const elements = Array.from(document.querySelectorAll(selectors));
      const seen = new Set<string>();

      for (const el of elements) {
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();

        // Skip elements that don't overflow the viewport
        if (rect.right <= viewportWidth + 1) continue;
        // Skip zero-size or hidden elements
        if (rect.width === 0 || rect.height === 0) continue;
        if (htmlEl.offsetParent === null && htmlEl.tagName !== 'BODY') continue;

        // Skip elements positioned off-screen via CSS transforms (e.g., drawers/slide-overs
        // using translate-x-full). These exist in the DOM but are visually hidden.
        // Tailwind v4 uses the CSS `translate` property (not `transform`) for translate-x-*,
        // so we must check both.
        const hasOffscreenTransform = (el: Element) => {
          const s = window.getComputedStyle(el);
          if (s.transform && s.transform !== 'none') return true;
          if (s.translate && s.translate !== 'none') return true;
          return false;
        };
        if (hasOffscreenTransform(htmlEl)) continue;
        let transformedAncestor = htmlEl.parentElement;
        let insideTransform = false;
        while (transformedAncestor) {
          if (hasOffscreenTransform(transformedAncestor)) {
            insideTransform = true;
            break;
          }
          transformedAncestor = transformedAncestor.parentElement;
        }
        if (insideTransform) continue;

        // Skip elements inside overflow-x-auto/scroll containers (intentional scroll)
        let parent = htmlEl.parentElement;
        let inScrollContainer = false;
        while (parent) {
          const parentOverflow = window.getComputedStyle(parent).overflowX;
          if (parentOverflow === 'auto' || parentOverflow === 'scroll') {
            inScrollContainer = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (inScrollContainer) continue;

        const selector = htmlEl.id
          ? `#${htmlEl.id}`
          : htmlEl.getAttribute('data-testid')
            ? `[data-testid="${htmlEl.getAttribute('data-testid')}"]`
            : `${htmlEl.tagName.toLowerCase()}${htmlEl.className ? '.' + String(htmlEl.className).split(' ')[0] : ''}`;

        // Dedupe — many nested children of the same overflowing parent will all flag
        if (seen.has(selector)) continue;
        seen.add(selector);

        const overflow = Math.round(rect.right - viewportWidth);
        findings.push({
          check: 'viewport-overflow',
          severity: 'serious',
          message: `Element extends ${overflow}px beyond viewport width (${viewportWidth}px). Right edge at ${Math.round(rect.right)}px.`,
          element: selector,
          suggestion:
            'Add overflow-hidden, max-w-full, or min-w-0 to contain this element within the viewport.',
        });
      }

      return findings;
    },
  ) as Promise<AuditFinding[]>;
}

// ---------------------------------------------------------------------------
// Noise filters for console errors
// ---------------------------------------------------------------------------

const CONSOLE_NOISE_PATTERNS = [
  /WebSocket.*reconnect/i,
  /Failed to connect to Convex/i,
  /WebSocket connection.*failed/i,
  /Angular is running in development mode/i,
  /favicon\.ico/i,
  /Lit is in dev mode/i,
  /NG0\d{3}/, // Angular dev-mode warnings
];

function isNoisyConsoleError(text: string): boolean {
  return CONSOLE_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

const ANIMATION_SETTLE_TIMEOUT_MS = 2_000;

/**
 * Wait until finite document animations have finished before sampling the DOM.
 *
 * The predicate is polled on animation frames and must be stable for two
 * consecutive frames. Infinite animations (spinners, pulses, scan lines) and
 * idle/paused animations are intentionally non-blocking. On timeout, callers
 * get a warning and can continue the audit instead of hanging the entire run.
 */
export async function waitForFiniteAnimationsToSettle(
  page: Page,
  routeLabel: string,
  timeoutMs = ANIMATION_SETTLE_TIMEOUT_MS,
): Promise<boolean> {
  const stableFramesProperty = '__braketAuditStableAnimationFrames';

  try {
    await page.evaluate((property) => {
      delete (window as unknown as Record<string, unknown>)[property];
    }, stableFramesProperty);

    await page.waitForFunction(
      ({property, requiredStableFrames}) => {
        const state = window as unknown as Record<string, number | undefined>;
        const hasPendingFiniteAnimation = document
          .getAnimations()
          .some((animation) => {
            if (
              animation.playState === 'idle' ||
              animation.playState === 'paused' ||
              animation.playState === 'finished' ||
              animation.playbackRate === 0
            ) {
              return false;
            }

            const endTime = animation.effect?.getComputedTiming().endTime;
            return typeof endTime === 'number' && Number.isFinite(endTime);
          });

        state[property] = hasPendingFiniteAnimation
          ? 0
          : (state[property] ?? 0) + 1;

        return state[property] >= requiredStableFrames;
      },
      {property: stableFramesProperty, requiredStableFrames: 2},
      {polling: 'raf', timeout: timeoutMs},
    );

    return true;
  } catch (err) {
    let pendingCount: number | 'unknown' = 'unknown';
    try {
      pendingCount = await page.evaluate(
        () =>
          document.getAnimations().filter((animation) => {
            if (
              animation.playState === 'idle' ||
              animation.playState === 'paused' ||
              animation.playState === 'finished' ||
              animation.playbackRate === 0
            ) {
              return false;
            }

            const endTime = animation.effect?.getComputedTiming().endTime;
            return typeof endTime === 'number' && Number.isFinite(endTime);
          }).length,
      );
    } catch {
      // The page may have navigated or closed while gathering timeout details.
    }

    console.warn(
      `[runChecks] Finite animations did not settle within ${timeoutMs}ms on "${routeLabel}" (${pendingCount} still pending) — proceeding anyway`,
      err,
    );
    return false;
  } finally {
    try {
      await page.evaluate((property) => {
        delete (window as unknown as Record<string, unknown>)[property];
      }, stableFramesProperty);
    } catch {
      // The page may have navigated or closed after the timeout.
    }
  }
}

export async function runChecks(
  page: Page,
  route: AuditRoute,
  viewport: 'desktop' | 'mobile',
  config: RunChecksConfig,
  theme?: 'dark' | 'light',
): Promise<AuditRouteResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const findings: AuditFinding[] = [];
  const consoleErrors: string[] = [];

  // Stage 1: Set up console error collection BEFORE navigation.
  // Named handler so we can remove it after the route run (avoids listener accumulation
  // in serial mode where a shared page object is reused across multiple runChecks calls).
  const consoleHandler = (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isNoisyConsoleError(text)) {
        consoleErrors.push(text);
      }
    }
  };
  page.on('console', consoleHandler);

  // Stage 2: Navigate and wait for readyLocator.
  // Theme is applied in two steps:
  // 1. Set localStorage before goto() so Angular's BraDarkMode service reads the correct
  //    value on init. This requires an existing page context (guaranteed in serial mode after
  //    global.setup or prior navigation). On first run, the localStorage write is a no-op if
  //    the page isn't yet loaded — step 2 compensates.
  // 2. Force-apply the <html> classes + colorScheme after load to guarantee the DOM reflects
  //    the requested theme regardless of Angular's change-detection timing.
  //
  // We intentionally do NOT use page.addInitScript() here — it accumulates across calls when
  // a shared page object is reused in serial mode and cannot be removed via Playwright's API.
  if (theme) {
    try {
      await page.evaluate((t: string) => {
        localStorage.setItem('theme', t);
      }, theme);
    } catch {
      // Page may not be navigated yet on first use — the post-goto evaluate below handles it.
    }
  }

  await page.goto(route.path);
  await expect(page.locator(route.readyLocator).first()).toBeVisible({
    timeout: 30000,
  });

  // Force-apply theme classes on <html> after Angular has initialised.
  if (theme) {
    await page.evaluate((t: string) => {
      const html = document.documentElement;
      localStorage.setItem('theme', t);
      html.classList.toggle('dark', t === 'dark');
      html.setAttribute('data-theme', t);
      html.style.colorScheme = t;
    }, theme);
  }

  // Stage 3: Handle postNavAction
  if (route.postNavAction === 'click-register-tab') {
    try {
      await page.getByRole('tab', {name: /register|create|sign up/i}).click();
      await expect(page.getByRole('heading')).toBeVisible({timeout: 10000});
    } catch (err) {
      console.warn(
        `[runChecks] postNavAction 'click-register-tab' failed on "${route.label}":`,
        err,
      );
    }
  }

  // Stage 4: Wait for loading indicators to settle before running any checks.
  // Waits for:
  // - <z-skeleton> elements (the actual loading placeholder component)
  // - [data-testid="loading-state"] divs (manual loading skeletons in community admin)
  // Do NOT wait for .animate-pulse — it's a generic Tailwind utility also used for
  // permanent animations unrelated to loading state.
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll('z-skeleton').length === 0 &&
        document.querySelectorAll('[data-testid="loading-state"]').length === 0,
      undefined,
      {timeout: 15_000},
    );
  } catch {
    console.warn(
      `[runChecks] Loading indicators still visible after 15s on "${route.label}" — proceeding anyway`,
    );
  }

  // Stage 5: Wait for route/view-transition and entry animations to settle so
  // axe and geometry checks sample the final rendered state.
  await waitForFiniteAnimationsToSettle(page, route.label);

  // Stage 6: axe-core WCAG 2.1 AA audit
  try {
    const axeResults = await new AxeBuilder({page})
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    for (const violation of axeResults.violations) {
      const axeImpactMap: Record<string, Severity> = {
        critical: 'critical',
        serious: 'serious',
        moderate: 'moderate',
        minor: 'minor',
      };
      const severity: Severity =
        axeImpactMap[violation.impact ?? ''] ?? 'moderate';
      findings.push({
        check: `axe-${violation.id}`,
        severity,
        message: violation.description,
        element: (() => {
          const rawTarget = violation.nodes[0]?.target?.[0];
          return typeof rawTarget === 'string'
            ? rawTarget
            : Array.isArray(rawTarget)
              ? rawTarget[0]
              : undefined;
        })(),
        suggestion: violation.help,
      });
    }
  } catch (err) {
    console.warn(
      `[runChecks] axe-core analysis failed on "${route.label}":`,
      err,
    );
  }

  // Stage 7: Static DOM checks
  const simpleChecks: Array<(page: Page) => Promise<AuditFinding[]>> = [
    checkHeadingHierarchy,
    checkTextOverflow,
    checkBrokenImages,
    checkMissingAltText,
    checkEmptyButtons,
    checkEmptyLinks,
    checkViewportOverflow,
  ];

  for (const check of simpleChecks) {
    try {
      const checkFindings = await check(page);
      findings.push(...checkFindings);
    } catch (err) {
      console.warn(
        `[runChecks] Static check "${check.name}" failed on "${route.label}":`,
        err,
      );
    }
  }

  // Touch targets: tiered WCAG 2.2 AA thresholds with inline/spacing exceptions.
  // Runs on both viewports — the checker itself handles element-type-aware sizing.
  try {
    const touchFindings = await checkTouchTargets(page);
    findings.push(...touchFindings);
  } catch (err) {
    console.warn(
      `[runChecks] Static check "checkTouchTargets" failed on "${route.label}":`,
      err,
    );
  }

  // Stage 8: Hide dev-only overlays before screenshot (they confuse LLM review)
  await page.evaluate(() => {
    const devOverlay = document.querySelector('[data-testid="dev-overlay"]');
    if (devOverlay) (devOverlay as HTMLElement).style.display = 'none';
  });

  // Stage 9: Full-page screenshot (after skeletons have settled)
  const safeLabel = route.label.replace(/[^a-zA-Z0-9-]/g, '_');
  const themeSuffix = theme ? `-${theme}` : '';
  const screenshotPath = `${config.screenshotDir}/${safeLabel}-${viewport}${themeSuffix}.png`;
  try {
    mkdirSync(dirname(screenshotPath), {recursive: true});
    await page.screenshot({path: screenshotPath, fullPage: true});
  } catch (err) {
    console.warn(`[runChecks] Screenshot failed on "${route.label}":`, err);
  }

  // Build the result object before the optional LLM stage.
  const result: AuditRouteResult = {
    route,
    viewport,
    ...(theme !== undefined ? {theme} : {}),
    timestamp,
    screenshotPath,
    consoleErrors,
    findings,
    durationMs: Date.now() - startTime,
  };

  // Stage 9: LLM design review (if enabled)
  if (config.llmProvider !== 'skip') {
    try {
      const provider = createLlmProvider(config.llmProvider);
      const designContext = readFileSync(
        resolve(__dirname, '..', '..', '..', '.impeccable.md'),
        'utf-8',
      );
      const screenshotBase64 = readFileSync(screenshotPath, 'base64');
      const reviewLabel = theme
        ? `${route.label} (${theme} mode)`
        : route.label;
      const review = await provider.reviewScreenshot(
        screenshotBase64,
        reviewLabel,
        viewport,
        designContext,
      );
      if (review) {
        result.llmScore = review.overallScore;
        result.llmSummary = review.summary;
        for (const f of review.findings) {
          findings.push({
            check: 'llm-design-review',
            severity: f.severity,
            message: `[${f.area}] ${f.issue}`,
            suggestion: f.suggestion,
          });
        }
      }
    } catch (err) {
      console.warn(`[runChecks] LLM review failed on "${route.label}":`, err);
    }
  }

  // Stage 10: Remove the console listener before returning to prevent accumulation
  // across routes when a shared page is reused in serial mode.
  page.off('console', consoleHandler);

  return result;
}
