import {api} from '@convex/_generated/api';

export async function dynamicPick(
  t: {mutation: (...args: unknown[]) => unknown},
  name: 'seedEvent',
) {
  // Dynamic access — the codemod must report this and leave it unchanged.
  return t.mutation(api.testing_functions[name], {});
}
