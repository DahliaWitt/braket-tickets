import { logger } from '@/utils/logger';
import { isValidSessionMessage, type SessionChannelMessage } from './auth.service.helpers';

interface AuthSessionSyncHandlers {
  onLogin: () => void;
  onLogout: () => void;
}

interface BroadcastChannelLike {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: SessionChannelMessage) => void;
  close: () => void;
}

type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

/**
 * Owns BroadcastChannel lifecycle and message routing for auth state changes.
 * AuthService provides the side effects to run when another tab logs in or out.
 */
export class AuthSessionSync {
  private channel: BroadcastChannelLike | null = null;

  constructor(
    private readonly handlers: AuthSessionSyncHandlers,
    private readonly createChannel: BroadcastChannelFactory = (name) => new BroadcastChannel(name),
  ) {
    this.connect();
  }

  broadcast(type: SessionChannelMessage['type']): void {
    if (!this.channel) {
      return;
    }

    try {
      this.channel.postMessage({ type });
      logger.debug(`[AuthService] Broadcasted ${type} to other tabs`);
    } catch (err) {
      logger.warn('[AuthService] Failed to broadcast session change:', err);
    }
  }

  disconnect(): void {
    if (!this.channel) {
      return;
    }

    try {
      this.channel.onmessage = null;
      this.channel.close();
    } catch (err) {
      logger.warn('[AuthService] Failed to close BroadcastChannel:', err);
    } finally {
      this.channel = null;
    }
  }

  private connect(): void {
    if (typeof BroadcastChannel === 'undefined') {
      logger.warn('[AuthService] BroadcastChannel not available, cross-tab sync disabled');
      return;
    }

    try {
      this.channel = this.createChannel('braket-auth-session');
      this.channel.onmessage = (event: MessageEvent) => {
        if (!isValidSessionMessage(event.data)) {
          logger.warn(
            '[AuthService] Rejected invalid BroadcastChannel message:',
            typeof event.data,
          );
          return;
        }

        if (event.data.type === 'LOGOUT') {
          logger.info('[AuthService] Received logout signal from another tab');
          this.handlers.onLogout();
          return;
        }

        logger.info('[AuthService] Received login signal from another tab, refreshing session');
        this.handlers.onLogin();
      };

      logger.info('[AuthService] Cross-tab session sync initialized');
    } catch (err) {
      logger.warn('[AuthService] Failed to initialize BroadcastChannel:', err);
    }
  }
}
