import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import type {OnInit} from '@angular/core';
import {A11yModule} from '@angular/cdk/a11y';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {
  FormField,
  email,
  form,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {
  GuestListDelegateService,
  type DelegateAccess,
  type GuestListAssignmentId,
  type GuestListGuestId,
} from '../../services/guest-list-delegate.service';
import {GuestListAssignmentTokenStoreService} from '../../services/guest-list-assignment-token-store.service';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {GUEST_LIST_TOKEN_STORAGE_PREFIX} from '@/core/services/guest-list-credential-storage';
import {logger} from '@/utils/logger';
import {signalFormFieldErrorMessage} from '@/utils/signal-form';
import {EventDatePipe} from '@/utils/event-date.pipe';
import {EventEndTimePipe} from '@/utils/event-end-time.pipe';

type AvailableView = Extract<
  Awaited<ReturnType<GuestListDelegateService['getView']>>,
  {status: 'available'}
>;
type AddGuestResult = Awaited<ReturnType<GuestListDelegateService['addGuest']>>;
type UpdateGuestResult = Awaited<
  ReturnType<GuestListDelegateService['updateGuest']>
>;
type AvailableGuest = AvailableView['guests']['page'][number];

@Component({
  selector: 'app-guest-list-manage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    A11yModule,
    EventDatePipe,
    EventEndTimePipe,
    FormField,
    RouterLink,
    ZardButtonComponent,
    ZardInputDirective,
  ],
  host: {class: 'block min-h-dvh bg-background text-foreground'},
  templateUrl: './guest-list-manage.component.html',
})
export class GuestListManageComponent implements OnInit {
  private readonly delegate = inject(GuestListDelegateService);
  private readonly tokens = inject(GuestListAssignmentTokenStoreService);
  private readonly browser = inject(BrowserPlatformService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly guestListHeading = viewChild<
    unknown,
    ElementRef<HTMLElement>
  >('guestListHeading', {read: ElementRef});
  private readonly cancelRemovalButton = viewChild<
    unknown,
    ElementRef<HTMLButtonElement>
  >('cancelRemovalButton', {read: ElementRef});
  private readonly routeAssignmentId =
    this.route.snapshot.paramMap.get('assignmentId');
  private fragmentToken = this.routeAssignmentId
    ? null
    : this.tokens.captureCredentialFromFragment();

  readonly loading = signal(true);
  readonly unavailable = signal(false);
  readonly loadFailure = signal(false);
  readonly view = signal<AvailableView | null>(null);
  readonly saving = signal(false);
  readonly loadingMoreGuests = signal(false);
  readonly removingGuestIds = signal<ReadonlySet<GuestListGuestId>>(new Set());
  readonly retryingGuestIds = signal<ReadonlySet<GuestListGuestId>>(new Set());
  readonly pendingRemovalGuest = signal<AvailableGuest | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly actionNotice = signal<string | null>(null);
  readonly editingGuestId = signal<GuestListGuestId | null>(null);
  readonly accountless = signal(false);
  readonly guestModel = signal({name: '', email: ''});
  readonly guestSubmitted = signal(false);
  readonly guestForm = form(this.guestModel, (path) => {
    required(path.name, {message: 'Name is required'});
    maxLength(path.name, 120, {message: 'Name must be 120 characters or less'});
    required(path.email, {message: 'Email is required'});
    email(path.email, {message: 'Enter a valid email'});
    maxLength(path.email, 320, {
      message: 'Email must be 320 characters or less',
    });
  });
  readonly quotaFull = computed(() => {
    const assignment = this.view()?.assignment;
    return assignment ? assignment.usedSlots >= assignment.grantedSlots : false;
  });
  readonly rowActionInFlight = computed(
    () => this.removingGuestIds().size > 0 || this.retryingGuestIds().size > 0,
  );

  protected guestNameError(): string | null {
    if (!this.guestSubmitted() && !this.guestForm.name().touched()) return null;
    return signalFormFieldErrorMessage(this.guestForm.name, [
      'required',
      'maxLength',
    ]);
  }

  protected guestEmailError(): string | null {
    if (!this.guestSubmitted() && !this.guestForm.email().touched())
      return null;
    return signalFormFieldErrorMessage(this.guestForm.email, [
      'required',
      'email',
      'maxLength',
    ]);
  }

  private access: DelegateAccess | null = null;
  /**
   * Idempotency key for the guest currently being added, bound to the exact
   * payload it was minted for. Retrying the same guest after a
   * commit-then-disconnect (the mutation lands but the response is lost) must
   * replay as the same operation, or the server mints a second guest row,
   * consumes a second slot, and sends a second ticket email. Editing the name
   * or email first makes it a different operation, so the key rotates.
   * Cleared on a confirmed success and on any explicit form reset.
   */
  private pendingAddGuest: {signature: string; key: string} | null = null;
  private activeToken: string | null = null;
  private storedAssignmentId: string | null = null;
  private removalTrigger: HTMLElement | null = null;
  private accessGeneration = 0;
  private reloadGeneration = 0;

  ngOnInit(): void {
    void this.initializeAccess();
  }

  private async initializeAccess(): Promise<void> {
    const generation = ++this.accessGeneration;
    this.access = null;
    try {
      const assignmentId = this.routeAssignmentId;
      if (assignmentId) {
        const typedAssignmentId = assignmentId as GuestListAssignmentId;
        const claim = await this.delegate.claimSignedIn(typedAssignmentId);
        if (!this.isCurrentAccess(generation)) return;
        if (claim.status === 'unavailable') {
          this.showUnavailable();
          return;
        }
        this.access = {
          kind: 'signedIn',
          assignmentId: typedAssignmentId,
        };
      } else {
        this.accountless.set(true);
        const fragmentToken = this.fragmentToken;
        const stored = fragmentToken ? null : this.tokens.getMostRecent();
        this.activeToken = fragmentToken ?? stored?.token ?? null;
        this.storedAssignmentId = stored?.assignmentId ?? null;
        if (this.activeToken) {
          const authorization = await this.delegate.authorizeToken(
            this.activeToken,
          );
          if (!this.isCurrentAccess(generation)) return;
          if (authorization.status === 'unavailable') {
            this.showUnavailable();
            return;
          }
          this.access = {kind: 'token', token: this.activeToken};
        }
      }
      await this.reload(true, generation);
    } catch (error) {
      if (!this.isCurrentAccess(generation)) return;
      logger.error('Failed to load delegated guest list', error);
      this.view.set(null);
      this.unavailable.set(false);
      this.loadFailure.set(true);
      this.loading.set(false);
    }
  }

  private showUnavailable(): void {
    this.forgetActiveCredential();
    this.access = null;
    this.activeToken = null;
    this.storedAssignmentId = null;
    this.pendingRemovalGuest.set(null);
    this.removalTrigger = null;
    this.view.set(null);
    this.loading.set(false);
    this.loadFailure.set(false);
    this.unavailable.set(true);
  }

  /**
   * Clears the stored credential behind the current session. A revoked/ended
   * link must never leave `bt-guest-list-token:<id>` (or the recent pointer)
   * behind, so when the token arrived from the URL fragment — meaning no
   * resolved assignment ID is known yet — the entry is located by matching the
   * stored token value.
   */
  private forgetActiveCredential(): void {
    if (this.storedAssignmentId) {
      this.tokens.forget(this.storedAssignmentId);
      return;
    }
    const token = this.activeToken;
    if (!token) return;
    for (const key of this.browser.getLocalStorageKeys()) {
      if (!key.startsWith(GUEST_LIST_TOKEN_STORAGE_PREFIX)) continue;
      if (this.browser.getLocalStorageItem(key) !== token) continue;
      this.tokens.forget(key.slice(GUEST_LIST_TOKEN_STORAGE_PREFIX.length));
    }
  }

  retryLoading(): void {
    this.loadFailure.set(false);
    this.unavailable.set(false);
    this.loading.set(true);
    this.actionNotice.set(null);
    void this.initializeAccess();
  }

  async saveGuest(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.saving() || this.rowActionInFlight() || this.pendingRemovalGuest())
      return;
    this.guestSubmitted.set(true);
    const access = this.access;
    if (!access) return;
    const accessGeneration = this.accessGeneration;
    await submit(this.guestForm, async () => {
      this.saving.set(true);
      this.actionError.set(null);
      this.actionNotice.set(null);
      const guestId = this.editingGuestId();
      try {
        const value = this.guestModel();
        if (guestId) {
          const result = await this.delegate.updateGuest(access, {
            guestId,
            name: value.name.trim(),
            email: value.email.trim(),
          });
          if (!this.isCurrentAccess(accessGeneration)) return;
          this.applyGuestMutation(result);
        } else {
          const name = value.name.trim();
          const email = value.email.trim();
          const result = await this.delegate.addGuest(access, {
            name,
            email,
            idempotencyKey: this.addGuestKeyFor(JSON.stringify([name, email])),
          });
          if (!this.isCurrentAccess(accessGeneration)) return;
          this.pendingAddGuest = null;
          this.applyGuestMutation(result);
        }
        this.cancelEdit();
        await this.refreshAfterCommittedAction(accessGeneration);
      } catch (error) {
        if (!this.isCurrentAccess(accessGeneration)) return;
        logger.error('Failed to save delegated guest', error);
        this.actionError.set(
          guestId
            ? 'changes were not saved — try again.'
            : 'guest was not added — try again.',
        );
      } finally {
        this.saving.set(false);
      }
    });
  }

  /**
   * The idempotency key for this exact add payload — reused while the payload
   * is unchanged (retry of the same operation), rotated when it changes (a new
   * operation).
   */
  private addGuestKeyFor(signature: string): string {
    if (this.pendingAddGuest?.signature !== signature) {
      this.pendingAddGuest = {signature, key: crypto.randomUUID()};
    }
    return this.pendingAddGuest.key;
  }

  startEdit(guest: AvailableGuest): void {
    if (
      this.saving() ||
      this.pendingRemovalGuest() ||
      this.guestActionInFlight(guest.guestId)
    )
      return;
    this.editingGuestId.set(guest.guestId);
    this.guestModel.set({name: guest.name, email: guest.email});
  }

  cancelEdit(): void {
    this.editingGuestId.set(null);
    this.pendingAddGuest = null;
    this.guestModel.set({name: '', email: ''});
    this.guestForm().reset();
    this.guestSubmitted.set(false);
  }

  requestRemoval(guest: AvailableGuest, event: MouseEvent): void {
    if (
      this.saving() ||
      this.guestActionInFlight(guest.guestId) ||
      this.pendingRemovalGuest()
    )
      return;
    const trigger = event.currentTarget;
    if (trigger instanceof HTMLElement) {
      this.removalTrigger = trigger;
    }
    this.pendingRemovalGuest.set(guest);
    afterNextRender(() => this.cancelRemovalButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  cancelRemoval(): void {
    const guest = this.pendingRemovalGuest();
    if (guest && this.removingGuestIds().has(guest.guestId)) return;
    const trigger = this.removalTrigger;
    this.pendingRemovalGuest.set(null);
    this.removalTrigger = null;
    this.focusAfterRender(trigger);
  }

  async confirmRemoval(): Promise<void> {
    const guest = this.pendingRemovalGuest();
    if (!guest || this.removingGuestIds().has(guest.guestId)) return;
    const trigger = this.removalTrigger;
    const removed = await this.remove(guest.guestId);
    if (this.pendingRemovalGuest()?.guestId !== guest.guestId) return;
    this.pendingRemovalGuest.set(null);
    this.removalTrigger = null;
    this.focusAfterRender(
      removed ? (this.guestListHeading()?.nativeElement ?? null) : trigger,
    );
  }

  async remove(guestId: GuestListGuestId): Promise<boolean> {
    if (!this.access || this.saving() || this.guestActionInFlight(guestId))
      return false;
    const access = this.access;
    const accessGeneration = this.accessGeneration;
    this.addGuestAction(this.removingGuestIds, guestId);
    this.actionError.set(null);
    this.actionNotice.set(null);
    try {
      const result = await this.delegate.removeGuest(access, guestId);
      if (!this.isCurrentAccess(accessGeneration)) return false;
      if (this.editingGuestId() === guestId) {
        this.cancelEdit();
      }
      this.view.update((current) =>
        current
          ? {
              ...current,
              assignment: {
                ...current.assignment,
                usedSlots: result.usedSlots,
              },
              guests: {
                ...current.guests,
                page: current.guests.page.filter(
                  (guest) => guest.guestId !== guestId,
                ),
              },
            }
          : current,
      );
      await this.refreshAfterCommittedAction(accessGeneration);
      return true;
    } catch (error) {
      if (!this.isCurrentAccess(accessGeneration)) return false;
      logger.error('Failed to remove delegated guest', error);
      this.actionError.set('guest was not removed — try again.');
      return false;
    } finally {
      this.removeGuestAction(this.removingGuestIds, guestId);
    }
  }

  async retry(guestId: GuestListGuestId): Promise<void> {
    if (
      !this.access ||
      this.saving() ||
      this.pendingRemovalGuest() ||
      this.guestActionInFlight(guestId)
    )
      return;
    const access = this.access;
    const accessGeneration = this.accessGeneration;
    this.addGuestAction(this.retryingGuestIds, guestId);
    this.actionError.set(null);
    this.actionNotice.set(null);
    try {
      const result = await this.delegate.retryTicket(access, guestId);
      if (!this.isCurrentAccess(accessGeneration)) return;
      this.view.update((current) =>
        current
          ? {
              ...current,
              guests: {
                ...current.guests,
                page: current.guests.page.map((guest) =>
                  guest.guestId === guestId
                    ? {
                        ...guest,
                        deliveryState:
                          result.status === 'alreadySent' ? 'sent' : 'queued',
                      }
                    : guest,
                ),
              },
            }
          : current,
      );
      await this.refreshAfterCommittedAction(accessGeneration);
    } catch (error) {
      if (!this.isCurrentAccess(accessGeneration)) return;
      logger.error('Failed to retry delegated guest ticket email', error);
      this.actionError.set('ticket email could not resend — try again.');
    } finally {
      this.removeGuestAction(this.retryingGuestIds, guestId);
    }
  }

  guestActionInFlight(guestId: GuestListGuestId): boolean {
    return (
      this.saving() ||
      this.removingGuestIds().has(guestId) ||
      this.retryingGuestIds().has(guestId)
    );
  }

  private addGuestAction(
    actions: typeof this.removingGuestIds,
    guestId: GuestListGuestId,
  ): void {
    actions.update((current) => new Set(current).add(guestId));
  }

  private removeGuestAction(
    actions: typeof this.removingGuestIds,
    guestId: GuestListGuestId,
  ): void {
    actions.update((current) => {
      const next = new Set(current);
      next.delete(guestId);
      return next;
    });
  }

  async loadMoreGuests(): Promise<void> {
    const current = this.view();
    const access = this.access;
    if (!current || !access || current.guests.isDone) return;
    const accessGeneration = this.accessGeneration;
    const reloadGeneration = this.reloadGeneration;
    this.loadingMoreGuests.set(true);
    this.actionError.set(null);
    this.actionNotice.set(null);
    try {
      const result = await this.delegate.getView(
        access,
        current.guests.continueCursor,
      );
      if (
        !this.isCurrentAccess(accessGeneration) ||
        reloadGeneration !== this.reloadGeneration
      )
        return;
      if (result.status === 'unavailable') {
        this.showUnavailable();
        return;
      }
      this.view.update((latest) => {
        if (!latest) return latest;
        const guestsById = new Map(
          [...latest.guests.page, ...result.guests.page].map((guest) => [
            guest.guestId,
            guest,
          ]),
        );
        return {
          ...result,
          guests: {
            ...result.guests,
            page: [...guestsById.values()],
          },
        };
      });
    } catch (error) {
      if (
        !this.isCurrentAccess(accessGeneration) ||
        reloadGeneration !== this.reloadGeneration
      )
        return;
      logger.error('Failed to load more delegated guests', error);
      this.actionError.set('more guests could not load — try again.');
    } finally {
      this.loadingMoreGuests.set(false);
    }
  }

  forget(): void {
    ++this.accessGeneration;
    ++this.reloadGeneration;
    const assignmentId =
      this.view()?.assignment.assignmentId ?? this.storedAssignmentId;
    if (assignmentId) this.tokens.forget(assignmentId);
    this.access = null;
    this.activeToken = null;
    this.fragmentToken = null;
    this.storedAssignmentId = null;
    this.pendingAddGuest = null;
    this.view.set(null);
    this.loading.set(false);
    this.loadFailure.set(false);
    this.actionError.set(null);
    this.actionNotice.set(null);
    this.pendingRemovalGuest.set(null);
    this.removalTrigger = null;
    this.unavailable.set(true);
  }

  private focusAfterRender(target: HTMLElement | null): void {
    if (!target) return;
    afterNextRender(
      () => {
        if (target.isConnected) target.focus();
      },
      {injector: this.injector},
    );
  }

  private async reload(
    showLoading = true,
    accessGeneration = this.accessGeneration,
  ): Promise<void> {
    const generation = ++this.reloadGeneration;
    const access = this.access;
    if (!access) {
      this.loading.set(false);
      this.unavailable.set(true);
      return;
    }
    if (showLoading) this.loading.set(true);
    this.loadFailure.set(false);
    try {
      const result = await this.delegate.getView(access);
      if (
        generation !== this.reloadGeneration ||
        !this.isCurrentAccess(accessGeneration)
      )
        return;
      if (result.status === 'unavailable') {
        this.showUnavailable();
        return;
      }
      this.view.set(result);
      this.unavailable.set(false);
      if (this.activeToken) {
        this.tokens.rememberResolvedAssignment(
          result.assignment.assignmentId,
          this.activeToken,
        );
        this.storedAssignmentId = result.assignment.assignmentId;
      }
    } finally {
      if (
        generation === this.reloadGeneration &&
        this.isCurrentAccess(accessGeneration)
      )
        this.loading.set(false);
    }
  }

  private isCurrentAccess(generation: number): boolean {
    return generation === this.accessGeneration;
  }

  private applyGuestMutation(result: AddGuestResult | UpdateGuestResult): void {
    this.view.update((current) => {
      if (!current) return current;
      const existing = current.guests.page.some(
        (guest) => guest.guestId === result.guest.guestId,
      );
      return {
        ...current,
        assignment: {
          ...current.assignment,
          usedSlots: result.usedSlots,
          grantedSlots: result.grantedSlots,
        },
        guests: {
          ...current.guests,
          page: existing
            ? current.guests.page.map((guest) =>
                guest.guestId === result.guest.guestId ? result.guest : guest,
              )
            : [...current.guests.page, result.guest],
        },
      };
    });
  }

  private async refreshAfterCommittedAction(
    accessGeneration: number,
  ): Promise<void> {
    const refreshGeneration = this.reloadGeneration + 1;
    try {
      await this.reload(false, accessGeneration);
    } catch (error) {
      if (
        !this.isCurrentAccess(accessGeneration) ||
        refreshGeneration !== this.reloadGeneration
      )
        return;
      logger.error('Guest-list change succeeded but refresh failed', error);
      this.actionNotice.set(
        'your change went through, but this list couldn’t refresh. reload the page to see the latest details.',
      );
    }
  }
}
