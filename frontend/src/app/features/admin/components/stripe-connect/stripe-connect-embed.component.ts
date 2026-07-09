import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  loadConnectAndInitialize,
  type ConnectElementTagName,
  type StripeConnectInstance,
} from '@stripe/connect-js';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {injectConvex} from 'convex-angular';

import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {logger} from '@/utils/logger';
import {BraDarkMode} from '@ui/services/dark-mode';
import {environment} from '../../../../../environments/environment';
import {buildStripeConnectAppearance} from './stripe-connect-appearance';
import {mountMockConnectComponents} from './stripe-connect-embed.mock';

/**
 * Which Stripe Connect embedded components this wrapper can mount. Each
 * flag maps directly to a Connect component — see
 * https://docs.stripe.com/connect/supported-embedded-components.
 */
export type StripeConnectComponentKind =
  | 'account-onboarding'
  | 'account-management'
  | 'notification-banner'
  | 'payments'
  | 'balances'
  | 'documents';

/**
 * Map our feature-facing kind names to the tag names the
 * `@stripe/connect-js` factory expects. The SDK's `instance.create()`
 * takes the short form (`account-onboarding`); it registers the
 * `stripe-connect-*` custom element internally.
 */
const COMPONENT_KIND_TO_FACTORY_NAME: Record<
  StripeConnectComponentKind,
  ConnectElementTagName
> = {
  'account-onboarding': 'account-onboarding',
  'account-management': 'account-management',
  'notification-banner': 'notification-banner',
  payments: 'payments',
  balances: 'balances',
  documents: 'documents',
};

/**
 * Narrow view of the element returned by
 * `StripeConnectInstance.create('account-onboarding' | 'account-management')`.
 * The SDK's typed return has `setOnExit` but it's hidden behind a
 * discriminated union, so we re-declare the subset we consume.
 */
interface ConnectOnboardingLikeElement extends HTMLElement {
  setOnExit?: (cb: () => void) => void;
}

/**
 * Embedded Stripe Connect component wrapper.
 *
 * Replaces the V1 hosted onboarding + Express dashboard redirect flows.
 * The backend issues a short-lived Account Session; this component hands
 * that secret to `@stripe/connect-js`'s `loadConnectAndInitialize`,
 * constructs a `StripeConnectInstance`, and mounts the requested
 * component(s) into a managed container. Secret refresh is plumbed
 * through the `fetchClientSecret` callback so components can renew
 * themselves without a round trip through the app.
 *
 * Event callbacks:
 * - `exited` — emitted when an onboarding-style component signals the
 *   user has exited (Task 10 uses this to refresh account status).
 * - `loadError` — surfaced so the host page can render a retry control.
 */
@Component({
  selector: 'app-stripe-connect-embed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [ZardSkeletonComponent],
  // Stripe's V2 custom elements inherit `display: inline` (the browser
  // default for unregistered element names) and the SDK never sets
  // `display: block` on them. Force block layout on all of them so the
  // inner auto-resizing iframe can grow. Onboarding alone gets a
  // min-height floor: its iframe starts at 1px before any postMessage
  // lands, and without a floor the component collapses to a flat band
  // before Stripe's UI has a chance to report its real size. The
  // post-onboarding components (management, payments, balances,
  // documents, notification-banner) report height reliably as soon as
  // content mounts; giving them a 320px floor just bolts ~100–200px of
  // dead space onto each one.
  styles: [
    `
      app-stripe-connect-embed stripe-connect-account-onboarding {
        display: block;
        width: 100%;
        min-height: 320px;
      }
      app-stripe-connect-embed stripe-connect-account-management,
      app-stripe-connect-embed stripe-connect-payments,
      app-stripe-connect-embed stripe-connect-balances,
      app-stripe-connect-embed stripe-connect-documents,
      app-stripe-connect-embed stripe-connect-notification-banner {
        display: block;
        width: 100%;
      }
    `,
  ],
  template: `
    <div class="ph-no-capture w-full space-y-3">
      @if (loading()) {
        <z-skeleton class="block h-40 w-full rounded-lg" />
      }
      @if (error(); as err) {
        <p
          data-testid="stripe-connect-embed-error"
          class="text-sm text-destructive-text"
        >
          {{ err }}
        </p>
      }
      <div
        #host
        class="w-full space-y-3"
        [class.hidden]="loading() || error()"
        data-testid="stripe-connect-embed-host"
      ></div>
    </div>
  `,
})
export class StripeConnectEmbedComponent {
  private destroyRef = inject(DestroyRef);
  private convex = injectConvex();
  private darkMode = inject(BraDarkMode);

  readonly organizerId = input.required<Id<'organizers'>>();
  readonly components = input.required<readonly StripeConnectComponentKind[]>();

  readonly exited = output<void>();
  readonly loadError = output<string>();

  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  private readonly hostRef =
    viewChild.required<ElementRef<HTMLElement>>('host');

  private instance: StripeConnectInstance | null = null;
  private lastInitializedOrganizerId: string | null = null;
  private lastAppliedAppearanceThemeMode: ReturnType<
    BraDarkMode['themeMode']
  > | null = null;
  /**
   * The sorted component set that the current Account Session was minted
   * for. Used to detect whether `components()` has expanded beyond what
   * the session authorized, in which case we must tear down and recreate.
   */
  private lastInitializedComponents = '';
  private readonly connectAppearance = computed(() =>
    buildStripeConnectAppearance(this.darkMode.themeMode()),
  );
  private readonly requestedAccountSessionArgs = computed(() => ({
    organizerId: this.organizerId(),
    components: this.accountSessionComponentsArg(),
  }));

  /**
   * Convert the component list into the Account Session `components`
   * object expected by the backend `backend/convex/stripe/actions.ts`
   * `createAccountSession` action.
   */
  private accountSessionComponentsArg(): {
    accountOnboarding?: boolean;
    accountManagement?: boolean;
    notificationBanner?: boolean;
    payments?: boolean;
    balances?: boolean;
    documents?: boolean;
  } {
    const enabled: Record<string, boolean> = {};
    for (const kind of this.components()) {
      switch (kind) {
        case 'account-onboarding':
          enabled['accountOnboarding'] = true;
          break;
        case 'account-management':
          enabled['accountManagement'] = true;
          break;
        case 'notification-banner':
          enabled['notificationBanner'] = true;
          break;
        case 'payments':
          enabled['payments'] = true;
          break;
        case 'balances':
          enabled['balances'] = true;
          break;
        case 'documents':
          enabled['documents'] = true;
          break;
      }
    }
    return enabled;
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      // Remove DOM nodes before logout so the SDK releases its element
      // observers before Angular tears down the host. This prevents the
      // StripeAccountPayoutSettingsFragment duplicate-registration warning
      // that accumulates on repeated navigations to this page (BRA-388).
      this.clearHost();
      const instance = this.instance;
      this.instance = null;
      this.lastInitializedOrganizerId = null;
      this.lastInitializedComponents = '';
      this.lastAppliedAppearanceThemeMode = null;
      if (!instance) return;
      // `logout()` returns a Promise but we cannot await inside
      // `onDestroy`. Swallow rejection so cleanup never surfaces as an
      // unhandled rejection — we're tearing the component down anyway.
      instance
        .logout()
        .catch((err: unknown) =>
          logger.warn('Stripe Connect instance logout failed', err),
        );
    });

    // Rebuild when inputs change. Signal-driven so the parent page can
    // swap components (e.g. 'account-onboarding' → management cluster
    // after KYC completes) without remounting the Angular component.
    effect(() => {
      const args = this.requestedAccountSessionArgs();
      if (!args.organizerId) return;
      void untracked(() => this.rebuild(args.organizerId, args.components));
    });

    // Connect.js owns iframe internals, so theme changes must go through
    // its Appearance API instead of host CSS selectors.
    effect(() => {
      const themeMode = this.darkMode.themeMode();
      const appearance = this.connectAppearance();
      untracked(() => {
        if (
          !this.instance ||
          this.lastAppliedAppearanceThemeMode === themeMode
        ) {
          return;
        }
        this.instance.update({appearance});
        this.lastAppliedAppearanceThemeMode = themeMode;
      });
    });
  }

  private async rebuild(
    organizerId: Id<'organizers'>,
    componentsArg: ReturnType<
      StripeConnectEmbedComponent['accountSessionComponentsArg']
    >,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    // Remove previously mounted elements before remounting.
    this.clearHost();

    const organizerChanged = this.lastInitializedOrganizerId !== organizerId;
    // Build a stable key for the requested component set so we can detect
    // when `components()` expands beyond what the current Account Session
    // was minted for. A session authorizes a fixed set of components; if
    // the new set is not a subset of the minted set, the SDK will reject
    // mount calls for the unauthorized components. Tear down and recreate.
    const requestedComponentKey = [...this.components()].sort().join(',');
    const componentsExpanded =
      !organizerChanged &&
      this.instance !== null &&
      this.lastInitializedComponents !== '' &&
      requestedComponentKey !== this.lastInitializedComponents &&
      !this.isSubsetOf(requestedComponentKey, this.lastInitializedComponents);

    // Destroy the existing instance when:
    // 1. The organizer changed (original behavior — avoids duplicate
    //    StripeAccountPayoutSettingsFragment warnings, BRA-388).
    // 2. The new component set is not a subset of the minted session's
    //    component set (F6 — prevents mounting unauthorized components).
    if ((organizerChanged || componentsExpanded) && this.instance) {
      try {
        await this.instance.logout();
      } catch (err) {
        logger.warn('Stripe Connect instance logout failed', err);
      }
      this.instance = null;
      this.lastAppliedAppearanceThemeMode = null;
    }

    // E2E / unit mock path: skip the Stripe CDN + Account Session round
    // trip and render placeholder elements with the same `data-testid`
    // values the real SDK branch produces.
    if (environment.stripe.mockPayments) {
      this.lastInitializedOrganizerId = organizerId;
      this.lastInitializedComponents = requestedComponentKey;
      mountMockConnectComponents(
        this.hostRef().nativeElement,
        this.components(),
      );
      this.loading.set(false);
      return;
    }

    try {
      if (!this.instance) {
        const themeMode = this.darkMode.themeMode();
        this.instance = loadConnectAndInitialize({
          publishableKey: environment.stripe.publishableKey,
          appearance: buildStripeConnectAppearance(themeMode),
          fetchClientSecret: async () => {
            try {
              const result = await this.convex.action(
                api.stripe.actions.createAccountSession,
                {
                  organizerId,
                  components: componentsArg,
                },
              );
              if (!result || typeof result.clientSecret !== 'string') {
                throw new Error(
                  'createAccountSession returned no clientSecret',
                );
              }
              return result.clientSecret;
            } catch (err: unknown) {
              // Surface failure to the host page BEFORE rethrowing so the
              // Angular template renders a single, consistent error — an
              // empty-string return would cause the SDK to issue a 400
              // and show its own error UI on top of ours. Rethrowing
              // keeps the SDK from mounting the component at all.
              const message =
                err instanceof Error
                  ? err.message
                  : 'Failed to fetch Stripe account session';
              logger.error('Stripe Connect fetchClientSecret failed', err);
              this.error.set(message);
              this.loading.set(false);
              this.loadError.emit(message);
              throw err instanceof Error ? err : new Error(message);
            }
          },
        });
        this.lastInitializedOrganizerId = organizerId;
        this.lastInitializedComponents = requestedComponentKey;
        this.lastAppliedAppearanceThemeMode = themeMode;
      }

      this.mountRequestedComponents();
      this.loading.set(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to initialize Stripe Connect';
      logger.error('Stripe Connect initialization failed', err);
      this.error.set(message);
      this.loading.set(false);
      this.loadError.emit(message);
    }
  }

  private mountRequestedComponents(): void {
    const instance = this.instance;
    if (!instance) return;
    const host = this.hostRef().nativeElement;
    host.replaceChildren();

    for (const kind of this.components()) {
      const factoryName = COMPONENT_KIND_TO_FACTORY_NAME[kind];
      // `StripeConnectInstance.create()` returns an element that's
      // already registered, wired to this session, and ready to mount.
      // Using `document.createElement('stripe-connect-*')` instead
      // produces a bare custom element that loads the Stripe UI layer
      // iframe but never renders content — it's not bound to our
      // StripeConnectInstance.
      const element = instance.create(
        factoryName,
      ) as ConnectOnboardingLikeElement;
      element.setAttribute('data-testid', `stripe-connect-${kind}`);
      host.appendChild(element);

      if (
        (kind === 'account-onboarding' || kind === 'account-management') &&
        typeof element.setOnExit === 'function'
      ) {
        element.setOnExit(() => this.exited.emit());
      }
    }
  }

  private clearHost(): void {
    const host = this.hostRef().nativeElement;
    host.replaceChildren();
  }

  /**
   * Returns true when every component in `requestedKey` (sorted CSV) is
   * also present in `mintedKey` (sorted CSV).
   */
  private isSubsetOf(requestedKey: string, mintedKey: string): boolean {
    if (requestedKey === '') return true;
    const minted = new Set(mintedKey.split(','));
    return requestedKey.split(',').every((c) => minted.has(c));
  }
}
