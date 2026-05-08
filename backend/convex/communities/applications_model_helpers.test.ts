import {describe, expect, it} from 'vitest';
import {
  pickLatestApplicationByCreationTime,
  toApplicationListRow,
} from '../lib/applications/read_models';

describe('applications model helpers', () => {
  it('picks the latest application by creation time', () => {
    expect(
      pickLatestApplicationByCreationTime([
        {
          _id: 'app_1' as never,
          _creationTime: 10,
          userId: 'user_1' as never,
          status: 'pending',
          answers: {},
        },
        {
          _id: 'app_2' as never,
          _creationTime: 25,
          userId: 'user_1' as never,
          status: 'approved',
          answers: {},
        },
      ])?._id,
    ).toBe('app_2');
  });

  it('builds admin list rows with safe user and organizer summaries', () => {
    const row = toApplicationListRow(
      {
        _id: 'app_1' as never,
        _creationTime: 10,
        organizerId: 'org_1' as never,
        userId: 'user_1' as never,
        processedBy: 'admin_1' as never,
        status: 'approved',
        reason: 'Approved',
        answers: {bio: 'Hi'},
      },
      {
        user: {
          _id: 'user_1' as never,
          _creationTime: 1,
          email: 'user@example.com',
          name: 'Member',
          emailChangeToken: 'secret',
          emailChangeTokenExpiry: 123,
        },
        processor: {
          _id: 'admin_1' as never,
          _creationTime: 2,
          email: 'admin@example.com',
          name: 'Admin',
          emailChangeToken: 'secret',
          emailChangeTokenExpiry: 456,
        },
        organizer: {
          _id: 'org_1' as never,
          _creationTime: 3,
          name: 'Members Club',
          email: 'hello@club.test',
          contactInfo: 'Discord',
          isPublicDirectory: true,
          vettingQuestions: [
            {
              id: 'q1',
              question: 'Why join?',
              type: 'text',
              required: true,
            },
          ],
        },
      },
    );

    expect(row.user).toMatchObject({
      _id: 'user_1',
      email: 'user@example.com',
      name: 'Member',
    });
    expect(row.user).not.toHaveProperty('emailChangeToken');
    expect(row.processor).not.toHaveProperty('emailChangeTokenExpiry');
    expect(row.organizer).toMatchObject({
      _id: 'org_1',
      name: 'Members Club',
      email: 'hello@club.test',
      contactInfo: 'Discord',
    });
  });
});
