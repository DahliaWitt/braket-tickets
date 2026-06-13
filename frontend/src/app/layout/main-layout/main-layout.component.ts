import {
  Component,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {
  HeaderComponent,
  type HeaderAction,
  type NavItem,
} from '@/layout/header/header';
import {FooterComponent} from '@/layout/footer/footer';
import {CommunityAdminDefaultService} from '@/features/admin/services/community-admin-default.service';

@Component({
  selector: 'app-main-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  template: `
    <div
      class="flex min-h-screen flex-col bg-background font-mono text-foreground selection:bg-primary selection:text-primary-foreground"
    >
      <app-header [navItems]="navItems()" [action]="headerAction()" />
      <div class="flex-outlet flex grow flex-col">
        <router-outlet />
      </div>
      <app-footer />
    </div>
  `,
})
export class MainLayoutComponent {
  private auth = inject(AuthService);
  private readonly communityAdminDefaults = inject(
    CommunityAdminDefaultService,
  );

  readonly headerAction = computed<HeaderAction | null>(() => {
    if (!this.auth.authInitialized() || this.auth.isAuthenticated()) {
      return null;
    }
    return {label: 'Log in / Sign up', routerLink: '/login'};
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
      const defaultCommunity = this.shouldUseCommunityAdminDefault()
        ? this.communityAdminDefaults.defaultCommunityId()
        : null;
      items.push({
        label: 'COMMUNITY ADMIN',
        routerLink: '/community-admin',
        queryParams: defaultCommunity
          ? {community: defaultCommunity}
          : undefined,
        class:
          'font-mono text-xs uppercase tracking-widest text-[hsl(var(--secondary-text))] hover:text-[hsl(var(--secondary-text))] border border-secondary/50 hover:border-secondary/70 hover:bg-secondary/15',
      });
    }

    items.push(
      {label: 'HOME', routerLink: '/', exactMatch: true},
      {label: 'MY TICKETS', routerLink: '/tickets'},
      {label: 'ACCOUNT', routerLink: '/account'},
      {label: 'LOGOUT', onClick: () => this.auth.logout()},
    );

    return items;
  });

  private readonly communityAdminCommunityCount = computed(() => {
    const communityIds = this.auth.user()?.communityAdminOrganizerIds;
    return Array.isArray(communityIds) ? communityIds.length : 0;
  });

  private readonly shouldUseCommunityAdminDefault = computed(
    () =>
      this.auth.userRole() === 'root_admin' ||
      this.communityAdminCommunityCount() > 1,
  );
}
