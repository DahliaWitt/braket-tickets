import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
} from '@angular/core';
import {Router, provideRouter, type Routes} from '@angular/router';
import type {Meta, StoryObj} from '@storybook/angular';
import {applicationConfig} from '@storybook/angular';

import {
  DashboardShellComponent,
  type DashboardTab,
} from './dashboard-shell.component';

const ADMIN_TABS: DashboardTab[] = [
  {id: 'communities', label: 'Communities', path: '/admin/communities'},
];

const COMMUNITY_TABS: DashboardTab[] = [
  {id: 'pending', label: 'Pending Apps', path: '/community-admin/pending'},
  {id: 'history', label: 'App History', path: '/community-admin/history'},
  {id: 'members', label: 'Members', path: '/community-admin/members'},
  {id: 'events', label: 'Events', path: '/community-admin/events'},
  {
    id: 'magic-links',
    label: 'Magic Links',
    path: '/community-admin/magic-links',
  },
  {id: 'audit-log', label: 'Audit Log', path: '/community-admin/audit-log'},
  {
    id: 'shared-vetting',
    label: 'Shared Vetting',
    path: '/community-admin/shared-vetting',
  },
  {id: 'settings', label: 'Settings', path: '/community-admin/settings'},
];

@Component({
  selector: 'bt-story-dashboard-shell-route-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class DashboardShellStoryRouteStubComponent {}

function createStoryRoute(tab: DashboardTab): Routes[number] {
  return {
    path: tab.path.replace(/^\//, ''),
    component: DashboardShellStoryRouteStubComponent,
  };
}

const STORY_ROUTES: Routes = [
  ...ADMIN_TABS.map(createStoryRoute),
  ...COMMUNITY_TABS.map(createStoryRoute),
  {path: '**', component: DashboardShellStoryRouteStubComponent},
];

@Component({
  selector: 'bt-story-dashboard-shell-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardShellComponent],
  template: `
    <app-dashboard-shell
      [titlePrefix]="titlePrefix()"
      [titleAccent]="titleAccent()"
      [tabs]="tabs()"
      [overrideBorder]="overrideBorder()"
    >
      <button
        type="button"
        dashboardActions
        class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 font-mono text-xs tracking-widest text-foreground uppercase transition-colors hover:bg-muted"
      >
        Refresh view
      </button>

      <div
        data-testid="projected-content"
        class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)]"
      >
        <section
          class="rounded-xl border border-border/50 bg-card/80 p-6 shadow-sm"
        >
          <p
            class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            Communities
          </p>
          <h2
            class="mt-2 font-display text-2xl font-bold tracking-tight text-foreground uppercase"
          >
            Approval queue is quiet
          </h2>
          <p class="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            This mirrors the default admin shell used in
            <code>admin.component.ts</code> with the router highlighting one
            active section.
          </p>
        </section>

        <section
          class="rounded-xl border border-border/50 bg-card/80 p-6 shadow-sm"
        >
          <p
            class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            Quick actions
          </p>
          <div class="mt-4 flex flex-wrap gap-3">
            <span
              class="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1.5 font-mono text-xs tracking-widest text-muted-foreground uppercase"
            >
              Review reminders
            </span>
            <span
              class="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1.5 font-mono text-xs tracking-widest text-muted-foreground uppercase"
            >
              Triage communities
            </span>
          </div>
        </section>
      </div>
    </app-dashboard-shell>
  `,
})
class DashboardShellAdminStoryComponent implements OnInit {
  private readonly router = inject(Router);

  readonly titlePrefix = input('ADMIN');
  readonly titleAccent = input('CONTROL');
  readonly tabs = input<DashboardTab[]>(ADMIN_TABS);
  readonly overrideBorder = input(false);
  readonly activePath = input('/admin/communities');

  ngOnInit(): void {
    void this.router.navigateByUrl(this.activePath(), {replaceUrl: true});
  }
}

@Component({
  selector: 'bt-story-dashboard-shell-community',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardShellComponent],
  template: `
    <app-dashboard-shell
      [showDefaultTitle]="false"
      [tabs]="tabs()"
      [overrideBorder]="true"
    >
      <div
        dashboardHeader
        data-testid="dashboard-custom-header"
        class="flex min-w-0 flex-col gap-4"
      >
        <div class="flex items-center justify-between gap-4">
          <p
            class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            Community Admin
          </p>
          <span
            class="inline-flex items-center rounded bg-success/10 px-2 py-0.5 font-mono text-2xs tracking-widest text-success uppercase"
          >
            Published
          </span>
        </div>

        <div class="flex min-w-0 items-center gap-5">
          <div
            class="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/50 font-display text-lg font-bold tracking-wider text-muted-foreground uppercase"
            aria-hidden="true"
          >
            DC
          </div>

          <div class="min-w-0">
            <h1
              class="truncate font-display text-3xl font-bold tracking-tight text-foreground uppercase sm:text-4xl lg:text-5xl"
            >
              Dancefloor
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              Custom header pattern lifted from
              <code>community-admin.component.html</code>.
            </p>
          </div>
        </div>
      </div>

      <div
        data-testid="projected-content"
        class="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
      >
        <section
          class="rounded-xl border border-border/50 bg-card/80 p-6 shadow-sm"
        >
          <div class="flex items-center gap-3">
            <p
              class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
            >
              Magic Links
            </p>
            <span
              class="inline-flex items-center rounded bg-warning/10 px-2 py-0.5 font-mono text-2xs tracking-widest text-warning uppercase"
            >
              Active tab
            </span>
          </div>
          <h2
            class="mt-2 font-display text-2xl font-bold tracking-tight text-foreground uppercase"
          >
            One-click access for vetted guests
          </h2>
          <p class="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            This mirrors the custom community header and tab structure used on
            the real community admin page while keeping the Storybook surface
            focused on the shell.
          </p>
        </section>

        <section
          class="rounded-xl border border-border/50 bg-card/80 p-6 shadow-sm"
        >
          <p
            class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            Header context
          </p>
          <ul class="mt-4 space-y-3 text-sm text-muted-foreground">
            <li class="flex items-center justify-between gap-4">
              <span>Community</span>
              <span class="font-mono tracking-widest text-foreground uppercase"
                >Dancefloor</span
              >
            </li>
            <li class="flex items-center justify-between gap-4">
              <span>Status</span>
              <span class="font-mono tracking-widest text-foreground uppercase"
                >Published</span
              >
            </li>
            <li class="flex items-center justify-between gap-4">
              <span>Active section</span>
              <span class="font-mono tracking-widest text-foreground uppercase"
                >Magic Links</span
              >
            </li>
          </ul>
        </section>
      </div>
    </app-dashboard-shell>
  `,
})
class DashboardShellCommunityStoryComponent implements OnInit {
  private readonly router = inject(Router);

  readonly tabs = input<DashboardTab[]>(COMMUNITY_TABS);
  readonly activePath = input('/community-admin/magic-links');

  ngOnInit(): void {
    void this.router.navigateByUrl(this.activePath(), {replaceUrl: true});
  }
}

const meta: Meta<DashboardShellComponent> = {
  title: 'Braket/Composites/DashboardShell',
  component: DashboardShellComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [provideRouter(STORY_ROUTES)],
    }),
  ],
  parameters: {
    docs: {
      description: {
        component:
          'Shell shared by the admin and community admin pages. The stories mirror the default admin header and the custom community header used in the app.',
      },
    },
  },
  argTypes: {
    titlePrefix: {
      control: 'text',
      description:
        'Default header prefix text rendered before the accent title.',
    },
    titleAccent: {
      control: 'text',
      description: 'Default header accent text rendered after the prefix.',
    },
    tabs: {
      control: 'object',
      description:
        'Navigation tabs rendered in the desktop rail and mobile selector.',
    },
    tabQueryParams: {
      control: 'object',
      description: 'Query params appended to generated tab links.',
    },
    selectedTabId: {
      control: 'text',
      description:
        'Optional active-tab override when URL-derived selection is not desired.',
    },
    overrideBorder: {
      control: 'boolean',
      description:
        'Applies the editorial left-border treatment used by community admin pages.',
    },
    showDefaultTitle: {
      control: 'boolean',
      description:
        'Shows or hides the built-in title row when using a custom projected header.',
    },
    beforeTabChange: {
      control: false,
      description:
        'Optional navigation guard callback invoked before changing tabs.',
      table: {
        type: {
          summary: '(tab: DashboardTab) => Promise<boolean> | boolean',
        },
      },
    },
  },
};

export default meta;
type Story = StoryObj<DashboardShellComponent>;

export const AdminHeader: Story = {
  render: () => ({
    template: `<bt-story-dashboard-shell-admin />`,
    moduleMetadata: {imports: [DashboardShellAdminStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven shell state for the platform admin dashboard with the default header treatment.',
      },
    },
  },
};

export const CommunityHeader: Story = {
  render: () => ({
    template: `<bt-story-dashboard-shell-community />`,
    moduleMetadata: {imports: [DashboardShellCommunityStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven shell state for community admin pages with custom community header content.',
      },
    },
  },
};
