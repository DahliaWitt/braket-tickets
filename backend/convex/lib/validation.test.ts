import {describe, it, expect} from 'vitest';
import {getAppErrorMessage} from './errors';
import {
  stripHtmlTags,
  sanitizeName,
  validateStringLength,
  validateArrayField,
  validateApplicationAnswers,
  MAX_NAME_LENGTH,
  MAX_ANSWER_STRING_LENGTH,
  MAX_ANSWER_ARRAY_ITEMS,
  MAX_ANSWER_KEYS,
} from './validation';

function expectValidationMessage(fn: () => void, message: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(getAppErrorMessage(caught)).toContain(message);
}

describe('stripHtmlTags', () => {
  it('removes script tags', () => {
    expect(stripHtmlTags('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('removes nested HTML tags', () => {
    expect(stripHtmlTags('<b><i>bold italic</i></b>')).toBe('bold italic');
  });

  it('removes self-closing tags', () => {
    expect(stripHtmlTags('before<br/>after')).toBe('beforeafter');
  });

  it('removes tags with attributes', () => {
    expect(stripHtmlTags('<a href="http://evil.com">click</a>')).toBe('click');
  });

  it('trims whitespace', () => {
    expect(stripHtmlTags('  hello  ')).toBe('hello');
  });

  it('handles string with no HTML', () => {
    expect(stripHtmlTags('Alice Smith')).toBe('Alice Smith');
  });

  it('handles empty string', () => {
    expect(stripHtmlTags('')).toBe('');
  });

  it('removes img/onerror XSS vector', () => {
    expect(stripHtmlTags('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('preserves angle brackets in non-tag contexts', () => {
    expect(stripHtmlTags('5 > 3 and 2 < 4')).toBe('5 > 3 and 2 < 4');
  });
});

describe('sanitizeName', () => {
  it('returns undefined for undefined input', () => {
    expect(sanitizeName(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(sanitizeName('')).toBeUndefined();
  });

  it('returns undefined when only HTML tags (empty after strip)', () => {
    expect(sanitizeName('<script></script>')).toBeUndefined();
  });

  it('strips HTML and returns clean name', () => {
    expect(sanitizeName('<b>Alice</b>')).toBe('Alice');
  });

  it('strips XSS payload from name', () => {
    expect(sanitizeName('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('truncates to MAX_NAME_LENGTH', () => {
    const longName = 'A'.repeat(200);
    const result = sanitizeName(longName);
    expect(result).toHaveLength(MAX_NAME_LENGTH);
  });

  it('preserves normal names unchanged', () => {
    expect(sanitizeName('Alice Smith')).toBe('Alice Smith');
  });

  it('trims whitespace', () => {
    expect(sanitizeName('  Alice  ')).toBe('Alice');
  });

  it('handles unicode names', () => {
    expect(sanitizeName('田中太郎')).toBe('田中太郎');
  });

  it('returns undefined for whitespace-only input', () => {
    expect(sanitizeName('   ')).toBeUndefined();
  });
});

describe('validateStringLength', () => {
  it('accepts string at max length', () => {
    expect(() => {
      validateStringLength('x'.repeat(100), 'Name', 100);
    }).not.toThrow();
  });

  it('accepts string under max length', () => {
    expect(() => {
      validateStringLength('short', 'Name', 100);
    }).not.toThrow();
  });

  it('rejects string over max length', () => {
    expect(() => {
      validateStringLength('x'.repeat(101), 'Name', 100);
    }).toThrow('Name exceeds maximum length of 100 characters');
  });

  it('uses field name in error message', () => {
    expect(() => {
      validateStringLength('x'.repeat(51), 'Username', 50);
    }).toThrow('Username exceeds maximum length of 50 characters');
  });

  it('handles unicode characters correctly', () => {
    // Emoji are typically 2 characters in JavaScript
    const emoji = '🎉'.repeat(50); // 100 characters
    expect(() => {
      validateStringLength(emoji, 'Name', 100);
    }).not.toThrow();

    const tooManyEmoji = '🎉'.repeat(51); // 102 characters
    expect(() => {
      validateStringLength(tooManyEmoji, 'Name', 100);
    }).toThrow('exceeds maximum length');
  });
});

describe('validateArrayField', () => {
  it('accepts array within limits', () => {
    expect(() => {
      validateArrayField(['a', 'b', 'c'], 'Options', 10, 100);
    }).not.toThrow();
  });

  it('accepts array at max item count', () => {
    const items = Array(50).fill('item');
    expect(() => {
      validateArrayField(items, 'Options', 50, 100);
    }).not.toThrow();
  });

  it('rejects array exceeding max item count', () => {
    const items = Array(51).fill('item');
    expect(() => {
      validateArrayField(items, 'Options', 50, 100);
    }).toThrow('Options exceeds maximum of 50 items');
  });

  it('accepts items at max length', () => {
    expect(() => {
      validateArrayField(['x'.repeat(100)], 'Options', 10, 100);
    }).not.toThrow();
  });

  it('rejects items exceeding max length', () => {
    expect(() => {
      validateArrayField(['x'.repeat(101)], 'Options', 10, 100);
    }).toThrow('Options[0] exceeds maximum length of 100 characters');
  });

  it('identifies the correct index in error message', () => {
    expect(() => {
      validateArrayField(['ok', 'ok', 'x'.repeat(101)], 'Options', 10, 100);
    }).toThrow('Options[2] exceeds maximum length of 100 characters');
  });

  it('validates all items in array', () => {
    // All items should be validated, not just the first
    expect(() => {
      validateArrayField(
        ['ok', 'ok', 'ok', 'x'.repeat(101)],
        'Options',
        10,
        100,
      );
    }).toThrow('Options[3] exceeds maximum length of 100 characters');
  });
});

describe('validateApplicationAnswers', () => {
  it('accepts valid string answers', () => {
    expect(() => {
      validateApplicationAnswers({
        question1: 'Short answer',
        question2: 'Another answer',
      });
    }).not.toThrow();
  });

  it('accepts string answers at max length', () => {
    expect(() => {
      validateApplicationAnswers({
        question1: 'x'.repeat(MAX_ANSWER_STRING_LENGTH),
      });
    }).not.toThrow();
  });

  it('rejects string answers over max length', () => {
    expectValidationMessage(() => {
      validateApplicationAnswers({
        question1: 'x'.repeat(MAX_ANSWER_STRING_LENGTH + 1),
      });
    }, 'Answer "question1" exceeds maximum length');
  });

  it('accepts valid array answers', () => {
    expect(() => {
      validateApplicationAnswers({
        multiSelect: ['Option A', 'Option B'],
      });
    }).not.toThrow();
  });

  it('accepts array answers at max item count', () => {
    const items = Array(MAX_ANSWER_ARRAY_ITEMS).fill('item');
    expect(() => {
      validateApplicationAnswers({
        multiSelect: items,
      });
    }).not.toThrow();
  });

  it('rejects array answers over max item count', () => {
    const items = Array(MAX_ANSWER_ARRAY_ITEMS + 1).fill('item');
    expectValidationMessage(() => {
      validateApplicationAnswers({
        multiSelect: items,
      });
    }, `Answer "multiSelect" exceeds maximum of ${MAX_ANSWER_ARRAY_ITEMS} items`);
  });

  it('rejects array items over max length', () => {
    expectValidationMessage(() => {
      validateApplicationAnswers({
        multiSelect: ['x'.repeat(MAX_ANSWER_STRING_LENGTH + 1)],
      });
    }, 'Answer "multiSelect"[0] exceeds maximum length');
  });

  it('validates mixed answer types', () => {
    expect(() => {
      validateApplicationAnswers({
        name: 'John Doe',
        interests: ['Music', 'Art', 'Technology'],
        agreedToTerms: true,
        age: 30,
      });
    }).not.toThrow();
  });

  it('validates all answers and reports first error', () => {
    // When multiple answers are invalid, it should throw on the first one found
    // (order depends on Object.entries iteration, which is insertion order in modern JS)
    expectValidationMessage(() => {
      validateApplicationAnswers({
        valid: 'ok',
        invalid: 'x'.repeat(MAX_ANSWER_STRING_LENGTH + 1),
      });
    }, 'Answer "invalid" exceeds maximum length');
  });

  it('rejects too many answer keys', () => {
    const answers = Object.fromEntries(
      Array.from({length: MAX_ANSWER_KEYS + 1}, (_, index) => [
        `question${index}`,
        'answer',
      ]),
    );

    expectValidationMessage(
      () => validateApplicationAnswers(answers),
      `Too many answer fields: maximum is ${MAX_ANSWER_KEYS}`,
    );
  });
});

describe('Edge Cases and Security', () => {
  it('prevents DoS via extremely long strings', () => {
    // Even if someone tries to pass a huge string, validation should catch it quickly
    const hugeString = 'x'.repeat(1000000); // 1MB string
    expect(() => {
      validateStringLength(hugeString, 'Field', 10000);
    }).toThrow('exceeds maximum length');
  });

  it('prevents DoS via large arrays', () => {
    const hugeArray = Array(10000).fill('item');
    expect(() => {
      validateArrayField(hugeArray, 'Field', 50, 100);
    }).toThrow('exceeds maximum of 50 items');
  });

  it('handles null bytes in strings', () => {
    const stringWithNull = 'hello\x00world';
    expect(() => {
      validateStringLength(stringWithNull, 'Field', 100);
    }).not.toThrow();
  });

  it('handles newlines and whitespace', () => {
    const multilineString = 'line1\nline2\nline3\n';
    expect(() => {
      validateStringLength(multilineString, 'Field', 100);
    }).not.toThrow();
  });

  it('handles whitespace-only strings', () => {
    const whitespace = '   \t\n   ';
    expect(() => {
      validateStringLength(whitespace, 'Field', 100);
    }).not.toThrow();
  });

  it('counts characters not bytes', () => {
    // Japanese characters are 3 bytes in UTF-8 but 1 character in JS
    const japaneseText = 'こんにちは'; // 5 characters
    expect(() => {
      validateStringLength(japaneseText, 'Field', 5);
    }).not.toThrow();

    expect(() => {
      validateStringLength(japaneseText, 'Field', 4);
    }).toThrow('exceeds maximum length of 4 characters');
  });
});
