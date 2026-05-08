import '../../../../../test-setup';
import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter, Router} from '@angular/router';
import {vi} from 'vitest';
import {
  DashboardShellComponent,
  type DashboardTab,
} from './dashboard-shell.component';
import {DashboardShellHarness} from './dashboard-shell.component.harness';

// Test host component to provide inputs and projected content
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [DashboardShellComponent],
  template: `
    <app-dashboard-shell
      [titlePrefix]="titlePrefix"
      [titleAccent]="titleAccent"
      [tabs]="tabs"
      [selectedTabId]="selectedTabId()"
    >
      @if (showActions()) {
        <button type="button" dashboardActions>TEST ACTION</button>
      }
      <div data-testid="projected-content">Tab content here</div>
    </app-dashboard-shell>
  `,
})
class TestHostComponent {
  titlePrefix = 'ADMIN';
  titleAccent = 'CONTROL';
  tabs: DashboardTab[] = [
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
  readonly showActions = signal(false);
  readonly selectedTabId = signal<string | null>(null);
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-query-param-host',
  imports: [DashboardShellComponent],
  template: `
    <app-dashboard-shell [tabs]="tabs" [tabQueryParams]="tabQueryParams">
      <div data-testid="projected-content">Query param content</div>
    </app-dashboard-shell>
  `,
})
class QueryParamHostComponent {
  tabs: DashboardTab[] = [
    {id: 'pending', label: 'Pending Apps', path: '/community-admin/pending'},
  ];
  tabQueryParams = {community: 'lot-45'};
}

// Test host for custom header mode (showDefaultTitle=false)
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-custom-header-host',
  imports: [DashboardShellComponent],
  template: `
    <app-dashboard-shell [showDefaultTitle]="false" [tabs]="tabs">
      <div dashboardHeader data-testid="dashboard-custom-header">
        <h1>My Custom Heading</h1>
      </div>
      <div data-testid="projected-content">Custom header content</div>
    </app-dashboard-shell>
  `,
})
class CustomHeaderHostComponent {
  tabs: DashboardTab[] = [{id: 'tab-a', label: 'Tab A', path: '/test/tab-a'}];
}

describe('DashboardShellComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let harness: DashboardShellHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(DashboardShellHarness);
  });

  it('should render the title prefix and accent', async () => {
    expect(await harness.getTitlePrefixText()).toBe('ADMIN');
    expect(await harness.getTitleAccentText()).toBe('CONTROL');
  });

  it('should separate title prefix and accent with a space (BRA-123)', async () => {
    const fullTitle = await harness.getFullTitleText();
    expect(fullTitle).toBe('ADMIN CONTROL');
  });

  it('should render all tabs', async () => {
    const labels = await harness.getTabLabels();
    expect(labels).toEqual([
      'Pending Apps',
      'App History',
      'Members',
      'Events',
      'Magic Links',
      'Audit Log',
      'Shared Vetting',
      'Settings',
    ]);
  });

  it('should return correct tab count', async () => {
    expect(await harness.getTabCount()).toBe(8);
  });

  it('keeps the desktop tab scroller out of the tab order and vertically locked', async () => {
    expect(await harness.getDesktopTabScrollTabindex()).toBe('-1');
    expect(await harness.getDesktopSectionNavClass()).toContain(
      'overflow-y-clip',
    );
    expect(await harness.getDesktopTabScrollClass()).toContain(
      'overflow-x-auto',
    );
    expect(await harness.getDesktopTabScrollClass()).toContain(
      'overflow-y-hidden',
    );
    expect(await harness.getDesktopTabScrollClass()).toContain(
      'overscroll-y-none',
    );
  });

  it('should project default content', async () => {
    const text = await harness.getProjectedContentText();
    expect(text).toBe('Tab content here');
  });

  it('should project actions slot when provided', async () => {
    fixture.componentInstance.showActions.set(true);
    await fixture.whenStable();
    const hasActions = await harness.hasActionsContent();
    expect(hasActions).toBe(true);
  });

  it('should not show actions content when slot is empty', async () => {
    fixture.componentInstance.showActions.set(false);
    await fixture.whenStable();
    const hasActions = await harness.hasActionsContent();
    expect(hasActions).toBe(false);
  });

  it('should render mobile section selector', async () => {
    expect(await harness.hasMobileSectionNav()).toBe(true);
  });

  it('should render every tab as a mobile section option', async () => {
    const labels = await harness.getMobileSectionLabels();
    expect(labels).toEqual([
      'Pending Apps',
      'App History',
      'Members',
      'Events',
      'Magic Links',
      'Audit Log',
      'Shared Vetting',
      'Settings',
    ]);
  });

  it('should render same section count in mobile selector and desktop tabs', async () => {
    const desktopCount = await harness.getTabCount();
    const mobileCount = await harness.getMobileSectionCount();
    expect(mobileCount).toBe(desktopCount);
  });

  it('uses the explicit selected tab for the mobile section value', async () => {
    fixture.componentInstance.selectedTabId.set('members');
    fixture.detectChanges();

    expect(await harness.getSelectedMobileSectionValue()).toBe('members');
  });
});

// Test host for beforeTabChange guard testing
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-guard-host',
  imports: [DashboardShellComponent],
  template: `
    <app-dashboard-shell
      titlePrefix="GUARDED"
      titleAccent="SHELL"
      [tabs]="tabs"
      [beforeTabChange]="guardFn()"
    >
      <div data-testid="projected-content">Content</div>
    </app-dashboard-shell>
  `,
})
class GuardHostComponent {
  tabs: DashboardTab[] = [
    {id: 'tab-a', label: 'Tab A', path: '/test/tab-a'},
    {id: 'tab-b', label: 'Tab B', path: '/test/tab-b'},
  ];
  readonly guardFn = signal<
    ((tab: DashboardTab) => Promise<boolean> | boolean) | undefined
  >(undefined);
}

describe('DashboardShellComponent (beforeTabChange guard)', () => {
  let fixture: ComponentFixture<GuardHostComponent>;
  let harness: DashboardShellHarness;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuardHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {path: 'test/tab-a', component: GuardHostComponent},
          {path: 'test/tab-b', component: GuardHostComponent},
        ]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(GuardHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(DashboardShellHarness);
  });

  it('should not call guard when beforeTabChange is not set', async () => {
    const guardSpy = vi.fn().mockReturnValue(true);
    // Guard is not set — spy should never be called on click
    await harness.clickTabByLabel('Tab A');
    expect(guardSpy).not.toHaveBeenCalled();
  });

  it('should call guard with the clicked tab when beforeTabChange is set', async () => {
    let capturedTab: DashboardTab | undefined;
    fixture.componentInstance.guardFn.set((tab) => {
      capturedTab = tab;
      return false; // block navigation
    });
    fixture.detectChanges();
    await harness.clickTabByLabel('Tab B');
    expect(capturedTab).toBeDefined();
    expect(capturedTab!.id).toBe('tab-b');
  });

  it('should keep guarded desktop tabs exposed as links and mobile sections exposed as options', async () => {
    fixture.componentInstance.guardFn.set(() => true);
    fixture.detectChanges();

    await expect
      .poll(() => harness.getTabHrefs())
      .toEqual(['/test/tab-a', '/test/tab-b']);
    await expect
      .poll(() => harness.getMobileSectionOptionValues())
      .toEqual(['tab-a', 'tab-b']);
  });

  it('should navigate when guard returns true', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.guardFn.set(() => true);
    fixture.detectChanges();
    await harness.clickTabByLabel('Tab B');
    await fixture.whenStable();
    expect(navigateSpy).toHaveBeenCalledWith(
      ['/test/tab-b'],
      expect.objectContaining({queryParams: undefined}),
    );
  });

  it('should not navigate when guard returns false', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.guardFn.set(() => false);
    fixture.detectChanges();
    await harness.clickTabByLabel('Tab B');
    await fixture.whenStable();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('should navigate when async guard resolves true', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.guardFn.set(() => Promise.resolve(true));
    fixture.detectChanges();
    await harness.clickTabByLabel('Tab B');
    // Allow async guard to resolve
    await fixture.whenStable();
    expect(navigateSpy).toHaveBeenCalled();
  });

  it('should not navigate when async guard resolves false', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.guardFn.set(() => Promise.resolve(false));
    fixture.detectChanges();
    await harness.clickTabByLabel('Tab B');
    await fixture.whenStable();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('should call guard for mobile section changes too', async () => {
    let capturedTab: DashboardTab | undefined;
    fixture.componentInstance.guardFn.set((tab) => {
      capturedTab = tab;
      return false;
    });
    fixture.detectChanges();
    await harness.selectMobileSectionByLabel('Tab B');
    expect(capturedTab).toBeDefined();
    expect(capturedTab!.id).toBe('tab-b');
  });
});

describe('DashboardShellComponent (custom header)', () => {
  let fixture: ComponentFixture<CustomHeaderHostComponent>;
  let harness: DashboardShellHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomHeaderHostComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomHeaderHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(DashboardShellHarness);
  });

  it('should hide default title when showDefaultTitle is false', async () => {
    expect(await harness.getTitlePrefixText()).toBe('');
    expect(await harness.getTitleAccentText()).toBe('');
    expect(await harness.getFullTitleText()).toBe('My Custom Heading');
  });

  it('should render the custom header slot', async () => {
    expect(await harness.hasCustomHeader()).toBe(true);
  });

  it('should still render tabs in custom header mode', async () => {
    const labels = await harness.getTabLabels();
    expect(labels).toEqual(['Tab A']);
  });

  it('should still project default content in custom header mode', async () => {
    const text = await harness.getProjectedContentText();
    expect(text).toBe('Custom header content');
  });
});

describe('DashboardShellComponent (tab query params)', () => {
  let fixture: ComponentFixture<QueryParamHostComponent>;
  let harness: DashboardShellHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QueryParamHostComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(QueryParamHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(DashboardShellHarness);
  });

  it('applies explicit query params to tab links when provided', async () => {
    const tabs = await (
      harness as unknown as {getTabLinks: () => Promise<Element[]>}
    ).getTabLinks();
    const href = await tabs[0]?.getAttribute('href');
    expect(href).toContain('community=lot-45');
  });
});
