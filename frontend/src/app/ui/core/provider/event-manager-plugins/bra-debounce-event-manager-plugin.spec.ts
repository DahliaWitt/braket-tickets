import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BraDebounceEventManagerPlugin } from './bra-debounce-event-manager-plugin';

type WrappedListener = (event: Event) => void;

describe('BraDebounceEventManagerPlugin', () => {
  let plugin: BraDebounceEventManagerPlugin;
  let wrappedListener: WrappedListener | undefined;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    wrappedListener = undefined;
    unsubscribe.mockReset();

    plugin = new BraDebounceEventManagerPlugin(document);
    const manager = {
      addEventListener: vi.fn(
        (
          _element: HTMLElement,
          _eventName: string,
          listener: WrappedListener,
          _options?: AddEventListenerOptions,
        ) => {
          wrappedListener = listener;
          return unsubscribe;
        },
      ),
    };
    (plugin as unknown as { manager: typeof manager }).manager = manager;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports only debounce event bindings', () => {
    expect(plugin.supports('input.debounce')).toBe(true);
    expect(plugin.supports('input.debounce.150')).toBe(true);
    expect(plugin.supports('click')).toBe(false);
  });

  it('registers the base event name', () => {
    const element = document.createElement('input');
    const handler = vi.fn();
    plugin.addEventListener(element, 'input.debounce.150', handler);

    const manager = (
      plugin as unknown as { manager: { addEventListener: ReturnType<typeof vi.fn> } }
    ).manager;
    expect(manager.addEventListener).toHaveBeenCalledWith(
      element,
      'input',
      expect.any(Function),
      undefined,
    );
  });

  it('debounces events using configured delay', () => {
    const element = document.createElement('input');
    const handler = vi.fn();
    plugin.addEventListener(element, 'input.debounce.150', handler);

    wrappedListener?.(new Event('input'));
    wrappedListener?.(new Event('input'));
    vi.advanceTimersByTime(149);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('defaults to 300ms when delay is omitted or invalid', () => {
    const element = document.createElement('input');
    const handler = vi.fn();
    plugin.addEventListener(element, 'input.debounce.invalid', handler);

    wrappedListener?.(new Event('input'));
    vi.advanceTimersByTime(299);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('clears pending timeout on unsubscribe', () => {
    const element = document.createElement('input');
    const handler = vi.fn();
    const dispose = plugin.addEventListener(element, 'input.debounce.150', handler);

    wrappedListener?.(new Event('input'));
    dispose();
    vi.advanceTimersByTime(200);

    expect(handler).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
