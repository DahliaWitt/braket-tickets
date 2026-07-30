'use node';

import {v} from 'convex/values';
import {internalAction} from '../_generated/server';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as tickets/actions.ts.
import {deliverPreviewEmail} from '../lib/email/smtp_delivery';
import {providerEmailDeliveryArgs} from '../lib/validators/email_delivery';

export const sendPreview = internalAction({
  args: providerEmailDeliveryArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await deliverPreviewEmail(ctx, args);
    return null;
  },
});
