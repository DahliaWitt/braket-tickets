const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const ACCEPTED_IMAGE_FILE_INPUT = ACCEPTED_IMAGE_MIME_TYPES.join(',');
export const ACCEPTED_IMAGE_FORMATS_LABEL = 'JPG, PNG, GIF, WEBP';

export function isAcceptedImageMimeType(mimeType: string): boolean {
  return ACCEPTED_IMAGE_MIME_TYPES.includes(
    mimeType as (typeof ACCEPTED_IMAGE_MIME_TYPES)[number],
  );
}

export function getAcceptedImageFormatsMessage(): string {
  return `Accepted formats: ${ACCEPTED_IMAGE_FORMATS_LABEL}.`;
}

export function getUnsupportedImageTypeMessage(): string {
  return `Unsupported file type. ${getAcceptedImageFormatsMessage()}`;
}
