import { describe, it, expect } from 'vitest';
import { parseQRScanData } from './qr-parse';

describe('parseQRScanData', () => {
  describe('TICKET: prefix format', () => {
    it('extracts ticket ID from TICKET: prefix', () => {
      const result = parseQRScanData('TICKET:abc123');
      expect(result).toEqual({ ticketId: 'abc123', guestId: null });
    });

    it('trims whitespace after TICKET: prefix', () => {
      const result = parseQRScanData('TICKET: abc123 ');
      expect(result).toEqual({ ticketId: 'abc123', guestId: null });
    });
  });

  describe('GUEST: prefix format', () => {
    it('extracts guest ID from GUEST: prefix', () => {
      const result = parseQRScanData('GUEST:xyz789');
      expect(result).toEqual({ ticketId: null, guestId: 'xyz789' });
    });

    it('trims whitespace after GUEST: prefix', () => {
      const result = parseQRScanData('GUEST: xyz789 ');
      expect(result).toEqual({ ticketId: null, guestId: 'xyz789' });
    });
  });

  describe('URL format', () => {
    it('extracts last path segment as ticket ID', () => {
      const result = parseQRScanData('https://community.braket.gay/tickets/abc123');
      expect(result).toEqual({ ticketId: 'abc123', guestId: null });
    });

    it('strips query params from URL', () => {
      const result = parseQRScanData('https://example.com/tickets/abc123?ref=qr');
      expect(result).toEqual({ ticketId: 'abc123', guestId: null });
    });

    it('handles trailing slash by using last non-empty segment', () => {
      const result = parseQRScanData('https://example.com/tickets/abc123/');
      expect(result).toEqual({ ticketId: 'abc123', guestId: null });
    });
  });

  describe('raw ID format', () => {
    it('treats plain string as ticket ID', () => {
      const result = parseQRScanData('jh7abc123def456');
      expect(result).toEqual({ ticketId: 'jh7abc123def456', guestId: null });
    });

    it('trims whitespace from raw ID', () => {
      const result = parseQRScanData('  jh7abc123def456  ');
      expect(result).toEqual({ ticketId: 'jh7abc123def456', guestId: null });
    });
  });

  describe('case sensitivity', () => {
    it('treats lowercase ticket: prefix as raw ID (case-sensitive)', () => {
      const result = parseQRScanData('ticket:abc123');
      expect(result).toEqual({ ticketId: 'ticket:abc123', guestId: null });
    });

    it('treats lowercase guest: prefix as raw ID (case-sensitive)', () => {
      const result = parseQRScanData('guest:xyz789');
      expect(result).toEqual({ ticketId: 'guest:xyz789', guestId: null });
    });
  });

  describe('edge cases', () => {
    it('returns null for both when input is empty', () => {
      const result = parseQRScanData('');
      expect(result).toBeNull();
    });

    it('returns null for whitespace-only input', () => {
      const result = parseQRScanData('   ');
      expect(result).toBeNull();
    });

    it('returns null for slash-only URL-like input', () => {
      const result = parseQRScanData('////');
      expect(result).toBeNull();
    });
  });
});
