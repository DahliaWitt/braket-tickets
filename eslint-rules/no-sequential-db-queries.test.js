/**
 * Tests for the no-sequential-db-queries ESLint rule.
 *
 * Validates that the rule correctly flags N+1 query patterns
 * (sequential db operations inside loops) and allows batch patterns.
 */
const {RuleTester} = require('eslint');
const rule = require('./no-sequential-db-queries');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-sequential-db-queries', rule, {
  valid: [
    // ✅ Promise.all with .map() — correct batch pattern
    {
      code: `
        const docs = await Promise.all(ids.map(id => ctx.db.get('users', id)));
      `,
    },
    // ✅ batchGetDocuments utility — correct batch pattern
    {
      code: `
        const userMap = await batchGetDocuments(ctx, 'users', userIds);
      `,
    },
    // ✅ Single db.get outside a loop — not an N+1 issue
    {
      code: `
        const user = await ctx.db.get('users', userId);
      `,
    },
    // ✅ db.query outside a loop — not an N+1 issue
    {
      code: `
        const events = await ctx.db.query('events').withIndex('by_date').take(10);
      `,
    },
    // ✅ Promise.all with query inside .map — correct pattern
    {
      code: `
        const results = await Promise.all(
          eventIds.map(async (id) => {
            return ctx.db.get('events', id);
          })
        );
      `,
    },
    // ✅ runQuery outside of loop — fine
    {
      code: `
        const result = await ctx.runQuery(api.events.get, { id: eventId });
      `,
    },
  ],

  invalid: [
    // ❌ await ctx.db.get inside a for-of loop
    {
      code: `
        for (const id of ids) {
          const doc = await ctx.db.get('users', id);
        }
      `,
      errors: [{messageId: 'sequentialDbGet'}],
    },
    // ❌ await ctx.db.get inside a for loop
    {
      code: `
        for (let i = 0; i < ids.length; i++) {
          const doc = await ctx.db.get('users', ids[i]);
        }
      `,
      errors: [{messageId: 'sequentialDbGet'}],
    },
    // ❌ await ctx.db.get inside a while loop
    {
      code: `
        let i = 0;
        while (i < ids.length) {
          const doc = await ctx.db.get('users', ids[i]);
          i++;
        }
      `,
      errors: [{messageId: 'sequentialDbGet'}],
    },
    // ❌ await ctx.db.query inside a for-of loop
    {
      code: `
        for (const communityId of communityIds) {
          const events = await ctx.db.query('events')
            .withIndex('by_community', q => q.eq('communityId', communityId))
            .collect();
        }
      `,
      errors: [{messageId: 'sequentialDbQuery'}],
    },
    // ❌ await ctx.runQuery inside a for-of loop
    {
      code: `
        for (const id of eventIds) {
          const event = await ctx.runQuery(api.events.get, { id });
        }
      `,
      errors: [{messageId: 'sequentialRunQuery'}],
    },
    // ❌ await ctx.db.get inside a forEach callback
    {
      code: `
        ids.forEach(async (id) => {
          const doc = await ctx.db.get('users', id);
        });
      `,
      errors: [{messageId: 'sequentialDbGet'}],
    },
    // ❌ await ctx.db.get inside a for-in loop
    {
      code: `
        for (const key in idMap) {
          const doc = await ctx.db.get('users', idMap[key]);
        }
      `,
      errors: [{messageId: 'sequentialDbGet'}],
    },
  ],
});

console.log('✅ All no-sequential-db-queries tests passed');
