/**
 * @vitest-environment node
 */
import {describe, it, expect} from 'vitest';
import type {Doc, Id} from '../../_generated/dataModel';
import {buildVettingReminderRecipients} from './reminders';

function makeUser(
  id: string,
  overrides: Partial<Doc<'users'>> = {},
): Doc<'users'> {
  return {
    _id: id as Id<'users'>,
    _creationTime: Date.now(),
    email: `${id}@example.com`,
    ...overrides,
  } as Doc<'users'>;
}

function appliedSet(...userIds: string[]): ReadonlySet<Id<'users'>> {
  return new Set(userIds.map((id) => id as Id<'users'>));
}

// Tests for buildVettingReminderRecipients
// (defined in convex/lib/reminder_audience.ts, re-exported from this module)
describe('buildVettingReminderRecipients', () => {
  it('includes users with no application record and a valid email', () => {
    const users = [makeUser('u1'), makeUser('u2')];

    const result = buildVettingReminderRecipients(appliedSet(), users);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });

  it('excludes users who have a pending application', () => {
    const users = [makeUser('u1'), makeUser('u2')];

    const result = buildVettingReminderRecipients(appliedSet('u1'), users);
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u2');
  });

  it('excludes users who have an approved application', () => {
    const users = [makeUser('u1')];

    const result = buildVettingReminderRecipients(appliedSet('u1'), users);
    expect(result).toHaveLength(0);
  });

  it('excludes users who have a rejected application', () => {
    const users = [makeUser('u1')];

    const result = buildVettingReminderRecipients(appliedSet('u1'), users);
    expect(result).toHaveLength(0);
  });

  it('excludes users who have a revoked application', () => {
    const users = [makeUser('u1')];

    const result = buildVettingReminderRecipients(appliedSet('u1'), users);
    expect(result).toHaveLength(0);
  });

  it('excludes users without an email', () => {
    const users = [makeUser('u1', {email: undefined})];

    const result = buildVettingReminderRecipients(appliedSet(), users);
    expect(result).toHaveLength(0);
  });

  it('excludes users with whitespace-only email', () => {
    const users = [makeUser('u1', {email: '   '})];

    const result = buildVettingReminderRecipients(appliedSet(), users);
    expect(result).toHaveLength(0);
  });

  it('handles mix of eligible and ineligible users', () => {
    const users = [
      makeUser('eligible1'),
      makeUser('has_app'),
      makeUser('no_email', {email: undefined}),
      makeUser('eligible2'),
    ];

    const result = buildVettingReminderRecipients(
      appliedSet('has_app'),
      users,
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.userId)).toEqual(['eligible1', 'eligible2']);
  });

  it('returns empty array when all users have applications', () => {
    const users = [makeUser('u1'), makeUser('u2')];

    const result = buildVettingReminderRecipients(
      appliedSet('u1', 'u2'),
      users,
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no users exist', () => {
    const result = buildVettingReminderRecipients(appliedSet(), []);
    expect(result).toHaveLength(0);
  });

  it('deduplicates users sharing the same email (case-sensitive exact match)', () => {
    const users = [
      makeUser('u1', {email: 'shared@example.com'}),
      makeUser('u2', {email: 'shared@example.com'}),
    ];

    const result = buildVettingReminderRecipients(appliedSet(), users);
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
  });

  it('deduplicates users sharing the same email (case-insensitive)', () => {
    const users = [
      makeUser('u1', {email: 'User@Example.com'}),
      makeUser('u2', {email: 'user@example.com'}),
    ];

    const result = buildVettingReminderRecipients(appliedSet(), users);
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
  });

  it('keeps the first occurrence when deduplicating', () => {
    const users = [
      makeUser('first', {email: 'dup@example.com'}),
      makeUser('second', {email: 'DUP@EXAMPLE.COM'}),
      makeUser('third', {email: 'other@example.com'}),
    ];

    const result = buildVettingReminderRecipients(appliedSet(), users);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.userId)).toEqual(['first', 'third']);
  });
});
