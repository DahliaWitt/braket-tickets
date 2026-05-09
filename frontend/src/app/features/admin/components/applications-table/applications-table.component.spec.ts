import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {AdminApplicationsTableComponent} from './applications-table.component';
import {AdminApplicationsTableHarness} from './applications-table.component.harness';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import type {BraDialogOptions} from '@ui/components/composites/dialog/dialog.component';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {of} from 'rxjs';
import {type Application} from '@/features/vetting/models/application.model';
import {type Id} from '@convex/_generated/dataModel';
import {ReasonDialogComponent} from '@/features/admin/components/reason-dialog/reason-dialog.component';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

import {vi} from 'vitest';

describe('AdminApplicationsTableComponent', () => {
  let component: AdminApplicationsTableComponent;
  let fixture: ComponentFixture<AdminApplicationsTableComponent>;
  let harness: AdminApplicationsTableHarness;

  interface ApplicationsServiceMock {
    mapApplications: ReturnType<typeof vi.fn>;
    mapHistoryApplications: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
  }

  interface AuthServiceMock {
    currentUser: ReturnType<typeof vi.fn>;
  }

  interface BraDialogMock {
    create: ReturnType<typeof vi.fn>;
  }

  let appsServiceMock: ApplicationsServiceMock;
  let convexClientMock: MockConvexClient;
  let authServiceMock: AuthServiceMock;
  let braDialogMock: BraDialogMock;
  let latestOnData: ((apps: Application[]) => void) | null = null;

  const appId = '1' as Id<'applications'>;
  const userId = 'u1' as Id<'users'>;
  const organizerId = 'org1' as Id<'organizers'>;
  const adminId = 'admin1' as Id<'users'>;

  const mockApps: Application[] = [
    {
      _id: appId,
      _creationTime: 123,
      userId,
      status: 'pending',
      answers: {
        referral: 'User2 referred me',
        custom_q1: 'Answer 1',
        custom_q2: true,
        unknown_q: 'Some other answer',
        source: 'web',
      },
      user: {
        _id: userId,
        name: 'User1',
        email: 'u1@test.com',
      } as Application['user'],
      organizer: {
        _id: organizerId,
        name: 'Community 1',
        vettingQuestions: [
          {
            id: 'custom_q1',
            question: 'Custom Question 1',
            type: 'text',
            required: true,
          },
          {
            id: 'custom_q2',
            question: 'Custom Question 2',
            type: 'boolean',
            required: true,
          },
        ],
      } as Application['organizer'],
    },
  ];

  beforeEach(async () => {
    appsServiceMock = {
      mapApplications: vi.fn().mockImplementation((docs: unknown) => {
        return Array.isArray(docs) ? (docs as Application[]) : [];
      }),
      mapHistoryApplications: vi.fn().mockImplementation((docs: unknown) => {
        return Array.isArray(docs)
          ? (docs as Application[]).filter((app) => app.status !== 'pending')
          : [];
      }),
      approve: vi.fn().mockResolvedValue({}),
      reject: vi.fn().mockResolvedValue({}),
    };

    const onUpdate = vi
      .fn()
      .mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (apps: Application[]) => void,
        ) => {
          latestOnData = onData;
          onData(mockApps);
          return () => void 0;
        },
      );
    convexClientMock = createMockConvexClient();
    convexClientMock.client.onUpdate = onUpdate;
    convexClientMock.onUpdate = onUpdate;

    authServiceMock = {
      currentUser: vi.fn().mockReturnValue({_id: adminId}),
    };

    braDialogMock = {
      create: vi
        .fn()
        .mockImplementation((options: BraDialogOptions<unknown, unknown>) => {
          // Simulate 'OK' click if zOnOk is present, which triggers the logic
          // If zContent is ReasonDialogComponent, pass a mock instance with reason signal
          if (options.zOnOk) {
            if (options.zContent === ReasonDialogComponent) {
              const mockInstance = {reason: signal('')} as Pick<
                ReasonDialogComponent,
                'reason'
              >;
              (options.zOnOk as (result: unknown) => void)(mockInstance);
            } else {
              (options.zOnOk as (result: unknown) => void)(null);
            }
          }
          return {
            afterClosed$: of(true),
          };
        }),
    };

    await TestBed.configureTestingModule({
      imports: [AdminApplicationsTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: ApplicationsService, useValue: appsServiceMock},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: AuthService, useValue: authServiceMock},
        {provide: BraDialogService, useValue: braDialogMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminApplicationsTableComponent);
    component = fixture.componentInstance;
    // Set required input
    fixture.componentRef.setInput('tableType', 'pending');
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminApplicationsTableHarness,
    );
  });

  it('should load pending applications on init', async () => {
    expect(convexClientMock.client.onUpdate).toHaveBeenCalled();
    expect(appsServiceMock.mapApplications).toHaveBeenCalled();
    expect(component.allApplications().length).toBe(1);
  });

  it('should open dialog and approve application', async () => {
    await component.updateStatus(mockApps[0], 'approved');
    await fixture.whenStable();

    expect(braDialogMock.create).toHaveBeenCalled();
    expect(appsServiceMock.approve).toHaveBeenCalledWith(
      appId,
      userId,
      adminId,
    );
  });

  it('should open dialog and reject application without reason', async () => {
    await component.updateStatus(mockApps[0], 'rejected');
    await fixture.whenStable();

    expect(braDialogMock.create).toHaveBeenCalled();
    expect(appsServiceMock.reject).toHaveBeenCalledWith(
      appId,
      adminId,
      undefined,
    );
  });

  it('should pass reason to reject when reason dialog returns a value', async () => {
    braDialogMock.create.mockImplementationOnce(
      (options: BraDialogOptions<unknown, unknown>) => {
        if (options.zOnOk && options.zContent === ReasonDialogComponent) {
          const mockInstance = {reason: signal('Suspicious profile')} as Pick<
            ReasonDialogComponent,
            'reason'
          >;
          (options.zOnOk as (result: unknown) => void)(mockInstance);
        }
        return {afterClosed$: of(true)};
      },
    );

    await component.updateStatus(mockApps[0], 'rejected');
    await fixture.whenStable();

    expect(appsServiceMock.reject).toHaveBeenCalledWith(
      appId,
      adminId,
      'Suspicious profile',
    );
  });

  it('should use ReasonDialogComponent as zContent when rejecting', async () => {
    await component.updateStatus(mockApps[0], 'rejected');
    await fixture.whenStable();

    const callArg = braDialogMock.create.mock.calls[0][0] as BraDialogOptions<
      unknown,
      unknown
    >;
    expect(callArg.zContent).toBe(ReasonDialogComponent);
    expect(callArg.zData).toEqual({
      visibilityLabel: 'VISIBLE TO THE APPLICANT (IN-APP + EMAIL)',
      reasonLabel: 'Deny reason',
      placeholder: 'Optional: tell the applicant why they were denied',
    });
  });

  it('should NOT use ReasonDialogComponent when approving', async () => {
    await component.updateStatus(mockApps[0], 'approved');
    await fixture.whenStable();

    const callArg = braDialogMock.create.mock.calls[0][0] as BraDialogOptions<
      unknown,
      unknown
    >;
    expect(callArg.zContent).toBeUndefined();
  });

  it('should include organizerId in query args when input is set', async () => {
    fixture.componentRef.setInput('organizerId', organizerId);
    await fixture.whenStable();

    // Find the applications.list query call by looking for args with 'status' field
    const allCalls = convexClientMock.client.onUpdate.mock.calls;
    const listCalls = allCalls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args && typeof args === 'object' && 'status' in args;
    });
    const lastListCall = listCalls.at(-1);
    expect(lastListCall?.[1]).toMatchObject({organizerId, status: 'pending'});
  });

  it('should not include organizerId in query args when input is undefined', async () => {
    fixture.componentRef.setInput('organizerId', undefined);
    await fixture.whenStable();

    // Find the applications.list query call by looking for args with 'status' field
    const allCalls = convexClientMock.client.onUpdate.mock.calls;
    const listCalls = allCalls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args && typeof args === 'object' && 'status' in args;
    });
    const lastListCall = listCalls.at(-1);
    expect(lastListCall?.[1]).not.toHaveProperty('organizerId');
  });

  it('should correctly map dynamic answers using organizer questions', () => {
    const answers = component.getVettingAnswers(mockApps[0]);

    // Should find: Custom Question 1, Custom Question 2, referral, unknown_q
    // Should NOT find: source
    expect(answers.length).toBe(4);

    expect(answers.find((a) => a.label === 'Custom Question 1')?.value).toBe(
      'Answer 1',
    );
    expect(answers.find((a) => a.label === 'Custom Question 2')?.value).toBe(
      true,
    );
    expect(answers.find((a) => a.label === 'referral')?.value).toBe(
      'User2 referred me',
    ); // fallback to key as label since not in org vettingQuestions
    expect(answers.find((a) => a.label === 'unknown_q')?.value).toBe(
      'Some other answer',
    );
    expect(answers.find((a) => a.label === 'source')).toBeUndefined();
  });

  it('should show no-vetting-answers indicator for application with empty answers', async () => {
    const emptyAnswersApp: Application = {
      _id: 'app-empty' as Id<'applications'>,
      _creationTime: 456,
      userId,
      status: 'revoked',
      answers: {},
      organizer: null,
    };

    convexClientMock.client.onUpdate.mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        onData: (apps: Application[]) => void,
      ) => {
        onData([emptyAnswersApp]);
        return () => void 0;
      },
    );

    fixture.componentRef.setInput('tableType', 'history');
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeEl = fixture.nativeElement as HTMLElement;
    const noAnswersElements = nativeEl.querySelectorAll(
      '[data-testid="no-vetting-answers"]',
    );
    expect(noAnswersElements.length).toBeGreaterThan(0);
  });

  it('should show no-vetting-answers indicator when answers contain only source key', async () => {
    const sourceOnlyApp: Application = {
      _id: 'app-source' as Id<'applications'>,
      _creationTime: 789,
      userId,
      status: 'revoked',
      answers: {source: 'admin_grant'},
      organizer: null,
    };

    convexClientMock.client.onUpdate.mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        onData: (apps: Application[]) => void,
      ) => {
        onData([sourceOnlyApp]);
        return () => void 0;
      },
    );

    fixture.componentRef.setInput('tableType', 'history');
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeEl = fixture.nativeElement as HTMLElement;
    const noAnswersElements = nativeEl.querySelectorAll(
      '[data-testid="no-vetting-answers"]',
    );
    expect(noAnswersElements.length).toBeGreaterThan(0);
  });

  it('should not show no-vetting-answers indicator when answers are provided', async () => {
    // mockApps[0] has answers; verifies the fallback is NOT shown for normal applications
    fixture.componentRef.setInput('tableType', 'pending');
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeEl = fixture.nativeElement as HTMLElement;
    const noAnswersElements = nativeEl.querySelectorAll(
      '[data-testid="no-vetting-answers"]',
    );
    expect(noAnswersElements.length).toBe(0);
  });

  describe('search filtering', () => {
    const multiApps: Application[] = [
      {
        _id: 'app1' as Id<'applications'>,
        _creationTime: 100,
        userId: 'u1' as Id<'users'>,
        status: 'pending',
        answers: {},
        user: {
          _id: 'u1' as Id<'users'>,
          name: 'Alice Smith',
          email: 'alice@example.com',
        } as Application['user'],
        organizer: null,
      },
      {
        _id: 'app2' as Id<'applications'>,
        _creationTime: 200,
        userId: 'u2' as Id<'users'>,
        status: 'pending',
        answers: {},
        user: {
          _id: 'u2' as Id<'users'>,
          name: 'Bob Jones',
          email: 'bob@test.org',
        } as Application['user'],
        organizer: null,
      },
      {
        _id: 'app3' as Id<'applications'>,
        _creationTime: 300,
        userId: 'u3' as Id<'users'>,
        status: 'pending',
        answers: {},
        user: {
          _id: 'u3' as Id<'users'>,
          name: 'Charlie Brown',
          email: 'charlie@example.com',
        } as Application['user'],
        organizer: null,
      },
    ];

    beforeEach(async () => {
      // Push multi-app data through the existing subscription
      latestOnData?.(multiApps);
      await fixture.whenStable();
    });

    it('should render the search input', async () => {
      expect(await harness.hasSearchInput()).toBe(true);
    });

    it('should filter applications by name', async () => {
      expect(component.filteredApplications().length).toBe(3);

      component.searchQuery.set('Alice');
      await fixture.whenStable();

      expect(component.filteredApplications().length).toBe(1);
      expect(component.filteredApplications()[0].user?.name).toBe(
        'Alice Smith',
      );
    });

    it('should filter applications by email', async () => {
      component.searchQuery.set('bob@test');
      await fixture.whenStable();

      expect(component.filteredApplications().length).toBe(1);
      expect(component.filteredApplications()[0].user?.name).toBe('Bob Jones');
    });

    it('should show all applications when search is cleared', async () => {
      component.searchQuery.set('Alice');
      await fixture.whenStable();
      expect(component.filteredApplications().length).toBe(1);

      component.searchQuery.set('');
      await fixture.whenStable();
      expect(component.filteredApplications().length).toBe(3);
    });

    it('should filter case-insensitively', async () => {
      component.searchQuery.set('aLiCe');
      await fixture.whenStable();

      expect(component.filteredApplications().length).toBe(1);
      expect(component.filteredApplications()[0].user?.name).toBe(
        'Alice Smith',
      );
    });

    it('should show no-results empty state when search has no matches', async () => {
      component.searchQuery.set('nonexistent');
      await fixture.whenStable();

      expect(component.filteredApplications().length).toBe(0);
      const nativeEl = fixture.nativeElement as HTMLElement;
      const emptyText = nativeEl.textContent ?? '';
      expect(emptyText).toContain('NO RESULTS FOR');
      expect(emptyText).toContain('nonexistent');
    });
  });
});
