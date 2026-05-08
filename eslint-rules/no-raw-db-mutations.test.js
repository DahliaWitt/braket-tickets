/**
 * Tests for the no-raw-db-mutations ESLint rule.
 *
 * Validates that the rule correctly flags direct/destructured/aliased
 * ctx.db mutation calls and allows read operations.
 */
const {RuleTester} = require('eslint');
const plugin = require('./no-raw-db-mutations');

const rule = plugin.rules['no-raw-db-mutation'];

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-raw-db-mutations/no-raw-db-mutation', rule, {
  valid: [
    // ✅ Read operations are fine
    {
      code: `ctx.db.get("users", id);`,
    },
    {
      code: `ctx.db.query("users").collect();`,
    },
    // ✅ insert/patch/replace/delete on something that is not db
    {
      code: `something.insert();`,
    },
    {
      code: `array.delete(0);`,
    },
    // ✅ Calling insert on a non-db member expression
    {
      code: `service.insert("users", {});`,
    },
  ],

  invalid: [
    // ❌ Direct: ctx.db.insert
    {
      code: `ctx.db.insert("users", {});`,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'insert'}}],
    },
    // ❌ Direct: ctx.db.patch
    {
      code: `ctx.db.patch("users", id, {});`,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'patch'}}],
    },
    // ❌ Direct: ctx.db.replace
    {
      code: `ctx.db.replace("users", id, {});`,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'replace'}}],
    },
    // ❌ Direct: ctx.db.delete
    {
      code: `ctx.db.delete("users", id);`,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'delete'}}],
    },
    // ❌ Nested member: foo.db.patch
    {
      code: `foo.db.patch(id, { name: "Bob" });`,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'patch'}}],
    },
    // ❌ Destructured: const { db } = ctx; db.insert(...)
    {
      code: `
        const { db } = ctx;
        db.insert("users", {});
      `,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'insert'}}],
    },
    // ❌ Aliased: const d = ctx.db; d.insert(...)
    {
      code: `
        const d = ctx.db;
        d.insert("users", {});
      `,
      errors: [{messageId: 'noRawDbMutation', data: {method: 'insert'}}],
    },
  ],
});

console.log('✅ All no-raw-db-mutations tests passed');
