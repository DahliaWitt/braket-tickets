import {
  Component,
  ChangeDetectionStrategy,
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
  template: `
    <div class="relative">
      <input
        id="help-search"
        name="help-search"
        type="search"
        placeholder="Search help articles..."
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        data-testid="help-search-input"
        class="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        aria-label="Search help articles"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-expanded]="query().length > 0"
        aria-controls="help-search-listbox"
        [attr.aria-activedescendant]="activeDescendant()"
        autocomplete="off"
      />

      @if (query().length > 0) {
        <div
          id="help-search-listbox"
          role="listbox"
          data-testid="help-search-results"
          class="absolute left-0 right-0 top-full z-50 mt-1 rounded border border-border bg-background shadow-lg max-h-80 overflow-y-auto"
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
              class="w-full text-left px-3 py-2 hover:bg-muted transition-colors border-b border-border last:border-b-0"
            >
              <div class="flex items-center gap-2 mb-0.5">
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
              <p class="text-xs text-muted-foreground line-clamp-2">
                {{ result.snippet }}
              </p>
            </button>
          } @empty {
            <div
              class="px-3 py-4 text-sm text-muted-foreground text-center"
              data-testid="help-search-no-results"
              role="status"
              aria-live="polite"
            >
              No matching articles found
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

  readonly query = signal('');
  readonly results = computed<HelpSearchResult[]>(() =>
    this.searchService.search(this.query()),
  );
  readonly activeIndex = signal(-1);

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
