import {describe, expect, it} from 'vitest';
import {ConvexError} from 'convex/values';
import {MAX_RICH_EMAIL_BODY_JSON_BYTES} from '@shared/constants';
import {validateRichBodyJson} from './rich_text_validator';

/** Asserts the thunk throws a ConvexError with INVALID_INPUT code. */
function expectInvalid(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ConvexError);
  const data = (thrown as {data: unknown}).data as {code?: string};
  expect(data.code).toBe('INVALID_INPUT');
}

const docWith = (content: unknown): string =>
  JSON.stringify({type: 'doc', content});

describe('validateRichBodyJson — happy path', () => {
  it('accepts a rich document with heading, marks, list, link, and image', () => {
    const raw = docWith([
      {
        type: 'heading',
        attrs: {level: 2},
        content: [{type: 'text', text: 'Hi'}],
      },
      {
        type: 'paragraph',
        content: [
          {type: 'text', text: 'bold', marks: [{type: 'bold'}]},
          {type: 'text', text: 'italic', marks: [{type: 'italic'}]},
          {
            type: 'text',
            text: 'link',
            marks: [{type: 'link', attrs: {href: 'https://example.com'}}],
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {type: 'paragraph', content: [{type: 'text', text: 'a'}]},
            ],
          },
        ],
      },
      {type: 'image', attrs: {storageId: 'kg2abcdef123456', alt: 'p'}},
    ]);

    const doc = validateRichBodyJson(raw);
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(4);
  });

  it('accepts heading levels 2 and 3', () => {
    expect(() =>
      validateRichBodyJson(
        docWith([{type: 'heading', attrs: {level: 3}, content: []}]),
      ),
    ).not.toThrow();
  });

  it('accepts mailto: links', () => {
    expect(() =>
      validateRichBodyJson(
        docWith([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'mail',
                marks: [{type: 'link', attrs: {href: 'mailto:a@b.com'}}],
              },
            ],
          },
        ]),
      ),
    ).not.toThrow();
  });
});

describe('validateRichBodyJson — attribute stripping', () => {
  it('drops unknown node attributes (onclick etc.)', () => {
    const doc = validateRichBodyJson(
      docWith([
        {
          type: 'paragraph',
          attrs: {onclick: 'alert(1)', style: 'x'},
          content: [{type: 'text', text: 'hi'}],
        },
      ]),
    );
    expect(doc.content?.[0].attrs).toBeUndefined();
  });

  it('keeps only storageId+alt on image, dropping src and injected handlers', () => {
    const doc = validateRichBodyJson(
      docWith([
        {
          type: 'image',
          attrs: {
            storageId: 'kg2abcdef123456',
            alt: 'p',
            // A client-supplied src must be dropped, not trusted.
            src: 'https://attacker.example/pixel.png',
            onerror: 'alert(1)',
            width: 999,
          },
        },
      ]),
    );
    expect(doc.content?.[0].attrs).toEqual({
      storageId: 'kg2abcdef123456',
      alt: 'p',
    });
  });

  it('keeps only href on a link mark', () => {
    const doc = validateRichBodyJson(
      docWith([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'l',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    onmouseover: 'alert(1)',
                    target: '_top',
                  },
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(doc.content?.[0].content?.[0].marks?.[0].attrs).toEqual({
      href: 'https://example.com',
    });
  });
});

describe('validateRichBodyJson — node/mark allowlist', () => {
  it('rejects an unknown node type', () => {
    expectInvalid(() =>
      validateRichBodyJson(
        docWith([{type: 'script', content: [{type: 'text', text: 'x'}]}]),
      ),
    );
  });

  it('rejects an unknown mark type', () => {
    expectInvalid(() =>
      validateRichBodyJson(
        docWith([
          {
            type: 'paragraph',
            content: [{type: 'text', text: 'x', marks: [{type: 'underline'}]}],
          },
        ]),
      ),
    );
  });

  it('rejects heading level 1', () => {
    expectInvalid(() =>
      validateRichBodyJson(
        docWith([{type: 'heading', attrs: {level: 1}, content: []}]),
      ),
    );
  });

  it('rejects heading level 4', () => {
    expectInvalid(() =>
      validateRichBodyJson(
        docWith([{type: 'heading', attrs: {level: 4}, content: []}]),
      ),
    );
  });

  it('rejects a heading with no level', () => {
    expectInvalid(() =>
      validateRichBodyJson(docWith([{type: 'heading', content: []}])),
    );
  });
});

describe('validateRichBodyJson — URL scheme allowlist', () => {
  const linkDoc = (href: string): string =>
    docWith([
      {
        type: 'paragraph',
        content: [
          {type: 'text', text: 'l', marks: [{type: 'link', attrs: {href}}]},
        ],
      },
    ]);

  it('rejects javascript: link href', () => {
    expectInvalid(() => validateRichBodyJson(linkDoc('javascript:alert(1)')));
  });

  it('rejects data: link href', () => {
    expectInvalid(() =>
      validateRichBodyJson(linkDoc('data:text/html,<script>')),
    );
  });

  it('rejects control-character-smuggled javascript scheme', () => {
    expectInvalid(() => validateRichBodyJson(linkDoc('java\tscript:alert(1)')));
  });

  it('rejects scheme-relative link href (//evil.com)', () => {
    expectInvalid(() => validateRichBodyJson(linkDoc('//evil.com')));
  });

  it('rejects relative link href (/path)', () => {
    expectInvalid(() => validateRichBodyJson(linkDoc('/path')));
  });
});

describe('validateRichBodyJson — image storageId requirement', () => {
  it('accepts an image node that carries a storageId', () => {
    const doc = validateRichBodyJson(
      docWith([
        {type: 'image', attrs: {storageId: 'kg2abcdef123456', alt: 'p'}},
      ]),
    );
    expect(doc.content?.[0].attrs).toEqual({
      storageId: 'kg2abcdef123456',
      alt: 'p',
    });
  });

  it('rejects an image with a src but no storageId (arbitrary remote host)', () => {
    expectInvalid(() =>
      validateRichBodyJson(
        docWith([
          {type: 'image', attrs: {src: 'https://attacker.example/pixel.png'}},
        ]),
      ),
    );
  });

  it('rejects an image with no attrs at all', () => {
    expectInvalid(() => validateRichBodyJson(docWith([{type: 'image'}])));
  });

  it('rejects an image whose storageId is not a string', () => {
    expectInvalid(() =>
      validateRichBodyJson(docWith([{type: 'image', attrs: {storageId: 123}}])),
    );
  });

  it('rejects an image whose storageId is empty/whitespace', () => {
    expectInvalid(() =>
      validateRichBodyJson(
        docWith([{type: 'image', attrs: {storageId: '   '}}]),
      ),
    );
  });
});

describe('validateRichBodyJson — size, JSON, structure, depth', () => {
  it('rejects a payload over the byte cap', () => {
    const big = 'a'.repeat(MAX_RICH_EMAIL_BODY_JSON_BYTES + 100);
    const raw = docWith([
      {type: 'paragraph', content: [{type: 'text', text: big}]},
    ]);
    expect(raw.length).toBeGreaterThan(MAX_RICH_EMAIL_BODY_JSON_BYTES);
    expectInvalid(() => validateRichBodyJson(raw));
  });

  it('rejects malformed JSON', () => {
    expectInvalid(() => validateRichBodyJson('{not valid json'));
  });

  it('rejects a non-doc top-level node', () => {
    expectInvalid(() =>
      validateRichBodyJson(JSON.stringify({type: 'paragraph', content: []})),
    );
  });

  it('rejects excessively nested lists', () => {
    let node: unknown = {
      type: 'paragraph',
      content: [{type: 'text', text: 'deep'}],
    };
    for (let i = 0; i < 120; i += 1) {
      node = {
        type: 'bulletList',
        content: [{type: 'listItem', content: [node]}],
      };
    }
    expectInvalid(() => validateRichBodyJson(docWith([node])));
  });
});
