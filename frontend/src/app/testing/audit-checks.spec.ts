import {type Page} from '@playwright/test';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  checkTouchTargets,
  checkViewportOverflow,
  isNoisyConsoleError,
} from '../../../e2e/audit/audit-checks';

function evaluationPage(): Page {
  return {
    evaluate: async <Result>(callback: () => Result) => callback(),
  } as unknown as Page;
}

function makeRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function setElementRect(element: HTMLElement, rect: DOMRect): void {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    value: document.body,
  });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
}

function setViewport(width: number, height: number): void {
  Object.defineProperties(document.documentElement, {
    clientWidth: {configurable: true, value: width},
    clientHeight: {configurable: true, value: height},
  });
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
  vi.restoreAllMocks();
});

describe('audit checks', () => {
  it('suppresses only the observed benign NG0913 warning shape', () => {
    const benignWarning =
      'NG0913: An image with src http://127.0.0.1:64532/api/storage/event-art is the Largest Contentful Paint (LCP) element but was given a "loading" value of "lazy", which can negatively impact application loading performance. This warning can be addressed by changing the loading value of the LCP image to "eager", or by using the NgOptimizedImage directive\'s prioritization utilities. For more information about addressing or disabling this warning, see https://v22.angular.dev/errors/NG0913. Find more at https://v22.angular.dev/errors/NG0913';

    expect(isNoisyConsoleError(benignWarning)).toBe(true);
    expect(isNoisyConsoleError('NG0100: Expression has changed')).toBe(false);
    expect(isNoisyConsoleError('NG0200: Circular dependency in DI')).toBe(
      false,
    );
    expect(isNoisyConsoleError('NG0201: No provider found')).toBe(false);
    expect(
      isNoisyConsoleError(
        'NG0913: An image has intrinsic file dimensions much larger than its rendered size.',
      ),
    ).toBe(false);
  });

  it('reports a 30px CTA only as non-critical usability guidance', async () => {
    const button = document.createElement('button');
    button.id = 'confirm';
    button.textContent = 'Confirm purchase';
    document.body.append(button);
    setElementRect(button, makeRect(20, 20, 30, 30));

    const findings = await checkTouchTargets(evaluationPage());

    expect(findings).toEqual([
      expect.objectContaining({
        check: 'cta-touch-target-guidance',
        severity: 'minor',
        element: '#confirm',
      }),
    ]);
  });

  it('does not exempt a standalone small action link in a generic span', async () => {
    document.body.innerHTML =
      '<span>Actions: <a id="remove-action" href="/remove">Remove</a></span><button id="nearby">More</button>';
    const link = document.querySelector<HTMLElement>('#remove-action')!;
    const nearby = document.querySelector<HTMLElement>('#nearby')!;
    setElementRect(link, makeRect(0, 0, 12, 12));
    setElementRect(nearby, makeRect(12, 0, 24, 24));

    const findings = await checkTouchTargets(evaluationPage());

    expect(findings).toContainEqual(
      expect.objectContaining({
        check: 'touch-target-size',
        element: '#remove-action',
      }),
    );
  });

  it('does not exempt an action link nested in a generic container within prose', async () => {
    document.body.innerHTML =
      '<li><span>Guest</span><span><a id="nested-remove" href="/remove">Remove</a></span></li><button id="nearby">More</button>';
    const link = document.querySelector<HTMLElement>('#nested-remove')!;
    const nearby = document.querySelector<HTMLElement>('#nearby')!;
    setElementRect(link, makeRect(0, 0, 12, 12));
    setElementRect(nearby, makeRect(12, 0, 24, 24));

    const findings = await checkTouchTargets(evaluationPage());

    expect(findings).toContainEqual(
      expect.objectContaining({
        check: 'touch-target-size',
        element: '#nested-remove',
      }),
    );
  });

  it('exempts a small link genuinely embedded in adjacent prose', async () => {
    document.body.innerHTML =
      '<p>Read our <a id="terms-link" href="/terms">terms</a> before continuing.</p><button id="nearby">More</button>';
    const link = document.querySelector<HTMLElement>('#terms-link')!;
    const nearby = document.querySelector<HTMLElement>('#nearby')!;
    setElementRect(link, makeRect(0, 0, 12, 12));
    setElementRect(nearby, makeRect(12, 0, 24, 24));

    const findings = await checkTouchTargets(evaluationPage());

    expect(findings.some((finding) => finding.element === '#terms-link')).toBe(
      false,
    );
  });

  it('reports visible transformed overflow and skips fully offscreen transforms', async () => {
    setViewport(320, 640);
    document.body.innerHTML = `
      <div id="visible" style="transform: scale(1.1)"></div>
      <div id="offscreen" style="transform: translateX(100%)"></div>
      <div id="offscreen-ancestor" style="transform: translateX(100%)">
        <div id="offscreen-child"></div>
      </div>
    `;
    const visible = document.querySelector<HTMLElement>('#visible')!;
    const offscreen = document.querySelector<HTMLElement>('#offscreen')!;
    const ancestor = document.querySelector<HTMLElement>(
      '#offscreen-ancestor',
    )!;
    const child = document.querySelector<HTMLElement>('#offscreen-child')!;
    setElementRect(visible, makeRect(300, 20, 80, 40));
    setElementRect(offscreen, makeRect(350, 20, 80, 40));
    setElementRect(ancestor, makeRect(350, 80, 100, 100));
    setElementRect(child, makeRect(340, 90, 60, 40));

    const findings = await checkViewportOverflow(evaluationPage());

    expect(findings).toEqual([
      expect.objectContaining({
        check: 'viewport-overflow',
        element: '#visible',
      }),
    ]);
  });
});
