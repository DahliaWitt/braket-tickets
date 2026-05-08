import {api} from '@convex/_generated/api';

// Mixed-domain destructuring — seedEvent (events) + seedTicket (tickets).
// The codemod cannot safely rewrite this; it must report and leave unchanged.
const {seedEvent, seedTicket} = api.testing_functions;

export async function go(t: {mutation: (...args: unknown[]) => unknown}) {
  await t.mutation(seedEvent, {});
  await t.mutation(seedTicket, {});
}
