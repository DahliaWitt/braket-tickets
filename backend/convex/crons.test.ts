import {describe, expect, it} from 'vitest';
import crons from './crons';

describe('cron registration', () => {
  it('runs guest-list audit retention every day', () => {
    expect(crons.crons['cleanup old guest-list audit logs']).toMatchObject({
      name: 'guest_list/maintenance:cleanupAuditEvents',
      schedule: {hours: 24, type: 'interval'},
    });
  });
});
