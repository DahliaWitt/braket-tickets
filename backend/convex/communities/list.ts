import {v} from 'convex/values';
import {query} from '../_generated/server';
import {communityViewerDocValidator} from '../lib/communities/validators';
import {listCommunities} from './_impl/list';

export const list = query({
  args: {},
  returns: v.array(communityViewerDocValidator),
  handler: async (ctx) => listCommunities(ctx),
});
