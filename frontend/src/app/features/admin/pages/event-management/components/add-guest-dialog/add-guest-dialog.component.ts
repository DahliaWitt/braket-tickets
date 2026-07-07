import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardSelectComponent} from '@ui/components/primitives/select/select.component';
import {ZardSelectItemComponent} from '@ui/components/primitives/select/select-item.component';
import {readInputValue} from '@ui/utils/dom-event';
import {type GuestType} from '../../../../models/event-management.model';

export interface AddGuestDialogData {
  eventId: string;
  guest?: {
    name: string;
    email?: string;
    type: GuestType;
    notes?: string;
  };
}

export interface AddGuestDialogResult {
  name: string;
  email?: string;
  type: GuestType;
  notes?: string;
}

@Component({
  selector: 'app-add-guest-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ZardButtonComponent,
    ZardInputDirective,
    ZardSelectComponent,
    ZardSelectItemComponent,
  ],
  template: `
    <div class="ph-no-capture space-y-4">
      <div class="space-y-2">
        <label for="guest-name" class="mono-label text-xs text-muted-foreground"
          >Name</label
        >
        <input
          id="guest-name"
          zInput
          [value]="name()"
          (input)="updateName($event)"
          placeholder="Enter guest name"
          class="w-full"
          (keydown.enter)="submit()"
        />
      </div>

      <div class="space-y-2">
        <label
          for="guest-email"
          class="mono-label text-xs text-muted-foreground"
          >Email (Optional)</label
        >
        <input
          id="guest-email"
          zInput
          [value]="email()"
          (input)="updateEmail($event)"
          type="email"
          placeholder="Enter email address"
          class="w-full"
          (keydown.enter)="submit()"
        />
      </div>

      <div class="space-y-2">
        <label for="guest-type" class="mono-label text-xs text-muted-foreground"
          >Guest Type</label
        >
        <z-select
          id="guest-type"
          [zValue]="type()"
          (zSelectionChange)="onTypeChange($event)"
          zPlaceholder="Select type"
          class="w-full"
        >
          <z-select-item zValue="guest">Guest</z-select-item>
          <z-select-item zValue="artist guest">Artist Guest</z-select-item>
          <z-select-item zValue="staff">Staff</z-select-item>
        </z-select>
      </div>

      <div class="space-y-2">
        <label
          for="guest-notes"
          class="mono-label text-xs text-muted-foreground"
          >Notes (Optional)</label
        >
        <textarea
          id="guest-notes"
          zInput
          [value]="notes()"
          (input)="updateNotes($event)"
          placeholder="Any special notes..."
          class="min-h-[80px] w-full"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" z-button zType="outline" (click)="cancel()">
          Cancel
        </button>
        <button
          type="button"
          z-button
          zType="default"
          [zDisabled]="!isValid()"
          (click)="submit()"
          data-testid="add-guest-submit"
        >
          {{ isEditMode() ? 'Save Changes' : 'Add Guest' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class AddGuestDialogComponent {
  private readonly dialogRef =
    inject<
      BraDialogRef<
        AddGuestDialogComponent,
        AddGuestDialogResult,
        AddGuestDialogData
      >
    >(BraDialogRef);
  private readonly data = inject<AddGuestDialogData>(BRA_MODAL_DATA);

  readonly isEditMode = () => this.data.guest != null;

  readonly name = signal(this.data.guest?.name ?? '');
  readonly email = signal(this.data.guest?.email ?? '');
  readonly type = signal<GuestType>(this.data.guest?.type ?? 'guest');
  readonly notes = signal(this.data.guest?.notes ?? '');

  updateName(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.name.set(value);
  }

  updateEmail(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.email.set(value);
  }

  updateNotes(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.notes.set(value);
  }

  onTypeChange(value: string | string[]): void {
    if (typeof value === 'string') {
      this.type.set(value as GuestType);
    }
  }

  isValid(): boolean {
    const email = this.email().trim();
    return (
      this.name().trim().length > 0 &&
      (email.length === 0 || email.includes('@'))
    );
  }

  cancel(): void {
    this.dialogRef.close();
  }

  submit(): void {
    if (!this.isValid()) return;

    this.dialogRef.close({
      name: this.name().trim(),
      email: this.email().trim() || undefined,
      type: this.type(),
      notes: this.notes().trim() || undefined,
    });
  }
}
