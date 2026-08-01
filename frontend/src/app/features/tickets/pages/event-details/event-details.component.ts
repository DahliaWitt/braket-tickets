import {
  Component,
  DestroyRef,
  inject,
  signal,
  computed,
  effect,
  afterNextRender,
  input,
  untracked,
  resource,
  ChangeDetectionStrategy,
  type AfterRenderRef,
} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {NgOptimizedImage} from '@angular/common';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {injectQueries, injectQuery, skipToken} from 'convex-angular';
import {PaymentService} from '@/features/tickets/services/payment.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {type Application} from '@/features/vetting/models/application.model';
import {CommunitiesService} from '@/core/services/communities.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {extractErrorMessage} from '@/core/utils/error-message.utils';
import {extractPaymentErrorMessage} from '@/features/tickets/services/payment-error-messages';
import {STRIPE_CONFIG, type StripeConfig} from '@/app.tokens';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {BraCommunityAvatarComponent} from '@ui/components/primitives/community-avatar/community-avatar.component';
import {BraCodeOfConductLinkComponent} from '@ui/components/primitives/code-of-conduct-link/code-of-conduct-link.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {CheckoutSidebarComponent} from '../../components/checkout-sidebar/checkout-sidebar.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {createSubmitGuard} from '@/utils/submit-guard';
import {sanitizeInternalReturnUrl} from '@/core/services/auth-navigation';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {type EventDetail} from '@/core/models/event.types';
import type {TicketTier} from '@shared/domain/ticket-tier';
import {EVENT_VISIBILITY} from '@shared/domain/event-visibility';
import {BraDarkMode, EDarkModes} from '@ui/services/dark-mode';
import {ContactCommunityDialogComponent} from './contact-community-dialog.component';
import {EventDetailsSidebarFocusService} from './event-details-sidebar-focus.service';
import {EventTicketStatusComponent} from './event-ticket-status.component';
import {awaitCheckoutSettlement} from './checkout-settlement';
import {CheckoutStore} from './checkout-store';
import {getContactDialogDescription} from './event-details-copy';
import {getBuyerPricingSummary} from '@shared/pricing/pricing-summary';
import {EventDatePipe} from '@/utils/event-date.pipe';
import {EventEndTimePipe} from '@/utils/event-end-time.pipe';

type EventOrganizer = NonNullable<EventDetail['organizer']>;

@Component({
  selector: 'app-event-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventDatePipe,
    EventEndTimePipe,
    RouterLink,
    NgOptimizedImage,
    ZardButtonComponent,
    ZardIconComponent,
    ZardSkeletonComponent,
    EmptyStateComponent,
    BraCommunityAvatarComponent,
    BraCodeOfConductLinkComponent,
    CheckoutSidebarComponent,
    EventTicketStatusComponent,
  ],
  providers: [EventDetailsSidebarFocusService, CheckoutStore],
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  private readonly destroyRef = inject(DestroyRef);
  route = inject(ActivatedRoute);
  router = inject(Router);
  auth = inject(AuthService);
  paymentService = inject(PaymentService);
  appsService = inject(ApplicationsService);
  communitiesService = inject(CommunitiesService);
  stripeConfig = inject<StripeConfig>(STRIPE_CONFIG);
  dialogService = inject(BraDialogService);
  resaleService = inject(ResaleService);
  private readonly darkMode = inject(BraDarkMode);
  private readonly sidebarFocus = inject(EventDetailsSidebarFocusService);
  readonly checkoutStore = inject(CheckoutStore);
  protected readonly EVENT_VISIBILITY = EVENT_VISIBILITY;
  readonly id = input.required<string>();
  readonly buy = input<string>();
  private readonly eventId = computed(() => this.id() as Id<'events'>);

  private isPrivilegedUser(): boolean {
    return this.auth.userRole() === 'root_admin';
  }

  private readonly queries = injectQueries(() => ({
    event: {
      query: api.events.public.get,
      args: {id: this.eventId()},
    },
    availability: {
      query: api.events.public.getAvailability,
      args: {
        eventId: this.eventId(),
        now: Math.floor(Date.now() / 60000) * 60000,
      },
    },
  }));

  private readonly organizerResource = resource({
    params: () => {
      if (this.event()?.organizer !== undefined) {
        return undefined;
      }

      const user = this.auth.user();
      const organizerId = this.event()?.organizerId;
      return user && organizerId ? {organizerId} : undefined;
    },
    loader: async ({params}): Promise<EventOrganizer | null> => {
      if (!params?.organizerId) return null;
      try {
        const community = await this.communitiesService.get(params.organizerId);
        if (!community) return null;
        return {
          _id: community._id,
          name: community.name,
          slug: community.slug,
          logoUrl: community.logoUrl,
          email: community.email,
          contactInfo: community.contactInfo,
          codeOfConduct: community.codeOfConduct,
        };
      } catch (e) {
        logger.error('Error loading organizer', e);
        return null;
      }
    },
  });

  private readonly appStatusRequestParams = computed(
    () => {
      const evt = this.event();
      const user = this.auth.user();
      const organizerId = evt?.organizerId;

      if (!evt || !user?._id || !organizerId) {
        return null;
      }

      return {userId: user._id, organizerId};
    },
    {
      equal: (prev, curr) =>
        prev?.userId === curr?.userId &&
        prev?.organizerId === curr?.organizerId,
    },
  );

  readonly appStatusResource = resource<
    Application | null,
    {userId: string; organizerId: Id<'organizers'>} | null
  >({
    params: () => this.appStatusRequestParams(),
    loader: async ({params}): Promise<Application | null> => {
      if (!params) {
        return null;
      }

      try {
        return await this.appsService.getMyApplicationForOrganizer(
          params.organizerId,
        );
      } catch (error: unknown) {
        logger.error('Error loading application status', error);
        throw error;
      }
    },
  });
  private readonly trustQuery = injectQuery(
    api.communities.trust_links.checkUserTrust,
    () => {
      const user = this.auth.user();
      // Read through the memoized `event` computed rather than
      // `queries.results().event` directly: `results()` emits a new object on
      // every settle of any key (event OR availability), so reading it here
      // would re-run this argsFn — and resubscribe the trust query — on every
      // availability push. The `event` computed is Object.is-stable across
      // availability-only updates, preserving the original narrow dependency
      // on the event document alone.
      const event = this.event();
      if (event?.visibility === EVENT_VISIBILITY.PUBLIC) return skipToken;
      if (!user?._id || !event) return skipToken;
      return {
        organizerId: event.organizerId,
      };
    },
  );
  readonly trustResult = computed(() => {
    const queryData = this.trustQuery.data();
    if (queryData !== undefined) return queryData;
    if (this.isPrivilegedUser()) {
      return {trusted: true as const, source: 'direct' as const, via: null};
    }
    return null;
  });
  readonly event = computed<EventDetail | null>(
    () => this.queries.results().event ?? null,
  );
  readonly hasLoadError = computed(
    () =>
      !!this.queries.errors().event ||
      !!this.queries.errors().availability ||
      !!this.organizerResource.error() ||
      !!this.appStatusResource.error(),
  );
  readonly eventNotFound = computed(
    () => !this.loading() && !this.hasLoadError() && !this.event(),
  );
  readonly organizer = computed(() => {
    const eventOrganizer = this.event()?.organizer;
    if (eventOrganizer !== undefined) {
      return eventOrganizer ?? null;
    }

    return safeResourceValue(this.organizerResource) ?? null;
  });
  readonly applicationStatus = computed(
    () => safeResourceValue(this.appStatusResource)?.status ?? null,
  );
  readonly loading = computed(() => {
    if (this.queries.isLoading()) {
      return true;
    }

    return (
      this.event()?.organizer === undefined &&
      this.organizerResource.isLoading()
    );
  });

  readonly availability = computed(
    () => this.queries.results().availability ?? null,
  );

  readonly remainingTickets = computed(() => {
    const avail = this.availability();
    if (avail && 'remainingTickets' in avail) {
      return avail.remainingTickets as number;
    }
    return null;
  });

  readonly ticketSalesStatus = computed(() => {
    const avail = this.availability();
    if (avail) return avail.ticketSalesStatus ?? 'active';
    return this.event()?.ticketSalesStatus ?? 'active';
  });

  readonly isSoldOut = computed(() => this.availability()?.isSoldOut ?? false);
  readonly userTicketCount = computed(
    () => this.availability()?.userTicketCount ?? 0,
  );
  readonly resaleAvailable = computed(
    () => this.availability()?.resaleAvailable ?? 0,
  );
  readonly resaleEnabled = computed(
    () => this.availability()?.resaleEnabled ?? false,
  );
  private readonly _optimisticSubscriptionOverride = signal<boolean | null>(
    null,
  );
  readonly isSubscribedToResale = computed(() => {
    const override = this._optimisticSubscriptionOverride();
    if (override !== null) return override;
    return this.availability()?.isSubscribedToResaleNotifications ?? false;
  });
  readonly isSubscribing = signal(false);
  readonly isUnsubscribing = signal(false);

  readonly canSeeResale = computed(() => {
    const evt = this.event();
    if (!evt || evt.visibility === EVENT_VISIBILITY.PUBLIC) return true;
    return this.availability()?.purchaseAccess.allowed ?? false;
  });

  readonly checkoutBlockedByVetting = computed(() => {
    const evt = this.event();
    if (!evt || evt.visibility === EVENT_VISIBILITY.PUBLIC) return false;
    return !(this.availability()?.purchaseAccess.allowed ?? false);
  });
  readonly isResalePurchase = this.checkoutStore.isResalePurchase;
  readonly buyerPricingSummary = computed(() => {
    const evt = this.event();
    if (!evt) {
      return getBuyerPricingSummary({price: 0, canSeePrice: false});
    }

    return getBuyerPricingSummary({
      ...evt,
      isResale: this.isResalePurchase(),
      canSeePrice:
        evt.visibility !== 'public_viewable' || this.auth.isAuthenticated(),
    });
  });

  readonly isPaymentSidebarOpen = signal(false);
  readonly initialized = signal(false);
  readonly guestEmail = this.checkoutStore.guestEmail;
  readonly buyerEmail = this.checkoutStore.buyerEmail;
  readonly guestSessionToken = this.checkoutStore.guestSessionToken;
  readonly guestTermsAccepted = this.checkoutStore.guestTermsAccepted;

  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly magicLinkToken = computed(
    () => this.queryParamMap().get('token') ?? undefined,
  );

  readonly resumeGuestEmail = computed(
    () => this.queryParamMap().get('resumeGuestEmail') ?? undefined,
  );

  readonly resumeGuestSessionToken = computed(
    () => this.queryParamMap().get('resumeGuestSessionToken') ?? undefined,
  );
  readonly paymentStatus = this.checkoutStore.paymentStatus;
  readonly paymentErrorMessage = this.checkoutStore.paymentErrorMessage;
  readonly ticketQuantity = this.checkoutStore.ticketQuantity;
  private readonly initializedEventId = signal<string | null>(null);
  readonly checkoutQuantity = this.checkoutStore.checkoutQuantity;
  readonly selectedTier = this.checkoutStore.selectedTier;
  readonly customAmount = this.checkoutStore.customAmount;
  readonly slidingScaleError = this.checkoutStore.slidingScaleError;
  private paymentGuard = createSubmitGuard();
  readonly activeOrderId = this.checkoutStore.activeOrderId;
  readonly activeCheckoutSessionId = this.checkoutStore.activeCheckoutSessionId;
  readonly stripeResetKey = this.checkoutStore.stripeResetKey;
  readonly activeConnectedAccountId =
    this.checkoutStore.activeConnectedAccountId;
  readonly checkoutLocked = this.checkoutStore.checkoutLocked;
  readonly totalAmount = this.checkoutStore.totalAmount;
  readonly supporterSliderMax = this.checkoutStore.supporterSliderMax;
  readonly communitySliderMax = this.checkoutStore.communitySliderMax;

  readonly canBuyTickets = computed(() => {
    const evt = this.event();
    if (!evt) return false;

    const hasPurchaseAccess =
      this.availability()?.purchaseAccess.allowed ?? false;

    const salesActive =
      this.ticketSalesStatus() === 'active' ||
      this.ticketSalesStatus() === null;
    const notSoldOut = !this.isSoldOut();
    return (
      hasPurchaseAccess &&
      salesActive &&
      (notSoldOut || this.isResalePurchase())
    );
  });

  readonly limitReached = computed(() => {
    const evt = this.event();
    if (!evt) return false;
    return this.userTicketCount() >= (evt.maxTicketsPerUser ?? 4);
  });
  readonly maxTickets = this.checkoutStore.maxTickets;
  readonly isAtMaxTickets = this.checkoutStore.isAtMaxTickets;

  constructor() {
    this.checkoutStore.bind({
      event: this.event,
      remainingTickets: this.remainingTickets,
      userTicketCount: this.userTicketCount,
      resaleEnabled: this.resaleEnabled,
      resaleAvailable: this.resaleAvailable,
      isSoldOut: this.isSoldOut,
    });

    const initializationRenderRef: AfterRenderRef = afterNextRender({
      read: () => {
        this.initialized.set(true);
      },
    });

    this.destroyRef.onDestroy(() => {
      initializationRenderRef.destroy();
    });

    effect(() => {
      const evt = this.event();
      if (!evt || this.loading()) {
        return;
      }

      if (this.initializedEventId() === evt._id) {
        return;
      }

      untracked(() => {
        this._optimisticSubscriptionOverride.set(null);
        this.resetPaymentForm();
        this.initializedEventId.set(evt._id);
      });
    });

    effect(() => {
      const evt = this.event();
      const avail = this.availability();
      const buy = this.buy();

      if (!evt || !avail || this.loading() || buy !== 'true') {
        return;
      }
      const canBuy = this.canBuyTickets();
      const limitHit = this.limitReached();
      const isSidebarOpen = untracked(() => this.isPaymentSidebarOpen());
      const paymentStatus = untracked(() => this.paymentStatus());
      if (isSidebarOpen || paymentStatus !== 'idle') {
        return;
      }

      untracked(() => {
        logger.debug('[EventDetails] buy=true check', {buy, canBuy, limitHit});

        if (canBuy && !limitHit) {
          void this.openPaymentSidebar(false);
          return;
        }

        logger.warn(
          '[EventDetails] Preventing checkout opening via buy=true param',
          {
            canBuy,
            limitHit,
          },
        );
        this.closePaymentSidebar();
      });
    });
    effect(() => {
      const buy = this.buy();
      if (buy === 'true') return;

      const isSidebarOpen = untracked(() => this.isPaymentSidebarOpen());
      if (!isSidebarOpen) return;

      untracked(() => {
        this.isPaymentSidebarOpen.set(false);
        this.checkoutStore.resetSidebarState();
        this.sidebarFocus.restoreTrigger();
      });
    });
    effect(() => {
      const resumeEmail = this.resumeGuestEmail();
      const resumeSessionToken = this.resumeGuestSessionToken();
      if (!resumeEmail || !resumeSessionToken) return;

      this.paymentService.rememberGuestSessionToken(
        resumeEmail,
        resumeSessionToken,
      );
    });
  }

  navigateToLogin(): void {
    void this.router.navigate(['/login'], {
      queryParams: {returnUrl: sanitizeInternalReturnUrl(this.router.url)},
    });
  }

  async onGuestEmailCollected(email: string): Promise<void> {
    try {
      const {sessionToken} = await this.paymentService.initiateGuestSession(
        email,
        this.magicLinkToken(),
        this.eventId(),
      );
      this.checkoutStore.setGuestSession(email, sessionToken);
    } catch (error: unknown) {
      // Never render error.message: prod Convex redacts it to "Server Error"
      // for every error type and carries the payload only on error.data.
      this.paymentStatus.set('error');
      this.paymentErrorMessage.set(extractPaymentErrorMessage(error));
    }
  }

  onGuestTermsAcceptedChange(accepted: boolean): void {
    this.checkoutStore.setGuestTermsAccepted(accepted);
  }

  onSidebarOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.closePaymentSidebar();
    } else {
      this.isPaymentSidebarOpen.set(true);
    }
  }

  contactOrganizer(): void {
    const org = this.organizer();
    if (!org) return;

    this.dialogService.create({
      zTitle: `Contact ${org.name}`,
      zDescription: getContactDialogDescription(org),
      zContent: ContactCommunityDialogComponent,
      zData: {
        eventTitle: this.event()?.title,
        organizerName: org.name,
        organizerEmail: org.email,
        organizerContactInfo: org.contactInfo,
      },
      zHideFooter: true,
      zWidth: 'min(34rem, calc(100vw - 2rem))',
    });
  }

  openPaymentSidebar(updateUrl = true) {
    if (!this.canBuyTickets() || this.limitReached()) return;
    if (
      this.ticketSalesStatus() === 'paused' ||
      this.ticketSalesStatus() === 'ended'
    ) {
      return;
    }
    if (this.isSoldOut() && !this.isResalePurchase()) {
      return;
    }

    if (this.isResalePurchase()) {
      this.checkoutStore.updateQuantity(0);
    }

    this.sidebarFocus.captureCurrentTrigger();
    this.isPaymentSidebarOpen.set(true);
    this.paymentStatus.set('idle');

    if (updateUrl) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {buy: 'true'},
        queryParamsHandling: 'merge',
      });
    }
  }

  closePaymentSidebar() {
    this.isPaymentSidebarOpen.set(false);
    this.checkoutStore.closeCheckout();
    this.sidebarFocus.restoreTrigger();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {buy: null},
      queryParamsHandling: 'merge',
    });
  }

  resetPaymentForm() {
    this.checkoutStore.resetPaymentForm();
  }

  updateQuantity(delta: number) {
    this.checkoutStore.updateQuantity(delta);
  }

  selectTier(tier: TicketTier) {
    this.checkoutStore.selectTier(tier);
  }

  onSliderChange(value: number) {
    this.checkoutStore.updateCustomAmountFromSlider(value);
  }

  onCustomAmountInput(value: string): void {
    this.checkoutStore.updateCustomAmountFromInput(value);
  }
  createCheckoutSession = async (): Promise<{
    clientSecret: string;
    connectedAccountId: string | null;
    orderId: string;
  }> => {
    if (!this.event()) throw new Error('Event not found');
    if (this.slidingScaleError()) {
      throw new Error(this.slidingScaleError() || 'Invalid amount');
    }

    const tier = this.selectedTier();
    const amount = this.totalAmount();
    const checkoutTheme =
      this.darkMode.themeMode() === EDarkModes.DARK ? 'dark' : 'light';

    // Lock the priced selection (quantity/tier/amount controls) the instant
    // session creation starts so the buyer cannot drift it during the
    // order-open + Stripe round trip. On success setActiveCheckoutSession keeps
    // it locked via the active session id; the finally releases the in-flight
    // flag either way so an error/cancel re-enables the controls.
    this.checkoutStore.beginSessionCreation();
    try {
      if (!this.auth.user()) {
        const sessionToken = this.guestSessionToken();
        if (!sessionToken) throw new Error('Guest session not initialized');

        const result = await this.paymentService.startGuestCheckoutSession(
          this.event()!._id,
          this.checkoutQuantity(),
          tier,
          amount,
          sessionToken,
          checkoutTheme,
          this.guestTermsAccepted(),
        );
        this.checkoutStore.setActiveCheckoutSession(result);
        return {
          clientSecret: result.clientSecret,
          connectedAccountId: result.connectedAccountId,
          orderId: result.orderId,
        };
      }

      const result = this.isResalePurchase()
        ? await this.paymentService.startResaleCheckoutSession(
            this.event()!._id,
            tier,
            amount,
            checkoutTheme,
          )
        : await this.paymentService.startPrimaryCheckoutSession(
            this.event()!._id,
            this.checkoutQuantity(),
            tier,
            amount,
            checkoutTheme,
          );

      this.checkoutStore.setActiveCheckoutSession(result);
      return {
        clientSecret: result.clientSecret,
        connectedAccountId: result.connectedAccountId,
        orderId: result.orderId,
      };
    } finally {
      this.checkoutStore.endSessionCreation();
    }
  };
  async onStripePaymentConfirmed() {
    const orderId = this.activeOrderId();
    const checkoutSessionId = this.activeCheckoutSessionId();
    if (!orderId || !checkoutSessionId) return;

    this.paymentStatus.set('processing');

    try {
      const sessionToken = this.auth.user()
        ? undefined
        : (this.guestSessionToken() ?? undefined);
      const finalState = await awaitCheckoutSettlement({
        paymentService: this.paymentService,
        orderId,
        checkoutSessionId,
        sessionToken,
      });
      if (finalState === 'completed') {
        this.paymentService.triggerRefresh();
        this.paymentStatus.set('success');
        return;
      }

      if (finalState === 'released') {
        this.paymentStatus.set('error');
        this.paymentErrorMessage.set(
          'Your reservation expired or could not be completed. If you were charged, Stripe will refund it automatically.',
        );
        return;
      }

      this.paymentStatus.set('error');
      this.paymentErrorMessage.set(
        'Your payment is still being confirmed. Please refresh your tickets shortly.',
      );
    } catch (error: unknown) {
      this.paymentStatus.set('error');
      this.paymentErrorMessage.set(extractPaymentErrorMessage(error));
    }
  }
  retryPayment() {
    this.checkoutStore.retryPayment();
  }
  onStripePaymentError(message: string) {
    this.checkoutStore.setPaymentError(message);
  }

  async onFreeTicketClaimed() {
    await this.paymentGuard.guard(async () => {
      if (!this.event()) return;
      if (this.totalAmount() > 0) return;
      // A below-minimum custom amount collapses totalAmount to 0 but leaves a
      // validation error set. Never route that through the free-claim path —
      // the backend rejects it as below the sliding-scale/supporter minimum.
      if (this.slidingScaleError()) return;

      this.paymentStatus.set('processing');

      try {
        if (!this.auth.user()) {
          const sessionToken = this.guestSessionToken();
          if (!sessionToken) throw new Error('Guest session token missing');
          await this.paymentService.claimFreeTicketAsGuest(
            this.event()!._id,
            this.checkoutQuantity(),
            this.selectedTier(),
            sessionToken,
            this.guestTermsAccepted(),
          );
        } else {
          await this.paymentService.claimFreeTicket(
            this.event()!._id,
            this.checkoutQuantity(),
            this.selectedTier(),
          );
        }

        this.paymentService.triggerRefresh();
        this.paymentStatus.set('success');
      } catch (error: unknown) {
        this.paymentStatus.set('error');
        this.paymentErrorMessage.set(extractPaymentErrorMessage(error));
      }
    });
  }

  async subscribeToResaleNotifications() {
    const eventId = this.event()?._id;
    if (!eventId || this.isSubscribing() || this.isSubscribedToResale()) return;

    this.isSubscribing.set(true);
    try {
      await this.resaleService.subscribeToResaleNotifications(eventId);
      this._optimisticSubscriptionOverride.set(true);
      toast.success(
        "You'll be notified when a resale ticket becomes available",
      );
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
      logger.error('Failed to subscribe to resale notifications', err);
    } finally {
      this.isSubscribing.set(false);
    }
  }

  async unsubscribeFromResaleNotifications() {
    const eventId = this.event()?._id;
    if (!eventId || this.isUnsubscribing() || !this.isSubscribedToResale())
      return;

    this.isUnsubscribing.set(true);
    try {
      await this.resaleService.unsubscribeFromResaleNotifications(eventId);
      this._optimisticSubscriptionOverride.set(false);
      toast.success('You will no longer receive resale notifications');
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
      logger.error('Failed to unsubscribe from resale notifications', err);
    } finally {
      this.isUnsubscribing.set(false);
    }
  }
}
