import {describe, expect, it} from 'vitest';
import {parseImportText} from './import-parser';
import {BUYER_IMPORT_CONFIG, GUEST_IMPORT_CONFIG} from './import-config';
import type {ImportFieldKey} from './import.types';

function accepted(config: {
  acceptedFields: readonly ImportFieldKey[];
}): Set<ImportFieldKey> {
  return new Set(config.acceptedFields);
}

const buyerFields = accepted(BUYER_IMPORT_CONFIG);
const guestFields = accepted(GUEST_IMPORT_CONFIG);

describe('parseImportText', () => {
  it('strips a leading UTF-8 BOM before header matching', () => {
    const input = '﻿Name,Email\nzoe,zoe@example.test';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns[0].mappedTo).toBe('name');
    expect(result.columns[1].mappedTo).toBe('email');
    expect(result.rows[0].cells.name).toBe('zoe');
  });

  it('auto-detects tab-separated spreadsheet paste', () => {
    const input = 'Name\tEmail\nzoe\tzoe@example.test\nsam\tsam@example.test';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delimiter).toBe('tab');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].cells.name).toBe('sam');
  });

  it('auto-detects semicolon-separated input', () => {
    const input = 'Name;Email\nzoe;zoe@example.test';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delimiter).toBe('semicolon');
    expect(result.rows[0].cells.email).toBe('zoe@example.test');
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const input = 'Name,Notes\n"doe, jane","line one\nline two"\nsam,plain';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].cells.name).toBe('doe, jane');
    expect(result.rows[0].cells.notes).toBe('line one\nline two');
    expect(result.rows[1].cells.name).toBe('sam');
  });

  it('handles escaped double-quotes inside a quoted field', () => {
    const input = 'Name,Notes\nzoe,"she said ""hi"""';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].cells.notes).toBe('she said "hi"');
  });

  it('trims surrounding whitespace on every cell', () => {
    const input = 'Name , Email \n  zoe  ,  zoe@example.test  ';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns[0].mappedTo).toBe('name');
    expect(result.rows[0].cells.name).toBe('zoe');
    expect(result.rows[0].cells.email).toBe('zoe@example.test');
  });

  it('parses CRLF line endings', () => {
    const input =
      'Name,Email\r\nzoe,zoe@example.test\r\nsam,sam@example.test\r\n';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it('returns no-rows-found for empty input', () => {
    const result = parseImportText('   \n  ', {acceptedFields: guestFields});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no-rows-found');
  });

  it('returns no-rows-found for header-only input', () => {
    const result = parseImportText('Name,Email', {acceptedFields: guestFields});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no-rows-found');
  });

  it('routes duplicate header names to manual mapping', () => {
    const input = 'Name,Name,Email\nzoe,zee,zoe@example.test';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiresManualMapping).toBe(true);
    expect(result.columns[0].duplicate).toBe(true);
    expect(result.columns[1].duplicate).toBe(true);
  });

  it('routes to manual mapping when no name column is present', () => {
    const input = 'Email,Barcode\nzoe@example.test,ABC';
    const result = parseImportText(input, {acceptedFields: buyerFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiresManualMapping).toBe(true);
  });

  it('hard-errors no-name-column when a manual mapping still lacks name', () => {
    const input = 'Email,Barcode\nzoe@example.test,ABC';
    const result = parseImportText(input, {
      acceptedFields: buyerFields,
      manualMapping: new Map([
        [0, 'email'],
        [1, 'externalRef'],
      ]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no-name-column');
  });

  it('applies a manual mapping to resolve ambiguous columns', () => {
    const input = 'Name,Name,Email\nzoe,zee,zoe@example.test';
    const result = parseImportText(input, {
      acceptedFields: guestFields,
      manualMapping: new Map<number, ImportFieldKey | null>([
        [0, 'name'],
        [1, null],
        [2, 'email'],
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiresManualMapping).toBe(false);
    expect(result.rows[0].cells.name).toBe('zoe');
  });

  describe('RA header synonym mapping', () => {
    const raHeader =
      'Barcode,Billing name,Date purchased,Email,Order number,Ticket type';

    it('maps the full RA export header set', () => {
      const input = `${raHeader}\nABC123,doe jane,2026-07-06 12:28,jane@example.test,ORD-1,general`;
      const result = parseImportText(input, {acceptedFields: buyerFields});
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const mapped = result.columns.map((c) => c.mappedTo);
      expect(mapped).toEqual([
        'externalRef',
        'name',
        'purchaseDateRaw',
        'email',
        'orderRef',
        'ticketTypeLabel',
      ]);

      const row = result.rows[0];
      expect(row.cells.externalRef).toBe('ABC123');
      expect(row.cells.name).toBe('doe jane');
      expect(row.cells.purchaseDateRaw).toBe('2026-07-06 12:28');
      expect(row.cells.email).toBe('jane@example.test');
      expect(row.cells.orderRef).toBe('ORD-1');
      expect(row.cells.ticketTypeLabel).toBe('general');
    });

    it('recognizes but ignores an unknown quantity column', () => {
      const input = `Billing name,Email,Quantity\ndoe jane,jane@example.test,2`;
      const result = parseImportText(input, {acceptedFields: buyerFields});
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const quantityColumn = result.columns.find(
        (c) => c.label.toLowerCase() === 'quantity',
      );
      expect(quantityColumn?.mappedTo).toBeNull();
      // The row still imports as one entry — no quantity expansion.
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].cells.name).toBe('doe jane');
    });
  });

  it('numbers rows with the header as row 1 (first data row is 2)', () => {
    const input = 'Name\nzoe\nsam';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].sourceRowNumber).toBe(2);
    expect(result.rows[1].sourceRowNumber).toBe(3);
  });

  it('skips fully blank lines between data rows', () => {
    const input = 'Name\nzoe\n\n\nsam\n';
    const result = parseImportText(input, {acceptedFields: guestFields});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });
});
