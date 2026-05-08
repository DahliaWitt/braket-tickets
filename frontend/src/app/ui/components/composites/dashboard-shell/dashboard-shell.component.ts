import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  NavigationEnd,
  type Params,
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {filter, map} from 'rxjs';
import {uniqueComponentId} from '@ui/utils/unique-id';

export interface DashboardTab {
  id: string;
  label: string;
  path: string;
}

@Component({
  selector: 'app-dashboard-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-background text-foreground flex flex-col">
      <main
        id="main-content"
        class="grow p-6 md:p-10 space-y-8 font-sans selection:bg-primary/30 min-w-0 overflow-hidden"
        [style.borderLeft]="
          overrideBorder() ? '3px solid oklch(0.75 0.15 50)' : 'none'
        "
      >
        <!--
          Default title row. Hidden when showDefaultTitle is false.
          The [dashboardActions] slot lives here — custom headers should
          include their own action controls via [dashboardHeader] instead.
        -->
        @if (showDefaultTitle()) {
          <div
            class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 min-w-0"
          >
            <div class="flex flex-col gap-2 min-w-0 overflow-hidden">
              <h1
                class="text-xl sm:text-3xl lg:text-4xl font-bold text-foreground tracking-tight font-display drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] dark:drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] truncate min-w-0"
              >
                <span data-testid="title-prefix">{{ titlePrefix() }}</span
                >{{ ' '
                }}<span
                  data-testid="title-accent"
                  class="text-transparent bg-clip-text bg-linear-to-r from-primary to-secondary"
                  >{{ titleAccent() }}</span
                >
              </h1>
            </div>
            <div data-testid="actions-slot" class="shrink-0">
              <ng-content select="[dashboardActions]" />
            </div>
          </div>
        }

        <!-- Custom header slot (used by community admin for community-identity hero) -->
        <ng-content select="[dashboardHeader]" />

        <!-- Mobile Tab Navigation -->
        <nav
          class="md:hidden"
          aria-label="Dashboard sections"
          data-testid="mobile-section-nav"
        >
          <label
            [attr.for]="mobileSectionSelectId"
            class="mb-2 block font-mono text-2xs uppercase tracking-widest text-muted-foreground"
          >
            Dashboard sections
          </label>
          <select
            [id]="mobileSectionSelectId"
            data-testid="mobile-section-select"
            class="native-select h-12 w-full rounded border border-border bg-card px-3 py-2 font-mono text-xs uppercase tracking-widest text-foreground shadow-none transition-colors hover:border-ring focus-visible:border-ring"
            [value]="activeTabId()"
            (change)="onMobileSectionChange($event)"
          >
            @for (tab of tabs(); track tab.id) {
              <option [value]="tab.id">{{ tab.label }}</option>
            }
          </select>
        </nav>

        <!-- Desktop Tab Navigation -->
        <nav
          class="hidden md:block border-b border-border overflow-y-clip"
          aria-label="Dashboard sections"
          data-testid="desktop-section-nav"
        >
          <div
            class="flex items-center gap-2 lg:gap-4 overflow-x-auto overflow-y-hidden overscroll-y-none no-scrollbar"
            data-testid="desktop-tab-scroll"
            tabindex="-1"
          >
            @for (tab of tabs(); track tab.id) {
              @if (guarded()) {
                <a
                  data-testid="tab-link"
                  [attr.href]="tabHref(tab)"
                  (click)="onTabClick($event, tab)"
                  class="px-4 first:pl-0 py-[14px] text-sm font-bold uppercase tracking-wider transition-colors relative group font-display whitespace-nowrap cursor-pointer"
                  [class.text-foreground]="isTabActive(tab)"
                  [class.text-muted-foreground]="!isTabActive(tab)"
                  [attr.aria-current]="isTabActive(tab) ? 'page' : null"
                >
                  {{ tab.label }}
                  <div
                    class="absolute bottom-0 left-0 w-full h-0.5 bg-linear-to-r from-primary to-secondary transform origin-left transition-transform duration-300"
                    [class.scale-x-100]="isTabActive(tab)"
                    [class.scale-x-0]="!isTabActive(tab)"
                  ></div>
                </a>
              } @else {
                <a
                  data-testid="tab-link"
                  [routerLink]="tab.path"
                  [queryParams]="tabQueryParams() ?? undefined"
                  routerLinkActive="text-foreground"
                  #rla="routerLinkActive"
                  class="px-4 first:pl-0 py-[14px] text-sm font-bold uppercase tracking-wider transition-colors relative group font-display whitespace-nowrap cursor-pointer"
                  [class.text-muted-foreground]="!rla.isActive"
                  [attr.aria-current]="rla.isActive ? 'page' : null"
                >
                  {{ tab.label }}
                  <div
                    class="absolute bottom-0 left-0 w-full h-0.5 bg-linear-to-r from-primary to-secondary transform origin-left transition-transform duration-300"
                    [class.scale-x-100]="rla.isActive"
                    [class.scale-x-0]="!rla.isActive"
                  ></div>
                </a>
              }
            }
          </div>
        </nav>

        <!-- Main Content Area -->
        <div
          class="min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <ng-content />
        </div>
      </main>
    </div>
  `,
})
export class DashboardShellComponent {
  readonly titlePrefix = input('');
  readonly titleAccent = input('');
  readonly tabs = input.required<DashboardTab[]>();
  readonly tabQueryParams = input<Params | null>(null);
  readonly selectedTabId = input<string | null>(null);
  readonly overrideBorder = input(false);
  /** Set to false to hide the default title row and use [dashboardHeader] slot instead. */
  readonly showDefaultTitle = input(true);
  readonly beforeTabChange = input<
    ((tab: DashboardTab) => Promise<boolean> | boolean) | undefined
  >();
  protected readonly mobileSectionSelectId = uniqueComponentId(
    'dashboard-section-select',
  );

  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    {initialValue: this.router.url},
  );
  protected readonly guarded = computed(() => !!this.beforeTabChange());
  protected readonly activeTabId = computed(() => {
    const selectedTabId = this.selectedTabId();
    if (selectedTabId && this.tabs().some((tab) => tab.id === selectedTabId)) {
      return selectedTabId;
    }

    return (
      this.tabs().find((tab) => this.isTabActiveByUrl(tab))?.id ??
      this.tabs()[0]?.id ??
      ''
    );
  });

  tabHref(tab: DashboardTab): string {
    return this.router.serializeUrl(
      this.router.createUrlTree([tab.path], {
        queryParams: this.tabQueryParams() ?? undefined,
      }),
    );
  }

  isTabActive(tab: DashboardTab): boolean {
    const selectedTabId = this.selectedTabId();
    if (
      selectedTabId &&
      this.tabs().some((candidate) => candidate.id === selectedTabId)
    ) {
      return tab.id === selectedTabId;
    }

    return this.isTabActiveByUrl(tab);
  }

  private isTabActiveByUrl(tab: DashboardTab): boolean {
    const url = this.currentUrl().split('?')[0];
    return url === tab.path || url.startsWith(tab.path + '/');
  }

  async onTabClick(event: MouseEvent, tab: DashboardTab): Promise<void> {
    const guard = this.beforeTabChange();
    if (!guard) return;
    event.preventDefault();
    const canProceed = await guard(tab);
    if (canProceed) {
      await this.router.navigate([tab.path], {
        queryParams: this.tabQueryParams() ?? undefined,
      });
    }
  }

  async onMobileSectionChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement | null;
    const tab = this.tabs().find((candidate) => candidate.id === select?.value);
    if (!select || !tab || this.isTabActive(tab)) {
      return;
    }

    const guard = this.beforeTabChange();
    const canProceed = guard ? await guard(tab) : true;
    if (canProceed) {
      await this.router.navigate([tab.path], {
        queryParams: this.tabQueryParams() ?? undefined,
      });
      return;
    }

    select.value = this.activeTabId();
  }
}
