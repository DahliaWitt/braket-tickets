import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '@/core/services/auth.service';
import { HeaderComponent, type HeaderAction, type NavItem } from '@/layout/header/header';
import { FooterComponent } from '@/layout/footer/footer';

@Component({
  selector: 'app-main-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  template: `
    <div class="min-h-screen bg-background text-foreground font-mono selection:bg-primary selection:text-primary-foreground flex flex-col">
      <app-header [navItems]="navItems()" [action]="headerAction()" />
      <div class="grow flex flex-col flex-outlet">
        <router-outlet />
      </div>
      <app-footer />
    </div>
  `,
})
export class MainLayoutComponent {
  private auth = inject(AuthService);

  readonly headerAction = computed<HeaderAction | null>(() => {
    if (!this.auth.authInitialized() || this.auth.isAuthenticated()) {
      return null;
    }
    return { label: 'Log in / Sign up', routerLink: '/login' };
  });

  readonly navItems = computed<NavItem[]>(() => {
    if (!this.auth.isAuthenticated() || !this.auth.user()) {
      return [];
    }

    const items: NavItem[] = [];

    if (this.auth.userRole() === 'root_admin') {
      items.push({
        label: 'ADMIN PORTAL ACCESS',
        routerLink: '/admin',
        class:
          'font-mono text-xs uppercase tracking-widest text-[hsl(var(--secondary-text))] hover:text-[hsl(var(--secondary-text))] border border-secondary/50 hover:border-secondary hover:bg-secondary/15',
      });
    }

    if (this.auth.userRole() === 'root_admin' || this.auth.isScannerStaff()) {
      items.push({
        label: 'TICKET SCANNER',
        routerLink: '/scanner',
        class:
          'font-mono text-xs uppercase tracking-widest text-[hsl(var(--secondary-text))] hover:text-[hsl(var(--secondary-text))] border border-secondary/50 hover:border-secondary/70 hover:bg-secondary/15',
      });
    }

    if (this.auth.isCommunityAdmin() || this.auth.userRole() === 'root_admin') {
      items.push({
        label: 'COMMUNITY ADMIN',
        routerLink: '/community-admin',
        class:
          'font-mono text-xs uppercase tracking-widest text-[hsl(var(--secondary-text))] hover:text-[hsl(var(--secondary-text))] border border-secondary/50 hover:border-secondary/70 hover:bg-secondary/15',
      });
    }

    items.push(
      { label: 'HOME', routerLink: '/', exactMatch: true },
      { label: 'MY TICKETS', routerLink: '/tickets' },
      { label: 'ACCOUNT', routerLink: '/account' },
      { label: 'LOGOUT', onClick: () => this.auth.logout() },
    );

    return items;
  });
}
