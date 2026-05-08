import {describe, expect, it} from 'vitest';
import type {Id} from '../_generated/dataModel';
import {
  buildTicketRosterProjection,
  normalizeRosterText,
  toRosterStatus,
} from './ticket_roster_projection';

describe('ticket_roster_projection', () => {
  it('builds a stable sort key and normalized attendee data', () => {
    const projection = buildTicketRosterProjection({
      ticketId: 'ticket-1' as Id<'tickets'>,
      status: 'valid',
      attendeeName: '  Alice Wonderland  ',
      email: 'Alice@Test.com',
      checkedInByName: 'Door Admin',
    });

    expect(projection).toMatchObject({
      rosterAttendeeName: 'Alice Wonderland',
      rosterAttendeeNameLower: 'alice wonderland',
      rosterEmail: 'Alice@Test.com',
      rosterEmailLower: 'alice@test.com',
      rosterCheckedInByName: 'Door Admin',
      rosterStatus: 'valid',
      rosterIsActive: true,
    });
    expect(projection.rosterSortKey).toBe('alice wonderland\u0000ticket-1');
  });

  it('maps a redeemed ticket to `checked_in` while keeping it in the active roster', () => {
    const projection = buildTicketRosterProjection({
      ticketId: 'ticket-2' as Id<'tickets'>,
      status: 'used',
      attendeeName: null,
      email: 'guest@example.com',
      checkedInByName: null,
    });

    expect(projection.rosterAttendeeName).toBe('guest@example.com');
    expect(projection.rosterStatus).toBe('checked_in');
    expect(projection.rosterIsActive).toBe(true);
  });

  it('maps each ticket status to its roster projection', () => {
    expect(toRosterStatus('valid')).toBe('valid');
    expect(toRosterStatus('used')).toBe('checked_in');
    expect(toRosterStatus('refunded')).toBe('refunded');
    expect(toRosterStatus('expired')).toBe('cancelled');
    expect(normalizeRosterText('  Mixed Case  ')).toBe('mixed case');
  });
});
