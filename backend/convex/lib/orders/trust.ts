import type {Doc, Id} from '../../_generated/dataModel';
import {throwOrderError} from './access';

export function assertOrderTrustMetadata(args: {
  trustSource: Doc<'ticket_orders'>['trustSource'];
  trustViaOrganizerId?: Id<'organizers'>;
}): void {
  if (args.trustSource === 'shared') {
    if (!args.trustViaOrganizerId) {
      throwOrderError(
        'INVALID_STATE',
        'Shared trust metadata requires trustViaOrganizerId',
      );
    }
    return;
  }

  if (args.trustViaOrganizerId !== undefined) {
    throwOrderError(
      'INVALID_STATE',
      'trustViaOrganizerId is only valid for shared trust',
    );
  }
}
