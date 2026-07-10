import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {SharedVettingTableComponent} from './shared-vetting-table.component';
import {SharedVettingTableHarness} from './shared-vetting-table.harness';
import {VettingTrustLinksService} from '@/features/admin/services/vetting-trust-links.service';
import {CONVEX} from 'convex-angular';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {provideZonelessChangeDetection} from '@angular/core';
import {of} from 'rxjs';
import {type Id} from '@convex/_generated/dataModel';
import {vi} from 'vitest';
import {type BraDialogOptions} from '@ui/components/composites/dialog/dialog.component';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

describe('SharedVettingTableComponent', () => {
  let component: SharedVettingTableComponent;
  let fixture: ComponentFixture<SharedVettingTableComponent>;
  let harness: SharedVettingTableHarness;

  const orgA = 'orgA' as Id<'organizers'>;
  const orgB = 'orgB' as Id<'organizers'>;

  interface TrustLinksServiceMock {
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }

  interface BraDialogMock {
    create: ReturnType<typeof vi.fn>;
  }

  let convexClientMock: MockConvexClient;
  let trustLinksServiceMock: TrustLinksServiceMock;
  let braDialogMock: BraDialogMock;

  const mockOrganizers = [
    {_id: orgA, name: 'VOID_COLLECTIVE', _creationTime: 100},
    {_id: orgB, name: 'NEON_NIGHTS', _creationTime: 200},
  ];

  const mockOutgoingLinks = [
    {
      direction: 'outgoing' as const,
      trustingOrganizerId: orgA,
      trustedOrganizerId: orgB,
      trustingOrganizerName: 'VOID_COLLECTIVE',
      trustedOrganizerName: 'NEON_NIGHTS',
      trustedMemberCount: 5,
    },
  ];

  function setupConvexMock(
    outgoing: typeof mockOutgoingLinks = [],
    incoming: unknown[] = [],
  ): void {
    // Track which queries have been called to return appropriate data
    let updateCount = 0;
    const onUpdate = vi
      .fn()
      .mockImplementation(
        (
          _queryRef: unknown,
          _args: unknown,
          onData: (data: unknown) => void,
        ) => {
          // Emit asynchronously: injectQueries records the active subscription
          // AFTER calling onUpdate, and settle() early-returns when the
          // subscription isn't recorded yet, so a synchronous emission is
          // dropped. Route by call order captured at call time.
          // First call -> organizers, second -> outgoing, third -> incoming.
          updateCount++;
          const call = updateCount;
          queueMicrotask(() => {
            if (call === 1) {
              onData(mockOrganizers);
            } else if (call === 2) {
              onData(outgoing);
            } else if (call === 3) {
              onData(incoming);
            } else {
              onData([]);
            }
          });
          return () => void 0;
        },
      );
    const mutation = vi.fn().mockResolvedValue(undefined);
    convexClientMock = createMockConvexClient();
    convexClientMock.client.onUpdate = onUpdate;
    convexClientMock.onUpdate = onUpdate;
    convexClientMock.client.mutation = mutation;
    convexClientMock.mutation = mutation;
  }

  async function createComponent(
    outgoing: typeof mockOutgoingLinks = [],
    incoming: unknown[] = [],
    options: {autoConfirmDialog?: boolean} = {},
  ): Promise<void> {
    const autoConfirmDialog = options.autoConfirmDialog ?? true;
    trustLinksServiceMock = {
      create: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    setupConvexMock(outgoing, incoming);

    braDialogMock = {
      create: vi.fn().mockImplementation((options: {zOnOk?: () => void}) => {
        if (autoConfirmDialog && options.zOnOk) {
          options.zOnOk();
        }
        return {afterClosed$: of(true)};
      }),
    };

    await TestBed.configureTestingModule({
      imports: [SharedVettingTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexClientMock},
        {provide: VettingTrustLinksService, useValue: trustLinksServiceMock},
        {provide: BraDialogService, useValue: braDialogMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedVettingTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // Force signal propagation by waiting for microtasks
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SharedVettingTableHarness,
    );
  }

  it('should show empty state text when no outgoing links', async () => {
    await createComponent();
    const emptyText = await harness.getEmptyStateText();
    expect(emptyText).toBe('No trust links created yet.');
  });

  it('should display outgoing links via harness', async () => {
    await createComponent(mockOutgoingLinks);
    const links = await harness.getOutgoingLinks();
    expect(links.length).toBe(1);
    expect(links[0].name).toBe('NEON_NIGHTS');
  });

  it('should render a specific accessible remove action for each outgoing link', async () => {
    await createComponent(mockOutgoingLinks);

    await expect(harness.getRemoveActionLabels()).resolves.toEqual([
      'Remove trust link to NEON_NIGHTS',
      'Remove trust link to NEON_NIGHTS',
    ]);
  });

  it('should open the remove dialog and call remove on confirm', async () => {
    const link = mockOutgoingLinks[0];
    await createComponent([], [], {autoConfirmDialog: false});
    component.removeLink(link);
    expect(braDialogMock.create).toHaveBeenCalled();
    const dialogConfig = braDialogMock.create.mock
      .calls[0][0] as BraDialogOptions<unknown, unknown>;
    expect(dialogConfig.zOkDestructive).toBe(true);
    expect(dialogConfig.zTitle).toBe('Remove Trust Link');
    await dialogConfig.zOnOk?.(undefined as never);
    expect(trustLinksServiceMock.remove).toHaveBeenCalledWith(orgA, orgB);
  });

  it('should leave the outgoing link intact when remove is canceled', async () => {
    await createComponent(mockOutgoingLinks, [], {autoConfirmDialog: false});

    await harness.clickRemove('NEON_NIGHTS');

    expect(braDialogMock.create).toHaveBeenCalled();
    expect(trustLinksServiceMock.remove).not.toHaveBeenCalled();
    await expect(harness.getOutgoingLinks()).resolves.toEqual([
      {name: 'NEON_NIGHTS'},
    ]);
  });

  it('should open the create dialog and call create on confirm', async () => {
    await createComponent([], [], {autoConfirmDialog: false});
    component.openCreateDialog();
    expect(braDialogMock.create).toHaveBeenCalled();
    const dialogConfig = braDialogMock.create.mock
      .calls[0][0] as BraDialogOptions<unknown, unknown>;
    expect(dialogConfig.zOkDestructive).toBeUndefined();
    expect(dialogConfig.zTitle).toBe('Create Trust Link');
    await dialogConfig.zOnOk?.(undefined as never);
    expect(trustLinksServiceMock.create).toHaveBeenCalledWith(orgA, orgB);
  });

  it('should compute available organizers excluding self and existing links', async () => {
    await createComponent();
    component.selectedOrganizerId.set(orgA);
    const available = component.availableOrganizers();
    expect(available.length).toBe(1);
    expect(available[0]._id).toBe(orgB);
  });

  it('should show organizer select when organizerId input is not set', async () => {
    await createComponent();
    // mockOrganizers has 2 entries so allOrganizers().length > 1 — selector should be visible
    const hasSelect = await harness.hasOrganizerSelect();
    expect(hasSelect).toBe(true);
  });

  it('should hide organizer select when organizerId input is set', async () => {
    await createComponent();
    fixture.componentRef.setInput('organizerId', orgA);
    await fixture.whenStable();
    const hasSelect = await harness.hasOrganizerSelect();
    expect(hasSelect).toBe(false);
  });

  it('should render incoming links as read-only without action buttons', async () => {
    const incomingLinks = [
      {
        direction: 'incoming' as const,
        trustingOrganizerId: orgB,
        trustedOrganizerId: orgA,
        trustingOrganizerName: 'NEON_NIGHTS',
        trustedOrganizerName: 'VOID_COLLECTIVE',
      },
    ];
    await createComponent([], incomingLinks);

    const incoming = await harness.getIncomingLinks();
    expect(incoming).toEqual([{name: 'NEON_NIGHTS'}]);
    expect(await harness.hasIncomingLinkActionButtons()).toBe(false);
  });
});
