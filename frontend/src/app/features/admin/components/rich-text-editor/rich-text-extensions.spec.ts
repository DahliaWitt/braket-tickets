import {describe, it, expect} from 'vitest';
import {
  RICH_TEXT_MARK_TYPES,
  RICH_TEXT_NODE_TYPES,
} from '@shared/email/rich-text-schema';
import {buildRichTextEmailExtensions} from './rich-text-extensions';

/**
 * Drift guard: the frontend editor's node/mark set MUST equal the shared
 * allowlist that the backend validator + renderer also consume. If the editor
 * schema and the render schema diverge, rich emails render incorrectly or get
 * rejected on send. This test fails closed on any mismatch.
 */
describe('buildRichTextEmailExtensions', () => {
  it('produces exactly the shared allowlist of node + mark names', () => {
    const names = new Set(
      buildRichTextEmailExtensions().map((extension) => extension.name),
    );
    const expected = new Set<string>([
      ...RICH_TEXT_NODE_TYPES,
      ...RICH_TEXT_MARK_TYPES,
    ]);

    expect(names).toEqual(expected);
  });

  it('restricts headings to the allowlisted levels (2, 3)', () => {
    const heading = buildRichTextEmailExtensions().find(
      (extension) => extension.name === 'heading',
    );
    expect(heading).toBeDefined();
    expect(heading?.options).toMatchObject({levels: [2, 3]});
  });

  it('disables base64 images so only durable URLs can be inserted', () => {
    const image = buildRichTextEmailExtensions().find(
      (extension) => extension.name === 'image',
    );
    expect(image).toBeDefined();
    expect(image?.options).toMatchObject({allowBase64: false});
  });

  it('restricts link protocols to http/https/mailto', () => {
    const link = buildRichTextEmailExtensions().find(
      (extension) => extension.name === 'link',
    );
    expect(link).toBeDefined();
    expect(link?.options).toMatchObject({
      protocols: ['http', 'https', 'mailto'],
      autolink: false,
      openOnClick: false,
    });
  });
});
