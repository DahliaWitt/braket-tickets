import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  computed,
  resource,
  type ElementRef,
  viewChild,
} from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { HelpManifestService } from '../../services/help-manifest.service';
import { HelpSearchService } from '../../services/help-search.service';
import { HelpSidebarComponent } from '../../components/help-sidebar/help-sidebar.component';
import { HelpSearchComponent } from '../../components/help-search/help-search.component';
import { AuthService } from '@/core/services/auth.service';
import { type HelpArticle } from '../../models/help.models';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';
import { safeResourceValue } from '@/utils/resource';

@Component({
  selector: 'app-help-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, HelpSidebarComponent, HelpSearchComponent, ZardIconComponent],
  template: `
    <div class="grow flex flex-col md:flex-row">
      <!-- Mobile header -->
      <div
        class="md:hidden flex items-center justify-between px-4 pt-1 pb-3 border-b border-border bg-background"
      >
        <button
          type="button"
          (click)="toggleSidebar()"
          class="p-3 text-muted-foreground hover:text-foreground"
          aria-label="Toggle sidebar"
          [attr.aria-expanded]="sidebarOpen()"
          aria-controls="help-sidebar-panel"
        >
          <z-icon zType="menu" aria-hidden="true" />
        </button>
        <span class="mono-label text-2xs text-muted-foreground"
          >Help Center</span
        >
        <div class="w-10"></div>
      </div>

      <!-- Sidebar -->
      <aside
        #sidebarPanel
        id="help-sidebar-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Help navigation"
        data-testid="help-sidebar-nav"
        [class.translate-x-0]="sidebarOpen()"
        [class.-translate-x-full]="!sidebarOpen()"
        class="fixed inset-y-0 left-0 z-40 w-72 bg-background border-r border-border overflow-y-auto transition-transform duration-200
               md:translate-x-0 md:static md:z-0"
      >
        <div class="p-4">
          <app-help-search />
        </div>
        @if (hasLoadError()) {
          <p class="text-destructive text-sm p-4" data-testid="help-shell-error-state" role="alert">
            couldn't load articles — try refreshing
          </p>
        } @else {
          <app-help-sidebar [articles]="accessibleArticles()" [activeSection]="activeSection()" />
        }
      </aside>

      @if (sidebarOpen()) {
        <div
          class="fixed inset-0 z-30 bg-background/80 md:hidden"
          (click)="sidebarOpen.set(false)"
          (keydown.enter)="sidebarOpen.set(false)"
          (keydown.space)="sidebarOpen.set(false); $event.preventDefault()"
          tabindex="0"
        ></div>
      }

      <!-- Main content -->
      <main
        class="flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 max-w-4xl mx-auto w-full"
        [attr.inert]="sidebarOpen() || null"
      >
        <router-outlet />
      </main>
    </div>
  `,
})
export class HelpShellComponent {
  private readonly manifest = inject(HelpManifestService);
  private readonly search = inject(HelpSearchService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly sidebarOpen = signal(false);
  private readonly sidebarPanel = viewChild<ElementRef<HTMLElement>>('sidebarPanel');

  toggleSidebar(): void {
    const opening = !this.sidebarOpen();
    this.sidebarOpen.set(opening);
    if (opening) {
      // Focus the first focusable element inside the sidebar when it opens
      const panel = this.sidebarPanel()?.nativeElement;
      if (panel) {
        requestAnimationFrame(() => {
          const focusable = panel.querySelector<HTMLElement>(
            'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
          );
          focusable?.focus();
        });
      }
    }
  }

  readonly activeSection = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        const url = this.router.url;
        if (url.includes('/help/admins')) return 'admins' as const;
        if (url.includes('/help/developers')) return 'developers' as const;
        return 'users' as const;
      }),
    ),
    { initialValue: 'users' as const },
  );

  // Load manifest using resource() (not ngOnInit per project conventions)
  private readonly manifestResource = resource({
    loader: () => this.manifest.loadManifest(),
  });

  readonly hasLoadError = computed<boolean>(() => this.manifestResource.error() != null);

  // Derive accessible articles as a computed signal — pure derivation, no side effects
  readonly accessibleArticles = computed<HelpArticle[]>(() => {
    const articles = safeResourceValue(this.manifestResource);
    if (!articles) return [];
    const role = this.auth.isAuthenticated() ? this.auth.userRole() : undefined;
    return this.manifest.getAccessibleArticles(role);
  });

  constructor() {
    // Rebuild search index whenever accessible articles change — this is a true side effect
    effect(() => {
      const articles = this.accessibleArticles();
      this.search.buildIndex(articles);
    });
  }
}
