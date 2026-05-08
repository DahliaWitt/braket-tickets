import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BRA_MODAL_DATA } from '@ui/components/composites/dialog/dialog.service';
import { ZardInputDirective } from '@ui/components/primitives/input/input.directive';
import { readInputValue } from '@ui/utils/dom-event';

interface ReasonDialogData {
  visibilityLabel: string;
  reasonLabel?: string;
  placeholder?: string;
}

@Component({
  selector: 'app-reason-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardInputDirective],
  template: `
    <div class="flex flex-col gap-2">
      <label for="reason-textarea" class="text-sm font-medium text-foreground font-sans">
        {{ zData.reasonLabel ?? 'Reason' }}
        <span class="text-muted-foreground text-xs">(optional)</span>
      </label>
      <textarea
        id="reason-textarea"
        zInput
        data-testid="reason-textarea"
        class="px-3 py-2 text-sm font-sans text-foreground min-h-[80px] w-full resize-y"
        [placeholder]="zData.placeholder ?? 'Enter a reason...'"
        [value]="reason()"
        (input)="onInput($event)"
        aria-describedby="reason-visibility-hint"
      ></textarea>
      <p
        id="reason-visibility-hint"
        data-testid="reason-visibility-hint"
        class="text-2xs mono-label text-muted-foreground"
      >
        {{ zData.visibilityLabel }}
      </p>
    </div>
  `,
})
export class ReasonDialogComponent {
  readonly zData = inject<ReasonDialogData>(BRA_MODAL_DATA);
  readonly reason = signal('');

  onInput(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.reason.set(value);
  }
}
