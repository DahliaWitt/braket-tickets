import { InjectionToken } from '@angular/core';
import QrScanner from 'qr-scanner';

export type QrScannerCtor = typeof QrScanner;

export const QR_SCANNER_CTOR = new InjectionToken<QrScannerCtor>('QR_SCANNER_CTOR', {
  providedIn: 'root',
  factory: () => QrScanner,
});
