import {describe, expect, it} from 'vitest';
import {parseImportText} from './import-parser';
import {buildPreview, extractValidValues} from './import-preview';
import {generateTemplateCsv} from './import-template';
import {
  ASSIGNMENT_STAFF_IMPORT_CONFIG,
  BUYER_IMPORT_CONFIG,
  GUEST_IMPORT_CONFIG,
} from './import-config';
import type {ImportFieldKey} from './import.types';

function parse(
  config: {acceptedFields: readonly ImportFieldKey[]},
  text: string,
) {
  const result = parseImportText(text, {
    acceptedFields: new Set(config.acceptedFields),
  });
  if (!result.ok) throw new Error(`parse failed: ${result.error.code}`);
  return result;
}

describe('buildPreview partitioning', () => {
  describe('staff assignment rows', () => {
    it('matches the backend transaction cap of 50 rows', () => {
      expect(ASSIGNMENT_STAFF_IMPORT_CONFIG.maxRows).toBe(50);
      expect(ASSIGNMENT_STAFF_IMPORT_CONFIG.copy.overCapMessage(50)).toContain(
        'more than 50 rows',
      );
    });

    it('requires an email address', () => {
      const parsed = parse(ASSIGNMENT_STAFF_IMPORT_CONFIG, 'Name\nzoe');
      const preview = buildPreview(
        parsed.rows,
        ASSIGNMENT_STAFF_IMPORT_CONFIG,
        {
          dedupMode: 'skip',
        },
      );

      expect(preview.rows[0].partition).toBe('invalid');
      expect(preview.rows[0].reasons).toContain('missing email');
    });

    it('parses an optional non-negative integer slot override', () => {
      const parsed = parse(
        ASSIGNMENT_STAFF_IMPORT_CONFIG,
        'Name,Email,Guest list slots\nzoe,zoe@example.test,4',
      );
      const preview = buildPreview(
        parsed.rows,
        ASSIGNMENT_STAFF_IMPORT_CONFIG,
        {
          dedupMode: 'skip',
        },
      );

      expect(preview.rows[0].partition).toBe('valid');
      expect(preview.rows[0].values.slotOverride).toBe(4);
    });

    it.each(['-1', '1.5', '101', 'lots', '0x10', '1e2'])(
      'rejects slot override %s',
      (slotOverride) => {
        const parsed = parse(
          ASSIGNMENT_STAFF_IMPORT_CONFIG,
          `Name,Email,Slots\nzoe,zoe@example.test,${slotOverride}`,
        );
        const preview = buildPreview(
          parsed.rows,
          ASSIGNMENT_STAFF_IMPORT_CONFIG,
          {
            dedupMode: 'skip',
          },
        );

        expect(preview.rows[0].partition).toBe('invalid');
        expect(preview.rows[0].reasons).toContain(
          'guest list slots must be a whole number between 0 and 100',
        );
      },
    );

    it('deduplicates by normalized email', () => {
      const parsed = parse(
        ASSIGNMENT_STAFF_IMPORT_CONFIG,
        'Name,Email\nzoe,STAFF@example.test\nsam,staff@example.test',
      );
      const preview = buildPreview(
        parsed.rows,
        ASSIGNMENT_STAFF_IMPORT_CONFIG,
        {
          dedupMode: 'skip',
        },
      );

      expect(preview.counts.valid).toBe(1);
      expect(preview.counts.duplicate).toBe(1);
    });
  });

  it('partitions valid, invalid, and duplicate rows', () => {
    const parsed = parse(
      GUEST_IMPORT_CONFIG,
      'Name,Email\nzoe,zoe@example.test\n,missing-name\nsam,not-an-email',
    );
    const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
      dedupMode: 'skip',
    });
    expect(preview.counts.valid).toBe(1);
    expect(preview.counts.invalid).toBe(2);
    expect(preview.counts.total).toBe(3);
  });

  it('reports the missing-name reason on the invalid row', () => {
    const parsed = parse(GUEST_IMPORT_CONFIG, 'Name,Email\n,zoe@example.test');
    const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
      dedupMode: 'skip',
    });
    expect(preview.rows[0].partition).toBe('invalid');
    expect(preview.rows[0].reasons).toContain('missing name');
  });

  it('flags an invalid email missing @ as a per-row reason', () => {
    const parsed = parse(
      GUEST_IMPORT_CONFIG,
      'Name,Email\nzoe,zoeexample.test',
    );
    const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
      dedupMode: 'skip',
    });
    expect(preview.rows[0].partition).toBe('invalid');
    expect(preview.rows[0].reasons).toContain('email is missing an @');
  });

  it('imports rows without email cleanly (email optional)', () => {
    const parsed = parse(GUEST_IMPORT_CONFIG, 'Name\nzoe\nsam');
    const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
      dedupMode: 'skip',
    });
    expect(preview.counts.valid).toBe(2);
    expect(preview.counts.invalid).toBe(0);
  });

  describe('guest type validation', () => {
    it('makes an invalid type value an invalid row with a reason', () => {
      const parsed = parse(GUEST_IMPORT_CONFIG, 'Name,Guest type\nzoe,VIP');
      const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.rows[0].partition).toBe('invalid');
      expect(
        preview.rows[0].reasons.some((r) =>
          r.includes('not a valid guest type'),
        ),
      ).toBe(true);
    });

    it('defaults a missing type to guest', () => {
      const parsed = parse(GUEST_IMPORT_CONFIG, 'Name\nzoe');
      const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.rows[0].partition).toBe('valid');
      expect(preview.rows[0].values.guestType).toBe('guest');
    });

    it('accepts a valid multi-word type (artist guest)', () => {
      const parsed = parse(
        GUEST_IMPORT_CONFIG,
        'Name,Guest type\nzoe,artist guest',
      );
      const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.rows[0].values.guestType).toBe('artist guest');
    });

    it('maps a bare "type" header to the guest type (not silently dropped)', () => {
      // The natural guest-CSV shape uses "type" (the single-add dialog's field
      // name). It must resolve to guestType, so staff/artist rows are not
      // silently defaulted to guest.
      const parsed = parse(GUEST_IMPORT_CONFIG, 'Name,Type\nzoe,staff');
      const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.rows[0].partition).toBe('valid');
      expect(preview.rows[0].values.guestType).toBe('staff');
    });

    it('an invalid row does not make a later valid row with the same key a duplicate', () => {
      // Row 1 shares the name+email dedup key but is invalid (bad type); it was
      // never submitted, so row 2 (same key, valid) must stay valid.
      const parsed = parse(
        GUEST_IMPORT_CONFIG,
        'Name,Email,Type\nzoe,zoe@example.test,VIP\nzoe,zoe@example.test,guest',
      );
      const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.rows[0].partition).toBe('invalid');
      expect(preview.rows[1].partition).toBe('valid');
    });
  });

  describe('duplicate reason copy', () => {
    it('guest duplicates read as name+email, not barcode', () => {
      const parsed = parse(
        GUEST_IMPORT_CONFIG,
        'Name,Email\nzoe,zoe@example.test\nzoe,zoe@example.test',
      );
      const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      const dup = preview.rows[1];
      expect(dup.partition).toBe('duplicate');
      expect(dup.reasons.join(' ')).toContain('name and email');
      expect(dup.reasons.join(' ')).not.toContain('barcode');
    });

    it('buyer duplicates read as barcode', () => {
      const parsed = parse(
        BUYER_IMPORT_CONFIG,
        'Billing name,Barcode\ndoe jane,ABC\ndoe jane,ABC',
      );
      const preview = buildPreview(parsed.rows, BUYER_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.rows[1].reasons.join(' ')).toContain('barcode');
    });
  });

  describe('buyer dedup by barcode', () => {
    const twoSameBarcode = 'Billing name,Barcode\ndoe jane,ABC\ndoe jane,ABC';

    it('skips within-batch barcode duplicates in skip mode', () => {
      const parsed = parse(BUYER_IMPORT_CONFIG, twoSameBarcode);
      const preview = buildPreview(parsed.rows, BUYER_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.counts.valid).toBe(1);
      expect(preview.counts.duplicate).toBe(1);
    });

    it('keeps within-batch barcode duplicates in include mode', () => {
      const parsed = parse(BUYER_IMPORT_CONFIG, twoSameBarcode);
      const preview = buildPreview(parsed.rows, BUYER_IMPORT_CONFIG, {
        dedupMode: 'include',
      });
      expect(preview.counts.valid).toBe(2);
      expect(preview.counts.duplicate).toBe(0);
    });

    it('skips barcodes matching a previous import in skip mode', () => {
      const parsed = parse(
        BUYER_IMPORT_CONFIG,
        'Billing name,Barcode\ndoe jane,ABC',
      );
      const preview = buildPreview(parsed.rows, BUYER_IMPORT_CONFIG, {
        dedupMode: 'skip',
        existingStrongKeys: new Set(['abc']),
      });
      expect(preview.counts.duplicate).toBe(1);
      expect(preview.counts.valid).toBe(0);
    });

    it('flags barcode-less name+email matches as possible duplicate but keeps valid', () => {
      const parsed = parse(
        BUYER_IMPORT_CONFIG,
        'Billing name,Email\ndoe jane,jane@example.test',
      );
      const preview = buildPreview(parsed.rows, BUYER_IMPORT_CONFIG, {
        dedupMode: 'skip',
        existingWeakKeys: new Set(['doe jane jane@example.test']),
      });
      expect(preview.rows[0].partition).toBe('valid');
      expect(
        preview.rows[0].reasons.some((r) => r.includes('possible duplicate')),
      ).toBe(true);
    });

    it('imports three rows sharing one order number as three valid entries', () => {
      const parsed = parse(
        BUYER_IMPORT_CONFIG,
        'Billing name,Email,Order number,Barcode\n' +
          'doe jane,jane@example.test,ORD-1,B1\n' +
          'doe jane,jane@example.test,ORD-1,B2\n' +
          'doe jane,jane@example.test,ORD-1,B3',
      );
      const preview = buildPreview(parsed.rows, BUYER_IMPORT_CONFIG, {
        dedupMode: 'skip',
      });
      expect(preview.counts.valid).toBe(3);
      expect(preview.counts.duplicate).toBe(0);
    });
  });

  it('extractValidValues returns only valid rows', () => {
    const parsed = parse(
      GUEST_IMPORT_CONFIG,
      'Name,Email\nzoe,zoe@example.test\n,bad',
    );
    const preview = buildPreview(parsed.rows, GUEST_IMPORT_CONFIG, {
      dedupMode: 'skip',
    });
    const values = extractValidValues(preview.rows);
    expect(values).toHaveLength(1);
    expect(values[0].name).toBe('zoe');
  });

  describe('over-cap rejection', () => {
    it('flags overCap when rows exceed the target maxRows', () => {
      const smallCapConfig = {...GUEST_IMPORT_CONFIG, maxRows: 2};
      const parsed = parse(GUEST_IMPORT_CONFIG, 'Name\nzoe\nsam\nlee');
      const preview = buildPreview(parsed.rows, smallCapConfig, {
        dedupMode: 'skip',
      });
      expect(preview.overCap).toBe(true);
      expect(preview.counts.total).toBe(3);
    });

    it('does not flag overCap at exactly the cap', () => {
      const smallCapConfig = {...GUEST_IMPORT_CONFIG, maxRows: 3};
      const parsed = parse(GUEST_IMPORT_CONFIG, 'Name\nzoe\nsam\nlee');
      const preview = buildPreview(parsed.rows, smallCapConfig, {
        dedupMode: 'skip',
      });
      expect(preview.overCap).toBe(false);
    });
  });
});

describe('template round-trip', () => {
  for (const config of [
    GUEST_IMPORT_CONFIG,
    BUYER_IMPORT_CONFIG,
    ASSIGNMENT_STAFF_IMPORT_CONFIG,
  ]) {
    it(`${config.target} template parses with every row valid and mapped`, () => {
      const csv = generateTemplateCsv(config);
      const result = parseImportText(csv, {
        acceptedFields: new Set(config.acceptedFields),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Every template column maps to a canonical field (none ignored).
      expect(result.columns.every((c) => c.mappedTo !== null)).toBe(true);
      expect(result.requiresManualMapping).toBe(false);

      const preview = buildPreview(result.rows, config, {dedupMode: 'include'});
      expect(preview.counts.total).toBeGreaterThan(0);
      expect(preview.counts.invalid).toBe(0);
      expect(preview.counts.valid).toBe(preview.counts.total);
    });
  }

  it('guest template maps a name column', () => {
    const csv = generateTemplateCsv(GUEST_IMPORT_CONFIG);
    const result = parseImportText(csv, {
      acceptedFields: new Set(GUEST_IMPORT_CONFIG.acceptedFields),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].cells.name).toBeTruthy();
  });
});
