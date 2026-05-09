import {describe, it, expect} from 'vitest';
import {createBraketImageLoader} from './braket-image-loader';

const CONVEX_URL = 'https://famous-bird-123.convex.cloud/api/storage/abc';

describe('createBraketImageLoader', () => {
  describe('on a Cloudflare-enabled zone (community.braket.gay)', () => {
    const loader = createBraketImageLoader('https://community.braket.gay');

    it('wraps absolute https URLs with /cdn-cgi/image/ prefix', () => {
      expect(loader({src: CONVEX_URL, width: 640, isPlaceholder: false})).toBe(
        `https://community.braket.gay/cdn-cgi/image/format=auto,onerror=redirect,width=640/${CONVEX_URL}`,
      );
    });

    it('omits width when not provided', () => {
      expect(loader({src: CONVEX_URL, isPlaceholder: false})).toBe(
        `https://community.braket.gay/cdn-cgi/image/format=auto,onerror=redirect/${CONVEX_URL}`,
      );
    });

    it('appends low quality for placeholder requests', () => {
      expect(loader({src: CONVEX_URL, width: 32, isPlaceholder: true})).toBe(
        `https://community.braket.gay/cdn-cgi/image/format=auto,onerror=redirect,width=32,quality=20/${CONVEX_URL}`,
      );
    });

    it('passes through data: URIs unchanged', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      expect(loader({src: dataUrl, width: 64, isPlaceholder: false})).toBe(
        dataUrl,
      );
    });

    it('passes through blob: URIs unchanged', () => {
      const blobUrl = 'blob:https://community.braket.gay/abc-def';
      expect(loader({src: blobUrl, width: 64, isPlaceholder: false})).toBe(
        blobUrl,
      );
    });

    it('passes through .svg sources unchanged (vector, no benefit)', () => {
      const svg = 'https://community.braket.gay/braket.svg';
      expect(loader({src: svg, width: 256, isPlaceholder: false})).toBe(svg);
    });

    it('passes through relative paths unchanged', () => {
      expect(loader({src: 'braket.svg', width: 64, isPlaceholder: false})).toBe(
        'braket.svg',
      );
    });
  });

  describe('on dev.community.braket.gay (also a Cloudflare zone)', () => {
    const loader = createBraketImageLoader('https://dev.community.braket.gay');

    it('still wraps URLs', () => {
      expect(loader({src: CONVEX_URL, width: 320, isPlaceholder: false})).toBe(
        `https://dev.community.braket.gay/cdn-cgi/image/format=auto,onerror=redirect,width=320/${CONVEX_URL}`,
      );
    });
  });

  describe('on the apex braket.gay (also a Cloudflare zone)', () => {
    const loader = createBraketImageLoader('https://braket.gay');

    it('wraps URLs on the apex domain', () => {
      expect(loader({src: CONVEX_URL, width: 320, isPlaceholder: false})).toBe(
        `https://braket.gay/cdn-cgi/image/format=auto,onerror=redirect,width=320/${CONVEX_URL}`,
      );
    });
  });

  describe('off a Cloudflare zone (localhost, pages.dev)', () => {
    it('passes through everything on localhost', () => {
      const loader = createBraketImageLoader('http://localhost:4200');
      expect(loader({src: CONVEX_URL, width: 640, isPlaceholder: false})).toBe(
        CONVEX_URL,
      );
    });

    it('passes through on raw pages.dev (no transforms enabled there)', () => {
      const loader = createBraketImageLoader(
        'https://develop.braket-tickets-frontend.pages.dev',
      );
      expect(loader({src: CONVEX_URL, width: 640, isPlaceholder: false})).toBe(
        CONVEX_URL,
      );
    });

    it('handles malformed origin gracefully', () => {
      const loader = createBraketImageLoader('not-a-url');
      expect(loader({src: CONVEX_URL, width: 640, isPlaceholder: false})).toBe(
        CONVEX_URL,
      );
    });
  });
});
