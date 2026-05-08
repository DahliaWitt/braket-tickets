import {describe, expect, it} from 'vitest';
import type {Doc, Id} from '../../_generated/dataModel';
import {evaluateConsent} from './policy';
import {
  buildRecipientSet,
  type RecipientCandidate,
} from './recipient_set';

/**
 * These tests pin the dedup + upgrade semantics that the broadcast,
 * announcement, and reminder pipelines all depend on. Changing any of
 * these behaviors breaks a production fan-out path.
 */
describe('buildRecipientSet', () => {
  async function* from(
    candidates: RecipientCandidate[],
  ): AsyncIterable<RecipientCandidate> {
    for (const c of candidates) yield c;
  }

  const includeAll = async () => true;

  it('deduplicates by normalized email (case-insensitive, trim)', async () => {
    const {recipients, isComplete} = await buildRecipientSet({
      candidates: from([
        {kind: 'address', email: '  alice@example.com '},
        {kind: 'address', email: 'ALICE@EXAMPLE.COM'},
        {kind: 'address', email: 'alice@example.com'},
      ]),
      decide: includeAll,
    });

    expect(isComplete).toBe(true);
    expect(recipients).toEqual([{email: 'alice@example.com'}]);
  });

  it('drops candidates whose normalized email is empty or nullish', async () => {
    const {recipients} = await buildRecipientSet({
      candidates: from([
        {kind: 'address', email: null},
        {kind: 'address', email: undefined},
        {kind: 'address', email: '   '},
        {kind: 'user', userId: 'u1' as Id<'users'>, email: ''},
        {kind: 'address', email: 'keeper@example.com'},
      ]),
      decide: includeAll,
    });

    expect(recipients).toEqual([{email: 'keeper@example.com'}]);
  });

  it('upgrades an address-first entry when a later user candidate shares the email', async () => {
    const {recipients} = await buildRecipientSet({
      candidates: from([
        {kind: 'address', email: 'shared@example.com'},
        {kind: 'user', userId: 'u1' as Id<'users'>, email: 'shared@example.com'},
      ]),
      decide: includeAll,
    });

    expect(recipients).toEqual([
      {email: 'shared@example.com', userId: 'u1' as Id<'users'>},
    ]);
  });

  it('keeps the first user when a later user candidate shares the email', async () => {
    // Rare in practice — would require two distinct user rows sharing an
    // email, which the users table does not enforce against. Tiebreak is
    // FIRST user wins (mirrors the first-address-wins rule) so attribution
    // (userId + downstream vettedViaOrganizerIds) is deterministic regardless
    // of the scan order of the underlying tables.
    const {recipients} = await buildRecipientSet({
      candidates: from([
        {kind: 'user', userId: 'u1' as Id<'users'>, email: 'shared@example.com'},
        {kind: 'user', userId: 'u2' as Id<'users'>, email: 'shared@example.com'},
      ]),
      decide: includeAll,
    });

    expect(recipients).toEqual([
      {email: 'shared@example.com', userId: 'u1' as Id<'users'>},
    ]);
  });

  it('skips duplicate user candidates before invoking decide', async () => {
    let decideCount = 0;
    await buildRecipientSet({
      candidates: from([
        {kind: 'user', userId: 'u1' as Id<'users'>, email: 'a@example.com'},
        {kind: 'user', userId: 'u1' as Id<'users'>, email: 'a@example.com'},
        {kind: 'address', email: 'a@example.com'},
        {kind: 'address', email: 'b@example.com'},
      ]),
      decide: async () => {
        decideCount += 1;
        return true;
      },
    });

    // u1 runs decide once (second u1 skipped by seenUserIds).
    // address 'a' runs decide once (decide is per-candidate, even when the
    // email already has an upgraded user recipient in the dedup Map).
    // address 'b' runs decide once.
    expect(decideCount).toBe(3);
  });

  it('honors stopAfterRecipientCount by returning isComplete=false without draining', async () => {
    let yielded = 0;
    async function* wide(): AsyncIterable<RecipientCandidate> {
      for (let index = 0; index < 1000; index += 1) {
        yielded += 1;
        yield {kind: 'address', email: `guest-${index}@example.com`};
      }
    }

    const {recipients, isComplete} = await buildRecipientSet({
      candidates: wide(),
      decide: includeAll,
      stopAfterRecipientCount: 5,
    });

    expect(isComplete).toBe(false);
    expect(recipients).toHaveLength(5);
    expect(yielded).toBe(5);
  });

  it('excludes candidates whose decide function returns false', async () => {
    const {recipients} = await buildRecipientSet({
      candidates: from([
        {kind: 'address', email: 'yes@example.com'},
        {kind: 'address', email: 'no@example.com'},
      ]),
      decide: async (_, email) => email !== 'no@example.com',
    });

    expect(recipients).toEqual([{email: 'yes@example.com'}]);
  });

  // ── evaluateConsent integration ───────────────────────────────────────
  // buildRecipientSet is the fan-out joint for broadcasts, announcements,
  // and reminders. The consent policy lives in `evaluateConsent`, but it
  // only acts through the `decide` callback — these tests wire the real
  // `evaluateConsent` into `decide` so a regression in the policy surfaces
  // through the same contract every production path uses.
  describe('evaluateConsent wired through decide', () => {
    const OPT_IN_USER: Doc<'marketingEmailPreferences'> = {
      _id: 'pref-in' as Id<'marketingEmailPreferences'>,
      _creationTime: 0,
      userId: 'u-in' as Id<'users'>,
      organizerId: 'org-a' as Id<'organizers'>,
      optedIn: true,
      unsubToken: 'tok-in',
      updatedAt: 0,
    };
    const OPT_OUT_USER: Doc<'marketingEmailPreferences'> = {
      _id: 'pref-out' as Id<'marketingEmailPreferences'>,
      _creationTime: 0,
      userId: 'u-out' as Id<'users'>,
      organizerId: 'org-a' as Id<'organizers'>,
      optedIn: false,
      unsubToken: 'tok-out',
      updatedAt: 0,
    };

    it('marketing-opt-in: drops users without an explicit opted-in row', async () => {
      // preferenceByUser: u-in → optedIn, u-out → optedOut, u-none → absent
      const preferenceByUser = new Map<Id<'users'>, Doc<'marketingEmailPreferences'>>([
        [OPT_IN_USER.userId, OPT_IN_USER],
        [OPT_OUT_USER.userId, OPT_OUT_USER],
      ]);

      const {recipients} = await buildRecipientSet({
        candidates: from([
          {kind: 'user', userId: OPT_IN_USER.userId, email: 'in@example.com'},
          {kind: 'user', userId: OPT_OUT_USER.userId, email: 'out@example.com'},
          {kind: 'user', userId: 'u-none' as Id<'users'>, email: 'none@example.com'},
        ]),
        decide: async (candidate) => {
          if (candidate.kind !== 'user') return false;
          return evaluateConsent(
            {kind: 'marketing-opt-in'},
            {userPreference: preferenceByUser.get(candidate.userId) ?? null},
          );
        },
      });

      expect(recipients).toEqual([
        {email: 'in@example.com', userId: OPT_IN_USER.userId},
      ]);
    });

    it('marketing-opt-out: includes users with no preference row, drops globalMarketingOptOut', async () => {
      const preferenceByUser = new Map<Id<'users'>, Doc<'marketingEmailPreferences'>>([
        [OPT_OUT_USER.userId, OPT_OUT_USER],
      ]);
      const globalOptOutByUser = new Map<Id<'users'>, boolean>([
        ['u-global-out' as Id<'users'>, true],
      ]);

      const {recipients} = await buildRecipientSet({
        candidates: from([
          // No preference row, no global opt-out → included
          {kind: 'user', userId: 'u-plain' as Id<'users'>, email: 'plain@example.com'},
          // Has opted-out preference row → excluded
          {kind: 'user', userId: OPT_OUT_USER.userId, email: 'out@example.com'},
          // globalMarketingOptOut=true → excluded even with no row
          {kind: 'user', userId: 'u-global-out' as Id<'users'>, email: 'global@example.com'},
          // Has opted-in preference row → included
          {kind: 'user', userId: OPT_IN_USER.userId, email: 'in@example.com'},
        ]),
        decide: async (candidate) => {
          if (candidate.kind !== 'user') return false;
          return evaluateConsent(
            {kind: 'marketing-opt-out'},
            {
              globalOptOut: globalOptOutByUser.get(candidate.userId) === true,
              userPreference: preferenceByUser.get(candidate.userId) ?? null,
            },
          );
        },
      });

      expect(recipients.map((r) => r.email).sort()).toEqual(
        ['in@example.com', 'plain@example.com'].sort(),
      );
    });

    it('operational: includes every candidate regardless of preference state', async () => {
      const preferenceByUser = new Map<Id<'users'>, Doc<'marketingEmailPreferences'>>([
        [OPT_OUT_USER.userId, OPT_OUT_USER],
      ]);

      const {recipients} = await buildRecipientSet({
        candidates: from([
          {kind: 'user', userId: OPT_OUT_USER.userId, email: 'out@example.com'},
          {kind: 'address', email: 'guest@example.com'},
        ]),
        decide: async (candidate) => {
          const userPreference =
            candidate.kind === 'user'
              ? preferenceByUser.get(candidate.userId) ?? null
              : null;
          return evaluateConsent(
            {kind: 'operational'},
            {userPreference, globalOptOut: true},
          );
        },
      });

      expect(recipients.map((r) => r.email).sort()).toEqual(
        ['guest@example.com', 'out@example.com'].sort(),
      );
    });
  });
});
