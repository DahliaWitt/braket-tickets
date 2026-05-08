import {api} from '@convex/_generated/api';

// Single-domain destructuring — should become api.testing.events.
const {seedEvent, getEvent} = api.testing_functions;

export async function go(t: {mutation: (...args: unknown[]) => unknown; query: (...args: unknown[]) => unknown}) {
  await t.mutation(seedEvent, {title: 'x'});
  return t.query(getEvent, {id: 'id'});
}
