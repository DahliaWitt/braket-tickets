import {describe, it, expect} from 'vitest';
import {type Id} from '@convex/_generated/dataModel';
import {
  DEFAULT_EXPORT_FIELDS,
  NATIVE_SOURCE_LABEL,
  prepareAttendeeExportData,
  type ExportField,
} from './attendee-export-data';
import {
  type EventManagementPurchase,
  type ImportedTicketHolder,
} from '../models/event-management.model';

const nativePurchase: EventManagementPurchase = {
  id: 'order1' as Id<'ticket_orders'>,
  userId: 'user1' as Id<'users'>,
  userName: 'Native Buyer',
  userEmail: 'native@example.com',
  quantity: 2,
  amount: 5000,
  tier: 'regular',
  status: 'completed',
  createdAt: new Date('2024-06-15T10:30:00').getTime(),
  tickets: [
    {id: 't1' as Id<'tickets'>, status: 'valid', tier: 'regular'},
    {id: 't2' as Id<'tickets'>, status: 'valid', tier: 'regular'},
  ],
};

const importedEntry: ImportedTicketHolder = {
  _id: 'imp1' as Id<'importedTicketHolders'>,
  _creationTime: 0,
  eventId: 'event1' as Id<'events'>,
  name: 'External Holder',
  email: 'external@example.com',
  externalRef: 'RA-0001',
  orderRef: 'ORD-9',
  ticketTypeLabel: 'general admission',
  purchaseDateRaw: '2026-07-06 12:28 ',
  sourceLabel: 'RA',
  batchKey: 'batch-1',
};

describe('prepareAttendeeExportData — imported entries', () => {
  it('appends imported entries after purchases and guests', () => {
    const rows = prepareAttendeeExportData(
      [nativePurchase],
      DEFAULT_EXPORT_FIELDS,
      [],
      false,
      [importedEntry],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]['userName']).toBe('Native Buyer');
    expect(rows[1]['userName']).toBe('External Holder');
  });

  it('emits BLANK (not zero) financial columns for imported rows', () => {
    const [, importedRow] = prepareAttendeeExportData(
      [nativePurchase],
      DEFAULT_EXPORT_FIELDS,
      [],
      false,
      [importedEntry],
    );

    // Financial columns must be empty strings, never '0' / '$0.00' — a zero
    // would read as a real free sale.
    expect(importedRow['tier']).toBe('');
    expect(importedRow['quantity']).toBe('');
    expect(importedRow['formattedAmount']).toBe('');
  });

  it('passes the raw purchase-date string through unformatted', () => {
    const [, importedRow] = prepareAttendeeExportData(
      [nativePurchase],
      DEFAULT_EXPORT_FIELDS,
      [],
      false,
      [importedEntry],
    );

    // Raw source string, including its trailing space — never re-parsed.
    expect(importedRow['formattedDate']).toBe('2026-07-06 12:28 ');
  });

  it('sets the source column to the entry sourceLabel for imported rows', () => {
    const [nativeRow, importedRow] = prepareAttendeeExportData(
      [nativePurchase],
      DEFAULT_EXPORT_FIELDS,
      [],
      false,
      [importedEntry],
    );

    expect(nativeRow['source']).toBe(NATIVE_SOURCE_LABEL);
    expect(importedRow['source']).toBe('RA');
  });

  it('leaves the status column blank for imported rows (no refund state)', () => {
    const statusField: ExportField[] = [
      {key: 'userName', label: 'Name', enabled: true},
    ];
    const [importedRow] = prepareAttendeeExportData([], statusField, [], true, [
      importedEntry,
    ]);

    expect(importedRow['status']).toBe('');
  });
});
