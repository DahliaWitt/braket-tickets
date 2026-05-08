import { inject, Injectable } from '@angular/core';
import { type SettlementExportInput } from '../models/event-management.model';
import type { jsPDF as JsPDF } from 'jspdf';
import { BRAND_PALETTE } from '../../../utils/brand-palette';
import { LOAD_PDF_EXPORT_DEPENDENCIES } from './pdf-export-loader.token';
import {
  completedResaleListings,
  parseSettlementEventDate,
  summarizeSettlementRefunds,
  type RefundTierStats,
} from './settlement-export-data';
import { formatUsdCents, generateDatedExportFilename } from '../utils/export-formatting';
import { addPdfPageNumbers, getLastAutoTableFinalY } from './pdf-export-document';

// Types for dynamic imports - jsPDF loaded only when PDF export is triggered

type RevenueByTierEntry = [
  keyof SettlementExportInput['revenueByTier'],
  SettlementExportInput['revenueByTier'][keyof SettlementExportInput['revenueByTier']],
];

/**
 * Service for generating financial settlement reports for events.
 *
 * Produces a professional PDF document containing:
 * - **Event Information**: Title, date, location, and report generation timestamp
 * - **Sales Breakdown**: Revenue by ticket tier (quantity, gross, and net after fees)
 * - **Processing Fees**: Itemized payment processor and platform fees
 * - **Settlement Summary**: Final net amount due to organizer
 * - **Refund Appendix** (Page 2): Detailed refund breakdown when applicable
 *
 * The report is branded with Braket's visual identity (Deep Crimson-Wine accents, light background)
 * and automatically generates a descriptive filename based on the event title.
 *
 * @example
 * ```typescript
 * // Compose narrowed input from the per-surface management queries
 * const input: SettlementExportInput = composeFromSummaryPurchasesResale(...);
 * this.settlementExport.export(input);
 * // Downloads: 'summer-party-2026-settlement-2026-01-15.pdf'
 * ```
 *
 * @remarks
 * The settlement figures correctly handle partial refunds by:
 * - Excluding refunded amounts from net revenue calculations
 * - Displaying refund details on a separate page for audit purposes
 * - Breaking down refunds by tier for financial reconciliation
 */
@Injectable({
  providedIn: 'root',
})
export class SettlementExportService {
  private readonly loadPdfExportDependencies = inject(LOAD_PDF_EXPORT_DEPENDENCIES);

  /**
   * Generates and downloads a settlement report PDF for the given event.
   *
   * The report consists of:
   * - **Page 1**: Settlement summary with sales breakdown, fees, and net settlement
   * - **Page 2** (conditional): Refund appendix, only included if refunds exist
   *
   * All monetary values are displayed in USD. Processing fees are shown as deductions.
   * The net settlement represents the final amount to be paid to the event organizer.
   *
   * PDF libraries (~500KB) are lazy-loaded to keep the initial bundle smaller.
   *
   * @param data - Narrowed settlement payload composed from the summary,
   *               purchases, and resale management surfaces.
   * @returns Promise that resolves when the PDF download is triggered.
   *
   * @remarks
   * Uses jsPDF with jspdf-autotable for professional table formatting.
   * Page numbers are added to all pages automatically.
   */
  async export(data: SettlementExportInput): Promise<void> {
    const { jsPDF, autoTable } = await this.loadPdfExportDependencies();

    const doc: JsPDF = new jsPDF();
    const { event, revenue, revenueByTier, purchases, resaleMetrics, resaleListings } = data;

    const refundSummary = summarizeSettlementRefunds(purchases);
    const { refundsByTier, totalRefundedTickets, hasRefunds } = refundSummary;

    // --- PAGE 1: Settlement Summary ---

    // --- Header Section ---
    doc.setFontSize(22);
    doc.setTextColor(BRAND_PALETTE.primary);
    doc.setFont('helvetica', 'bold');
    doc.text('SETTLEMENT REPORT', 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(BRAND_PALETTE.mutedForeground);
    doc.setFont('helvetica', 'normal');
    doc.text('Braket Tickets - Financial Summary', 14, 28);

    // Event Info Box
    doc.setDrawColor(BRAND_PALETTE.border);
    doc.setFillColor(BRAND_PALETTE.muted);
    doc.rect(14, 35, 182, 30, 'F');

    doc.setTextColor(BRAND_PALETTE.foreground);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(event.title, 18, 43);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const dateStr = parseSettlementEventDate(event.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.text(`Date: ${dateStr}`, 18, 49);
    doc.text(`Location: ${event.location || 'N/A'}`, 18, 54);
    doc.text(`Report Generated: ${new Date().toLocaleString()}`, 18, 59);

    // --- Sales Breakdown Table (non-refunded sales only) ---
    doc.setFontSize(14);
    doc.setTextColor(BRAND_PALETTE.primary);
    doc.setFont('helvetica', 'bold');
    doc.text('Sales Breakdown by Tier', 14, 78);

    const salesHeaders = [['Tier', 'Quantity', 'Gross Sales', 'Net Sales (After Fees)']];
    const salesBody = (Object.entries(revenueByTier) as RevenueByTierEntry[]).map(([tier, stats]) => [
      tier.toUpperCase(),
      stats.quantity.toString(),
      formatUsdCents(stats.grossCents),
      formatUsdCents(stats.netCents),
    ]);

    autoTable(doc, {
      head: salesHeaders,
      body: salesBody,
      startY: 82,
      theme: 'grid',
      headStyles: { fillColor: BRAND_PALETTE.primary, textColor: BRAND_PALETTE.white, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
    });

    // --- Processing Fees Section ---
    // Fallback Y = salesTableStartY + heading height — if the sales table
    // was empty (zero sales in every tier), autoTable emits no finalY.
    const feesY = getLastAutoTableFinalY(doc, 82) + 15;
    doc.setFontSize(14);
    doc.setTextColor(BRAND_PALETTE.primary);
    doc.setFont('helvetica', 'bold');
    doc.text('Processing Fees & Deductions', 14, feesY);

    const feeData: string[][] = [];
    if (revenue.processingFeeCents > 0) {
      feeData.push(['Processing Fees', `-${formatUsdCents(revenue.processingFeeCents)}`]);
    }
    feeData.push(['Braket Platform Fee (2%)', `-${formatUsdCents(revenue.platformFeeCents)}`]);
    // Lost processing fees: split into primary refunds vs resale refunds so
    // every visible line item sums exactly to the NET SETTLEMENT total.
    // revenue.lostProcessingFeeCents is the superset (includes resale seller fees).
    const resaleLostCents = resaleMetrics?.totalLostProcessingFeesCents ?? 0;
    const primaryLostCents = revenue.lostProcessingFeeCents - resaleLostCents;
    if (primaryLostCents > 0) {
      feeData.push([
        `Lost Fees on Refunds*`,
        `-${formatUsdCents(primaryLostCents)}`,
      ]);
    }
    if (resaleLostCents > 0) {
      feeData.push([
        'Lost Fees on Resale Refunds**',
        `-${formatUsdCents(resaleLostCents)}`,
      ]);
    }

    autoTable(doc, {
      head: [['Fee Type', 'Amount']],
      body: feeData,
      startY: feesY + 4,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        1: { halign: 'right', fontStyle: 'bold' },
      },
      bodyStyles: { textColor: BRAND_PALETTE.tableMutedText },
    });

    // Add footnotes if there are lost fees or resale fees
    const hasLostFees = primaryLostCents > 0;
    const hasResaleFees = resaleLostCents > 0;
    if (hasLostFees || hasResaleFees) {
      let footnoteY = getLastAutoTableFinalY(doc, feesY + 4) + 4;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(BRAND_PALETTE.mutedForeground);
      if (hasLostFees) {
        doc.text(
          '* Payment processors retain their fees even when refunds are issued.',
          14,
          footnoteY,
        );
        footnoteY += 4;
      }
      if (hasResaleFees) {
        doc.text(
          '** Processing fees retained by the payment processor on refunds to resale sellers.',
          14,
          footnoteY,
        );
      }
    }

    // --- Summary Section ---
    let summaryY = getLastAutoTableFinalY(doc, feesY + 4) + 15;

    // Adjust for footnotes if present
    if (hasLostFees) summaryY += 8;
    if (hasResaleFees) summaryY += 4;

    // Net revenue (gross minus refunds) for display
    const netGrossCents = revenue.grossCents - revenue.refundedCents;
    // NOTE: revenue.lostProcessingFeeCents already includes resale seller refund
    // fees (seller payments are marked 'refunded' and counted in the payments loop).
    // Do NOT add resaleMetrics.totalLostProcessingFeesCents here — it would double-count.
    const totalFees =
      revenue.processingFeeCents +
      revenue.platformFeeCents +
      revenue.lostProcessingFeeCents;

    // Final Net Box
    doc.setFillColor(BRAND_PALETTE.primary);
    doc.rect(120, summaryY, 76, 35, 'F');

    doc.setTextColor(BRAND_PALETTE.white);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Net Revenue:', 124, summaryY + 10);
    doc.text(formatUsdCents(netGrossCents), 192, summaryY + 10, { align: 'right' });

    doc.text('Processing Fees:', 124, summaryY + 18);
    doc.text(`-${formatUsdCents(totalFees)}`, 192, summaryY + 18, { align: 'right' });

    doc.setDrawColor(BRAND_PALETTE.white);
    doc.setLineWidth(0.5);
    doc.line(124, summaryY + 22, 192, summaryY + 22);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('NET SETTLEMENT:', 124, summaryY + 30);
    doc.text(formatUsdCents(revenue.netCents), 192, summaryY + 30, { align: 'right' });

    // Appendix notes if applicable
    const hasCompletedResales = resaleMetrics && resaleMetrics.completedResales > 0;
    let noteY = summaryY + 30;
    if (hasRefunds || hasCompletedResales) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(BRAND_PALETTE.mutedForeground);
      if (hasRefunds) {
        doc.text('Refund details on Page 2', 14, noteY);
        noteY += 5;
      }
      if (hasCompletedResales) {
        const resalePage = hasRefunds ? 3 : 2;
        doc.text(`Resale details on Page ${resalePage}`, 14, noteY);
      }
    }

    // --- PAGE 2: Refund Appendix (only if there are refunds) ---
    if (hasRefunds) {
      doc.addPage();

      // Header
      doc.setFontSize(22);
      doc.setTextColor(BRAND_PALETTE.primary);
      doc.setFont('helvetica', 'bold');
      doc.text('REFUND APPENDIX', 14, 22);

      doc.setFontSize(10);
      doc.setTextColor(BRAND_PALETTE.mutedForeground);
      doc.setFont('helvetica', 'normal');
      doc.text(`${event.title} - Refund Summary`, 14, 28);

      // Refund explanation
      doc.setFontSize(9);
      doc.setTextColor(BRAND_PALETTE.foreground);
      doc.text(
        'The following refunds have been processed and are excluded from the settlement figures on Page 1.',
        14,
        42,
      );

      // Refunds by Tier Table
      doc.setFontSize(14);
      doc.setTextColor(BRAND_PALETTE.primary);
      doc.setFont('helvetica', 'bold');
      doc.text('Refunds by Tier', 14, 55);

      const refundHeaders = [['Tier', 'Tickets Refunded', 'Amount Refunded']];
      const refundBody = Object.entries(refundsByTier).map(([tier, stats]: [string, RefundTierStats]) => [
        tier.toUpperCase(),
        stats.quantity.toString(),
        formatUsdCents(stats.amountCents),
      ]);

      autoTable(doc, {
        head: refundHeaders,
        body: refundBody,
        startY: 59,
        theme: 'grid',
        headStyles: { fillColor: BRAND_PALETTE.primary, textColor: BRAND_PALETTE.white, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 4 },
        columnStyles: {
          1: { halign: 'right' },
          2: { halign: 'right' },
        },
      });

      // Total Refunds Box
      const refundSummaryY = getLastAutoTableFinalY(doc, 59) + 15;

      // Increase box height if we have lost fees to show
      const boxHeight = revenue.lostProcessingFeeCents > 0 ? 32 : 20;
      doc.setFillColor(BRAND_PALETTE.muted);
      doc.rect(120, refundSummaryY, 76, boxHeight, 'F');

      doc.setTextColor(BRAND_PALETTE.foreground);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('Total Tickets Refunded:', 124, refundSummaryY + 8);
      doc.text(totalRefundedTickets.toString(), 192, refundSummaryY + 8, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.text('Total Refunded:', 124, refundSummaryY + 16);
      doc.text(formatUsdCents(revenue.refundedCents), 192, refundSummaryY + 16, {
        align: 'right',
      });

      // Show lost processing fees if any
      if (revenue.lostProcessingFeeCents > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(BRAND_PALETTE.destructive);
        doc.text('Lost Processing Fees:', 124, refundSummaryY + 26);
        doc.text(formatUsdCents(revenue.lostProcessingFeeCents), 192, refundSummaryY + 26, {
          align: 'right',
        });
      }
    }

    // --- RESALE APPENDIX PAGE (only if completed resales exist) ---
    if (hasCompletedResales) {
      doc.addPage();

      // Header
      doc.setFontSize(22);
      doc.setTextColor(BRAND_PALETTE.primary);
      doc.setFont('helvetica', 'bold');
      doc.text('RESALE APPENDIX', 14, 22);

      doc.setFontSize(10);
      doc.setTextColor(BRAND_PALETTE.mutedForeground);
      doc.setFont('helvetica', 'normal');
      doc.text(`${event.title} - Resale Summary`, 14, 28);

      // Summary section
      doc.setFontSize(14);
      doc.setTextColor(BRAND_PALETTE.primary);
      doc.setFont('helvetica', 'bold');
      doc.text('Summary', 14, 45);

      const resaleSummaryData = [
        ['Total Resold', resaleMetrics.completedResales.toString()],
        [
          'Total Refunded to Sellers',
          formatUsdCents(resaleMetrics.totalRefundedToSellersCents),
        ],
        ['Resale Fees Collected', formatUsdCents(resaleMetrics.totalResaleFeesCents)],
        [
          'Lost Processing Fees',
          `-${formatUsdCents(resaleMetrics.totalLostProcessingFeesCents)}`,
        ],
      ];

      autoTable(doc, {
        body: resaleSummaryData,
        startY: 49,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 4 },
        columnStyles: {
          1: { halign: 'right', fontStyle: 'bold' },
        },
        bodyStyles: { textColor: BRAND_PALETTE.tableMutedText },
      });

      // Transactions table (only completed listings with financial data)
      const completedListings = completedResaleListings(resaleListings);
      if (completedListings.length > 0) {
        const transactionsY = getLastAutoTableFinalY(doc, 49) + 15;

        doc.setFontSize(14);
        doc.setTextColor(BRAND_PALETTE.primary);
        doc.setFont('helvetica', 'bold');
        doc.text('Resale Transactions', 14, transactionsY);

        const transactionHeaders = [['#', 'Seller', 'Seller Refund', 'Resale Fee', 'Lost Fee']];
        const transactionBody = completedListings.map((listing, index) => [
          (index + 1).toString(),
          listing.sellerName,
          formatUsdCents(listing.sellerRefundAmountCents ?? 0),
          formatUsdCents(listing.resaleFeeCents ?? 0),
          `-${formatUsdCents(listing.lostProcessingFeeCents ?? 0)}`,
        ]);

        autoTable(doc, {
          head: transactionHeaders,
          body: transactionBody,
          startY: transactionsY + 4,
          theme: 'grid',
          headStyles: { fillColor: BRAND_PALETTE.primary, textColor: BRAND_PALETTE.white, fontStyle: 'bold' },
          styles: { fontSize: 9, cellPadding: 4 },
          columnStyles: {
            0: { halign: 'center', cellWidth: 15 },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right' },
          },
        });
      }
    }

    addPdfPageNumbers(doc);
    doc.save(generateDatedExportFilename(event.title, 'settlement', 'pdf'));
  }
}
