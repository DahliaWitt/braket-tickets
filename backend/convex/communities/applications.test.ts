import {createAutoDrainConvexTest} from '../setup.testing';
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {addMember, authz, authzUserId} from '../lib/authz';

// Reviews can enqueue notification emails through workpool; drain those
// callbacks between tests so edge-runtime teardown has no pending console RPC.
const convexTest = createAutoDrainConvexTest();
const {captureMock} = vi.hoisted(() => ({
  captureMock: vi.fn(),
}));

vi.mock('../lib/analytics', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/analytics')>(
      '../lib/analytics',
    );
  return {
    ...actual,
    captureBackendEvent: captureMock,
  };
});

beforeEach(() => {
  captureMock.mockReset();
});

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  name = 'Admin',
  email?: string,
): Promise<Id<'users'>> {
  return (await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email:
      email ??
      `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    isRootAdmin: true,
  })) as Id<'users'>;
}

async function assignCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'community_admin', {
      type: 'organizer',
      id: organizerId as string,
    });
    await addMember(ctx, userId, organizerId);
  });
}

function requiredTextQuestion(id: string) {
  return [
    {
      id,
      question: `Question ${id}`,
      type: 'text' as const,
      required: true,
    },
  ];
}

describe('applications.submit', () => {
  it('creates a pending application for authenticated user', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});

    const applicationId = await asUser.mutation(
      api.communities.applications.submit,
      {
        answers: {
          question1: 'Answer 1',
          question2: 'Answer 2',
        },
      },
    );

    expect(applicationId).toBeDefined();

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.userId).toBe(userId);
    expect(app?.status).toBe('pending');
    expect(app?.answers).toEqual({
      question1: 'Answer 1',
      question2: 'Answer 2',
    });
  });

  it('creates application with organizer ID', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-088o@test.com',
    })) as Id<'users'>;

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
        email: 'org@example.com',
        vettingQuestions: requiredTextQuestion('referral'),
      },
    )) as Id<'organizers'>;

    const asUser = t.withIdentity({subject: userId});

    const applicationId = await asUser.mutation(
      api.communities.applications.submit,
      {
        organizerId,
        answers: {referral: 'Friend'},
      },
    );

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.organizerId).toBe(organizerId);
    expect(captureMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: 'vetting_application_submitted',
        distinctId: userId,
        properties: expect.objectContaining({
          community_id: organizerId,
          application_id_hash: expect.stringMatching(/^[0-9a-f]{32}$/),
          actor_role: 'user',
        }),
      }),
    );
  });

  it('rejects organizer applications from users who are already members', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Existing Member',
      email: 'existing-member-application@example.com',
    })) as Id<'users'>;

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Existing Member Community',
      },
    )) as Id<'organizers'>;

    await t.run(async (ctx) => addMember(ctx, userId, organizerId));

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.communities.applications.submit, {
        organizerId,
        answers: {referral: 'Already inside'},
      }),
    ).rejects.toThrow('You are already a member of this community.');
  });

  it('does not spend submit rate limit on already-member rejections', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Existing Member Rate Limit',
      email: 'existing-member-rate-limit@example.com',
    })) as Id<'users'>;

    const memberOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Already Joined Community',
      },
    )) as Id<'organizers'>;
    const openOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Open Application Community',
        vettingQuestions: requiredTextQuestion('referral'),
      },
    )) as Id<'organizers'>;

    await t.run(async (ctx) => addMember(ctx, userId, memberOrganizerId));

    const asUser = t.withIdentity({subject: userId});
    for (let index = 0; index < 3; index += 1) {
      await expect(
        asUser.mutation(api.communities.applications.submit, {
          organizerId: memberOrganizerId,
          answers: {referral: `Already inside ${index}`},
        }),
      ).rejects.toThrow('You are already a member of this community.');
    }

    const applicationId = await asUser.mutation(
      api.communities.applications.submit,
      {
        organizerId: openOrganizerId,
        answers: {referral: 'Different community'},
      },
    );

    expect(applicationId).toBeDefined();
  });

  it('rejects duplicate pending applications', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-si3j@test.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});

    // First application should succeed
    await asUser.mutation(api.communities.applications.submit, {
      answers: {question1: 'First submission'},
    });

    // Second application should fail
    await expect(
      asUser.mutation(api.communities.applications.submit, {
        answers: {question1: 'Second submission'},
      }),
    ).rejects.toThrow(
      'You already have a pending application for this community.',
    );
  });

  it('allows pending applications for different communities', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-eqb8@test.com',
    })) as Id<'users'>;

    const organizer1Id = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community 1',
        vettingQuestions: requiredTextQuestion('question1'),
      },
    )) as Id<'organizers'>;

    const organizer2Id = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community 2',
        vettingQuestions: requiredTextQuestion('question1'),
      },
    )) as Id<'organizers'>;

    const asUser = t.withIdentity({subject: userId});

    // First application to community 1 should succeed
    await asUser.mutation(api.communities.applications.submit, {
      organizerId: organizer1Id,
      answers: {question1: 'Application for community 1'},
    });

    // Second application to community 2 should also succeed
    await asUser.mutation(api.communities.applications.submit, {
      organizerId: organizer2Id,
      answers: {question1: 'Application for community 2'},
    });

    // Third application to community 1 should fail (duplicate)
    await expect(
      asUser.mutation(api.communities.applications.submit, {
        organizerId: organizer1Id,
        answers: {question1: 'Another for community 1'},
      }),
    ).rejects.toThrow(
      'You already have a pending application for this community.',
    );
  });

  it('allows resubmission after rejection', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-fbpb@test.com',
    })) as Id<'users'>;

    // Create a rejected application
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'rejected',
      answers: {question1: 'Old answer'},
    });

    const asUser = t.withIdentity({subject: userId});

    // Should be able to submit new application
    const newAppId = await asUser.mutation(
      api.communities.applications.submit,
      {
        answers: {question1: 'New answer'},
      },
    );

    expect(newAppId).toBeDefined();
  });

  it('rejects unauthenticated users', async () => {
    const t = convexTest();

    await expect(
      t.mutation(api.communities.applications.submit, {
        answers: {question1: 'Answer'},
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('validates answer string length', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-y2vn@test.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});

    // Create a string longer than MAX_ANSWER_STRING_LENGTH (10000)
    const longAnswer = 'x'.repeat(10001);

    await expect(
      asUser.mutation(api.communities.applications.submit, {
        answers: {question1: longAnswer},
      }),
    ).rejects.toThrow('exceeds maximum length');
  });

  it('accepts array answers', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-0mog@test.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});

    const applicationId = await asUser.mutation(
      api.communities.applications.submit,
      {
        answers: {
          multiSelect: ['Option A', 'Option B', 'Option C'],
          boolean: true,
          numeric: 42,
        },
      },
    );

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.answers.multiSelect).toEqual([
      'Option A',
      'Option B',
      'Option C',
    ]);
    expect(app?.answers.boolean).toBe(true);
    expect(app?.answers.numeric).toBe(42);
  });

  it('validates organizer application answers against current vetting questions', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Schema Matched Applicant',
      email: 'schema-matched-applicant@test.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Typed Vetting Community',
        vettingQuestions: [
          {
            id: 'bio',
            question: 'Bio',
            type: 'long_text',
            required: true,
          },
          {
            id: 'role',
            question: 'Role',
            type: 'select',
            required: true,
            options: ['Artist', 'Fan'],
          },
          {
            id: 'interests',
            question: 'Interests',
            type: 'checkbox',
            required: true,
            options: ['Experimental', 'Ambient'],
          },
          {
            id: 'over21',
            question: 'Over 21?',
            type: 'boolean',
            required: true,
          },
        ],
      },
    )) as Id<'organizers'>;

    const asUser = t.withIdentity({subject: userId});
    const applicationId = await asUser.mutation(
      api.communities.applications.submit,
      {
        organizerId,
        answers: {
          bio: 'I help produce shows.',
          role: 'Artist',
          interests: ['Experimental'],
          over21: false,
          source: 'web',
        },
      },
    );

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.answers).toMatchObject({
      bio: 'I help produce shows.',
      role: 'Artist',
      interests: ['Experimental'],
      over21: false,
      source: 'web',
    });
  });

  it('rejects organizer applications when public vetting is unavailable', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Closed Community Applicant',
      email: 'closed-community-applicant@test.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Closed Vetting Community',
        status: 'draft',
      },
    )) as Id<'organizers'>;

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.mutation(api.communities.applications.submit, {
        organizerId,
        answers: {'seed-default': 'Please let me in'},
      }),
    ).rejects.toThrow('Community not found');
  });

  it('rejects organizer application answers with unknown keys', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Unknown Key Applicant',
      email: 'unknown-key-applicant@test.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Strict Answer Community',
        vettingQuestions: requiredTextQuestion('known'),
      },
    )) as Id<'organizers'>;

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.mutation(api.communities.applications.submit, {
        organizerId,
        answers: {known: 'ok', injected: 'nope'},
      }),
    ).rejects.toThrow(/Unknown answer field.*injected/);
  });

  it('rejects empty required multi-select answers', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Checkbox Applicant',
      email: 'checkbox-applicant@test.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Checkbox Community',
        vettingQuestions: [
          {
            id: 'interests',
            question: 'Interests',
            type: 'checkbox',
            required: true,
            options: ['Experimental', 'Ambient'],
          },
        ],
      },
    )) as Id<'organizers'>;

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.mutation(api.communities.applications.submit, {
        organizerId,
        answers: {interests: []},
      }),
    ).rejects.toThrow(/Answer.*interests.*required/);
  });
});

describe('applications.getMyApplication', () => {
  it('returns the most recent application', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-ra18@test.com',
    })) as Id<'users'>;

    // Create multiple applications (simulating resubmissions after rejection)
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'rejected',
      answers: {q: 'Old'},
    });

    // Insert newer application
    const latestAppId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId,
        status: 'pending',
        answers: {q: 'New'},
      },
    )) as Id<'applications'>;

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplication,
      {},
    );

    expect(result?._id).toBe(latestAppId);
    expect(result?.status).toBe('pending');
    expect(result?.answers.q).toBe('New');
  });

  it('returns null for unauthenticated user', async () => {
    const t = convexTest();

    const result = await t.query(
      api.communities.applications.getMyApplication,
      {},
    );
    expect(result).toBeNull();
  });

  it('returns null when user has no applications', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-e0s4@test.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplication,
      {},
    );

    expect(result).toBeNull();
  });
});

describe('applications.getMyApplicationForOrganizer', () => {
  it('returns the newest organizer-specific application even with deep history', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Organizer History User',
      email: 'organizer-history-user@example.com',
    })) as Id<'users'>;

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Organizer History Community',
      },
    )) as Id<'organizers'>;

    const otherOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Other History Community',
      },
    )) as Id<'organizers'>;

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk organizer-history insert exercises pagination in latest-application lookup without creating 100+ test mutations
    const latestOrganizerApplicationId = await t.run(async (ctx) => {
      for (let index = 0; index < 105; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- controlled test fixture for same-organizer history ordering
        await ctx.db.insert('applications', {
          userId,
          organizerId,
          status: 'rejected',
          answers: {version: index},
        });
      }

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- final insert establishes the newest organizer-specific row
      return await ctx.db.insert('applications', {
        userId,
        organizerId,
        status: 'approved',
        answers: {version: 105},
      });
    });

    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId: otherOrganizerId,
      status: 'pending',
      answers: {version: 999},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplicationForOrganizer,
      {
        organizerId,
      },
    );

    expect(result?._id).toBe(latestOrganizerApplicationId);
    expect(result?.organizerId).toBe(organizerId);
    expect(result?.status).toBe('approved');
    expect(result?.answers.version).toBe(105);
  });
});

describe('applications.review', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('approves application without changing auth email verification', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
        authEmailVerified: false,
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Review Community',
      },
    )) as Id<'organizers'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        organizerId,
        status: 'pending',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'approved',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('approved');
    expect(app?.processedBy).toBe(adminId);
    expect(captureMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: 'vetting_application_approved',
        distinctId: adminId,
        properties: expect.objectContaining({
          community_id: organizerId,
          reviewer_role: 'root_admin',
          application_id_hash: expect.stringMatching(/^[0-9a-f]{32}$/),
        }),
      }),
    );

    const user = await t.run(async (ctx) => ctx.db.get(applicantId));
    expect(user?.authEmailVerified).toBe(false);

    const auditLogs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('application.review');
    expect(auditLogs[0].applicationId).toBe(applicationId);
  });

  it('rejects application without clearing auth email verification history', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
        authEmailVerified: true,
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Review Community',
      },
    )) as Id<'organizers'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        organizerId,
        status: 'pending',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'rejected',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('rejected');
    expect(captureMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: 'vetting_application_rejected',
        distinctId: adminId,
        properties: expect.objectContaining({
          community_id: organizerId,
          reviewer_role: 'root_admin',
          application_id_hash: expect.stringMatching(/^[0-9a-f]{32}$/),
        }),
      }),
    );

    const user = await t.run(async (ctx) => ctx.db.get(applicantId));
    expect(user?.authEmailVerified).toBe(true);
  });

  it('rejects reviewing an application outside the pending state', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);
    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-gmwr@test.com',
      },
    )) as Id<'users'>;

    const approvedApplicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'approved',
        answers: {},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.communities.applications.review, {
        applicationId: approvedApplicationId,
        status: 'rejected',
      }),
    ).rejects.toThrow('Only pending applications can be reviewed');
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-0kq2@test.com',
    })) as Id<'users'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: userId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.communities.applications.review, {
        applicationId,
        status: 'approved',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects when application not found', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    // Create and delete an application to get a valid but non-existent ID
    const tempAppId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: adminId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- deleting record to simulate non-existent ID; no production delete mutation exists */
    await t.run(async (ctx) => ctx.db.delete(tempAppId));
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.communities.applications.review, {
        applicationId: tempAppId,
        status: 'approved',
      }),
    ).rejects.toThrow('Application not found');
  });

  it('requires authentication', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-3ot4@test.com',
    })) as Id<'users'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: userId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;

    await expect(
      t.mutation(api.communities.applications.review, {
        applicationId,
        status: 'approved',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  // Regression: community admins (non-root) go through organizer-scoped
  // authorization (via access.ts). The important path here is that the review
  // still succeeds with scoped permission checks and no root_admin role.
  it('allows a community admin (non-root) to approve an application in their community', async () => {
    const t = convexTest();

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
        email: 'org@example.com',
      },
    )) as Id<'organizers'>;

    const communityAdminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Community Admin',
        email: 'cadmin@example.com',
      },
    )) as Id<'users'>;
    await assignCommunityAdmin(t, communityAdminId, organizerId);

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
        authEmailVerified: false,
      },
    )) as Id<'users'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        organizerId,
        status: 'pending',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asCommunityAdmin = t.withIdentity({subject: communityAdminId});

    await asCommunityAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'approved',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('approved');
    expect(app?.organizerId).toBe(organizerId);
    expect(app?.processedBy).toBe(communityAdminId);

    const user = await t.run(async (ctx) => ctx.db.get(applicantId));
    expect(user?.authEmailVerified).toBe(false);

    // Audit log canary: insertAdminAuditLog also runs through RLS-wrapped ctx,
    // so a regression in the auth path would surface here too.
    const auditLogs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('application.review');
    expect(auditLogs[0].applicationId).toBe(applicationId);
  });
});

describe('applications.revoke', () => {
  it('revokes an approved application', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-oi8m@test.com',
        authEmailVerified: true,
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'approved',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.revoke, {
      applicationId,
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('revoked');
    expect(app?.processedBy).toBe(adminId);

    const user = await t.run(async (ctx) => ctx.db.get(applicantId));
    expect(user?.authEmailVerified).toBe(true);

    const auditLogs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('application.revoke');
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-h1y9@test.com',
    })) as Id<'users'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: userId,
        status: 'approved',
        answers: {},
      },
    )) as Id<'applications'>;

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.communities.applications.revoke, {applicationId}),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects when application not found', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const tempAppId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: adminId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- deleting record to simulate non-existent ID; no production delete mutation exists */
    await t.run(async (ctx) => ctx.db.delete(tempAppId));
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.communities.applications.revoke, {
        applicationId: tempAppId,
      }),
    ).rejects.toThrow('Application not found');
  });

  // Regression: same RLS bypass requirement as review — revoke still needs to
  // update the application and audit log through the RLS-wrapped mutation path.
  it('allows a community admin (non-root) to revoke an application in their community', async () => {
    const t = convexTest();

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
        email: 'org@example.com',
      },
    )) as Id<'organizers'>;

    const communityAdminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Community Admin',
        email: 'cadmin@example.com',
      },
    )) as Id<'users'>;
    await assignCommunityAdmin(t, communityAdminId, organizerId);

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-qlkt@test.com',
        authEmailVerified: true,
      },
    )) as Id<'users'>;

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        organizerId,
        status: 'approved',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asCommunityAdmin = t.withIdentity({subject: communityAdminId});

    await asCommunityAdmin.mutation(api.communities.applications.revoke, {
      applicationId,
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('revoked');
    expect(app?.organizerId).toBe(organizerId);
    expect(app?.processedBy).toBe(communityAdminId);

    const user = await t.run(async (ctx) => ctx.db.get(applicantId));
    expect(user?.authEmailVerified).toBe(true);

    // Audit log canary: insertAdminAuditLog also runs through RLS-wrapped ctx,
    // so a regression in the auth path would surface here too.
    const auditLogs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('application.revoke');
    expect(auditLogs[0].applicationId).toBe(applicationId);
  });

  it('rejects revoking an application outside the approved state', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);
    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-48sr@test.com',
      },
    )) as Id<'users'>;

    const pendingApplicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.communities.applications.revoke, {
        applicationId: pendingApplicationId,
      }),
    ).rejects.toThrow('Only approved applications can be revoked');
  });
});

describe('applications.list', () => {
  it('lists all applications for admin', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const user1Id = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User 1',
      email: 'user1@example.com',
    })) as Id<'users'>;

    const user2Id = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User 2',
      email: 'user2@example.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: user1Id,
      status: 'pending',
      answers: {q: 'A1'},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: user2Id,
      status: 'approved',
      answers: {q: 'A2'},
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.communities.applications.list, {});

    expect(results.length).toBe(2);
    // Should have user data joined
    expect(results.some((a) => a.user?.name === 'User 1')).toBe(true);
    expect(results.some((a) => a.user?.name === 'User 2')).toBe(true);
  });

  it('filters by status', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-m0ot@test.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'approved',
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'rejected',
      answers: {},
    });

    const asAdmin = t.withIdentity({subject: adminId});

    const pending = await asAdmin.query(api.communities.applications.list, {
      status: 'pending',
    });
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('pending');

    const approved = await asAdmin.query(api.communities.applications.list, {
      status: 'approved',
    });
    expect(approved.length).toBe(1);
    expect(approved[0].status).toBe('approved');
  });

  it('returns empty for non-admin', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-thpu@test.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      answers: {},
    });

    const asUser = t.withIdentity({subject: userId});
    const results = await asUser.query(api.communities.applications.list, {});

    expect(results).toEqual([]);
  });

  it('returns empty for unauthenticated user', async () => {
    const t = convexTest();

    const results = await t.query(api.communities.applications.list, {});
    expect(results).toEqual([]);
  });

  it('joins processor data when present', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-amjj@test.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'approved',
      answers: {},
      processedBy: adminId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.communities.applications.list, {});

    expect(results[0].processor?.name).toBe('Admin');
  });

  it('joins organizer data when present', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-whtw@test.com',
    })) as Id<'users'>;

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
        email: 'org@example.com',
      },
    )) as Id<'organizers'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      organizerId,
      status: 'pending',
      answers: {},
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.communities.applications.list, {});

    expect(results[0].organizer?.name).toBe('Test Org');
  });

  it('filters by organizerId for root admin', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-gdtb@test.com',
    })) as Id<'users'>;

    const org1Id = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org 1',
    })) as Id<'organizers'>;

    const org2Id = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org 2',
    })) as Id<'organizers'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org1Id,
      answers: {q: 'Org1 App'},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org2Id,
      answers: {q: 'Org2 App'},
    });

    const asAdmin = t.withIdentity({subject: adminId});

    const org1Results = await asAdmin.query(api.communities.applications.list, {
      organizerId: org1Id,
    });
    expect(org1Results.length).toBe(1);
    expect(org1Results[0].organizerId).toBe(org1Id);

    const org2Results = await asAdmin.query(api.communities.applications.list, {
      organizerId: org2Id,
    });
    expect(org2Results.length).toBe(1);
    expect(org2Results[0].organizerId).toBe(org2Id);
  });

  it('filters by organizerId and status for root admin', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-z4xx@test.com',
    })) as Id<'users'>;

    const orgId = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org',
    })) as Id<'organizers'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: orgId,
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'approved',
      organizerId: orgId,
      answers: {},
    });

    const asAdmin = t.withIdentity({subject: adminId});

    const pending = await asAdmin.query(api.communities.applications.list, {
      organizerId: orgId,
      status: 'pending',
    });
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('pending');

    const approved = await asAdmin.query(api.communities.applications.list, {
      organizerId: orgId,
      status: 'approved',
    });
    expect(approved.length).toBe(1);
    expect(approved[0].status).toBe('approved');
  });

  it('without organizerId returns all apps (backward compatible)', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-tu1c@test.com',
    })) as Id<'users'>;

    const org1Id = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org 1',
    })) as Id<'organizers'>;

    const org2Id = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org 2',
    })) as Id<'organizers'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org1Id,
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'approved',
      organizerId: org2Id,
      answers: {},
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.communities.applications.list, {});

    expect(results.length).toBe(2);
  });

  it('community admin: filters by organizerId they manage', async () => {
    const t = convexTest();

    const communityAdminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Community Admin',
        email: 'community-admin-thut@test.com',
      },
    )) as Id<'users'>;

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-j8dn@test.com',
    })) as Id<'users'>;

    const org1Id = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org 1',
    })) as Id<'organizers'>;

    const org2Id = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org 2',
    })) as Id<'organizers'>;

    // Make communityAdminId an admin of both orgs
    await assignCommunityAdmin(t, communityAdminId, org1Id);
    await assignCommunityAdmin(t, communityAdminId, org2Id);

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org1Id,
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org2Id,
      answers: {},
    });

    const asCommunityAdmin = t.withIdentity({subject: communityAdminId});

    const org1Results = await asCommunityAdmin.query(
      api.communities.applications.list,
      {
        organizerId: org1Id,
      },
    );
    expect(org1Results.length).toBe(1);
    expect(org1Results[0].organizerId).toBe(org1Id);
  });

  it('community admin: returns empty for organizerId they do not manage', async () => {
    const t = convexTest();

    const communityAdminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Community Admin',
        email: 'community-admin-by8f@test.com',
      },
    )) as Id<'users'>;

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user-jnvz@test.com',
    })) as Id<'users'>;

    const managedOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Managed Org',
      },
    )) as Id<'organizers'>;

    const otherOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Other Org',
      },
    )) as Id<'organizers'>;

    await assignCommunityAdmin(t, communityAdminId, managedOrgId);

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: otherOrgId,
      answers: {},
    });

    const asCommunityAdmin = t.withIdentity({subject: communityAdminId});

    const results = await asCommunityAdmin.query(
      api.communities.applications.list,
      {
        organizerId: otherOrgId,
      },
    );
    expect(results).toEqual([]);
  });
});

describe('applications — denyReason and reason fields', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('review: stores denyReason on application when rejecting', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'pending',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'rejected',
      denyReason: 'Not enough detail in answers.',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('rejected');
    expect(app?.denyReason).toBe('Not enough detail in answers.');
    // Backward-compatible mirror for existing reads.
    expect(app?.reason).toBe('Not enough detail in answers.');
  });

  it('review: accepts legacy reason argument and maps it to denyReason', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'pending',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'rejected',
      reason: 'Legacy reason from older client.',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('rejected');
    expect(app?.denyReason).toBe('Legacy reason from older client.');
    expect(app?.reason).toBe('Legacy reason from older client.');
  });

  it('review: denyReason is undefined when not provided', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'pending',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'rejected',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('rejected');
    expect(app?.denyReason).toBeUndefined();
    expect(app?.reason).toBeUndefined();
  });

  it('revoke: stores reason on application', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-vbvx@test.com',
        authEmailVerified: true,
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'approved',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.revoke, {
      applicationId,
      reason: 'Violated community guidelines.',
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('revoked');
    expect(app?.reason).toBe('Violated community guidelines.');
  });

  it('revoke: reason is undefined when not provided (backward compatibility)', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-h8lr@test.com',
        authEmailVerified: true,
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'approved',
        answers: {q: 'Answer'},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.revoke, {
      applicationId,
    });

    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.status).toBe('revoked');
    expect(app?.reason).toBeUndefined();
  });

  it('review: validates denyReason exceeding 500 characters throws ConvexError', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'a@example.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});
    const longReason = 'x'.repeat(501);

    await expect(
      asAdmin.mutation(api.communities.applications.review, {
        applicationId,
        status: 'rejected',
        denyReason: longReason,
      }),
    ).rejects.toThrow('exceeds maximum length');
  });

  it('revoke: validates reason exceeding 500 characters throws ConvexError', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-bc7h@test.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'approved',
        answers: {},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});
    const longReason = 'y'.repeat(501);

    await expect(
      asAdmin.mutation(api.communities.applications.revoke, {
        applicationId,
        reason: longReason,
      }),
    ).rejects.toThrow('exceeds maximum length');
  });

  it('review: denyReason is captured in audit log', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant@example.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'pending',
        answers: {},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.review, {
      applicationId,
      status: 'rejected',
      denyReason: 'Audit log test reason.',
    });

    const auditLogs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].reason).toBe('Audit log test reason.');
  });

  it('revoke: reason is captured in audit log', async () => {
    const t = convexTest();

    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-9zp9@test.com',
      },
    )) as Id<'users'>;

    const adminId = await createRootAdmin(t);

    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: applicantId,
        status: 'approved',
        answers: {},
      },
    )) as Id<'applications'>;

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.communities.applications.revoke, {
      applicationId,
      reason: 'Revoke audit log reason.',
    });

    const auditLogs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].reason).toBe('Revoke audit log reason.');
  });

  it('getMyApplication: returns denyReason field when set', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-chpx@test.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'rejected',
      answers: {q: 'Answer'},
      denyReason: 'Reason visible to applicant.',
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplication,
      {},
    );

    expect(result?.status).toBe('rejected');
    expect(result?.denyReason).toBe('Reason visible to applicant.');
  });

  it('getMyApplication: reason is undefined when not set', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-bmyo@test.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      answers: {q: 'Answer'},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplication,
      {},
    );

    expect(result?.reason).toBeUndefined();
  });

  it('list: returns denyReason field when set', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'user@example.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'rejected',
      answers: {},
      denyReason: 'List query reason test.',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.communities.applications.list, {});

    expect(results.length).toBe(1);
    expect(results[0].denyReason).toBe('List query reason test.');
  });
});

describe('applications.list security', () => {
  it('does not expose emailChangeToken in user or processor fields', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(
      t,
      'Root Admin',
      'root-admin@example.com',
    );

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly does not support emailChangeToken/emailChangeTokenExpiry; raw insert required to test PII exclusion from list response */
    const applicantId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        name: 'Applicant With Token',
        email: 'applicant-token@example.com',
        emailChangeToken: 'secret-applicant-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    const processorId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        name: 'Processor With Token',
        email: 'processor-token@example.com',
        emailChangeToken: 'secret-processor-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
      await authz.assignRole(ctx, authzUserId(userId), 'root_admin');
      return userId;
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    await t.mutation(api.testing.applications.seedApplication, {
      userId: applicantId,
      status: 'approved',
      answers: {question: 'answer'},
      processedBy: processorId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const apps = await asAdmin.query(api.communities.applications.list, {
      status: 'approved',
    });

    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      if (app.user) {
        expect(
          (app.user as Record<string, unknown>).emailChangeToken,
        ).toBeUndefined();
        expect(
          (app.user as Record<string, unknown>).emailChangeTokenExpiry,
        ).toBeUndefined();
      }
      if (app.processor) {
        expect(
          (app.processor as Record<string, unknown>).emailChangeToken,
        ).toBeUndefined();
        expect(
          (app.processor as Record<string, unknown>).emailChangeTokenExpiry,
        ).toBeUndefined();
      }
    }
  });
});

describe('applications.getMyApplications', () => {
  it('returns empty array for unauthenticated user', async () => {
    const t = convexTest();
    const result = await t.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toEqual([]);
  });

  it('returns empty array when user has no applications', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'New User',
      email: 'new@example.com',
    })) as Id<'users'>;
    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toEqual([]);
  });

  it('returns applications with organizer name enrichment', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Recoherence',
        vettingQuestions: requiredTextQuestion('referral'),
      },
    )) as Id<'organizers'>;
    const asUser = t.withIdentity({subject: userId});
    await asUser.mutation(api.communities.applications.submit, {
      organizerId,
      answers: {referral: 'Friend'},
    });

    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toHaveLength(1);
    expect(result[0].organizerName).toBe('Recoherence');
    expect(result[0].status).toBe('pending');
    expect(result[0].organizerId).toBe(organizerId);
  });

  it('returns multiple applications across communities', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    })) as Id<'users'>;
    const org1 = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Recoherence',
    })) as Id<'organizers'>;
    const org2 = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Vortex',
    })) as Id<'organizers'>;

    // Insert applications directly to avoid the duplicate-pending check
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'approved',
      organizerId: org1,
      answers: {referral: 'Friend'},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org2,
      answers: {referral: 'Scene'},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toHaveLength(2);

    const names = result.map((a) => a.organizerName);
    expect(names).toContain('Recoherence');
    expect(names).toContain('Vortex');

    const statuses = result.map((a) => a.status);
    expect(statuses).toContain('approved');
    expect(statuses).toContain('pending');
  });

  it('returns applications in descending order (most recent first)', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    })) as Id<'users'>;
    const org1 = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'First Community',
    })) as Id<'organizers'>;
    const org2 = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Second Community',
    })) as Id<'organizers'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'approved',
      organizerId: org1,
      answers: {},
    });
    // Small delay to ensure different _creationTime
    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      organizerId: org2,
      answers: {},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toHaveLength(2);
    // Most recent first (desc order)
    expect(result[0]._creationTime).toBeGreaterThanOrEqual(
      result[1]._creationTime,
    );
  });

  it('includes rejection reason when present', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    })) as Id<'users'>;
    const _organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Strict Community',
      },
    )) as Id<'organizers'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'rejected',
      answers: {},
      reason: 'Incomplete application',
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('rejected');
    expect(result[0].reason).toBe('Incomplete application');
  });

  it('handles platform-level applications (no organizerId)', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: userId,
      status: 'pending',
      answers: {referral: 'Web search'},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );
    expect(result).toHaveLength(1);
    expect(result[0].organizerId).toBeUndefined();
    expect(result[0].organizerName).toBe('Unknown Community');
  });

  it('BRA-398: newer pending application appears before older rejected (creationTime desc)', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Sort Test User',
      email: `sort-test-${Date.now()}@example.com`,
    })) as Id<'users'>;
    const org1 = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Sort Org A',
    })) as Id<'organizers'>;
    const org2 = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Sort Org B',
    })) as Id<'organizers'>;

    // Seed rejected first (older), then pending (newer)
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'rejected',
      organizerId: org1,
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'pending',
      organizerId: org2,
      answers: {},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.applications.getMyApplications,
      {},
    );

    expect(result).toHaveLength(2);
    // Pending was inserted last, so it has a higher _creationTime
    expect(result[0].status).toBe('pending');
    expect(result[1].status).toBe('rejected');
    expect(result[0]._creationTime).toBeGreaterThanOrEqual(
      result[1]._creationTime,
    );
  });
});

describe('applications.submit — vetting notifications', () => {
  async function setupNotificationData() {
    const t = convexTest();
    const adminUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Admin User',
        email: 'admin@notify-test.com',
      },
    )) as Id<'users'>;
    const digestAdminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Digest Admin',
        email: 'digest@notify-test.com',
      },
    )) as Id<'users'>;
    const orgId = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Notify Community',
      vettingQuestions: requiredTextQuestion('q1'),
    })) as Id<'organizers'>;
    // Grant both users community admin
    await assignCommunityAdmin(t, adminUserId, orgId);
    await assignCommunityAdmin(t, digestAdminId, orgId);
    // Set immediate mode for adminUserId
    await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
      userId: adminUserId,
      organizerId: orgId,
      mode: 'all',
      digestHour: 9,
    });
    // Set digest mode for digestAdminId (should NOT get immediate email)
    await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
      userId: digestAdminId,
      organizerId: orgId,
      mode: 'digest',
      digestHour: 9,
    });
    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'app@test.com',
      },
    )) as Id<'users'>;
    return {t, adminUserId, digestAdminId, orgId, applicantId};
  }

  it('sends immediate email to admin with mode=all on submit', async () => {
    const {t, orgId, applicantId} = await setupNotificationData();
    const asApplicant = t.withIdentity({subject: applicantId});

    await asApplicant.mutation(api.communities.applications.submit, {
      organizerId: orgId,
      answers: {q1: 'answer'},
    });

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    const notifyKeys = dedupKeys.filter((k) =>
      k.key.startsWith('vetting-notify-'),
    );
    expect(notifyKeys).toHaveLength(1);
  });

  it('sends immediate email to root admin with mode=all on submit', async () => {
    const {t, orgId, applicantId} = await setupNotificationData();
    const rootAdminId = await createRootAdmin(
      t,
      'Root Notification Admin',
      'root-notify@test.com',
    );
    await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
      userId: rootAdminId,
      organizerId: orgId,
      mode: 'all',
      digestHour: 9,
    });
    const asApplicant = t.withIdentity({subject: applicantId});

    const applicationId = await asApplicant.mutation(
      api.communities.applications.submit,
      {
        organizerId: orgId,
        answers: {q1: 'answer'},
      },
    );

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    const rootAdminKeys = dedupKeys.filter((k) =>
      k.key.includes(String(rootAdminId)),
    );
    expect(rootAdminKeys).toHaveLength(1);
    expect(rootAdminKeys[0].key).toBe(
      `vetting-notify-${applicationId}-${rootAdminId}`,
    );
  });

  it('does NOT send immediate email to admin with mode=digest', async () => {
    const {t, orgId, applicantId, digestAdminId} =
      await setupNotificationData();
    const asApplicant = t.withIdentity({subject: applicantId});

    await asApplicant.mutation(api.communities.applications.submit, {
      organizerId: orgId,
      answers: {q1: 'answer'},
    });

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    const digestAdminKeys = dedupKeys.filter((k) =>
      k.key.includes(String(digestAdminId)),
    );
    expect(digestAdminKeys).toHaveLength(0);
  });

  it('does NOT send notification for stale mode=all preference without manage access', async () => {
    const {t, orgId, applicantId} = await setupNotificationData();
    const staleUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Former Admin',
        email: 'former-admin@test.com',
      },
    )) as Id<'users'>;
    await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
      userId: staleUserId,
      organizerId: orgId,
      mode: 'all',
      digestHour: 9,
    });
    const asApplicant = t.withIdentity({subject: applicantId});

    await asApplicant.mutation(api.communities.applications.submit, {
      organizerId: orgId,
      answers: {q1: 'answer'},
    });

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    const staleUserKeys = dedupKeys.filter((k) =>
      k.key.includes(String(staleUserId)),
    );
    expect(staleUserKeys).toHaveLength(0);
  });

  it('does NOT send notification when organizerId is absent', async () => {
    const t = convexTest();
    const applicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Applicant',
        email: 'applicant-o69f@test.com',
      },
    )) as Id<'users'>;
    const asApplicant = t.withIdentity({subject: applicantId});

    await asApplicant.mutation(api.communities.applications.submit, {
      answers: {q1: 'answer'},
      // No organizerId
    });

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys).toHaveLength(0);
  });

  it('dedup key includes applicationId to prevent retry double-send', async () => {
    const {t, adminUserId, orgId, applicantId} = await setupNotificationData();
    const asApplicant = t.withIdentity({subject: applicantId});

    const applicationId = await asApplicant.mutation(
      api.communities.applications.submit,
      {
        organizerId: orgId,
        answers: {q1: 'answer'},
      },
    );

    const all = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    const notifyKeys = all.filter((k) => k.key.startsWith('vetting-notify-'));
    expect(notifyKeys).toHaveLength(1);
    // Key contains applicationId — guarantees per-submission uniqueness (prevents retry double-send)
    expect(notifyKeys[0].key).toContain(String(applicationId));
    expect(notifyKeys[0].key).toBe(
      `vetting-notify-${applicationId}-${adminUserId}`,
    );
  });
});
