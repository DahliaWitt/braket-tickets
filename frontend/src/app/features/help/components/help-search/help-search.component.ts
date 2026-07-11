import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import {Router} from '@angular/router';
import {HelpSearchService} from '../../services/help-search.service';
import {
  type HelpSearchResult,
  type HelpSection,
} from '../../models/help.models';
import {readInputValue} from '@ui/utils/dom-event';

@Component({
  selector: 'app-help-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // focusout bubbles, so this catches focus leaving the input or a result
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <div class="relative">
      <input
        id="help-search"
        name="help-search"
        type="search"
        placeholder="search help articles..."
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (focus)="onFocus()"
        data-testid="help-search-input"
        class="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
        aria-label="Search help articles"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-expanded]="showResults()"
        aria-controls="help-search-listbox"
        [attr.aria-activedescendant]="activeDescendant()"
        autocomplete="off"
      />

      @if (showResults()) {
        <div
          id="help-search-listbox"
          role="listbox"
          data-testid="help-search-results"
          class="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded border border-border bg-background shadow-lg"
        >
          @for (
            result of results();
            track result.article.slug;
            let i = $index
          ) {
            <button
              type="button"
              role="option"
              [id]="optionId(i)"
              [attr.aria-selected]="activeIndex() === i"
              (click)="selectResult(result)"
              [class.bg-muted]="activeIndex() === i"
              class="w-full border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted"
            >
              <div class="mb-0.5 flex items-center gap-2">
                <span
                  class="mono-label text-2xs text-muted-foreground"
                  data-testid="help-search-result-badge"
                >
                  {{ sectionLabel(result.article.section) }}
                </span>
                <span class="text-sm font-medium text-foreground">{{
                  result.article.title
                }}</span>
              </div>
              <p class="line-clamp-2 text-xs text-muted-foreground">
                {{ result.snippet }}
              </p>
            </button>
          } @empty {
            <div
              class="px-3 py-4 text-center text-sm text-muted-foreground"
              data-testid="help-search-no-results"
              role="status"
              aria-live="polite"
            >
              no matching articles found
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class HelpSearchComponent {
  private readonly searchService = inject(HelpSearchService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly query = signal('');
  readonly results = computed<HelpSearchResult[]>(() =>
    this.searchService.search(this.query()),
  );
  readonly activeIndex = signal(-1);
  private readonly dropdownOpen = signal(false);

  readonly showResults = computed(
    () => this.dropdownOpen() && this.query().length > 0,
  );

  readonly activeDescendant = computed<string | null>(() => {
    const idx = this.activeIndex();
    return idx >= 0 ? this.optionId(idx) : null;
  });

  sectionLabel(section: HelpSection): string {
    switch (section) {
      case 'users':
        return 'User';
      case 'admins':
        return 'Admin';
      case 'developers':
        return 'Developer';
    }
  }

  optionId(index: number): string {
    return `help-search-option-${index}`;
  }

  onInput(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.query.set(value);
    this.activeIndex.set(-1);
    this.dropdownOpen.set(true);
  }

  onFocus(): void {
    // Reopen the dropdown when the input regains focus with a query present
    if (this.query().length > 0) {
      this.dropdownOpen.set(true);
    }
  }

  onFocusOut(event: FocusEvent): void {
    // Ignore focus moving within the component (e.g. clicking a result) so
    // the click still lands before the dropdown dismisses.
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) {
      return;
    }
    this.dropdownOpen.set(false);
    this.activeIndex.set(-1);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.clearSearch();
      return;
    }

    const count = this.results().length;
    if (count === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update((i) => Math.min(i + 1, count - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Enter') {
      const idx = this.activeIndex();
      if (idx >= 0 && idx < count) {
        event.preventDefault();
        this.selectResult(this.results()[idx]);
      }
    }
  }

  clearSearch(): void {
    this.query.set('');
    this.activeIndex.set(-1);
  }

  selectResult(result: HelpSearchResult): void {
    void this.router.navigate([
      '/help',
      result.article.section,
      result.article.slug,
    ]);
    this.clearSearch();
  }
}
