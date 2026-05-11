import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  ViewEncapsulation,
} from '@angular/core';

import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';

@Component({
  selector: 'bra-code-of-conduct-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [ZardIconComponent],
  template: `
    <button
      type="button"
      data-testid="code-of-conduct-link"
      (click)="open()"
      class="group inline-flex min-h-6 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 font-mono text-2xs tracking-widest text-muted-foreground uppercase transition-colors hover:text-secondary"
    >
      <z-icon
        zType="book-open-text"
        class="h-3.5 w-3.5 text-muted-foreground/60 transition-colors group-hover:text-secondary/80"
      />
      <span
        class="underline decoration-muted-foreground/30 underline-offset-4 transition-colors group-hover:decoration-secondary/50"
      >
        code of conduct
      </span>
    </button>
  `,
})
export class BraCodeOfConductLinkComponent {
  private readonly dialog = inject(BraDialogService);

  readonly codeOfConduct = input.required<string>();

  open(): void {
    this.dialog.create({
      zTitle: 'Code of Conduct',
      zContent: this.codeOfConduct(),
      zOkText: 'Close',
      zCancelText: null,
      zWidth: 'min(600px, calc(100vw - 2rem))',
      zCustomClasses: 'max-h-[70vh] overflow-y-auto whitespace-pre-wrap',
    });
  }
}
