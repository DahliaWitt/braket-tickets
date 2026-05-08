import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  output,
} from '@angular/core';
import {form, FormField, required, email} from '@angular/forms/signals';
import {toast} from 'ngx-sonner';
import {AdminInvitesService} from '@/features/admin/services/admin-invites.service';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {createSubmitGuard} from '@/utils/submit-guard';
import {logger} from '@/utils/logger';
import {
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
} from '@/utils/signal-form';

interface InviteFormModel {
  communityName: string;
  email: string;
}

export interface InviteAdminDialogCloseResult {
  refreshCommunities: true;
}

@Component({
  selector: 'app-invite-admin-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    ZardButtonComponent,
    ZardInputDirective,
    ZardIconComponent,
  ],
  template: `
    @if (sent()) {
      <div
        class="flex flex-col items-center justify-center space-y-6 text-center py-4"
        data-testid="invite-success-state"
        aria-live="polite"
      >
        <div
          class="w-16 h-16 rounded-full bg-secondary/10 border border-secondary/20 flex items-center justify-center"
        >
          <z-icon zType="circle-check" class="text-secondary w-8 h-8" />
        </div>
        <div class="space-y-2">
          <h3
            class="font-display uppercase text-xl text-secondary tracking-tight"
          >
            Invite Sent
          </h3>
          <p class="font-mono text-sm text-muted-foreground">
            An invitation has been sent to <strong>{{ sentEmail() }}</strong
            >.
          </p>
        </div>
        <button
          type="button"
          z-button
          zType="secondary"
          (click)="closeDialog()"
          data-testid="invite-done-btn"
        >
          Done
        </button>
      </div>
    } @else {
      <div class="space-y-6">
        @if (!isHostedInDialog) {
          <div class="space-y-1">
            <h2
              class="font-display uppercase text-2xl font-bold tracking-tight text-foreground"
              data-testid="invite-dialog-title"
            >
              Invite Admin
            </h2>
            <p class="text-sm text-muted-foreground font-mono">
              Create a new community and send an invite to its admin.
            </p>
          </div>
        }

        <form
          (submit)="submit($event)"
          class="space-y-4"
          data-testid="invite-form"
        >
          <div class="space-y-2">
            <label
              for="communityName"
              class="text-sm mono-label text-muted-foreground"
            >
              Community Name
            </label>
            <input
              zInput
              id="communityName"
              type="text"
              placeholder="Underground Collective"
              [formField]="f.communityName"
              data-testid="community-name-input"
            />
            @if (isFieldInvalid(f.communityName)) {
              <p
                class="text-xs text-destructive font-mono"
                data-testid="community-name-error"
              >
                Community name is required.
              </p>
            }
          </div>

          <div class="space-y-2">
            <label
              for="inviteEmail"
              class="text-sm mono-label text-muted-foreground"
            >
              Admin Email
            </label>
            <input
              zInput
              id="inviteEmail"
              type="email"
              placeholder="admin@example.com"
              [formField]="f.email"
              data-testid="invite-email-input"
            />
            @if (isFieldInvalid(f.email)) {
              <p
                class="text-xs text-destructive font-mono"
                data-testid="invite-email-error"
              >
                @if (hasError(f.email, 'required')) {
                  Email is required.
                } @else {
                  Please enter a valid email address.
                }
              </p>
            }
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              z-button
              zType="ghost"
              type="button"
              cdkFocusInitial
              (click)="closeDialog()"
              data-testid="invite-cancel-btn"
            >
              Cancel
            </button>
            <button
              z-button
              type="submit"
              [zDisabled]="!f().valid() || submitGuard.isSubmitting()"
              [zLoading]="submitGuard.isSubmitting()"
              data-testid="invite-submit-btn"
            >
              Send Invite
            </button>
          </div>
        </form>
      </div>
    }
  `,
})
export class InviteAdminDialogComponent {
  private readonly invitesService = inject(AdminInvitesService);
  private readonly dialogRef = inject<BraDialogRef<InviteAdminDialogComponent>>(
    BraDialogRef,
    {optional: true},
  );

  readonly closed = output();
  readonly isHostedInDialog = this.dialogRef !== null;

  readonly sent = signal(false);
  readonly sentEmail = signal('');

  readonly submitGuard = createSubmitGuard();

  readonly formModel = signal<InviteFormModel>({
    communityName: '',
    email: '',
  });

  readonly f = form(this.formModel, (f) => {
    required(f.communityName);
    required(f.email);
    email(f.email);
  });

  readonly isFieldInvalid = isSignalFormFieldInvalid;
  readonly hasError = signalFormFieldHasError;

  closeDialog(): void {
    this.closed.emit();
    this.dialogRef?.close({refreshCommunities: true});
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.f().valid()) return;
    if (this.submitGuard.isSubmitting()) return;

    const value = this.formModel();

    await this.submitGuard.guard(async () => {
      try {
        await this.invitesService.createWithCommunity(
          value.email,
          value.communityName,
        );
        this.sentEmail.set(value.email);
        this.sent.set(true);
      } catch (err) {
        logger.error('Failed to send admin invite', err);
        toast.error('Failed to send invite. Please try again.');
      }
    });
  }
}
