import {describe, expect, it} from 'vitest';
import schema from '../../schema';
import {internalUserValidator} from './validators';

/**
 * `getInternal` (users/profile.ts) returns raw `ctx.db.get('users', id)`
 * documents validated against `internalUserValidator`. Convex return
 * validation rejects unknown fields, so any schema field missing from the
 * validator makes every `getInternal` caller throw for users whose documents
 * carry that field. This broke prod checkout for community admins when
 * `defaultCommunityAdminOrganizerId` was added to the schema but not to the
 * validator. Keep the two in lockstep.
 */
describe('internalUserValidator schema parity', () => {
  it('covers every field of the users table schema', () => {
    const schemaFields = Object.keys(schema.tables.users.validator.fields);
    const validatorFields = Object.keys(internalUserValidator.fields).filter(
      (field) => !field.startsWith('_'),
    );
    expect(validatorFields.sort()).toEqual(schemaFields.sort());
  });
});
