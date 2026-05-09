import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {Router} from '@angular/router';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BraToastService} from '@ui/components/composites/toast/toast.service';
import {
  AnalyticsService,
  type FeedbackCategory,
} from '@/core/services/analytics.service';

type FooterFeedbackCategory = FeedbackCategory | null;

interface CategoryOption {
  label: string;
  value: FeedbackCategory;
}

const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  {label: 'General feedback', value: 'general_feedback'},
  {label: 'Bug', value: 'bug'},
  {label: 'Feature request', value: 'feature_request'},
] as const;

@Component({
  selector: 'app-footer-feedback-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardInputDirective],
  template: `
    <section class="flex flex-col gap-3">
      <div
        id="feedback-category-label"
        class="text-xs font-medium text-foreground"
      >
        Category (optional)
      </div>
      <div
        class="flex flex-wrap gap-2"
        role="group"
        [attr.aria-labelledby]="'feedback-category-label'"
      >
        @for (category of CATEGORY_OPTIONS; track category.value) {
          <button
            type="button"
            z-button
            zType="outline"
            [attr.aria-pressed]="
              isCategorySelected(category.value) ? 'true' : 'false'
            "
            [attr.data-selected]="
              isCategorySelected(category.value) ? '' : null
            "
            class="border-primary/30 font-mono text-xs tracking-widest uppercase transition-[transform,color,background-color,border-color,opacity] hover:border-primary hover:bg-primary hover:text-primary-foreground data-selected:border-primary data-selected:bg-primary data-selected:text-primary-foreground data-selected:shadow-[0_0_18px_-8px_hsl(var(--primary)/0.75)] data-selected:hover:bg-primary data-selected:hover:text-primary-foreground dark:hover:bg-primary dark:data-selected:bg-primary"
            [attr.data-testid]="'feedback-category-' + category.value"
            (click)="setCategory(category.value)"
          >
            {{ category.label }}
          </button>
        }
      </div>

      <label for="feedback-message" class="text-sm font-medium text-foreground">
        What should we know?
      </label>
      <textarea
        id="feedback-message"
        zInput
        data-testid="feedback-message"
        rows="4"
        [value]="message()"
        (input)="onMessageInput($event)"
        aria-required="true"
        class="min-h-[88px]"
      ></textarea>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          z-button
          zType="outline"
          data-testid="feedback-cancel"
          (click)="cancel()"
        >
          Cancel
        </button>
        <button
          type="button"
          z-button
          data-testid="feedback-submit"
          [zDisabled]="!canSubmit()"
          (click)="submit()"
        >
          Submit
        </button>
      </div>
    </section>
  `,
})
export class FooterFeedbackDialogComponent {
  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly selectedCategory = signal<FooterFeedbackCategory>(null);
  protected readonly message = signal('');
  protected readonly submitting = signal(false);
  protected readonly canSubmit = computed(
    () => this.message().trim().length > 0 && !this.submitting(),
  );

  protected readonly analytics = inject(AnalyticsService);
  protected readonly dialogRef = inject(
    BraDialogRef<FooterFeedbackDialogComponent>,
  );
  protected readonly router = inject(Router);
  protected readonly toast = inject(BraToastService);

  constructor() {
    this.analytics.startFeedbackReplayCapture();
  }

  setCategory(value: FeedbackCategory): void {
    this.selectedCategory.update((current) =>
      current === value ? null : value,
    );
  }

  protected isCategorySelected(value: FeedbackCategory): boolean {
    return this.selectedCategory() === value;
  }

  onMessageInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    this.message.set(target.value);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    let captured: boolean;
    try {
      captured = await this.analytics.captureFeedback({
        category: this.selectedCategory(),
        message: this.message(),
        route: this.router.url,
      });
    } catch {
      captured = false;
    } finally {
      this.submitting.set(false);
    }

    if (!captured) {
      this.toast.error('Feedback could not be sent. Please try again.');
      return;
    }

    this.dialogRef.close();
    this.toast.success('Thanks for the feedback.');
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
