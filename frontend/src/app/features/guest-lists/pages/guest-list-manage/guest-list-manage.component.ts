import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {OnInit} from '@angular/core';
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
import {logger} from '@/utils/logger';
import {signalFormFieldErrorMessage} from '@/utils/signal-form';

type AvailableView = Extract<
  Awaited<ReturnType<GuestListDelegateService['getView']>>,
  {status: 'available'}
>;

@Component({
  selector: 'app-guest-list-manage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, RouterLink, ZardButtonComponent, ZardInputDirective],
  host: {class: 'block min-h-dvh bg-background text-foreground'},
  template: `
    <main class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-14">
      @if (loading()) {
        <div
          data-testid="guest-list-loading"
          class="border-y border-border py-10 text-xs font-bold tracking-[0.25em] uppercase"
        >
          Checking guest-list access…
        </div>
      } @else if (loadFailure()) {
        <section
          data-testid="guest-list-load-failure"
          class="mx-auto max-w-xl border-y border-border py-16"
        >
          <p
            class="text-xs font-bold tracking-[0.24em] text-muted-foreground uppercase"
          >
            Guest list
          </p>
          <h1 class="mt-3 text-4xl font-black tracking-tight uppercase">
            We couldn’t load this guest list
          </h1>
          <p class="mt-4 text-sm leading-6 text-muted-foreground">
            Something went wrong on our end. Check your connection and try
            again.
          </p>
          <button
            data-testid="guest-list-retry-loading"
            z-button
            zType="outline"
            type="button"
            class="mt-8"
            (click)="retryLoading()"
          >
            Try again
          </button>
        </section>
      } @else if (unavailable()) {
        <section
          data-testid="guest-list-unavailable"
          class="mx-auto max-w-xl border-y border-border py-16"
        >
          <p
            class="text-xs font-bold tracking-[0.24em] text-muted-foreground uppercase"
          >
            Guest list
          </p>
          <h1 class="mt-3 text-4xl font-black tracking-tight uppercase">
            This guest list is unavailable
          </h1>
          <p class="mt-4 text-sm leading-6 text-muted-foreground">
            The link may no longer be active, or guest-list access may have
            ended.
          </p>
          <a
            routerLink="/"
            class="mt-8 inline-block text-sm font-bold tracking-widest uppercase underline underline-offset-4"
            >Go home</a
          >
        </section>
      } @else if (view(); as current) {
        <header
          data-testid="guest-list-event"
          class="grid gap-8 border-b border-border pb-8 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <div>
            <p
              class="text-xs font-bold tracking-[0.24em] text-muted-foreground uppercase"
            >
              {{ current.assignment.role }} guest list
            </p>
            <h1
              class="mt-3 text-4xl font-black tracking-tight uppercase sm:text-6xl"
            >
              {{ current.event.title }}
            </h1>
            <p class="mt-4 text-sm text-muted-foreground">
              {{ current.event.date }}
              @if (current.event.location) {
                · {{ current.event.location }}
              }
            </p>
          </div>
          <div data-testid="guest-list-usage" class="sm:text-right">
            <strong class="text-4xl font-black tabular-nums"
              >{{ current.assignment.usedSlots }} of
              {{ current.assignment.grantedSlots }}</strong
            >
            <p
              class="mt-1 text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase"
            >
              guest slots used
            </p>
          </div>
        </header>

        <div
          class="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.68fr)]"
        >
          <section>
            <div
              class="flex items-end justify-between border-b border-border pb-3"
            >
              <h2 class="text-2xl font-black tracking-tight uppercase">
                At the door
              </h2>
              <span
                class="text-xs tracking-widest text-muted-foreground uppercase"
                >Tickets emailed automatically</span
              >
            </div>
            @if (current.guests.page.length === 0) {
              <p class="py-10 text-sm text-muted-foreground">
                No guests added yet.
              </p>
            } @else {
              <div class="divide-y divide-border">
                @for (guest of current.guests.page; track guest.guestId) {
                  <article data-testid="guest-list-guest" class="py-5">
                    <div
                      class="flex flex-wrap items-start justify-between gap-4"
                    >
                      <div>
                        <h3 class="font-bold">{{ guest.name }}</h3>
                        <p class="mt-1 text-sm text-muted-foreground">
                          {{ guest.email }}
                        </p>
                        @if (guest.deliveryState === 'failed') {
                          <p
                            class="mt-2 text-xs font-bold tracking-widest text-destructive uppercase"
                          >
                            Ticket email failed
                          </p>
                        } @else if (guest.deliveryState === 'queued') {
                          <p
                            class="mt-2 text-xs tracking-widest text-muted-foreground uppercase"
                          >
                            Ticket email queued
                          </p>
                        }
                      </div>
                      <div class="flex gap-2">
                        <button
                          data-testid="guest-list-edit"
                          z-button
                          zType="outline"
                          type="button"
                          [disabled]="guestActionInFlight(guest.guestId)"
                          (click)="startEdit(guest)"
                        >
                          Edit
                        </button>
                        @if (guest.deliveryState === 'failed') {
                          <button
                            data-testid="guest-list-retry"
                            z-button
                            zType="outline"
                            type="button"
                            [disabled]="guestActionInFlight(guest.guestId)"
                            (click)="retry(guest.guestId)"
                          >
                            {{
                              retryingGuestIds().has(guest.guestId)
                                ? 'Retrying…'
                                : 'Retry email'
                            }}
                          </button>
                        }
                        <button
                          data-testid="guest-list-remove"
                          z-button
                          zType="destructive"
                          type="button"
                          [disabled]="guestActionInFlight(guest.guestId)"
                          (click)="remove(guest.guestId)"
                        >
                          {{
                            removingGuestIds().has(guest.guestId)
                              ? 'Removing…'
                              : 'Remove'
                          }}
                        </button>
                      </div>
                    </div>
                    <p class="mt-3 text-xs text-muted-foreground">
                      Removing this guest invalidates their ticket.
                    </p>
                  </article>
                }
              </div>
              @if (!current.guests.isDone) {
                <button
                  data-testid="guest-list-load-more"
                  z-button
                  zType="outline"
                  type="button"
                  class="mt-6"
                  [disabled]="loadingMoreGuests()"
                  (click)="loadMoreGuests()"
                >
                  {{
                    loadingMoreGuests() ? 'Loading more…' : 'Load more guests'
                  }}
                </button>
              }
            }
          </section>

          <aside>
            <h2 class="text-2xl font-black tracking-tight uppercase">
              {{ editingGuestId() ? 'Edit guest' : 'Add a guest' }}
            </h2>
            @if (quotaFull() && !editingGuestId()) {
              <p class="mt-3 border-y border-border py-3 text-sm">
                All granted slots are in use. You can still edit or remove
                existing guests.
              </p>
            }
            @if (actionError(); as message) {
              <p
                data-testid="guest-list-action-error"
                role="alert"
                class="mt-4 border-y border-destructive/40 py-3 text-sm text-destructive"
              >
                {{ message }}
              </p>
            }
            <form
              data-testid="guest-list-add-form"
              class="mt-6 space-y-5"
              (submit)="saveGuest($event)"
            >
              <label class="block text-xs font-bold tracking-widest uppercase">
                Name
                <input
                  data-testid="guest-list-name"
                  id="guest-list-name"
                  zInput
                  [zStatus]="guestNameError() ? 'error' : undefined"
                  class="mt-2"
                  autocomplete="name"
                  [formField]="guestForm.name"
                />
                @if (guestNameError(); as message) {
                  <span
                    id="guest-list-name-error"
                    data-testid="guest-list-field-error"
                    class="mt-2 block font-mono text-xs normal-case tracking-normal text-destructive"
                    >{{ message }}</span
                  >
                }
              </label>
              <label class="block text-xs font-bold tracking-widest uppercase">
                Email
                <input
                  data-testid="guest-list-email"
                  id="guest-list-email"
                  zInput
                  [zStatus]="guestEmailError() ? 'error' : undefined"
                  class="mt-2"
                  type="email"
                  autocomplete="email"
                  [formField]="guestForm.email"
                />
                @if (guestEmailError(); as message) {
                  <span
                    id="guest-list-email-error"
                    data-testid="guest-list-field-error"
                    class="mt-2 block font-mono text-xs normal-case tracking-normal text-destructive"
                    >{{ message }}</span
                  >
                }
              </label>
              <button
                data-testid="guest-list-add"
                z-button
                zFull
                type="submit"
                [disabled]="(quotaFull() && !editingGuestId()) || saving()"
              >
                {{
                  editingGuestId() ? 'Save changes' : 'Add guest + send ticket'
                }}
              </button>
              @if (editingGuestId()) {
                <button
                  z-button
                  zType="ghost"
                  zFull
                  type="button"
                  (click)="cancelEdit()"
                >
                  Cancel edit
                </button>
              }
            </form>
          </aside>
        </div>

        @if (accountless()) {
          <footer class="border-t border-border pt-6">
            <button
              data-testid="guest-list-forget"
              type="button"
              class="text-xs font-bold tracking-widest uppercase underline underline-offset-4"
              (click)="forget()"
            >
              Forget this guest list on this device
            </button>
          </footer>
        }
      }
    </main>
  `,
})
export class GuestListManageComponent implements OnInit {
  private readonly delegate = inject(GuestListDelegateService);
  private readonly tokens = inject(GuestListAssignmentTokenStoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly routeAssignmentId =
    this.route.snapshot.paramMap.get('assignmentId');
  private readonly fragmentToken = this.routeAssignmentId
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
  readonly actionError = signal<string | null>(null);
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

  protected guestNameError(): string | null {
    if (!this.guestSubmitted() && !this.guestForm.name().touched()) return null;
    return signalFormFieldErrorMessage(this.guestForm.name, [
      'required',
      'maxLength',
    ]);
  }

  protected guestEmailError(): string | null {
    if (!this.guestSubmitted() && !this.guestForm.email().touched()) return null;
    return signalFormFieldErrorMessage(this.guestForm.email, [
      'required',
      'email',
      'maxLength',
    ]);
  }

  private access: DelegateAccess | null = null;
  private activeToken: string | null = null;
  private storedAssignmentId: string | null = null;
  private reloadGeneration = 0;

  ngOnInit(): void {
    void this.initializeAccess();
  }

  private async initializeAccess(): Promise<void> {
    try {
      const assignmentId = this.routeAssignmentId;
      if (assignmentId) {
        const typedAssignmentId = assignmentId as GuestListAssignmentId;
        const claim = await this.delegate.claimSignedIn(typedAssignmentId);
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
          if (authorization.status === 'unavailable') {
            if (this.storedAssignmentId) {
              this.tokens.forget(this.storedAssignmentId);
            }
            this.showUnavailable();
            return;
          }
          this.access = {kind: 'token', token: this.activeToken};
        }
      }
      await this.reload();
    } catch (error) {
      logger.error('Failed to load delegated guest list', error);
      this.view.set(null);
      this.unavailable.set(false);
      this.loadFailure.set(true);
      this.loading.set(false);
    }
  }

  private showUnavailable(): void {
    this.access = null;
    this.view.set(null);
    this.loading.set(false);
    this.loadFailure.set(false);
    this.unavailable.set(true);
  }

  retryLoading(): void {
    this.loadFailure.set(false);
    this.unavailable.set(false);
    this.loading.set(true);
    void this.initializeAccess();
  }

  async saveGuest(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.guestSubmitted.set(true);
    const access = this.access;
    if (!access) return;
    await submit(this.guestForm, async () => {
      this.saving.set(true);
      this.actionError.set(null);
      try {
        const value = this.guestModel();
        const guestId = this.editingGuestId();
        if (guestId) {
          await this.delegate.updateGuest(access, {
            guestId,
            name: value.name.trim(),
            email: value.email.trim(),
          });
        } else {
          await this.delegate.addGuest(access, {
            name: value.name.trim(),
            email: value.email.trim(),
            idempotencyKey: crypto.randomUUID(),
          });
        }
        this.cancelEdit();
        await this.reload(false);
      } catch (error) {
        logger.error('Failed to save delegated guest', error);
        this.actionError.set(
          this.editingGuestId()
            ? 'Changes were not saved — try again.'
            : 'Guest was not added — try again.',
        );
      } finally {
        this.saving.set(false);
      }
    });
  }

  startEdit(guest: AvailableView['guests']['page'][number]): void {
    this.editingGuestId.set(guest.guestId);
    this.guestModel.set({name: guest.name, email: guest.email});
  }

  cancelEdit(): void {
    this.editingGuestId.set(null);
    this.guestModel.set({name: '', email: ''});
    this.guestForm().reset();
    this.guestSubmitted.set(false);
  }

  async remove(guestId: GuestListGuestId): Promise<void> {
    if (!this.access || this.guestActionInFlight(guestId)) return;
    this.addGuestAction(this.removingGuestIds, guestId);
    this.actionError.set(null);
    try {
      await this.delegate.removeGuest(this.access, guestId);
      await this.reload(false);
    } catch (error) {
      logger.error('Failed to remove delegated guest', error);
      this.actionError.set('Guest was not removed — try again.');
    } finally {
      this.removeGuestAction(this.removingGuestIds, guestId);
    }
  }

  async retry(guestId: GuestListGuestId): Promise<void> {
    if (!this.access || this.guestActionInFlight(guestId)) return;
    this.addGuestAction(this.retryingGuestIds, guestId);
    this.actionError.set(null);
    try {
      await this.delegate.retryTicket(this.access, guestId);
      await this.reload(false);
    } catch (error) {
      logger.error('Failed to retry delegated guest ticket email', error);
      this.actionError.set('Ticket email could not resend — try again.');
    } finally {
      this.removeGuestAction(this.retryingGuestIds, guestId);
    }
  }

  guestActionInFlight(guestId: GuestListGuestId): boolean {
    return (
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
    this.loadingMoreGuests.set(true);
    this.actionError.set(null);
    try {
      const result = await this.delegate.getView(
        access,
        current.guests.continueCursor,
      );
      if (result.status === 'unavailable') {
        this.showUnavailable();
        return;
      }
      this.view.set({
        ...result,
        guests: {
          ...result.guests,
          page: [...current.guests.page, ...result.guests.page],
        },
      });
    } catch (error) {
      logger.error('Failed to load more delegated guests', error);
      this.actionError.set('More guests could not load — try again.');
    } finally {
      this.loadingMoreGuests.set(false);
    }
  }

  forget(): void {
    const assignmentId = this.view()?.assignment.assignmentId;
    if (assignmentId) this.tokens.forget(assignmentId);
    this.access = null;
    this.activeToken = null;
    this.view.set(null);
    this.unavailable.set(true);
  }

  private async reload(showLoading = true): Promise<void> {
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
      if (generation !== this.reloadGeneration) return;
      if (result.status === 'unavailable') {
        if (this.storedAssignmentId)
          this.tokens.forget(this.storedAssignmentId);
        this.view.set(null);
        this.unavailable.set(true);
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
      if (generation === this.reloadGeneration) this.loading.set(false);
    }
  }
}
