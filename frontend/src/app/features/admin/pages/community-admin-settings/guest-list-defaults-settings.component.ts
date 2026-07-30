import {
  ChangeDetectionStrategy,
  Component,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {FormField, form, submit, validate} from '@angular/forms/signals';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';

export interface GuestListDefaultValues {
  readonly artistSlots: number;
  readonly staffSlots: number;
}

interface GuestListDefaultFormValue {
  readonly artistSlots: string;
  readonly staffSlots: string;
}

const HELP_TEXT =
  'Defaults are copied when a person is assigned. Changing a default affects future assignments only. Existing event assignments keep their current grant.';

@Component({
  selector: 'app-guest-list-defaults-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    ZardButtonComponent,
    ZardIconComponent,
    ZardInputDirective,
    ZardTooltipDirective,
  ],
  template: `
    <section
      class="space-y-5 border-t border-border p-6"
      aria-labelledby="guest-list-defaults-heading"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <p
              id="guest-list-defaults-heading"
              class="mono-label text-2xs text-muted-foreground"
            >
              GUEST LIST DEFAULTS
            </p>
            <button
              type="button"
              z-button
              zType="ghost"
              zSize="sm"
              class="size-7 text-muted-foreground"
              data-testid="guest-list-defaults-help"
              aria-label="How guest list defaults work"
              aria-describedby="guest-list-defaults-help-text"
              [zTooltip]="helpText"
              zPosition="right"
            >
              <z-icon zType="info" class="size-4" />
            </button>
          </div>
          <p class="max-w-2xl text-sm text-muted-foreground">
            Set the starting allowance for newly assigned artists and staff.
          </p>
          <span
            id="guest-list-defaults-help-text"
            data-testid="guest-list-defaults-help-text"
            class="sr-only"
            >{{ helpText }}</span
          >
        </div>
      </div>

      <form class="space-y-5" (submit)="onSubmit($event)">
        <div class="grid gap-5 sm:grid-cols-2">
          <label class="space-y-2">
            <span class="mono-label pl-1 text-xs text-muted-foreground"
              >Artist slots</span
            >
            <input
              type="number"
              inputmode="numeric"
              zInput
              [formField]="defaultsForm.artistSlots"
              data-testid="artist-guest-slots"
            />
          </label>
          <label class="space-y-2">
            <span class="mono-label pl-1 text-xs text-muted-foreground"
              >Staff slots</span
            >
            <input
              type="number"
              inputmode="numeric"
              zInput
              [formField]="defaultsForm.staffSlots"
              data-testid="staff-guest-slots"
            />
          </label>
        </div>

        @if (defaultsForm().invalid() && defaultsForm().touched()) {
          <p role="alert" class="font-mono text-xs text-destructive-text">
            Use whole numbers between 0 and 100.
          </p>
        }

        <div class="flex justify-end">
          <button
            type="submit"
            z-button
            zType="outline"
            data-testid="save-guest-list-defaults"
            [zDisabled]="defaultsForm().invalid() || saving()"
            [zLoading]="saving()"
          >
            Save defaults
          </button>
        </div>
      </form>
    </section>
  `,
})
export class GuestListDefaultsSettingsComponent {
  readonly artistSlots = input(2);
  readonly staffSlots = input(2);
  readonly saving = input(false);
  readonly save = output<GuestListDefaultValues>();
  readonly helpText = HELP_TEXT;

  private readonly model = linkedSignal<GuestListDefaultFormValue>(() => ({
    artistSlots: String(this.artistSlots()),
    staffSlots: String(this.staffSlots()),
  }));
  readonly defaultsForm = form(this.model, (fields) => {
    for (const field of [fields.artistSlots, fields.staffSlots]) {
      validate(field, ({value}) => {
        const parsed = Number(value());
        return /^\d+$/.test(value()) &&
          Number.isInteger(parsed) &&
          parsed <= 100
          ? undefined
          : {kind: 'slots', message: 'Use a whole number between 0 and 100'};
      });
    }
  });

  onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void submit(this.defaultsForm, async () => {
      const values = this.model();
      this.save.emit({
        artistSlots: Number(values.artistSlots),
        staffSlots: Number(values.staffSlots),
      });
      await Promise.resolve();
    });
  }
}
