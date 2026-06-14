import {describe, it, expect} from 'vitest';
import {createTicketPdf, formatTicketDateParts} from './ticket_template';
import type {TicketPdfData} from './ticket_template';

const baseTicketData: TicketPdfData = {
  eventTitle: 'Summer Rave 2026',
  promoterName: 'Prism Society',
  attendeeName: 'Jane Doe',
  eventDate: new Date('2026-08-15T20:00:00').getTime(),
  ticketId: 'ticket_abc123',
  qrCodeDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
};

describe('ticket_template', () => {
  it('formats PDF ticket dates in the event timezone', () => {
    expect(
      formatTicketDateParts(new Date('2026-02-27T07:30:00.000Z').getTime()),
    ).toEqual({
      weekday: 'THU',
      isoDate: '2026.02.26',
      time: '11:30 PM',
    });
  });

  it('createTicketPdf returns a non-empty PDF data URL', async () => {
    const url = await createTicketPdf(baseTicketData);
    expect(url.startsWith('data:application/pdf;base64,')).toBe(true);
    const base64 = url.split(',')[1];
    expect(base64).toBeDefined();
    expect(base64).not.toBe('');
  });
});
