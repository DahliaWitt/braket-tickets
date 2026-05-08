import {api} from '@convex/_generated/api';

export async function doUnknown(t: {mutation: (...args: unknown[]) => unknown}) {
  return t.mutation(api.testing_functions.seedSomethingWeDidNotAuthor, {});
}
