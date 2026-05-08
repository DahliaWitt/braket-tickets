import {Component, ChangeDetectionStrategy, input} from '@angular/core';
import {RouterLink} from '@angular/router';

@Component({
  selector: 'app-admin-override-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: [`
    :host {
      --override-bg: oklch(0.25 0.08 55);
      --override-accent: oklch(0.75 0.15 50);
    }
  `],
  template: `
    @if (isOverride()) {
      <div
        data-testid="admin-override-banner"
        class="flex flex-wrap items-center justify-between gap-2 px-6 py-3 rounded-md mb-4 bg-[var(--override-bg)] border-l-[3px] border-l-[var(--override-accent)] max-w-full overflow-hidden"
      >
        <div class="flex items-center gap-3 min-w-0">
          <span class="font-mono uppercase tracking-widest text-2xs text-[var(--override-accent)]">
            ADMIN OVERRIDE
          </span>
          <span class="mono-label text-2xs text-[var(--override-accent)]">
            VIEWING
          </span>
          <span
            data-testid="override-community-name"
            class="font-display font-bold text-sm text-[var(--override-accent)] truncate min-w-0"
          >
            {{ communityName() }}
          </span>
        </div>
        <a
          data-testid="admin-portal-link"
          routerLink="/admin/communities"
          class="font-mono uppercase tracking-widest text-2xs text-[var(--override-accent)] hover:underline transition-colors"
        >
          ← ADMIN PORTAL
        </a>
      </div>
    }
  `,
})
export class AdminOverrideBannerComponent {
  readonly isOverride = input.required<boolean>();
  readonly communityName = input.required<string>();
}
