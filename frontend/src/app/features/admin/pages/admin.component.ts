import { Component, computed, ChangeDetectionStrategy, input } from '@angular/core';
import { AdminCommunityListComponent } from './communities/community-list/community-list.component';
import { DashboardShellComponent } from '@ui/components/composites/dashboard-shell/dashboard-shell.component';

type AdminTab = 'communities';

const VALID_TABS = new Set<AdminTab>(['communities']);

const ADMIN_TABS: { id: AdminTab; label: string; path: string }[] = [
  { id: 'communities', label: 'Communities', path: '/admin/communities' },
];

@Component({
  selector: 'app-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DashboardShellComponent,
    AdminCommunityListComponent,
  ],
  template: `
    <app-dashboard-shell
      titlePrefix="ADMIN"
      titleAccent="CONTROL"
      [tabs]="tabs"
    >
      @switch (activeTab()) {
        @case ('communities') {
          <app-admin-community-list />
        }
      }
    </app-dashboard-shell>
  `,
})
export class AdminComponent {
  readonly tabs = ADMIN_TABS;

  readonly tab = input<string>();

  readonly activeTab = computed<AdminTab>(() => {
    const tab = this.tab();
    if (tab && VALID_TABS.has(tab as AdminTab)) {
      return tab as AdminTab;
    }
    return 'communities';
  });
}
