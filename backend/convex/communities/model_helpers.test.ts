import {describe, expect, it} from 'vitest';
import {deleteOrganizerTrustLinks} from '../lib/communities/lifecycle';
import {mapCommunitiesWithLogoUrls} from '../lib/communities/read_models';
import {
  getRemovedVettingQuestionIds,
  stripRemovedAnswerKeys,
} from '../lib/communities/vetting';

describe('communities model helpers', () => {
  it('identifies removed vetting question ids from the pre-update snapshot', () => {
    expect(
      getRemovedVettingQuestionIds(
        [
          {id: 'q1', question: 'Why join?', type: 'text', required: true},
          {id: 'q2', question: 'Referral?', type: 'text', required: false},
        ],
        [
          {id: 'q1', question: 'Why join?', type: 'text', required: true},
          {id: 'q3', question: 'Anything else?', type: 'long_text', required: false},
        ],
      ),
    ).toEqual(['q2']);
  });

  it('strips only removed answer keys and preserves unchanged payloads', () => {
    expect(
      stripRemovedAnswerKeys(
        {q1: 'hello', q2: ['friend'], q3: true},
        new Set(['q2']),
      ),
    ).toEqual({q1: 'hello', q3: true});

    expect(
      stripRemovedAnswerKeys({q1: 'hello'}, new Set(['q2'])),
    ).toBeNull();
  });

  it('maps community logo urls with deduped storage lookups', async () => {
    const storageCalls: string[] = [];

    const communities = await mapCommunitiesWithLogoUrls(
      {
        storage: {
          getUrl: async (id) => {
            storageCalls.push(id);
            return `https://cdn.test/${id}`;
          },
        },
      },
      [
        {
          _id: 'org_1' as never,
          _creationTime: 1,
          name: 'Alpha',
          isPublicDirectory: true,
          logoStorageId: 'logo_shared' as never,
        },
        {
          _id: 'org_2' as never,
          _creationTime: 2,
          name: 'Beta',
          isPublicDirectory: true,
          logoStorageId: 'logo_shared' as never,
        },
        {
          _id: 'org_3' as never,
          _creationTime: 3,
          name: 'Gamma',
          isPublicDirectory: true,
        },
      ],
    );

    expect(storageCalls).toEqual(['logo_shared']);
    expect(communities.map((community) => community.logoUrl)).toEqual([
      'https://cdn.test/logo_shared',
      'https://cdn.test/logo_shared',
      undefined,
    ]);
  });

  it('dedupes self-referential trust links during organizer cleanup', async () => {
    const trustLinkCalls: Array<[string, string]> = [];
    const auditLogWrites: unknown[] = [];

    const deletedCount = await deleteOrganizerTrustLinks({
      ctx: {
        db: {
          query: () => ({
            withIndex: () => ({
              unique: async () => null,
            }),
          }),
        },
        runQuery: async (_ref: never, args: {objectId?: string; subjectId?: string}) => {
          if (args.subjectId !== undefined) {
            return [
              {
                _id: 'relation_out' as never,
                relation: 'trusts',
                objectType: 'organizer',
                objectId: 'org_1',
              },
            ];
          }

          if (args.objectId !== undefined) {
            return [
              {
                _id: 'relation_in' as never,
                relation: 'trusts',
                subjectType: 'organizer',
                subjectId: 'org_1',
              },
            ];
          }

          return [];
        },
        runMutation: async (_ref: never, args: {subjectId: string; objectId: string}) => {
          trustLinkCalls.push([args.subjectId, args.objectId]);
          return true;
        },
      } as never,
      db: {
        insert: async (_tableName: string, value: unknown) => {
          auditLogWrites.push(value);
          return 'audit_1' as never;
        },
      } as never,
      adminId: 'admin_1' as never,
      organizerId: 'org_1' as never,
    });

    expect(deletedCount).toBe(1);
    // Self-referential link is deduped: outgoing org_1→org_1 and incoming
    // org_1→org_1 collapse into a single Map entry, producing one removal call.
    expect(trustLinkCalls).toEqual([['org_1', 'org_1']]);
    expect(auditLogWrites).toHaveLength(1);
  });

  it('enqueues rebuilds for surviving trusting organizers during cleanup', async () => {
    const scheduledRebuilds: Array<{delayMs: number; organizerId: string}> = [];

    await deleteOrganizerTrustLinks({
      ctx: {
        db: {
          query: () => ({
            withIndex: () => ({
              unique: async () => null,
            }),
          }),
          insert: async () => 'rebuild_1' as never,
        },
        runQuery: async (_ref: never, args: {objectId?: string; subjectId?: string}) => {
          if (args.subjectId !== undefined) {
            return [];
          }

          if (args.objectId !== undefined) {
            return [
              {
                _id: 'relation_in' as never,
                relation: 'trusts',
                subjectType: 'organizer',
                subjectId: 'org_survivor',
              },
            ];
          }

          return [];
        },
        runMutation: async () => true,
        scheduler: {
          runAfter: async (delayMs: number, _ref: never, args: {organizerId: string}) => {
            scheduledRebuilds.push({delayMs, organizerId: args.organizerId});
            return 'job_1' as never;
          },
        },
      } as never,
      db: {
        insert: async () => 'audit_1' as never,
      } as never,
      adminId: 'admin_1' as never,
      organizerId: 'org_deleted' as never,
    });

    expect(scheduledRebuilds).toEqual([
      {delayMs: 0, organizerId: 'org_survivor'},
    ]);
  });
});
