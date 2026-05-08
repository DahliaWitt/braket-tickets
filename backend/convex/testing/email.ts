import {v} from 'convex/values';
import {collectAllQueryUnsafe} from '../lib/query_scan';
import {testingMutation, testingQuery} from './wrappers';

const testEmailValidator = v.object({
  _id: v.id('testEmails'),
  _creationTime: v.number(),
  to: v.string(),
  subject: v.string(),
  html: v.string(),
  text: v.optional(v.string()),
  headers: v.optional(v.record(v.string(), v.string())),
  attachments: v.optional(
    v.array(
      v.object({
        filename: v.string(),
        contentType: v.string(),
        cid: v.optional(v.string()),
        size: v.number(),
      }),
    ),
  ),
});

/**
 * Logs a sent email for E2E testing purposes.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const logSentEmail = testingMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.optional(v.string()),
    headers: v.optional(v.record(v.string(), v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          cid: v.optional(v.string()),
          size: v.number(),
        }),
      ),
    ),
  },
  returns: v.null(),
  handler: async ({db}, args) => {
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test infrastructure: email capture table */
    await db.insert('testEmails', {
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? {text: args.text} : {}),
      ...(args.headers ? {headers: args.headers} : {}),
      ...(args.attachments ? {attachments: args.attachments} : {}),
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    return null;
  },
});

/**
 * Gets sent emails for a recipient from the testEmails table.
 * Used by EmailHarness to retrieve captured messages during E2E tests.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const getSentEmails = testingQuery({
  args: {to: v.string()},
  returns: v.array(testEmailValidator),
  handler: async ({db}, {to}) => {
    return await collectAllQueryUnsafe(
      db
        .query('testEmails')
        .withIndex('by_to', (q) => q.eq('to', to))
        .order('desc'),
    );
  },
});
