import {describe, expect, it} from 'vitest';
import {
  isActiveTicketStatus,
  isExpiredTicketStatus,
  isRefundedTicketStatus,
  isUsedTicketStatus,
  isValidTicketStatus,
  isVisibleInMyTicketsStatus,
} from './ticketing';

describe('ticketing status predicates', () => {
  it('recognizes the active ticket states', () => {
    expect(isActiveTicketStatus('valid')).toBe(true);
    expect(isActiveTicketStatus('used')).toBe(true);
    expect(isActiveTicketStatus('refunded')).toBe(false);
    expect(isActiveTicketStatus('expired')).toBe(false);
  });

  it('recognizes the individual ticket states', () => {
    expect(isValidTicketStatus('valid')).toBe(true);
    expect(isUsedTicketStatus('used')).toBe(true);
    expect(isRefundedTicketStatus('refunded')).toBe(true);
    expect(isExpiredTicketStatus('expired')).toBe(true);
  });

  it('recognizes ticket states that remain visible to the owner', () => {
    expect(isVisibleInMyTicketsStatus('valid')).toBe(true);
    expect(isVisibleInMyTicketsStatus('used')).toBe(true);
    expect(isVisibleInMyTicketsStatus('refunded')).toBe(true);
    expect(isVisibleInMyTicketsStatus('expired')).toBe(false);
  });
});
