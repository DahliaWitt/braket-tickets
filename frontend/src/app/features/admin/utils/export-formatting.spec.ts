import {describe, it, expect} from 'vitest';
import {escapeCsvValue} from './export-formatting';

describe('escapeCsvValue', () => {
  describe('formula-injection escaping', () => {
    // A malicious external buyer name must not execute in a spreadsheet app.
    it('prefixes a leading = with an apostrophe (=HYPERLINK case)', () => {
      expect(escapeCsvValue('=HYPERLINK("http://evil","click")')).toBe(
        '"\'=HYPERLINK(""http://evil"",""click"")"',
      );
    });

    it('prefixes a leading + with an apostrophe', () => {
      expect(escapeCsvValue('+1234567890')).toBe("'+1234567890");
    });

    it('prefixes a leading - with an apostrophe', () => {
      expect(escapeCsvValue('-2+3')).toBe("'-2+3");
    });

    it('prefixes a leading @ with an apostrophe', () => {
      expect(escapeCsvValue('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    });

    it('applies formula escaping to native names too, not just imported', () => {
      // A native buyer whose name starts with = is equally dangerous.
      expect(escapeCsvValue('=cmd')).toBe("'=cmd");
    });

    it('does not touch cells that do not start with a formula char', () => {
      expect(escapeCsvValue('zoe example')).toBe('zoe example');
      // A dash mid-string is fine — only a LEADING dash triggers escaping.
      expect(escapeCsvValue('a-b')).toBe('a-b');
    });

    it('wraps the apostrophe inside quotes when the cell also needs quoting', () => {
      // Leading =, and a comma → apostrophe lands inside the quoted cell.
      expect(escapeCsvValue('=1,2')).toBe('"\'=1,2"');
    });
  });

  describe('structural escaping (unchanged behavior)', () => {
    it('quotes cells containing a comma', () => {
      expect(escapeCsvValue('Bob, Jr')).toBe('"Bob, Jr"');
    });

    it('doubles internal quotes and wraps', () => {
      expect(escapeCsvValue('The "Builder"')).toBe('"The ""Builder"""');
    });

    it('quotes cells containing a newline', () => {
      expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    });

    it('passes plain cells through unchanged', () => {
      expect(escapeCsvValue('plain')).toBe('plain');
      expect(escapeCsvValue('')).toBe('');
    });
  });
});
