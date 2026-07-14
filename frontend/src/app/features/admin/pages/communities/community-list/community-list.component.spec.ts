import '../../../../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {Subject} from 'rxjs';
import {AdminCommunityListComponent} from './community-list.component';
import {AdminCommunityListComponentHarness} from './community-list.component.harness';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
} from '@angular/core';
import {provideRouter, Router} from '@angular/router';
import {vi} from 'vitest';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  InviteAdminDialogComponent,
  type InviteAdminDialogCloseResult,
} from '@/features/admin/components/invite-admin-dialog/invite-admin-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class RouteStubComponent {}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Build a Convex client mock for `api.communities.list.list` that supports:
 * - synchronous initial delivery on subscribe (mirrors a warm WebSocket emit),
 * - live re-emission on the active subscription (`emit`),
 * - refetch counting (`onUpdate` is called again on each resubscribe).
 */
function makeCommunitiesConvexMock(initial: unknown[]): {
  convex: MockConvexClient;
  onUpdate: ReturnType<typeof vi.fn>;
  emit: (v: unknown) => void;
} {
  const convex = createMockConvexClient();
  let latestOnData: ((v: unknown) => void) | undefined;
  let current: unknown = initial;
  const onUpdate = vi.fn(
    (_query: unknown, _args: unknown, onData: (v: unknown) => void) => {
      latestOnData = onData;
      onData(current); // deliver synchronously, mirroring a warm WebSocket emit
      return () => void 0;
    },
  );
  convex.onUpdate = onUpdate;
  convex.client.onUpdate = onUpdate;
  return {
    convex,
    onUpdate,
    /** Push new live data on the active subscription (no refetch). */
    emit: (v: unknown) => {
      current = v;
      latestOnData?.(v);
    },
  };
}

async function setup() {
  const {convex, onUpdate, emit} = makeCommunitiesConvexMock([
    {_id: '1', name: 'Community 1', email: 'test@community.com'},
  ]);
  const dialogAfterClosed$ = new Subject<
    InviteAdminDialogCloseResult | undefined
  >();
  const dialogMock = {
    create: vi.fn(() => ({afterClosed$: dialogAfterClosed$.asObservable()})),
  };

  await TestBed.configureTestingModule({
    imports: [AdminCommunityListComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([
        {path: 'admin/communities', component: RouteStubComponent},
        {path: 'community-admin/pending', component: RouteStubComponent},
        {path: 'admin/communities/:id/edit', component: RouteStubComponent},
      ]),
      {provide: CONVEX, useValue: convex},
      {provide: BraDialogService, useValue: dialogMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AdminCommunityListComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    AdminCommunityListComponentHarness,
  );

  return {
    fixture,
    component,
    harness,
    convex,
    onUpdate,
    emit,
    dialogAfterClosed$,
    dialogMock,
  };
}

async function setupLoading() {
  // Default onUpdate never delivers → isLoading stays true → skeletons render.
  const convex = createMockConvexClient();
  const loadingDialogMock = {
    create: vi.fn(() => ({
      afterClosed$: new Subject<InviteAdminDialogCloseResult | undefined>(),
    })),
  };

  await TestBed.configureTestingModule({
    imports: [AdminCommunityListComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: CONVEX, useValue: convex},
      {provide: BraDialogService, useValue: loadingDialogMock},
    ],
  }).compileComponents();

  const loadingFixture = TestBed.createComponent(AdminCommunityListComponent);
  loadingFixture.detectChanges();
  const loadingHarness = await TestbedHarnessEnvironment.harnessForFixture(
    loadingFixture,
    AdminCommunityListComponentHarness,
  );

  return {loadingFixture, loadingHarness};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminCommunityListComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('should load communities on init', async () => {
    const {onUpdate, component} = await setup();
    expect(onUpdate).toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(
      api.communities.list.list,
      {},
      expect.any(Function),
      expect.any(Function),
    );
    expect(component.communities().length).toBe(1);
    expect(
      (component as unknown as {isLoading: () => boolean}).isLoading(),
    ).toBe(false);
  });

  it('should render community entries and edit actions for desktop and mobile layouts', async () => {
    const {harness} = await setup();
    // 1 community × 2 layout views (desktop table + mobile card) = 2 entries
    expect(await harness.getCommunityEntryCount()).toBe(2);
    // Each layout has 2 action buttons (Manage + Edit) × 2 layouts = 4 total
    expect(await harness.getEditActionCount()).toBe(4);
    // Each layout has 1 Manage button × 2 layouts = 2 total
    expect(await harness.getManageActionCount()).toBe(2);
  });

  it('uses the accessible foreground token for Manage actions in both layouts', async () => {
    const {harness} = await setup();

    const manageActionClasses = await harness.getManageActionClasses();
    expect(manageActionClasses).toHaveLength(2);
    expect(
      manageActionClasses.every((classes) =>
        classes.includes('text-foreground'),
      ),
    ).toBe(true);
  });

  it('should stack the header actions on mobile and keep each action full width', async () => {
    const {fixture} = await setup();
    const hostElement = fixture.nativeElement as HTMLElement;
    const actionRow = hostElement.querySelector<HTMLElement>(
      '[data-testid="community-header-actions"]',
    );
    const inviteAdminButton = hostElement.querySelector<HTMLElement>(
      '[data-testid="invite-admin-btn"]',
    );
    const createCommunityButton = hostElement.querySelector<HTMLElement>(
      '[data-testid="create-community-btn"]',
    );

    expect(actionRow).not.toBeNull();
    expect(actionRow?.classList.contains('flex-col')).toBe(true);
    expect(actionRow?.classList.contains('sm:flex-row')).toBe(true);
    expect(inviteAdminButton?.classList.contains('w-full')).toBe(true);
    expect(inviteAdminButton?.classList.contains('sm:w-auto')).toBe(true);
    expect(createCommunityButton?.classList.contains('w-full')).toBe(true);
    expect(createCommunityButton?.classList.contains('sm:w-auto')).toBe(true);
  });

  it('should open the invite admin flow through the shared dialog service and refresh on close', async () => {
    const {harness, dialogMock, dialogAfterClosed$, fixture, onUpdate} =
      await setup();
    await harness.clickInviteAdmin();

    expect(dialogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zContent: InviteAdminDialogComponent,
        zHideFooter: true,
      }),
    );

    dialogAfterClosed$.next({refreshCommunities: true});
    await fixture.whenStable();
    fixture.detectChanges();

    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('should not refresh communities when the invite dialog closes without a refresh result', async () => {
    const {harness, dialogAfterClosed$, fixture, onUpdate} = await setup();
    await harness.clickInviteAdmin();

    dialogAfterClosed$.next(undefined);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  describe('status badge', () => {
    it('shows "published" for a community with no status field', async () => {
      const {harness} = await setup();
      // Default mock already has no status (undefined → treated as published)
      const texts = await harness.getStatusBadgeTexts();
      // 1 community × 2 layouts = 2 badges
      expect(texts).toHaveLength(2);
      expect(texts.every((t) => t.trim() === 'published')).toBe(true);
    });

    it('shows "published" for a community with status: published', async () => {
      const {emit, fixture, harness} = await setup();
      emit([
        {
          _id: '1',
          name: 'Live Community',
          email: 'live@example.com',
          status: 'published',
        },
      ]);
      fixture.detectChanges();

      const texts = await harness.getStatusBadgeTexts();
      expect(texts.every((t) => t.trim() === 'published')).toBe(true);
    });

    it('shows "draft" for a community with status: draft', async () => {
      const {emit, fixture, harness} = await setup();
      emit([
        {
          _id: '2',
          name: 'Draft Community',
          email: 'draft@example.com',
          status: 'draft',
        },
      ]);
      fixture.detectChanges();

      const texts = await harness.getStatusBadgeTexts();
      expect(texts.every((t) => t.trim() === 'draft')).toBe(true);
    });

    it('renders correct badges when both published and draft communities are present', async () => {
      const {emit, fixture, harness} = await setup();
      emit([
        {
          _id: '1',
          name: 'Live Community',
          email: 'live@example.com',
          status: 'published',
        },
        {
          _id: '2',
          name: 'Draft Community',
          email: 'draft@example.com',
          status: 'draft',
        },
      ]);
      fixture.detectChanges();

      const texts = await harness.getStatusBadgeTexts();
      // 2 communities × 2 layouts = 4 badges; order is desktop-first then mobile
      const normalised = texts.map((t) => t.trim());
      expect(normalised.filter((t) => t === 'published')).toHaveLength(2);
      expect(normalised.filter((t) => t === 'draft')).toHaveLength(2);
    });
  });

  describe('manage link query params', () => {
    it('uses slug in ?community= param when community has a slug', async () => {
      const {emit, fixture, harness} = await setup();
      emit([
        {
          _id: 'someorgid123456789012345678901234',
          name: 'Lot 45',
          email: 'lot@example.com',
          slug: 'lot-45',
        },
      ]);
      fixture.detectChanges();

      const hrefs = await harness.getManageLinkHrefs();
      expect(hrefs.length).toBeGreaterThan(0);
      expect(
        hrefs.every((h) => h != null && h.includes('community=lot-45')),
      ).toBe(true);
    });

    it('falls back to _id in ?community= param when community has no slug', async () => {
      const {emit, fixture, harness} = await setup();
      const fakeId = 'abcdefghijklmnopqrstuvwxyz123456';
      emit([{_id: fakeId, name: 'No Slug Community', email: 'ns@example.com'}]);
      fixture.detectChanges();

      const hrefs = await harness.getManageLinkHrefs();
      expect(hrefs.length).toBeGreaterThan(0);
      expect(
        hrefs.every((h) => h != null && h.includes(`community=${fakeId}`)),
      ).toBe(true);
    });

    it('clicking Manage navigates to community-admin with the slug param', async () => {
      const {emit, fixture, harness} = await setup();
      emit([
        {
          _id: 'someorgid123456789012345678901234',
          name: 'Lot 45',
          email: 'lot@example.com',
          slug: 'lot-45',
        },
      ]);
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      await router.navigateByUrl('/admin/communities');
      await harness.clickFirstManageAction();
      await fixture.whenStable();

      expect(router.url).toBe('/community-admin/pending?community=lot-45');
    });

    it('clicking Edit navigates to the community edit route', async () => {
      const {emit, fixture, harness} = await setup();
      const fakeId = 'someorgid123456789012345678901234';
      emit([
        {
          _id: fakeId,
          name: 'Editable Community',
          email: 'edit@example.com',
          slug: 'editable-community',
        },
      ]);
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      await router.navigateByUrl('/admin/communities');
      await harness.clickFirstEditAction();
      await fixture.whenStable();

      expect(router.url).toBe(`/admin/communities/${fakeId}/edit`);
    });
  });

  describe('loading skeleton', () => {
    it('should show skeleton rows in desktop table while loading', async () => {
      const {loadingHarness} = await setupLoading();
      const isShowing = await loadingHarness.isShowingSkeleton();
      const rowCount = await loadingHarness.getDesktopSkeletonRowCount();
      expect(isShowing).toBe(true);
      expect(rowCount).toBe(5);
    });

    it('should show skeleton cards on mobile while loading', async () => {
      const {loadingHarness} = await setupLoading();
      const cardCount = await loadingHarness.getMobileSkeletonCardCount();
      expect(cardCount).toBe(3);
    });

    it('should use shimmer animation on skeleton elements', async () => {
      const {loadingHarness} = await setupLoading();
      const skeletons = await loadingHarness.getSkeletonHarnesses();
      expect(skeletons.length).toBeGreaterThan(0);
      for (const skeleton of skeletons) {
        expect(await skeleton.getAnimation()).toBe('shimmer');
      }
    });
  });
});
