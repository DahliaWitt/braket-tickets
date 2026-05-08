import {describe, expect, it} from 'vitest';
import type {Id} from '../_generated/dataModel';
import {buildOrderTicketPdfArtifacts} from './actions';

describe('ticket PDF action helpers', () => {
  it('builds one PDF artifact per ticket in an order', async () => {
    const event = {
      title: 'Two Ticket Night',
      date: '2026-02-03T04:05:06.000Z',
    };
    const tickets = [
      {_id: 'ticket_one' as Id<'tickets'>, tier: 'regular' as const},
      {_id: 'ticket_two' as Id<'tickets'>, tier: 'supporter' as const},
    ];

    const artifacts = await buildOrderTicketPdfArtifacts({
      event,
      tickets,
      attendeeName: 'Multi Ticket Buyer',
      promoterName: 'Prism Society',
    });

    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.ticketId)).toEqual([
      'ticket_one',
      'ticket_two',
    ]);
    expect(artifacts.map((artifact) => artifact.pdfData.ticketId)).toEqual([
      'ticket_one',
      'ticket_two',
    ]);
    expect(artifacts.every((artifact) => artifact.qrCodeDataUrl)).toBe(true);
  });
});
