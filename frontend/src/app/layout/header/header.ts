import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  inject,
  ElementRef,
  effect,
  DestroyRef,
} from '@angular/core';
import {DOCUMENT, NgOptimizedImage} from '@angular/common';
import {type Params, RouterLink, RouterLinkActive} from '@angular/router';
import {ThemeToggleComponent} from '@ui/components/primitives/theme-toggle/theme-toggle.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

export interface NavItem {
  label: string;
  routerLink?: string;
  queryParams?: Params;
  onClick?: () => void;
  class?: string;
  exactMatch?: boolean;
}

export interface HeaderAction {
  label: string;
  routerLink: string;
}

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    ThemeToggleComponent,
    ZardButtonComponent,
    ZardIconComponent,
    NgOptimizedImage,
  ],
  host: {
    '(document:keydown.escape)': 'closeMobileMenu()',
  },
  styles: [
    `
      .mobile-menu {
        display: grid;
        grid-template-rows: 0fr;
        opacity: 0;
        transition:
          grid-template-rows 0.3s ease-out,
          opacity 0.2s ease-out;
      }
      .mobile-menu.open {
        grid-template-rows: 1fr;
        opacity: 1;
        overscroll-behavior: contain;
      }
      .mobile-menu > * {
        overflow: hidden;
      }
      .backdrop {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease-out;
      }
      .backdrop.open {
        opacity: 1;
        pointer-events: auto;
      }
      @media (min-width: 48rem) {
        .mobile-menu,
        .backdrop {
          display: none;
        }
      }
    `,
  ],
  template: `
    <header class="relative z-50">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:border focus:border-ring focus:bg-background focus:px-4 focus:py-2 focus:font-bold focus:text-foreground focus:shadow-lg focus-visible:ring-2 focus-visible:ring-primary"
      >
        Skip to main content
      </a>
      <div
        class="flex items-center justify-between border-b border-border bg-background px-4 py-3 md:px-12 md:py-6"
      >
        <a
          routerLink="/"
          aria-label="Braket Community home"
          class="transition-opacity hover:opacity-80"
        >
          <img
            ngSrc="braket.svg"
            alt="Braket Community"
            width="56"
            height="56"
            priority
            class="-my-2 h-10 md:-my-4 md:h-14 dark:invert"
          />
        </a>

        <!-- Desktop Navigation -->
        <nav aria-label="Main" class="hidden items-center gap-4 md:flex">
          @for (item of navItems(); track item.label) {
            @if (item.routerLink) {
              <a
                z-button
                zType="ghost"
                [routerLink]="item.routerLink"
                [queryParams]="item.queryParams"
                routerLinkActive="!border-foreground !text-foreground bg-foreground/10"
                [routerLinkActiveOptions]="{exact: !!item.exactMatch}"
                [class]="
                  item.class ??
                  'border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase hover:border-foreground/50 hover:text-foreground'
                "
              >
                {{ item.label }}
              </a>
            } @else {
              <button
                type="button"
                z-button
                zType="ghost"
                [class]="
                  item.class ??
                  'border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase hover:border-foreground/50 hover:text-foreground'
                "
                (click)="item.onClick?.()"
              >
                {{ item.label }}
              </button>
            }
          }
          @if (action(); as action) {
            <a
              z-button
              zType="default"
              [routerLink]="action.routerLink"
              class="border border-primary/60 bg-primary font-mono text-xs tracking-widest text-primary-foreground uppercase hover:bg-primary/90"
            >
              {{ action.label }}
            </a>
          }
          <app-theme-toggle />
        </nav>

        <!-- Mobile Navigation Toggle -->
        <div class="flex items-center gap-2 md:hidden">
          @if (action(); as action) {
            <a
              z-button
              zType="default"
              zSize="sm"
              [routerLink]="action.routerLink"
              class="border border-primary/60 bg-primary font-mono text-[10px] tracking-widest text-primary-foreground uppercase hover:bg-primary/90"
            >
              {{ action.label }}
            </a>
          }
          <app-theme-toggle />
          @if (navItems().length > 0) {
            <button
              type="button"
              data-testid="mobile-menu-toggle"
              z-button
              zType="ghost"
              zSize="default"
              class="p-2"
              [attr.aria-label]="mobileMenuOpen() ? 'Close menu' : 'Open menu'"
              [attr.aria-expanded]="mobileMenuOpen()"
              (click)="toggleMobileMenu()"
            >
              @if (mobileMenuOpen()) {
                <z-icon zType="x" class="h-5 w-5" />
              } @else {
                <z-icon zType="menu" class="h-5 w-5" />
              }
            </button>
          }
        </div>
      </div>

      <!-- Mobile Dropdown Menu -->
      @if (navItems().length > 0) {
        <nav
          aria-label="Main"
          class="mobile-menu absolute right-0 left-0 border-b border-border bg-background shadow-lg md:hidden"
          [class.open]="mobileMenuOpen()"
          [attr.inert]="mobileMenuOpen() ? null : ''"
        >
          <div class="flex flex-col gap-2 p-4">
            @for (item of navItems(); track item.label) {
              @if (item.routerLink) {
                <a
                  [routerLink]="item.routerLink"
                  [queryParams]="item.queryParams"
                  routerLinkActive="bg-foreground/10 text-foreground"
                  [routerLinkActiveOptions]="{exact: !!item.exactMatch}"
                  class="block w-full rounded-lg px-4 py-[14px] text-left font-mono text-sm tracking-widest text-muted-foreground uppercase transition-colors hover:bg-muted/50 hover:text-foreground"
                  (click)="closeMobileMenu()"
                >
                  {{ item.label }}
                </a>
              } @else {
                <button
                  type="button"
                  class="block w-full rounded-lg px-4 py-[14px] text-left font-mono text-sm tracking-widest text-muted-foreground uppercase transition-colors hover:bg-muted/50 hover:text-foreground"
                  (click)="handleMobileClick(item)"
                >
                  {{ item.label }}
                </button>
              }
            }
          </div>
        </nav>
      }
    </header>

    <!-- Backdrop -->
    <div
      role="presentation"
      class="backdrop fixed inset-0 z-40 bg-background/80 md:hidden"
      [class.open]="mobileMenuOpen()"
      (click)="closeMobileMenu()"
    ></div>
  `,
})
export class HeaderComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly navItems = input<NavItem[]>([]);
  readonly action = input<HeaderAction | null>(null);
  readonly mobileMenuOpen = signal(false);

  constructor() {
    effect(() => {
      this.doc.body.style.overflow = this.mobileMenuOpen() ? 'hidden' : '';
    });

    this.destroyRef.onDestroy(() => {
      this.doc.body.style.overflow = '';
    });
  }

  toggleMobileMenu() {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu() {
    if (!this.mobileMenuOpen()) return;
    this.mobileMenuOpen.set(false);
    // Restore focus to toggle button for keyboard accessibility
    this.el.nativeElement
      .querySelector<HTMLButtonElement>('[data-testid="mobile-menu-toggle"]')
      ?.focus();
  }

  handleMobileClick(item: NavItem) {
    this.closeMobileMenu();
    item.onClick?.();
  }
}
