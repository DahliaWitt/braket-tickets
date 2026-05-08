import type { jsPDF as JsPDF } from 'jspdf';

import { BRAND_PALETTE } from '@/utils/brand-palette';

export function getLastAutoTableFinalY(doc: JsPDF, fallbackY: number): number {
  const holder = doc as unknown as { lastAutoTable?: { finalY?: number } };
  const finalY = holder.lastAutoTable?.finalY;
  return typeof finalY === 'number' ? finalY : fallbackY;
}

export function addPdfPageNumbers(doc: JsPDF): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(BRAND_PALETTE.mutedForeground);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' },
    );
  }
}
