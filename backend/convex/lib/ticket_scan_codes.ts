import type {Doc} from '../_generated/dataModel';

const TICKET_SCAN_CODE_BYTE_LENGTH = 24;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function generateTicketScanCode(): string {
  const bytes = new Uint8Array(TICKET_SCAN_CODE_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `tkt_${bytesToHex(bytes)}`;
}

export function ticketQrPayload(
  ticket: Pick<Doc<'tickets'>, '_id' | 'qrCode'>,
): string {
  return `TICKET:${ticket.qrCode ?? ticket._id}`;
}
