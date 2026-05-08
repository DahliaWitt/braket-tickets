import {internal} from '@convex/_generated/api';

export async function lookup(t: {query: (...args: unknown[]) => unknown}) {
  return t.query(internal.testing_functions._getByEmailInternal, {
    email: 'a@b.c',
  });
}
