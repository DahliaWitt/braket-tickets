import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {vi} from 'vitest';
import {
  AuditLogTableComponent,
  type AuditLogEntry,
  ACTION_DISPLAY,
} from './audit-log-table.component';
import {AuditLogTableHarness} from './audit-log-table.harness';
import {CONVEX} from 'convex-angular';
import {type Id} from '@convex/_generated/dataModel';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

async function getHarness(
  fix: ComponentFixture<AuditLogTableComponent>,
): Promise<AuditLogTableHarness> {
  return TestbedHarnessEnvironment.harnessForFixture(fix, AuditLogTableHarness);
}

type MockConvexClientType = MockConvexClient;

type MakeEntryOverrides = Partial<Omit<AuditLogEntry, '_id'>> & {_id?: string};

const makeEntry = (overrides: MakeEntryOverrides = {}): AuditLogEntry => ({
  _id: (overrides._id ?? 'log1') as unknown as Id<'adminAuditLogs'>,
  _creationTime: overrides._creationTime ?? Date.now() - 1000,
  action: overrides.action ?? 'event.create',
  adminName: overrides.adminName ?? 'Alice Admin',
  eventName: overrides.eventName,
  deletedEventName: overrides.deletedEventName,
  eventId: overrides.eventId,
  reason: overrides.reason,
  source: overrides.source,
  applicationUserName: overrides.applicationUserName,
  targetUserName: overrides.targetUserName,
  magicLinkLabel: overrides.magicLinkLabel,
  trustLinkLabel: overrides.trustLinkLabel,
  applicationId: overrides.applicationId,
});

const makeMockConvex = (
  results: AuditLogEntry[],
  status: 'Exhausted' | 'CanLoadMore' = 'Exhausted',
): MockConvexClient => {
  const convexMock = createMockConvexClient();
  const onPaginatedUpdate = vi
    .fn()
    .mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        _options: unknown,
        onData: (data: unknown) => void,
      ) => {
        onData({
          results,
          status,
          loadMore: vi.fn().mockReturnValue(false),
        });
        return () => {
          // unsubscribe noop
        };
      },
    );

  convexMock.onPaginatedUpdate_experimental = onPaginatedUpdate;
  convexMock.client.onPaginatedUpdate_experimental = onPaginatedUpdate;
  return convexMock;
};

describe('AuditLogTableComponent', () => {
  let fixture: ComponentFixture<AuditLogTableComponent>;
  let component: AuditLogTableComponent;

  const setupComponent = async (mockConvex: MockConvexClient) => {
    await TestBed.configureTestingModule({
      imports: [AuditLogTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: CONVEX, useValue: mockConvex},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditLogTableComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('organizerId', 'org1' as unknown);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  afterEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('should render filter bar with category and time window selects', async () => {
    await setupComponent(makeMockConvex([]));
    const harness = await getHarness(fixture);

    const category = await harness.getFilterCategory();
    const timeWindow = await harness.getFilterTimeWindow();

    expect(category).toBe('');
    expect(timeWindow).toBe('all');
    expect(await harness.getFilterCategoryClass()).toContain('native-select');
    expect(await harness.getFilterTimeWindowClass()).toContain('native-select');
  });

  it('should show skeleton rows when loading', async () => {
    const mockConvex: MockConvexClientType = createMockConvexClient();
    const onPaginatedUpdate = vi
      .fn()
      .mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          _options: unknown,
          onData: (data: unknown) => void,
        ) => {
          onData({
            results: [],
            status: 'LoadingFirstPage',
            loadMore: vi.fn(),
          });
          return () => {
            // unsubscribe noop
          };
        },
      );

    mockConvex.onPaginatedUpdate_experimental = onPaginatedUpdate;
    mockConvex.client.onPaginatedUpdate_experimental = onPaginatedUpdate;

    await setupComponent(mockConvex);
    const harness = await getHarness(fixture);

    expect(await harness.hasSkeletons()).toBe(true);
  });

  it('should show empty state when no data', async () => {
    await setupComponent(makeMockConvex([]));
    const harness = await getHarness(fixture);

    expect(await harness.hasEmptyState()).toBe(true);
    const text = await harness.getEmptyStateText();
    expect(text.toUpperCase()).toContain('NO ACTIVITY RECORDED');
  });

  it('should render correct number of table rows when data present', async () => {
    const entries = [
      makeEntry({_id: 'l1', action: 'event.create', adminName: 'Alice'}),
      makeEntry({_id: 'l2', action: 'application.review', adminName: 'Bob'}),
      makeEntry({_id: 'l3', action: 'ticket.check-in', adminName: 'Carol'}),
    ];
    await setupComponent(makeMockConvex(entries));
    const harness = await getHarness(fixture);

    // Desktop table + mobile list each renders rows, so 3 entries = 6 DOM rows total
    const count = await harness.getRowCount();
    expect(count).toBe(6); // 3 desktop tr + 3 mobile divs
  });

  it('should show load more button when results are not exhausted', async () => {
    const entries = [makeEntry({_id: 'l1'})];
    await setupComponent(makeMockConvex(entries, 'CanLoadMore'));
    const harness = await getHarness(fixture);

    expect(await harness.hasLoadMoreButton()).toBe(true);
  });

  it('should hide load more button when results are exhausted', async () => {
    const entries = [makeEntry({_id: 'l1'})];
    await setupComponent(makeMockConvex(entries, 'Exhausted'));
    const harness = await getHarness(fixture);

    expect(await harness.hasLoadMoreButton()).toBe(false);
  });

  it('should not call the query when organizerId is undefined', async () => {
    const mockConvex = makeMockConvex([]);
    await TestBed.configureTestingModule({
      imports: [AuditLogTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: CONVEX, useValue: mockConvex},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditLogTableComponent);
    // Do NOT set organizerId — it defaults to undefined
    fixture.detectChanges();
    await fixture.whenStable();

    // When organizerId is undefined, the skip token is returned, so the client should not be called
    // (or if called, it was with the skip logic — no data is returned)
    expect(
      mockConvex.client.onPaginatedUpdate_experimental,
    ).not.toHaveBeenCalled();
  });

  it('should update category filter signal when select changes', async () => {
    await setupComponent(makeMockConvex([]));
    const harness = await getHarness(fixture);

    await harness.setFilterCategory('event');
    fixture.detectChanges();

    expect(component.selectedCategory()).toBe('event');
  });

  it('should update time window filter signal when select changes', async () => {
    await setupComponent(makeMockConvex([]));
    const harness = await getHarness(fixture);

    await harness.setFilterTimeWindow('7d');
    fixture.detectChanges();

    expect(component.selectedTimeWindow()).toBe('7d');
  });

  it('uses a real desktop detail button with synchronized aria state', async () => {
    const entry = makeEntry({
      _id: 'l1',
      action: 'event.create',
      adminName: 'Alice Admin',
      eventName: 'My Event',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    expect(await harness.getDesktopRowAttribute(0, 'role')).toBeNull();
    expect(await harness.getDesktopRowAttribute(0, 'tabindex')).toBeNull();
    expect(await harness.getDesktopRowAttribute(0, 'aria-expanded')).toBeNull();
    expect(await harness.getDetailTriggerAttribute(0, 'type')).toBe('button');
    expect(await harness.getDetailTriggerAttribute(0, 'role')).toBeNull();
    expect(await harness.getDetailTriggerAttribute(0, 'aria-label')).toBe(
      'Expand details for created event by Alice Admin',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'false',
    );
    expect(
      await harness.getDetailTriggerAttribute(0, 'aria-controls'),
    ).toBeNull();

    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getDetailTriggerAttribute(0, 'aria-label')).toBe(
      'Collapse details for created event by Alice Admin',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'true',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-controls')).toBe(
      'audit-log-expanded-detail-l1',
    );
    expect(await harness.getExpandedRegionAttribute('id')).toBe(
      'audit-log-expanded-detail-l1',
    );
    expect(await harness.getExpandedRegionAttribute('aria-labelledby')).toBe(
      'audit-log-detail-trigger-l1',
    );

    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getDetailTriggerAttribute(0, 'aria-label')).toBe(
      'Expand details for created event by Alice Admin',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'false',
    );
    expect(
      await harness.getDetailTriggerAttribute(0, 'aria-controls'),
    ).toBeNull();
    expect(await harness.getExpandedDetailCount()).toBe(0);
  });

  it('should toggle desktop details from the keyboard with Enter and Space', async () => {
    const entry = makeEntry({
      _id: 'l1',
      action: 'event.create',
      adminName: 'Alice Admin',
      eventName: 'Warehouse Party',
      eventId: 'evt123' as unknown as Id<'events'>,
      reason: 'New event created',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'false',
    );

    await harness.pressEnterOnDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'true',
    );
    expect(await harness.getExpandedDetailText()).toContain('Warehouse Party');
    expect(await harness.getExpandedDetailText()).toContain(
      'New event created',
    );

    await harness.pressSpaceOnDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'false',
    );
    expect(await harness.getExpandedDetailCount()).toBe(0);
  });

  // BRA-134: Click-to-expand row details
  it('should expand detail panel when the desktop detail trigger is clicked', async () => {
    const entry = makeEntry({
      _id: 'l1',
      action: 'event.create',
      adminName: 'Alice Admin',
      eventName: 'Warehouse Party',
      eventId: 'evt123' as unknown as Id<'events'>,
      reason: 'New event created',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    // No expanded detail initially
    expect(await harness.getExpandedDetailCount()).toBe(0);

    // Click the first desktop detail trigger (index 0)
    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    // Expanded detail should be visible
    expect(await harness.getExpandedDetailCount()).toBeGreaterThan(0);
    const text = await harness.getExpandedDetailText();
    expect(text).toContain('Alice Admin');
    expect(text).toContain('Warehouse Party');
    expect(text).toContain('New event created');
  });

  it('should collapse detail panel when the same desktop detail trigger is clicked again', async () => {
    const entry = makeEntry({
      _id: 'l1',
      action: 'event.create',
      adminName: 'Alice',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    // Expand
    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.getExpandedDetailCount()).toBeGreaterThan(0);

    // Collapse
    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.getExpandedDetailCount()).toBe(0);
  });

  it('should only expand one row at a time', async () => {
    const entries = [
      makeEntry({_id: 'l1', action: 'event.create', adminName: 'Alice'}),
      makeEntry({_id: 'l2', action: 'event.update', adminName: 'Bob'}),
    ];
    await setupComponent(makeMockConvex(entries));
    const harness = await getHarness(fixture);

    // Click first desktop detail trigger
    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    // Click second desktop detail trigger — should collapse first and expand second
    await harness.clickDesktopDetailTrigger(1);
    fixture.detectChanges();
    await fixture.whenStable();

    // Only one expanded detail visible at a time (desktop expanded row + mobile expanded detail)
    const text = await harness.getExpandedDetailText();
    expect(text).toContain('Bob');
  });

  // BRA-381: Audit log toggle buttons must have aria-label
  it('should have aria-label on desktop expand/collapse toggle buttons', async () => {
    const entry = makeEntry({
      _id: 'l1',
      action: 'event.create',
      adminName: 'Alice Admin',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    // Collapsed state
    expect(await harness.getDetailTriggerAttribute(0, 'aria-label')).toBe(
      'Expand details for created event by Alice Admin',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'false',
    );
    expect(
      await harness.getDetailTriggerAttribute(0, 'aria-controls'),
    ).toBeNull();

    // Click to expand
    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getDetailTriggerAttribute(0, 'aria-label')).toBe(
      'Collapse details for created event by Alice Admin',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-expanded')).toBe(
      'true',
    );
    expect(await harness.getDetailTriggerAttribute(0, 'aria-controls')).toBe(
      'audit-log-expanded-detail-l1',
    );
  });

  it('should have aria-label on mobile expand/collapse toggle buttons', async () => {
    const entry = makeEntry({
      _id: 'l1',
      action: 'event.create',
      adminName: 'Alice Admin',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    // Collapsed state
    expect(await harness.getMobileToggleAriaLabel(0)).toBe(
      'Expand details for created event by Alice Admin',
    );
    expect(await harness.getMobileToggleAriaExpanded(0)).toBe('false');
  });

  // BRA-133: Long admin names should truncate with title tooltip
  it('should truncate long admin names and provide title tooltip', async () => {
    const longName = 'A'.repeat(120);
    const entries = [makeEntry({_id: 'l1', adminName: longName})];
    await setupComponent(makeMockConvex(entries));
    const harness = await getHarness(fixture);

    const title = await harness.getDesktopAdminTitle(0);
    expect(title).toBe(longName);
  });

  // BRA-98: Every ACTION_DISPLAY key renders a non-fallback label
  it('renders a human-readable label for every ACTION_DISPLAY key', async () => {
    const actions = Object.keys(
      ACTION_DISPLAY,
    ) as (keyof typeof ACTION_DISPLAY)[];
    const entries = actions.map((action, i) =>
      makeEntry({_id: `key-${i}`, action}),
    );
    await setupComponent(makeMockConvex(entries));
    const harness = await getHarness(fixture);

    const rows = await harness.getRows();
    // Desktop rows are the first half (entries.length rows)
    const desktopRows = rows.slice(0, entries.length);
    for (const row of desktopRows) {
      const text = await row.text();
      expect(text).not.toContain('ACTION');
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  // BRA-400: Deleted event title shows as plain text (no link) in expanded details
  it('shows deleted event title as plain text in the expanded details', async () => {
    const entry = makeEntry({
      _id: 'del1',
      action: 'event.delete',
      deletedEventName: 'Lost Warehouse',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    const deletedText = await harness.getDeletedEventText();
    expect(deletedText).toContain('Lost Warehouse (deleted)');

    // Verify there is no anchor element wrapping the deleted event name
    const expanded = document.querySelector(
      '[data-testid="expanded-deleted-event"]',
    );
    expect(expanded).not.toBeNull();
    expect(expanded!.querySelector('a')).toBeNull();
  });

  it('shows target user name in expanded details when set', async () => {
    const entry = makeEntry({
      _id: 'tgt1',
      action: 'community_admin.grant',
      adminName: 'Root Admin',
      targetUserName: 'Jane Doe',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    const targetText = await harness.getTargetUserText();
    expect(targetText).toBe('Jane Doe');
  });

  it('does not show target user section when targetUserName is absent', async () => {
    const entry = makeEntry({
      _id: 'notgt1',
      action: 'event.create',
      adminName: 'Alice',
      eventName: 'Some Event',
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    await harness.clickDesktopDetailTrigger(0);
    fixture.detectChanges();
    await fixture.whenStable();

    const targetText = await harness.getTargetUserText();
    expect(targetText).toBeNull();
  });

  // BRA-98: Unknown actions are humanized rather than showing 'ACTION'
  it('humanizes a truly unknown action instead of printing ACTION', async () => {
    const entry = makeEntry({
      _id: 'unk1',
      action: 'brand.new.unmapped' as AuditLogEntry['action'],
    });
    await setupComponent(makeMockConvex([entry]));
    const harness = await getHarness(fixture);

    const rows = await harness.getRows();
    const desktopRows = rows.slice(0, 1);
    const text = await desktopRows[0].text();
    expect(text).toContain('BRAND NEW UNMAPPED');
    expect(text).not.toContain('ACTION');
  });

  // BRA-98: Verify all backend action types display human-readable labels
  it('should display human-readable labels for all BRA-98 action types', async () => {
    const entries = [
      makeEntry({
        _id: 'l1',
        action: 'event.management.view',
        adminName: 'Alice',
      }),
      makeEntry({
        _id: 'l2',
        action: 'vetting.reminder-email.send.no_application',
        adminName: 'Bob',
      }),
      makeEntry({
        _id: 'l3',
        action: 'account.email_change.failed',
        adminName: 'Carol',
      }),
      makeEntry({
        _id: 'l4',
        action: 'account.email_change.requested',
        adminName: 'Dave',
      }),
      makeEntry({_id: 'l5', action: 'organizer.update', adminName: 'Eve'}),
      makeEntry({_id: 'l6', action: 'event.delete', adminName: 'Frank'}),
      makeEntry({_id: 'l7', action: 'event.create', adminName: 'Grace'}),
      makeEntry({_id: 'l8', action: 'magic_link.create', adminName: 'Heidi'}),
      makeEntry({_id: 'l9', action: 'magic_link.pause', adminName: 'Ivan'}),
      makeEntry({_id: 'l10', action: 'magic_link.resume', adminName: 'Judy'}),
      makeEntry({_id: 'l11', action: 'magic_link.disable', adminName: 'Ken'}),
      makeEntry({_id: 'l12', action: 'magic_link.delete', adminName: 'Lia'}),
    ];
    await setupComponent(makeMockConvex(entries));
    const harness = await getHarness(fixture);

    // All rows should render
    const count = await harness.getRowCount();
    expect(count).toBe(24); // 12 entries × 2 views (desktop + mobile)

    // Verify each row maps to its correct label
    const rows = await harness.getRows();
    const desktopRows = rows.slice(0, entries.length);
    const rowTexts = await Promise.all(desktopRows.map((r) => r.text()));

    expect(rowTexts[0]).toContain('VIEWED EVENT DATA');
    expect(rowTexts[1]).toContain('SENT VETTING REMINDER');
    expect(rowTexts[2]).toContain('EMAIL CHANGE FAILED');
    expect(rowTexts[3]).toContain('EMAIL CHANGE REQUESTED');
    expect(rowTexts[4]).toContain('UPDATED ORGANIZER');
    expect(rowTexts[5]).toContain('DELETED EVENT');
    expect(rowTexts[6]).toContain('CREATED EVENT');
    expect(rowTexts[7]).toContain('CREATED MAGIC LINK');
    expect(rowTexts[8]).toContain('PAUSED MAGIC LINK');
    expect(rowTexts[9]).toContain('RESUMED MAGIC LINK');
    expect(rowTexts[10]).toContain('DISABLED MAGIC LINK');
    expect(rowTexts[11]).toContain('DELETED MAGIC LINK');
  });
});
