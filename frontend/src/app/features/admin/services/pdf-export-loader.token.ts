import { InjectionToken } from '@angular/core';
import type { jsPDF as JsPdfCtor } from 'jspdf';
import type autoTable from 'jspdf-autotable';

export interface PdfExportDependencies {
  jsPDF: typeof JsPdfCtor;
  autoTable: typeof autoTable;
}

export type LoadPdfExportDependencies = () => Promise<PdfExportDependencies>;

export const LOAD_PDF_EXPORT_DEPENDENCIES = new InjectionToken<LoadPdfExportDependencies>(
  'LOAD_PDF_EXPORT_DEPENDENCIES',
  {
    providedIn: 'root',
    factory: () => async () => {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);

      return { jsPDF, autoTable };
    },
  },
);
