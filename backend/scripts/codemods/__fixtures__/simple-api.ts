import {api} from '@convex/_generated/api';

export async function setupEvent(t: {mutation: (...args: unknown[]) => unknown}) {
  return t.mutation(api.testing_functions.seedEvent, {title: 'x'});
}
