'use node';

import {v} from 'convex/values';
import {action} from '../_generated/server';
import {exportEventRosterCsvImpl} from './_impl/analytics_export';

export const exportEventRosterCsv = action({
  args: {
    eventId: v.id('events'),
    includeRefunded: v.boolean(),
  },
  returns: v.object({
    csv: v.string(),
    filename: v.string(),
  }),
  handler: exportEventRosterCsvImpl,
});
