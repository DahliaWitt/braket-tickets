import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';

import {type Ticket} from '../../models/ticket.model';

export interface TicketTransferConfirmation {
  ticketId: string;
  recipientEmail: string;
  recipientName?: string;
}

@Component({
  selector: 'app-ticket-transfer-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardIconComponent, ZardInputDirective],
  template: `
    @if (isOpen()) {
      <div
        class="animate-in fade-in slide-in-from-bottom-2 relative mt-4 w-full overflow-hidden rounded-xl border border-primary/25 bg-card/95 text-left shadow-[0_18px_50px_hsl(var(--primary)/0.12)] duration-200 dark:bg-card/85"
        data-testid="transfer-panel"
        role="region"
        aria-label="Transfer ticket"
      >
        <div
          class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
        ></div>

        <div
          class="border-b border-primary/15 bg-primary/5 px-4 py-3 dark:bg-primary/10"
        >
          <div class="flex items-start gap-3">
            <z-icon zType="send" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div class="min-w-0">
              <p
                class="font-mono text-xs tracking-widest text-primary uppercase"
              >
                Vetted handoff
              </p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Send this ticket to another member of this community or a
                trusted one. We check the email before you confirm.
              </p>
            </div>
          </div>
        </div>

        <div class="p-4">
          <div class="space-y-3">
            <label
              class="block font-mono text-2xs tracking-widest text-muted-foreground uppercase"
              [attr.for]="emailInputId()"
            >
              Recipient email
            </label>
            <input
              zInput
              type="email"
              autocomplete="email"
              placeholder="friend@example.com"
              class="w-full border-primary/20 bg-background/80 font-sans text-sm"
              data-testid="transfer-email-input"
              [id]="emailInputId()"
              [value]="email()"
              [attr.aria-invalid]="hasError()"
              [attr.aria-describedby]="hasError() ? errorId() : null"
              (input)="onEmailInput($event)"
              (keydown.enter)="onEmailEnter($event)"
            />
            @if (hasError()) {
              <p
                class="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-2xs leading-relaxed text-destructive"
                data-testid="transfer-error"
                [id]="errorId()"
                role="alert"
              >
                {{ error() }}
              </p>
            }

            @if (confirmation()?.ticketId === ticket()._id) {
              <div
                class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 shadow-[inset_0_1px_0_hsl(var(--destructive)/0.18)]"
                data-testid="transfer-confirmation-panel"
                role="region"
                aria-label="Confirm ticket transfer"
                aria-live="polite"
              >
                <div class="flex items-start gap-2">
                  <z-icon
                    zType="triangle-alert"
                    class="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  />
                  <div class="min-w-0">
                    <p
                      class="font-mono text-xs tracking-widest text-destructive uppercase"
                    >
                      This cannot be reversed
                    </p>
                    <p
                      class="mt-1 text-xs leading-relaxed text-muted-foreground"
                    >
                      Transfer to
                      <span class="font-medium text-foreground">{{
                        confirmation()?.recipientName ||
                          confirmation()?.recipientEmail
                      }}</span>
                      ? It leaves your account immediately, then we email them
                      the PDF.
                    </p>
                  </div>
                </div>
                <div class="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    z-button
                    zType="destructive"
                    class="min-h-11 font-mono text-xs tracking-widest uppercase"
                    data-testid="transfer-confirm-button"
                    [zDisabled]="isTransferring()"
                    [attr.aria-busy]="isTransferring()"
                    (click)="confirmRequested.emit()"
                  >
                    @if (isTransferring()) {
                      <z-icon zType="loader-circle" class="mr-2 animate-spin" />
                      Transferring...
                    } @else {
                      Send ticket
                    }
                  </button>
                  <button
                    type="button"
                    z-button
                    zType="outline"
                    class="min-h-11 border-border/60 font-mono text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
                    data-testid="transfer-cancel-confirmation"
                    [zDisabled]="isTransferring()"
                    (click)="clearConfirmationRequested.emit()"
                  >
                    Not yet
                  </button>
                </div>
              </div>
            }
          </div>
          @if (confirmation()?.ticketId !== ticket()._id) {
            <div class="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                z-button
                zType="default"
                class="min-h-11 font-mono text-xs tracking-widest uppercase"
                data-testid="transfer-validate-button"
                [zDisabled]="isValidating() || isTransferring()"
                [attr.aria-busy]="isValidating()"
                (click)="validateRequested.emit()"
              >
                @if (isValidating()) {
                  <z-icon zType="loader-circle" class="mr-2 animate-spin" />
                  Checking...
                } @else {
                  Check member
                }
              </button>
              <button
                type="button"
                z-button
                zType="outline"
                class="min-h-11 border-border/60 font-mono text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
                data-testid="transfer-cancel-flow"
                [zDisabled]="isValidating() || isTransferring()"
                (click)="closeRequested.emit()"
              >
                Cancel
              </button>
            </div>
          }
        </div>
      </div>
    } @else {
      <button
        type="button"
        z-button
        zType="outline"
        class="mt-3 min-h-11 w-full border-border/50 font-mono text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
        data-testid="ticket-transfer-open"
        aria-label="Transfer this ticket"
        [zDisabled]="isBusy()"
        (click)="openRequested.emit()"
      >
        <z-icon zType="send" class="mr-2 h-4 w-4" />
        Transfer ticket
      </button>
    }
  `,
})
export class TicketTransferControlsComponent {
  readonly ticket = input.required<Ticket>();
  readonly isOpen = input.required<boolean>();
  readonly email = input.required<string>();
  readonly hasError = input.required<boolean>();
  readonly error = input<string | null>(null);
  readonly confirmation = input<TicketTransferConfirmation | null>(null);
  readonly isValidating = input.required<boolean>();
  readonly isTransferring = input.required<boolean>();
  readonly isBusy = input.required<boolean>();

  readonly openRequested = output<void>();
  readonly closeRequested = output<void>();
  readonly emailChange = output<string>();
  readonly validateRequested = output<void>();
  readonly confirmRequested = output<void>();
  readonly clearConfirmationRequested = output<void>();

  readonly emailInputId = computed(
    () => `ticket-transfer-email-${this.safeTicketId()}`,
  );
  readonly errorId = computed(
    () => `ticket-transfer-error-${this.safeTicketId()}`,
  );

  onEmailInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.emailChange.emit(target.value);
    }
  }

  onEmailEnter(event: Event): void {
    event.preventDefault();
    if (this.confirmation()?.ticketId === this.ticket()._id) return;
    this.validateRequested.emit();
  }

  private safeTicketId(): string {
    return this.ticket()._id.replace(/[^A-Za-z0-9_-]/g, '-');
  }
}
