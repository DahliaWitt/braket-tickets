import {Component, ChangeDetectionStrategy, input} from '@angular/core';
import {RouterLink} from '@angular/router';

@Component({
  selector: 'app-admin-override-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (isOverride()) {
      <div
        data-testid="admin-override-banner"
        class="mb-4 flex max-w-full flex-wrap items-center justify-between gap-2 overflow-hidden rounded border-l-4 border-warning/40 bg-warning/10 px-6 py-3"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="font-mono text-2xs tracking-widest text-warning uppercase"
          >
            ADMIN OVERRIDE
          </span>
          <span class="mono-label text-2xs text-warning"> VIEWING </span>
          <span
            data-testid="override-community-name"
            class="min-w-0 truncate font-display text-sm font-bold text-warning"
          >
            {{ communityName() }}
          </span>
        </div>
        <a
          data-testid="admin-portal-link"
          routerLink="/admin/communities"
          class="font-mono text-2xs tracking-widest text-warning uppercase transition-colors hover:underline"
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
