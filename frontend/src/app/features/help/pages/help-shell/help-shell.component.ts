import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  signal,
  effect,
  computed,
  resource,
  type ElementRef,
  viewChild,
} from '@angular/core';
import {DOCUMENT} from '@angular/common';
import {Router, RouterOutlet, NavigationEnd} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {filter, map, startWith} from 'rxjs';
import {HelpManifestService} from '../../services/help-manifest.service';
import {HelpSearchService} from '../../services/help-search.service';
import {HelpSidebarComponent} from '../../components/help-sidebar/help-sidebar.component';
import {HelpSearchComponent} from '../../components/help-search/help-search.component';
import {AuthService} from '@/core/services/auth.service';
import {type HelpArticle} from '../../models/help.models';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {safeResourceValue} from '@/utils/resource';

@Component({
  selector: 'app-help-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    HelpSidebarComponent,
    HelpSearchComponent,
    ZardIconComponent,
  ],
  template: `
    <div class="flex grow flex-col md:flex-row">
      <!-- Mobile header -->
      <div
        class="flex items-center justify-between border-b border-border bg-background px-4 pt-1 pb-3 md:hidden"
      >
        <button
          #sidebarToggle
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
          >help center</span
        >
        <div class="w-10"></div>
      </div>

      <!-- Sidebar: static column on desktop, modal overlay panel on mobile -->
      <aside
        #sidebarPanel
        id="help-sidebar-panel"
        [attr.role]="isMobileOverlay() ? 'dialog' : null"
        [attr.aria-modal]="isMobileOverlay() ? 'true' : null"
        aria-label="Help navigation"
        data-testid="help-sidebar-nav"
        [attr.inert]="isHiddenMobilePanel() ? '' : null"
        tabindex="-1"
        (keydown.escape)="onSidebarEscape()"
        [class.translate-x-0]="sidebarOpen()"
        [class.-translate-x-full]="!sidebarOpen()"
        class="fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-border bg-background transition-transform duration-200 md:static md:z-0 md:translate-x-0"
      >
        <div class="p-4">
          <app-help-search />
        </div>
        @if (hasLoadError()) {
          <p
            class="p-4 text-sm text-destructive-text"
            data-testid="help-shell-error-state"
            role="alert"
          >
            couldn't load articles — try refreshing
          </p>
        } @else {
          <app-help-sidebar
            [articles]="accessibleArticles()"
            [activeSection]="activeSection()"
          />
        }
      </aside>

      @if (sidebarOpen()) {
        <!-- Decorative backdrop — click-to-dismiss only; Escape is handled on the dialog panel -->
        <div
          class="fixed inset-0 z-30 bg-background/80 md:hidden"
          (click)="closeSidebar()"
          aria-hidden="true"
        ></div>
      }

      <!-- Main content -->
      <main
        class="mx-auto w-full max-w-4xl min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8"
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
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly desktopQuery =
    this.document.defaultView?.matchMedia('(min-width: 768px)');

  readonly sidebarOpen = signal(false);
  private readonly sidebarPanel =
    viewChild<ElementRef<HTMLElement>>('sidebarPanel');
  private readonly sidebarToggle =
    viewChild<ElementRef<HTMLElement>>('sidebarToggle');

  // Tracks the md breakpoint so dialog semantics only apply to the mobile
  // overlay — on desktop the same element is a plain static sidebar.
  private readonly isDesktop = signal(this.desktopQuery?.matches ?? false);

  /** Mobile overlay state: the sidebar acts as a modal dialog. */
  readonly isMobileOverlay = computed(
    () => !this.isDesktop() && this.sidebarOpen(),
  );

  /** Closed mobile panel: visually off-canvas, must not be tab-reachable. */
  readonly isHiddenMobilePanel = computed(
    () => !this.isDesktop() && !this.sidebarOpen(),
  );

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

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onSidebarEscape(): void {
    if (!this.isMobileOverlay()) return;
    this.closeSidebar();
    // The closed panel becomes inert, so move focus back to the trigger
    this.sidebarToggle()?.nativeElement.focus();
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
    {initialValue: 'users' as const},
  );

  // Load manifest using resource() (not ngOnInit per project conventions)
  private readonly manifestResource = resource({
    loader: () => this.manifest.loadManifest(),
  });

  readonly hasLoadError = computed<boolean>(
    () => this.manifestResource.error() != null,
  );

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

    // Keep dialog semantics in sync when the viewport crosses the md breakpoint
    const query = this.desktopQuery;
    if (query) {
      const onChange = (event: MediaQueryListEvent): void => {
        this.isDesktop.set(event.matches);
      };
      query.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => {
        query.removeEventListener('change', onChange);
      });
    }
  }
}
