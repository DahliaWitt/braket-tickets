import {inject, Injectable} from '@angular/core';
import {
  type EventManagementPurchase,
  type Guest,
  type ImportedTicketHolder,
} from '../models/event-management.model';
import type {jsPDF as JsPDF} from 'jspdf';
import {BRAND_PALETTE} from '../../../utils/brand-palette';
import {LOAD_PDF_EXPORT_DEPENDENCIES} from './pdf-export-loader.token';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  prepareAttendeeExportData,
  type ExportConfig,
  type ExportField,
} from './attendee-export-data';
import {
  escapeCsvValue,
  generateDatedExportFilename,
} from '../utils/export-formatting';
import {addPdfPageNumbers, getLastAutoTableFinalY} from './pdf-export-document';
import {
  getPurchaseRefundAmountCents,
  getPurchaseRefundedTicketCount,
  hasPurchaseRefund,
} from './settlement-export-data';

export {
  DEFAULT_EXPORT_FIELDS,
  type ExportConfig,
  type ExportField,
  type ExportFieldKey,
} from './attendee-export-data';

// Types for dynamic imports - jsPDF loaded only when PDF export is triggered

export function hasAttendeeRefunds(
  purchases: EventManagementPurchase[],
): boolean {
  return purchases.some(hasPurchaseRefund);
}

/**
 * Service for exporting attendee lists in various formats.
 *
 * Supports two export formats:
 * - **CSV**: Comma-separated values compatible with Excel, Google Sheets, etc.
 * - **PDF**: Professionally formatted document with event branding and pagination.
 *
 * Key features:
 * - Configurable fields (users can choose which columns to include)
 * - Optional refund handling (refunded tickets on separate page in PDF, with status column in CSV)
 * - Guest inclusion (admin-added guests appear alongside purchased tickets)
 * - Automatic filename generation based on event title and date
 *
 * @example
 * ```typescript
 * // Basic export with default fields
 * this.attendeeExport.export(purchases, {
 *   fields: DEFAULT_EXPORT_FIELDS,
 *   format: 'csv',
 *   eventTitle: 'Summer Party 2026'
 * });
 *
 * // PDF export including refunds
 * this.attendeeExport.export(purchases, {
 *   fields: customFields,
 *   format: 'pdf',
 *   eventTitle: 'Summer Party 2026',
 *   eventDate: 'June 15, 2026',
 *   includeRefunded: true
 * }, guests);
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class AttendeeExportService {
  private readonly loadPdfExportDependencies = inject(
    LOAD_PDF_EXPORT_DEPENDENCIES,
  );
  private readonly browser = inject(BrowserPlatformService);

  /**
   * Exports the attendee list to the specified format.
   *
   * Triggers a browser download of the generated file. Active and refunded tickets
   * are handled separately based on the `includeRefunded` config option.
   *
   * PDF exports load jsPDF lazily (~500KB) to keep initial bundle smaller.
   *
   * @param purchases - Array of purchase records from the event management API.
   * @param config - Export configuration (format, fields, event info).
   * @param guests - Optional array of manually-added guests to include in the export.
   * @returns Promise that resolves when export is complete (PDF is async due to lazy loading).
   */
  async export(
    purchases: EventManagementPurchase[],
    config: ExportConfig,
    guests: Guest[] = [],
    importedEntries: ImportedTicketHolder[] = [],
  ): Promise<void> {
    const enabledFields = config.fields.filter((f) => f.enabled);
    const includeRefunded = config.includeRefunded ?? false;
    const {activePurchases, refundedPurchases} =
      this.splitPurchasesForExport(purchases);

    if (config.format === 'csv') {
      this.exportCsv(
        activePurchases,
        refundedPurchases,
        enabledFields,
        config,
        guests,
        includeRefunded,
        importedEntries,
      );
    } else {
      await this.exportPdf(
        activePurchases,
        refundedPurchases,
        enabledFields,
        config,
        guests,
        includeRefunded,
        importedEntries,
      );
    }
  }

  private splitPurchasesForExport(purchases: EventManagementPurchase[]): {
    activePurchases: EventManagementPurchase[];
    refundedPurchases: EventManagementPurchase[];
  } {
    const activePurchases: EventManagementPurchase[] = [];
    const refundedPurchases: EventManagementPurchase[] = [];

    for (const purchase of purchases) {
      if (!hasPurchaseRefund(purchase)) {
        if (purchase.status === 'completed') {
          activePurchases.push(purchase);
        }
        continue;
      }

      const refundedTicketCount = getPurchaseRefundedTicketCount(purchase);
      const refundedAmountCents = getPurchaseRefundAmountCents(purchase);

      refundedPurchases.push({
        ...purchase,
        quantity: refundedTicketCount || purchase.quantity,
        amount: refundedAmountCents,
        status: 'refunded',
      });

      if (purchase.status === 'refunded') {
        continue;
      }

      const activeTicketCount =
        refundedTicketCount > 0
          ? Math.max(purchase.quantity - refundedTicketCount, 0)
          : purchase.quantity;
      if (activeTicketCount <= 0) {
        continue;
      }

      activePurchases.push({
        ...purchase,
        quantity: activeTicketCount,
        amount: Math.max(purchase.amount - refundedAmountCents, 0),
        status: 'completed',
      });
    }

    return {activePurchases, refundedPurchases};
  }

  /**
   * Generates and downloads a CSV file of the attendee list.
   *
   * CSV format includes:
   * - Header row with column labels
   * - Optional "Status" column when refunds are included
   * - Proper escaping for values containing commas, quotes, or newlines
   *
   * @param activePurchases - Purchases with status 'completed'.
   * @param refundedPurchases - Purchases with status 'refunded'.
   * @param fields - Enabled fields to include as columns.
   * @param config - Export configuration for filename and options.
   * @param guests - Guest records to include.
   * @param includeRefunded - Whether to include refunded purchases with status column.
   */
  private exportCsv(
    activePurchases: EventManagementPurchase[],
    refundedPurchases: EventManagementPurchase[],
    fields: ExportField[],
    config: ExportConfig,
    guests: Guest[],
    includeRefunded: boolean,
    importedEntries: ImportedTicketHolder[],
  ): void {
    // Determine if we need a status column (only when including refunds)
    const includeStatus = includeRefunded && refundedPurchases.length > 0;

    // Prepare data - combine active and refunded if included
    const purchasesToExport = includeRefunded
      ? [...activePurchases, ...refundedPurchases]
      : activePurchases;
    const data = prepareAttendeeExportData(
      purchasesToExport,
      fields,
      guests,
      includeStatus,
      importedEntries,
    );

    // Build headers - add Status column if we have refunds
    const headers = fields.map((f) => f.label);
    if (includeStatus) {
      headers.push('Status');
    }

    // Build rows
    const rows = data.map((row) => {
      const rowValues = fields.map((f) => escapeCsvValue(row[f.key] ?? ''));
      if (includeStatus) {
        rowValues.push(escapeCsvValue(row['status'] ?? ''));
      }
      return rowValues;
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    this.browser.downloadBlob(
      blob,
      generateDatedExportFilename(config.eventTitle, 'attendees', 'csv'),
    );
  }

  /**
   * Generates and downloads a PDF document of the attendee list.
   *
   * PDF format features:
   * - Branded header with event title and date
   * - Professional table styling with alternating row colors
   * - Separate page for refunded tickets (when included) with warning styling
   * - Summary box showing total refunded ticket count
   * - Page numbers on all pages
   *
   * Uses jsPDF with jspdf-autotable plugin for table generation.
   * Libraries are loaded lazily (~500KB) to keep initial bundle smaller.
   *
   * @param activePurchases - Purchases with status 'completed'.
   * @param refundedPurchases - Purchases with status 'refunded'.
   * @param fields - Enabled fields to include as columns.
   * @param config - Export configuration for event info and options.
   * @param guests - Guest records to include in the active attendees table.
   * @param includeRefunded - Whether to add a second page for refunded tickets.
   */
  private async exportPdf(
    activePurchases: EventManagementPurchase[],
    refundedPurchases: EventManagementPurchase[],
    fields: ExportField[],
    config: ExportConfig,
    guests: Guest[],
    includeRefunded: boolean,
    importedEntries: ImportedTicketHolder[],
  ): Promise<void> {
    const {jsPDF, autoTable} = await this.loadPdfExportDependencies();

    const doc: JsPDF = new jsPDF();

    const headers = fields.map((f) => f.label);

    // --- PAGE 1: Active Attendees ---
    // Title
    doc.setFontSize(20);
    doc.setTextColor(BRAND_PALETTE.primary);
    doc.text(config.eventTitle, 14, 22);

    // Subtitle
    doc.setFontSize(10);
    doc.setTextColor(BRAND_PALETTE.mutedForeground);
    doc.text('Attendee List', 14, 30);

    if (config.eventDate) {
      doc.text(`Event Date: ${config.eventDate}`, 14, 36);
    }

    doc.text(
      `Generated: ${new Date().toLocaleDateString('en-US', {dateStyle: 'long'})}`,
      14,
      config.eventDate ? 42 : 36,
    );

    // Note about refunds if there are any
    const hasRefunds = refundedPurchases.length > 0;
    if (hasRefunds && includeRefunded) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.text(
        '* Refunded tickets shown on Page 2',
        14,
        config.eventDate ? 48 : 42,
      );
    }

    // Active attendees table — imported external entries join the active list.
    const activeData = prepareAttendeeExportData(
      activePurchases,
      fields,
      guests,
      false,
      importedEntries,
    );
    const activeBody = activeData.map((row) =>
      fields.map((f) => row[f.key] ?? ''),
    );

    const tableStartY = config.eventDate
      ? hasRefunds && includeRefunded
        ? 54
        : 50
      : hasRefunds && includeRefunded
        ? 48
        : 44;

    autoTable(doc, {
      head: [headers],
      body: activeBody,
      startY: tableStartY,
      theme: 'grid',
      headStyles: {
        fillColor: BRAND_PALETTE.primary,
        textColor: BRAND_PALETTE.white,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: {
        textColor: BRAND_PALETTE.tableBodyText,
        halign: 'left',
      },
      alternateRowStyles: {
        fillColor: BRAND_PALETTE.background,
      },
      styles: {
        fontSize: 9,
        cellPadding: 4,
        lineColor: BRAND_PALETTE.border,
        lineWidth: 0.1,
      },
      columnStyles: this.getColumnStyles(fields),
    });

    // --- PAGE 2: Refunded Attendees (if any and included) ---
    if (hasRefunds && includeRefunded) {
      doc.addPage();

      // Header with warning styling
      doc.setFontSize(20);
      doc.setTextColor(BRAND_PALETTE.destructive);
      doc.text('REFUNDED TICKETS', 14, 22);

      doc.setFontSize(10);
      doc.setTextColor(BRAND_PALETTE.mutedForeground);
      doc.text(`${config.eventTitle} - Refund Appendix`, 14, 30);

      // Explanation
      doc.setFontSize(9);
      doc.setTextColor(BRAND_PALETTE.foreground);
      doc.text(
        'The following tickets have been refunded and are no longer valid for entry.',
        14,
        42,
      );

      // Refunded attendees table
      const refundedData = prepareAttendeeExportData(
        refundedPurchases,
        fields,
        [],
        false,
      );
      const refundedBody = refundedData.map((row) =>
        fields.map((f) => row[f.key] ?? ''),
      );

      autoTable(doc, {
        head: [headers],
        body: refundedBody,
        startY: 50,
        theme: 'grid',
        headStyles: {
          fillColor: BRAND_PALETTE.destructive,
          textColor: BRAND_PALETTE.white,
          fontStyle: 'bold',
          halign: 'left',
        },
        bodyStyles: {
          textColor: BRAND_PALETTE.tableRefundedText,
          halign: 'left',
          fontStyle: 'italic',
        },
        alternateRowStyles: {
          fillColor: BRAND_PALETTE.destructiveTint,
        },
        styles: {
          fontSize: 9,
          cellPadding: 4,
          lineColor: BRAND_PALETTE.border,
          lineWidth: 0.1,
        },
        columnStyles: this.getColumnStyles(fields),
      });

      // Summary box
      const summaryY = getLastAutoTableFinalY(doc, 50) + 15;

      doc.setFillColor(BRAND_PALETTE.destructiveTint);
      doc.rect(120, summaryY, 76, 15, 'F');

      doc.setFontSize(10);
      doc.setTextColor(BRAND_PALETTE.destructive);
      doc.setFont('helvetica', 'bold');
      doc.text('Total Refunded:', 124, summaryY + 10);

      const totalRefundedTickets = refundedPurchases.reduce(
        (sum, p) => sum + p.quantity,
        0,
      );
      doc.text(
        `${totalRefundedTickets} ticket${totalRefundedTickets !== 1 ? 's' : ''}`,
        192,
        summaryY + 10,
        {
          align: 'right',
        },
      );
    }

    addPdfPageNumbers(doc);

    doc.save(
      generateDatedExportFilename(config.eventTitle, 'attendees', 'pdf'),
    );
  }

  /**
   * Generates column alignment styles for the PDF table.
   * - Numeric fields (quantity, amount) are right-aligned.
   * - Tier field is center-aligned.
   * - All other fields default to left-aligned.
   *
   * @param fields - The field configuration to generate styles for.
   * @returns Column style object keyed by column index.
   */
  private getColumnStyles(
    fields: ExportField[],
  ): Record<number, {halign?: 'left' | 'center' | 'right'}> {
    const styles: Record<number, {halign?: 'left' | 'center' | 'right'}> = {};

    fields.forEach((field, index) => {
      if (field.key === 'quantity' || field.key === 'formattedAmount') {
        styles[index] = {halign: 'right'};
      } else if (field.key === 'tier') {
        styles[index] = {halign: 'center'};
      }
    });

    return styles;
  }
}
