/**
 * Tests for the no-v-any ESLint rule.
 *
 * Validates that the rule catches direct and nested Convex `v.any()` calls
 * while ignoring unrelated `.any()` calls and non-Convex locals named `v`.
 */
const {RuleTester} = require('eslint');
const plugin = require('./no-v-any');

const noVAnyRule = plugin.rules['no-v-any'];
const noRawConvexErrorRule = plugin.rules['no-raw-convex-error'];

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('braket-convex/no-v-any', noVAnyRule, {
  valid: [
    {
      code: `
        import {v} from 'convex/values';
        export const returnsString = {returns: v.string()};
      `,
    },
    {
      code: `
        import {v} from 'not-convex';
        export const arbitrary = {returns: v.any()};
      `,
    },
    {
      code: `
        const v = {any: () => null};
        export const arbitrary = {returns: v.any()};
      `,
    },
    {
      code: `
        import {v} from 'convex/values';
        const schema = v.object({name: v.string()});
      `,
    },
    {
      code: `
        import {ConvexError} from 'convex/values';
        const arbitrary = {returns: object.any()};
      `,
    },
    {
      code: `
        import {v} from 'convex/values';
        function acceptsValidator(v) {
          return v.any();
        }
        export const schema = {returns: v.string()};
      `,
    },
  ],

  invalid: [
    {
      code: `
        import {v} from 'convex/values';
        export const direct = {returns: v.any()};
      `,
      errors: [{messageId: 'noVAny'}],
    },
    {
      code: `
        import {v} from 'convex/values';
        export const nested = {
          returns: v.object({
            page: v.array(v.record(v.string(), v.any())),
          }),
        };
      `,
      errors: [{messageId: 'noVAny'}],
    },
    {
      code: `
        import {v as validator} from 'convex/values';
        export const aliased = {returns: validator.any()};
      `,
      errors: [{messageId: 'noVAny'}],
    },
    {
      code: `
        import * as values from 'convex/values';
        export const namespace = {returns: values.v.any()};
      `,
      errors: [{messageId: 'noVAny'}],
    },
    {
      code: `
        import * as values from 'convex/values';
        export const computedNamespace = {returns: values['v']['any']()};
      `,
      errors: [{messageId: 'noVAny'}],
    },
    {
      code: `
        import {v} from 'convex/values';
        export const argsAlsoMatter = {args: {payload: v.any()}};
      `,
      errors: [{messageId: 'noVAny'}],
    },
    {
      code: `
        import {v} from 'convex/values';
        export const twoCalls = {
          args: {payload: v.any()},
          returns: v.union(v.null(), v.any()),
        };
      `,
      errors: [{messageId: 'noVAny'}, {messageId: 'noVAny'}],
    },
  ],
});

console.log('All braket-convex/no-v-any tests passed');

ruleTester.run('braket-convex/no-raw-convex-error', noRawConvexErrorRule, {
  valid: [
    {
      code: `
          import {throwAppError} from './errors';
          export function fail() {
            throwAppError('INVALID_INPUT', 'Bad input');
          }
        `,
    },
    {
      filename: '/repo/backend/convex/lib/errors.ts',
      code: `
          import {ConvexError} from 'convex/values';
          export function throwAppError(data) {
            throw new ConvexError(data);
          }
        `,
    },
    {
      filename: '/repo/backend/convex/example.test.ts',
      code: `
          import {ConvexError} from 'convex/values';
          expect(new ConvexError('test')).toBeTruthy();
        `,
    },
    {
      code: `
          class ConvexError extends Error {}
          export const err = new ConvexError('local');
        `,
    },
    {
      code: `
          import {ConvexError} from 'not-convex';
          export const err = new ConvexError('external');
        `,
    },
  ],

  invalid: [
    {
      code: `
          import {ConvexError} from 'convex/values';
          export function fail() {
            throw new ConvexError('Event not found');
          }
        `,
      errors: [{messageId: 'noRawConvexError'}],
    },
    {
      code: `
          import {ConvexError as AppError} from 'convex/values';
          export const err = new AppError({code: 'BAD', message: 'Bad'});
        `,
      errors: [{messageId: 'noRawConvexError'}],
    },
    {
      code: `
          import * as values from 'convex/values';
          export const err = new values.ConvexError('Bad');
        `,
      errors: [{messageId: 'noRawConvexError'}],
    },
    {
      code: `
          import * as values from 'convex/values';
          export const err = new values['ConvexError']('Bad');
        `,
      errors: [{messageId: 'noRawConvexError'}],
    },
  ],
});

console.log('All braket-convex/no-raw-convex-error tests passed');
