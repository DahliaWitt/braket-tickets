import {DOCUMENT} from '@angular/common';
import {inject} from '@angular/core';
import type {ImageLoader, ImageLoaderConfig} from '@angular/common';

const PLACEHOLDER_QUALITY = 20;
// Matches the apex `braket.gay` and any subdomain. Cloudflare Image
// Transformations only run on a zone we control; localhost, *.pages.dev,
// and tests fall through to the source URL.
const CLOUDFLARE_ZONE_PATTERN = /(^|\.)braket\.gay$/;

export function createBraketImageLoader(origin: string): ImageLoader {
  const isCloudflareZone = (() => {
    try {
      return CLOUDFLARE_ZONE_PATTERN.test(new URL(origin).hostname);
    } catch {
      return false;
    }
  })();

  return (config: ImageLoaderConfig): string => {
    const {src} = config;

    if (
      !isCloudflareZone ||
      src.startsWith('data:') ||
      src.startsWith('blob:') ||
      !src.startsWith('http') ||
      src.toLowerCase().endsWith('.svg')
    ) {
      return src;
    }

    // Param order is load-bearing: Cloudflare bills per unique
    // (source, params) string, so reordering invalidates every cached
    // transform. Keep this order: format, onerror, width, quality.
    const params = ['format=auto', 'onerror=redirect'];
    if (config.width) {
      params.push(`width=${config.width}`);
    }
    if (config.isPlaceholder) {
      params.push(`quality=${PLACEHOLDER_QUALITY}`);
    }

    return `${origin}/cdn-cgi/image/${params.join(',')}/${src}`;
  };
}

export function braketImageLoaderFactory(): ImageLoader {
  const doc = inject(DOCUMENT);
  const origin = doc.defaultView?.location.origin ?? '';
  return createBraketImageLoader(origin);
}
