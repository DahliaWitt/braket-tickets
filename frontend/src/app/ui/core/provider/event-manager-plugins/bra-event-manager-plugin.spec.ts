import { describe, expect, it, beforeEach, vi } from 'vitest';
import { BraEventManagerPlugin } from './bra-event-manager-plugin';

type WrappedListener = (event: Event) => void;

describe('BraEventManagerPlugin', () => {
  let plugin: BraEventManagerPlugin;
  let wrappedListener: WrappedListener | undefined;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    wrappedListener = undefined;
    unsubscribe.mockReset();

    plugin = new BraEventManagerPlugin(document);
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
  });

  it('supports modifier events', () => {
    expect(plugin.supports('click.prevent')).toBe(true);
    expect(plugin.supports('click.stop')).toBe(true);
    expect(plugin.supports('keydown.enter.stop-immediate')).toBe(true);
    expect(plugin.supports('click.prevent-with-stop')).toBe(true);
    expect(plugin.supports('click')).toBe(false);
  });

  it('parses the base event name before registering', () => {
    const element = document.createElement('button');
    const handler = vi.fn();
    plugin.addEventListener(element, 'keydown.{enter,space}.prevent', handler);

    const manager = (
      plugin as unknown as { manager: { addEventListener: ReturnType<typeof vi.fn> } }
    ).manager;
    expect(manager.addEventListener).toHaveBeenCalledWith(
      element,
      'keydown',
      expect.any(Function),
      undefined,
    );
  });

  it('applies preventDefault for matching modifier', () => {
    const element = document.createElement('button');
    const handler = vi.fn();
    plugin.addEventListener(element, 'click.prevent', handler);

    const event = new Event('click');
    const preventDefault = vi.fn();
    Object.defineProperty(event, 'preventDefault', { value: preventDefault });

    wrappedListener?.(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('skips modifiers for aria-disabled elements', () => {
    const element = document.createElement('button');
    element.setAttribute('aria-disabled', 'true');
    const handler = vi.fn();
    plugin.addEventListener(element, 'click.stop', handler);

    const event = new Event('click');
    const stopPropagation = vi.fn();
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation });

    wrappedListener?.(event);

    expect(stopPropagation).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('applies key filter modifiers only for matching keys', () => {
    const element = document.createElement('input');
    const handler = vi.fn();
    plugin.addEventListener(element, 'keydown.{enter,space}.prevent', handler);

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    const preventDefaultEnter = vi.fn();
    const preventDefaultEscape = vi.fn();
    Object.defineProperty(enterEvent, 'preventDefault', { value: preventDefaultEnter });
    Object.defineProperty(escapeEvent, 'preventDefault', { value: preventDefaultEscape });

    wrappedListener?.(enterEvent);
    wrappedListener?.(escapeEvent);

    expect(preventDefaultEnter).toHaveBeenCalledTimes(1);
    expect(preventDefaultEscape).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
