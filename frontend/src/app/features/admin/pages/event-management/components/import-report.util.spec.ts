import {describe, it, expect} from 'vitest';
import {ConvexError} from 'convex/values';
import {buildImportErrorReport, buildImportReport} from './import-report.util';

describe('buildImportReport', () => {
  it('maps counts and translates invalid → failed', () => {
    const report = buildImportReport({
      insertedCount: 2,
      skippedCount: 1,
      outcomes: [
        {rowIndex: 0, status: 'inserted'},
        {rowIndex: 1, status: 'skipped', reason: 'duplicate barcode'},
        {rowIndex: 2, status: 'invalid', reason: 'missing name'},
      ],
    });

    expect(report.inserted).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(1);
    // rowIndex is 0-based; surface renders 1-based source row numbers.
    expect(report.outcomes).toEqual([
      {sourceRowNumber: 1, status: 'inserted', reason: undefined},
      {sourceRowNumber: 2, status: 'skipped', reason: 'duplicate barcode'},
      {sourceRowNumber: 3, status: 'failed', reason: 'missing name'},
    ]);
  });

  it('reports zero failed when all rows inserted or skipped', () => {
    const report = buildImportReport({
      insertedCount: 1,
      skippedCount: 0,
      outcomes: [{rowIndex: 0, status: 'inserted'}],
    });
    expect(report.failed).toBe(0);
  });
});

describe('buildImportErrorReport', () => {
  it('surfaces a ConvexError string message', () => {
    const report = buildImportErrorReport(
      new ConvexError('that file is too big — split it up'),
      'fallback',
    );
    expect(report.errorMessage).toBe('that file is too big — split it up');
    expect(report.inserted).toBe(0);
    expect(report.skipped).toBe(0);
  });

  it('surfaces a ConvexError structured message field', () => {
    const report = buildImportErrorReport(
      new ConvexError({code: 'BATCH_TOO_LARGE', message: 'too many rows'}),
      'fallback',
    );
    expect(report.errorMessage).toBe('too many rows');
  });

  it('falls back for non-ConvexError failures', () => {
    const report = buildImportErrorReport(new Error('network'), 'try again');
    expect(report.errorMessage).toBe('try again');
  });
});
