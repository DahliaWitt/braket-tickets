import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {logger} from '@/utils/logger';
import {AuthSessionSync} from './auth-session-sync';

describe('AuthSessionSync', () => {
  let onLogin: ReturnType<typeof vi.fn>;
  let onLogout: ReturnType<typeof vi.fn>;
  let capturedOnMessage: ((event: MessageEvent) => void) | null;
  let postMessage: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onLogin = vi.fn();
    onLogout = vi.fn();
    capturedOnMessage = null;
    postMessage = vi.fn();
    close = vi.fn();

    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'BroadcastChannel',
      class MockBroadcastChannel {
        constructor(_name: string) {
          Object.defineProperty(this, 'onmessage', {
            configurable: true,
            get: () => capturedOnMessage,
            set: (handler: ((event: MessageEvent) => void) | null) => {
              capturedOnMessage = handler;
            },
          });
        }

        postMessage = postMessage;
        close = close;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createSync(): AuthSessionSync {
    return new AuthSessionSync({
      onLogin: onLogin as unknown as () => void,
      onLogout: onLogout as unknown as () => void,
    });
  }

  function dispatchMessage(data: unknown): void {
    expect(capturedOnMessage).not.toBeNull();
    capturedOnMessage?.({data} as MessageEvent);
  }

  it('dispatches valid login and logout messages to callbacks', () => {
    createSync();

    dispatchMessage({type: 'LOGIN'});
    dispatchMessage({type: 'LOGOUT'});

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects invalid messages and logs their runtime type', () => {
    createSync();

    dispatchMessage('LOGIN');

    expect(onLogin).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[AuthService] Rejected invalid BroadcastChannel message:',
      'string',
    );
  });

  it('broadcasts session changes and tears the channel down cleanly', () => {
    const sync = createSync();

    sync.broadcast('LOGIN');
    sync.disconnect();

    expect(postMessage).toHaveBeenCalledWith({type: 'LOGIN'});
    expect(close).toHaveBeenCalledTimes(1);
    expect(capturedOnMessage).toBeNull();
  });
});
