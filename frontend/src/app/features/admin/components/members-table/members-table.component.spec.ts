import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {AdminMembersTableComponent} from './members-table.component';
import {AdminMembersTableHarness} from './members-table.component.harness';
import {
  MembersService,
  type MemberWithApplication,
} from '@/features/admin/services/members.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi, type Mock} from 'vitest';
import {type BraDialogOptions} from '@ui/components/composites/dialog/dialog.component';
import {
  signal,
  computed,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import {type Id, type Doc} from '@convex/_generated/dataModel';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../../testing/mock-types';
import {toast} from 'ngx-sonner';

async function getHarness(
  fix: ComponentFixture<AdminMembersTableComponent>,
): Promise<AdminMembersTableHarness> {
  return TestbedHarnessEnvironment.harnessForFixture(
    fix,
    AdminMembersTableHarness,
  );
}

const TEST_ORGANIZER_ID = 'org1' as Id<'organizers'>;

function setOrganizerInput(
  fix: ComponentFixture<AdminMembersTableComponent>,
  organizerId: Id<'organizers'> = TEST_ORGANIZER_ID,
): void {
  fix.componentRef.setInput('organizerId', organizerId);
}

type MockMembersService = Pick<MembersService, 'revokeMembership'>;
type MockApplicationsService = Pick<
  ApplicationsService,
  'approve' | 'reject' | 'revoke'
>;
interface MockAuthService {
  user: Signal<Doc<'users'> | undefined>;
  currentUser: Signal<Doc<'users'> | null>;
}
interface MockDialogService {
  create: ReturnType<typeof vi.fn>;
}

describe('AdminMembersTableComponent', () => {
  let component: AdminMembersTableComponent;
  let fixture: ComponentFixture<AdminMembersTableComponent>;
  let mockMembersService: MockMembersService;
  let mockAppsService: MockApplicationsService;
  let mockAuthService: MockAuthService;
  let mockDialogService: MockDialogService;
  let mockConvexClient: MockConvexClient;
  let toastSuccessSpy: ReturnType<typeof vi.spyOn>;
  let toastErrorSpy: ReturnType<typeof vi.spyOn>;

  const mockMember: MemberWithApplication = {
    user: {
      _id: 'u1' as Id<'users'>,
      name: 'testuser',
      email: 'test@example.com',
      _creationTime: 1234567890,
    } as Doc<'users'>,
    application: {
      _id: 'a1' as Id<'applications'>,
      status: 'pending',
      answers: {},
      userId: 'u1' as Id<'users'>,
    } as Doc<'applications'>,
  };

  const mockApprovedMember: MemberWithApplication = {
    user: {
      _id: 'u2' as Id<'users'>,
      name: 'approved-member',
      email: 'trust@example.com',
      _creationTime: 1234567890,
    } as Doc<'users'>,
    application: {
      _id: 'a2' as Id<'applications'>,
      status: 'approved',
      answers: {},
      userId: 'u2' as Id<'users'>,
    } as Doc<'applications'>,
    communityAccessSource: 'approved_application',
  };

  const mockRejectedMember: MemberWithApplication = {
    user: {
      _id: 'u4' as Id<'users'>,
      name: 'rejected-user',
      email: 'rejected@example.com',
      _creationTime: 1234567890,
    } as Doc<'users'>,
    application: {
      _id: 'a4' as Id<'applications'>,
      status: 'rejected',
      answers: {},
      userId: 'u4' as Id<'users'>,
    } as Doc<'applications'>,
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    toastSuccessSpy = vi
      .spyOn(toast, 'success')
      .mockImplementation(() => '' as string & number);
    toastErrorSpy = vi
      .spyOn(toast, 'error')
      .mockImplementation(() => '' as string & number);

    mockMembersService = {
      revokeMembership: vi.fn().mockResolvedValue({}),
    };

    mockAppsService = {
      approve: vi.fn().mockResolvedValue({}),
      reject: vi.fn().mockResolvedValue({}),
      revoke: vi.fn().mockResolvedValue({}),
    };

    const userSignal: WritableSignal<Doc<'users'> | undefined> = signal({
      _id: 'admin1' as Id<'users'>,
      _creationTime: 1234567890,
    } as Doc<'users'>);
    mockAuthService = {
      user: userSignal as Signal<Doc<'users'> | undefined>,
      currentUser: computed(() => userSignal() ?? null),
    };

    mockDialogService = {
      create: vi.fn(),
    };

    const defaultLoadMore = vi.fn().mockReturnValue(false);
    const membersLoad = vi
      .fn()
      .mockImplementation(
        (_query, _args, _options, onData: (data: unknown) => void) => {
          onData({
            results: [mockMember, mockApprovedMember],
            status: 'Exhausted',
            loadMore: defaultLoadMore,
          });
          return () => {
            // unsubscribe noop
          };
        },
      );
    mockConvexClient = createMockConvexClient();
    mockConvexClient.client.onPaginatedUpdate_experimental = membersLoad;
    mockConvexClient.onPaginatedUpdate_experimental = membersLoad;

    await TestBed.configureTestingModule({
      imports: [AdminMembersTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: MembersService, useValue: mockMembersService},
        {provide: ApplicationsService, useValue: mockAppsService},
        {provide: AuthService, useValue: mockAuthService},
        {provide: CONVEX, useValue: mockConvexClient},
        {provide: BraDialogService, useValue: mockDialogService},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminMembersTableComponent);
    component = fixture.componentInstance;
    setOrganizerInput(fixture);
    fixture.detectChanges();
  });

  it('should load members on init', async () => {
    expect(
      mockConvexClient.client.onPaginatedUpdate_experimental,
    ).toHaveBeenCalled();
    await fixture.whenStable();
    expect(component.members().length).toBe(2);
  });

  it('should default memberFilter to all', () => {
    expect(component.memberFilter()).toBe('all');
  });

  it('should switch memberFilter when setMemberFilter is called', () => {
    component.setMemberFilter('ours');
    expect(component.memberFilter()).toBe('ours');

    component.setMemberFilter('shared');
    expect(component.memberFilter()).toBe('shared');

    component.setMemberFilter('all');
    expect(component.memberFilter()).toBe('all');
  });

  it('should render member filter labels without page-scoped counts', async () => {
    const harness = await getHarness(fixture);
    await fixture.whenStable();

    expect(await harness.getFilterLabels()).toEqual(['ALL', 'OURS', 'SHARED']);
  });

  it('should filter members by ours when filter is ours', async () => {
    component.setMemberFilter('ours');
    await fixture.whenStable();
    expect(component.filteredMembers().length).toBe(1);
    expect(component.filteredMembers()[0].user._id).toBe(
      mockApprovedMember.user._id,
    );
  });

  it('should filter members by shared when filter is shared', async () => {
    component.setMemberFilter('shared');
    await fixture.whenStable();
    expect(component.filteredMembers().length).toBe(0);
  });

  it('should include shared members when they have trustedViaOrganizerName', async () => {
    const sharedMember: MemberWithApplication = {
      user: {
        _id: 'u3' as Id<'users'>,
        name: 'shared-user',
        email: 'shared@example.com',
        _creationTime: 1234567890,
      } as Doc<'users'>,
      application: null,
      communityAccessSource: 'shared',
      trustedViaOrganizerName: 'Partner Community',
    };

    const sharedConvexMock = createMockConvexClient();
    const sharedLoad = vi
      .fn()
      .mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          _options: unknown,
          onData: (data: unknown) => void,
        ) => {
          onData({
            results: [sharedMember],
            status: 'Exhausted',
            loadMore: vi.fn().mockReturnValue(false),
          });
          return () => {
            // unsubscribe noop
          };
        },
      );
    sharedConvexMock.onPaginatedUpdate_experimental = sharedLoad;
    sharedConvexMock.client.onPaginatedUpdate_experimental = sharedLoad;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AdminMembersTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: MembersService, useValue: mockMembersService},
        {provide: ApplicationsService, useValue: mockAppsService},
        {provide: AuthService, useValue: mockAuthService},
        {provide: CONVEX, useValue: sharedConvexMock},
        {provide: BraDialogService, useValue: mockDialogService},
      ],
    }).compileComponents();

    const sharedFixture = TestBed.createComponent(AdminMembersTableComponent);
    const sharedComponent = sharedFixture.componentInstance;
    setOrganizerInput(sharedFixture);
    sharedFixture.detectChanges();
    await sharedFixture.whenStable();

    sharedComponent.setMemberFilter('shared');
    expect(sharedComponent.filteredMembers().length).toBe(1);
    expect(sharedComponent.filteredMembers()[0].trustedViaOrganizerName).toBe(
      'Partner Community',
    );

    const sharedHarness = await TestbedHarnessEnvironment.harnessForFixture(
      sharedFixture,
      AdminMembersTableHarness,
    );
    const managedViaText = await sharedHarness.getSharedManagedViaAt(0);
    expect(managedViaText).toContain('Managed via trusted community');
    expect(managedViaText).toContain('Partner Community');
    expect(await sharedHarness.isRevokeMembershipHiddenAt(0)).toBe(true);

    sharedComponent.revokeMembership(sharedMember);
    expect(mockDialogService.create).not.toHaveBeenCalled();
    expect(mockMembersService.revokeMembership).not.toHaveBeenCalled();
  });

  it('should render magic-link members as direct community access', async () => {
    const magicMember: MemberWithApplication = {
      user: {
        _id: 'u4' as Id<'users'>,
        name: 'magic-user',
        email: 'magic@example.com',
        _creationTime: 1234567890,
      } as Doc<'users'>,
      application: null,
      communityAccessSource: 'magic_link',
    };

    const magicConvexMock = createMockConvexClient();
    const magicLoad = vi
      .fn()
      .mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          _options: unknown,
          onData: (data: unknown) => void,
        ) => {
          onData({
            results: [magicMember],
            status: 'Exhausted',
            loadMore: vi.fn().mockReturnValue(false),
          });
          return () => {
            // unsubscribe noop
          };
        },
      );
    magicConvexMock.onPaginatedUpdate_experimental = magicLoad;
    magicConvexMock.client.onPaginatedUpdate_experimental = magicLoad;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AdminMembersTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: MembersService, useValue: mockMembersService},
        {provide: ApplicationsService, useValue: mockAppsService},
        {provide: AuthService, useValue: mockAuthService},
        {provide: CONVEX, useValue: magicConvexMock},
        {provide: BraDialogService, useValue: mockDialogService},
      ],
    }).compileComponents();

    const magicFixture = TestBed.createComponent(AdminMembersTableComponent);
    const magicComponent = magicFixture.componentInstance;
    setOrganizerInput(magicFixture);
    magicFixture.detectChanges();
    await magicFixture.whenStable();

    expect(magicComponent.hasCommunityAccess(magicMember)).toBe(true);
    expect(magicComponent.getMemberStatusLabel(magicMember)).toBe('MAGIC LINK');
    expect(magicComponent.filteredMembers().length).toBe(1);
  });

  it('should render direct members with an explicit source label', async () => {
    const directMember: MemberWithApplication = {
      user: {
        _id: 'u6' as Id<'users'>,
        name: 'direct-user',
        email: 'direct@example.com',
        _creationTime: 1234567890,
      } as Doc<'users'>,
      application: null,
      communityAccessSource: 'direct_member',
    };

    expect(component.hasCommunityAccess(directMember)).toBe(true);
    expect(component.getMemberStatusLabel(directMember)).toBe('DIRECT MEMBER');
  });

  it('should pass organizerId to query when input is set', async () => {
    fixture.componentRef.setInput('organizerId', 'org42' as unknown);
    fixture.detectChanges();
    await fixture.whenStable();

    const calls =
      mockConvexClient.client.onPaginatedUpdate_experimental.mock.calls;
    // The most recent call should include organizerId in args (args are resolved before being passed)
    const lastCall = calls[calls.length - 1];
    const resolvedArgs = lastCall[1] as Record<string, unknown>;
    expect(resolvedArgs).toEqual({organizerId: 'org42'});
  });

  describe('loadMore error handling', () => {
    it('should show error toast when loadMore fails', async () => {
      let onErrorCallback: ((error: Error) => unknown) | undefined;
      const loadMoreSpy = vi.fn().mockImplementation(() => {
        onErrorCallback?.(new Error('Network error'));
        return true;
      });

      const paginationConvexMock: MockConvexClient = createMockConvexClient();
      paginationConvexMock.client.onPaginatedUpdate_experimental = vi
        .fn()
        .mockImplementation(
          (
            _query,
            _args,
            _options,
            onData: (data: unknown) => void,
            onError: (error: Error) => unknown,
          ) => {
            onErrorCallback = onError;
            onData({
              results: [mockMember],
              status: 'CanLoadMore',
              loadMore: loadMoreSpy,
            });
            return () => {
              // unsubscribe noop
            };
          },
        );
      paginationConvexMock.onPaginatedUpdate_experimental =
        paginationConvexMock.client.onPaginatedUpdate_experimental;

      // Create a new component with pagination-enabled initial load
      const paginationMock = {
        revokeMembership: vi.fn(),
      };

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AdminMembersTableComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: MembersService, useValue: paginationMock},
          {provide: ApplicationsService, useValue: mockAppsService},
          {provide: AuthService, useValue: mockAuthService},
          {provide: CONVEX, useValue: paginationConvexMock},
          {provide: BraDialogService, useValue: mockDialogService},
        ],
      }).compileComponents();

      const paginationFixture = TestBed.createComponent(
        AdminMembersTableComponent,
      );
      const paginationComponent = paginationFixture.componentInstance;
      setOrganizerInput(paginationFixture);
      paginationFixture.detectChanges();

      // Wait for initial load (isDone: false, has cursor)
      await paginationFixture.whenStable();

      // Now loadMore should trigger the mocked pagination error callback
      paginationComponent.loadMore();

      expect(loadMoreSpy).toHaveBeenCalledWith(20);
      expect(toastErrorSpy).toHaveBeenCalledWith('Failed to load more members');
    });
  });

  it('should open dialog when revoking membership', async () => {
    await component.revokeMembership(mockApprovedMember);
    expect(mockDialogService.create).toHaveBeenCalled();
    const config = (mockDialogService.create as unknown as Mock).mock
      .calls[0][0] as BraDialogOptions<unknown, unknown>;
    expect(config.zTitle).toBe('Revoke Membership');
  });

  it('should call revoke service when dialog confirmed', async () => {
    const mockReasonInstance = {reason: () => ''};
    (mockDialogService.create as unknown as Mock).mockImplementation(
      (config: {zOnOk: (instance: unknown) => void}) => {
        config.zOnOk(mockReasonInstance);
      },
    );

    await component.revokeMembership(mockApprovedMember);
    await fixture.whenStable();

    // When member has an application, only appsService.revoke is called
    // (it handles both application status and user flags atomically)
    expect(mockAppsService.revoke).toHaveBeenCalledWith(
      'a2',
      'admin1',
      undefined,
    );
    expect(mockMembersService.revokeMembership).not.toHaveBeenCalled();
    expect(toastSuccessSpy).toHaveBeenCalledWith('Membership revoked');
  });

  it('should pass reason to revoke when dialog returns a value', async () => {
    const mockReasonInstance = {reason: () => 'Violated community guidelines'};
    (mockDialogService.create as unknown as Mock).mockImplementation(
      (config: {zOnOk: (instance: unknown) => void}) => {
        config.zOnOk(mockReasonInstance);
      },
    );

    await component.revokeMembership(mockApprovedMember);
    await fixture.whenStable();

    expect(mockAppsService.revoke).toHaveBeenCalledWith(
      'a2',
      'admin1',
      'Violated community guidelines',
    );
  });

  it('should pass organizerId to revokeMembership when member has no application', async () => {
    fixture.componentRef.setInput('organizerId', 'org1' as unknown);
    fixture.detectChanges();

    const memberNoApp: MemberWithApplication = {
      user: {
        _id: 'u3' as Id<'users'>,
        name: 'noapp',
        email: 'no@app.com',
        _creationTime: 0,
      } as Doc<'users'>,
      application: null,
      communityAccessSource: 'direct_member',
    };

    (mockDialogService.create as unknown as Mock).mockImplementation(
      (config: {zOnOk: () => void}) => {
        config.zOnOk();
      },
    );

    await component.revokeMembership(memberNoApp);
    await fixture.whenStable();

    expect(mockMembersService.revokeMembership).toHaveBeenCalledWith(
      'u3',
      'org1',
    );
    expect(mockAppsService.revoke).not.toHaveBeenCalled();
  });

  it('should approve application', async () => {
    await component.updateAppStatus(mockMember, 'approved');
    expect(mockAppsService.approve).toHaveBeenCalledWith('a1', 'u1', 'admin1');
    expect(toastSuccessSpy).toHaveBeenCalledWith(
      'Membership application approved',
    );
  });

  it('should reject application with reason dialog', async () => {
    const mockReasonInstance = {reason: () => 'Not eligible'};
    (mockDialogService.create as unknown as Mock).mockImplementation(
      (config: {zOnOk: (instance: unknown) => void}) => {
        config.zOnOk(mockReasonInstance);
      },
    );

    await component.updateAppStatus(mockMember, 'rejected');
    await fixture.whenStable();

    expect(mockDialogService.create).toHaveBeenCalled();
    const config = (mockDialogService.create as unknown as Mock).mock
      .calls[0][0] as BraDialogOptions<unknown, unknown>;
    expect(config.zData).toEqual({
      visibilityLabel: 'VISIBLE TO THE APPLICANT (IN-APP + EMAIL)',
      reasonLabel: 'Deny reason',
      placeholder: 'Optional: tell the applicant why they were denied',
    });
    expect(mockAppsService.reject).toHaveBeenCalledWith(
      'a1',
      'admin1',
      'Not eligible',
    );
    expect(toastSuccessSpy).toHaveBeenCalledWith(
      'Membership application rejected',
    );
  });

  it('should block invalid review transitions with a visible toast', async () => {
    await component.updateAppStatus(mockRejectedMember, 'approved');

    expect(mockAppsService.approve).not.toHaveBeenCalled();
    expect(mockDialogService.create).not.toHaveBeenCalled();
    expect(toastErrorSpy).toHaveBeenCalledWith(
      'Only pending applications can be approved or rejected',
    );
  });

  describe('DOM rendering via harness', () => {
    it('approved member: name, email, and APPROVED status badge are visible', async () => {
      const harness = await getHarness(fixture);
      await fixture.whenStable();

      const rowCount = await harness.getRowCount();
      expect(rowCount).toBe(1);

      // Find the approved member row by name
      const rows = await harness.getAllRows();
      const approvedRow = rows.find((r) => r.name === 'approved-member');
      expect(approvedRow).toBeDefined();
      expect(approvedRow?.email).toBe('trust@example.com');
      expect(approvedRow?.status).toBe('APPROVED');
    });

    it('labels the revoke action with the member name', async () => {
      const harness = await getHarness(fixture);
      await fixture.whenStable();

      expect(await harness.getActionAriaLabelsAt(0)).toContain(
        'Revoke membership for approved-member, trust@example.com, id U2',
      );
    });

    it('empty state: shows "NO MEMBERS FOUND" and zero rows when no members are returned', async () => {
      // Reconfigure convex to return empty results
      const emptyConvexMock = createMockConvexClient();
      const emptyLoad = vi
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
              status: 'Exhausted',
              loadMore: vi.fn().mockReturnValue(false),
            });
            return () => {
              // unsubscribe noop
            };
          },
        );
      emptyConvexMock.onPaginatedUpdate_experimental = emptyLoad;
      emptyConvexMock.client.onPaginatedUpdate_experimental = emptyLoad;

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AdminMembersTableComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: MembersService, useValue: mockMembersService},
          {provide: ApplicationsService, useValue: mockAppsService},
          {provide: AuthService, useValue: mockAuthService},
          {provide: CONVEX, useValue: emptyConvexMock},
          {provide: BraDialogService, useValue: mockDialogService},
        ],
      }).compileComponents();

      const emptyFixture = TestBed.createComponent(AdminMembersTableComponent);
      setOrganizerInput(emptyFixture);
      emptyFixture.detectChanges();
      await emptyFixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        emptyFixture,
        AdminMembersTableHarness,
      );

      expect(await harness.getRowCount()).toBe(0);
      expect(await harness.hasEmptyState()).toBe(true);
      expect(await harness.getEmptyStateText()).toContain('NO MEMBERS FOUND');
    });

    it('rejected applicant: row is excluded from member-management rows', async () => {
      const rejectedConvexMock = createMockConvexClient();
      const rejectedLoad = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            _options: unknown,
            onData: (data: unknown) => void,
          ) => {
            onData({
              results: [mockApprovedMember, mockRejectedMember],
              status: 'Exhausted',
              loadMore: vi.fn().mockReturnValue(false),
            });
            return () => {
              // unsubscribe noop
            };
          },
        );
      rejectedConvexMock.onPaginatedUpdate_experimental = rejectedLoad;
      rejectedConvexMock.client.onPaginatedUpdate_experimental = rejectedLoad;

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AdminMembersTableComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: MembersService, useValue: mockMembersService},
          {provide: ApplicationsService, useValue: mockAppsService},
          {provide: AuthService, useValue: mockAuthService},
          {provide: CONVEX, useValue: rejectedConvexMock},
          {provide: BraDialogService, useValue: mockDialogService},
        ],
      }).compileComponents();

      const rejectedFixture = TestBed.createComponent(
        AdminMembersTableComponent,
      );
      setOrganizerInput(rejectedFixture);
      rejectedFixture.detectChanges();
      await rejectedFixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        rejectedFixture,
        AdminMembersTableHarness,
      );

      expect(await harness.getRowCount()).toBe(1);
      const rows = await harness.getAllRows();
      expect(rows[0].name).toBe('approved-member');
      expect(rows[0].email).toBe('trust@example.com');
      expect(rows[0].status).toBe('APPROVED');
    });

    it('does not show REVOKE MEMBERSHIP for the currently logged-in admin', async () => {
      // The current admin is 'admin1'; set up an approved member with that same id
      const selfMember: MemberWithApplication = {
        user: {
          _id: 'admin1' as Id<'users'>,
          name: 'current-admin',
          email: 'admin@example.com',
          _creationTime: 1234567890,
        } as Doc<'users'>,
        application: {
          _id: 'a99' as Id<'applications'>,
          status: 'approved',
          answers: {},
          userId: 'admin1' as Id<'users'>,
        } as Doc<'applications'>,
        communityAccessSource: 'approved_application',
      };

      const otherMember: MemberWithApplication = {
        user: {
          _id: 'u99' as Id<'users'>,
          name: 'other-member',
          email: 'other@example.com',
          _creationTime: 1234567890,
        } as Doc<'users'>,
        application: null,
        communityAccessSource: 'magic_link',
      };

      const selfConvexMock = createMockConvexClient();
      const selfLoad = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            _options: unknown,
            onData: (data: unknown) => void,
          ) => {
            onData({
              results: [selfMember, otherMember],
              status: 'Exhausted',
              loadMore: vi.fn().mockReturnValue(false),
            });
            return () => {
              // unsubscribe noop
            };
          },
        );
      selfConvexMock.onPaginatedUpdate_experimental = selfLoad;
      selfConvexMock.client.onPaginatedUpdate_experimental = selfLoad;

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AdminMembersTableComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: MembersService, useValue: mockMembersService},
          {provide: ApplicationsService, useValue: mockAppsService},
          {provide: AuthService, useValue: mockAuthService},
          {provide: CONVEX, useValue: selfConvexMock},
          {provide: BraDialogService, useValue: mockDialogService},
        ],
      }).compileComponents();

      const selfFixture = TestBed.createComponent(AdminMembersTableComponent);
      setOrganizerInput(selfFixture);
      selfFixture.detectChanges();
      await selfFixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        selfFixture,
        AdminMembersTableHarness,
      );

      // Row 0 is the current admin — REVOKE MEMBERSHIP must not appear
      expect(await harness.isRevokeMembershipHiddenAt(0)).toBe(true);
      // Row 1 is another member — REVOKE MEMBERSHIP must appear
      expect(await harness.isRevokeMembershipHiddenAt(1)).toBe(false);
    });

    it('member without email: shows "No email" instead of blank cell', async () => {
      const noEmailMember: MemberWithApplication = {
        user: {
          _id: 'u5' as Id<'users'>,
          name: 'no-email-user',
          _creationTime: 1234567890,
        } as Doc<'users'>,
        application: null,
        communityAccessSource: 'magic_link',
      };

      const noEmailConvexMock = createMockConvexClient();
      const noEmailLoad = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            _options: unknown,
            onData: (data: unknown) => void,
          ) => {
            onData({
              results: [noEmailMember],
              status: 'Exhausted',
              loadMore: vi.fn().mockReturnValue(false),
            });
            return () => {
              // unsubscribe noop
            };
          },
        );
      noEmailConvexMock.onPaginatedUpdate_experimental = noEmailLoad;
      noEmailConvexMock.client.onPaginatedUpdate_experimental = noEmailLoad;

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AdminMembersTableComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: MembersService, useValue: mockMembersService},
          {provide: ApplicationsService, useValue: mockAppsService},
          {provide: AuthService, useValue: mockAuthService},
          {provide: CONVEX, useValue: noEmailConvexMock},
          {provide: BraDialogService, useValue: mockDialogService},
        ],
      }).compileComponents();

      const noEmailFixture = TestBed.createComponent(
        AdminMembersTableComponent,
      );
      setOrganizerInput(noEmailFixture);
      noEmailFixture.detectChanges();
      await noEmailFixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        noEmailFixture,
        AdminMembersTableHarness,
      );

      const rows = await harness.getAllRows();
      expect(rows[0].email).toBe('No email');
    });
  });
});
