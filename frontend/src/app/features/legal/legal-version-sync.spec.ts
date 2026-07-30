import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION} from '@shared/constants';

/**
 * Guards the bidirectional sync points between the legal version constants
 * (stamped as ToS assent evidence on guest orders, BRA-455) and the dates
 * displayed on the legal pages. The LINT.IfChange/ThenChange annotations only
 * flag drift in diff-based checks; this test asserts the values actually match.
 */

const legalPagesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'pages');

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

// Deliberately avoids Date/Intl: parsing an ISO date through `new Date()`
// yields UTC midnight, which formats as the previous day in US timezones.
function isoToDisplayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Not an ISO date: ${iso}`);
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (!monthName) throw new Error(`Invalid month in: ${iso}`);
  return `${monthName} ${Number(day)}, ${year}`;
}

function displayedDate(html: string, label: string): string {
  const match = new RegExp(`${label}:\\s*([A-Za-z]+ \\d{1,2}, \\d{4})`).exec(
    html,
  );
  if (!match) throw new Error(`No "${label}: <date>" line found`);
  return match[1];
}

describe('legal document version sync (BRA-455)', () => {
  it('terms-of-service.html "Last Updated" matches LEGAL_TERMS_VERSION', () => {
    const html = readFileSync(
      resolve(legalPagesDir, 'terms-of-service/terms-of-service.html'),
      'utf8',
    );
    expect(displayedDate(html, 'Last Updated')).toBe(
      isoToDisplayDate(LEGAL_TERMS_VERSION),
    );
  });

  it('privacy-policy.html "Effective Date" matches LEGAL_PRIVACY_VERSION', () => {
    const html = readFileSync(
      resolve(legalPagesDir, 'privacy-policy/privacy-policy.html'),
      'utf8',
    );
    expect(displayedDate(html, 'Effective Date')).toBe(
      isoToDisplayDate(LEGAL_PRIVACY_VERSION),
    );
  });
});
