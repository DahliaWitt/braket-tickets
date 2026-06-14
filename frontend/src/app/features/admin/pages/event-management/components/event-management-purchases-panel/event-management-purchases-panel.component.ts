import {CurrencyPipe, DatePipe} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {toast} from 'ngx-sonner';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {
  type EventManagementPurchase,
  type Guest,
} from '@/features/admin/models/event-management.model';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  ExportDialogComponent,
  type ExportDialogData,
} from '../export-dialog/export-dialog.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {formatEventDate} from '@/utils/event-date-format';

@Component({
  selector: 'app-event-management-purchases-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DatePipe,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
  ],
  templateUrl: './event-management-purchases-panel.component.html',
})
export class EventManagementPurchasesPanelComponent {
  private readonly adminEventsService = inject(AdminEventsService);
  private readonly dialogService = inject(BraDialogService);
  private readonly alertDialog = inject(BraAlertDialogService);
  private readonly browser = inject(BrowserPlatformService);

  readonly eventTitle = input.required<string>();
  readonly eventDate = input.required<string>();
  readonly purchases = input.required<EventManagementPurchase[]>();
  readonly guests = input<Guest[]>([]);
  readonly dataChanged = output<void>();

  readonly isGeneratingPdf = signal<string | null>(null);
  readonly isRefunding = signal<string | null>(null);
  readonly isRefundingTicket = signal<string | null>(null);
  readonly refundingPurchaseIds = signal<Set<EventManagementPurchase['id']>>(
    new Set(),
  );
  readonly expandedPurchaseIds = signal<Set<EventManagementPurchase['id']>>(
    new Set(),
  );

  openExportDialog(): void {
    const dialogData: ExportDialogData = {
      purchases: this.purchases(),
      guests: this.guests(),
      eventTitle: this.eventTitle(),
      eventDate: formatEventDate(this.eventDate(), 'fullDate') ?? undefined,
    };

    this.dialogService.create({
      zTitle: 'Export Attendee List',
      zDescription: `Export ${this.purchases().length} attendees to CSV or PDF`,
      zContent: ExportDialogComponent,
      zData: dialogData,
      zHideFooter: true,
      zWidth: '420px',
    });
  }

  isPurchaseExpanded(purchaseId: EventManagementPurchase['id']): boolean {
    return this.expandedPurchaseIds().has(purchaseId);
  }

  togglePurchaseTickets(purchaseId: EventManagementPurchase['id']): void {
    this.expandedPurchaseIds.update((current) => {
      const next = new Set(current);
      if (next.has(purchaseId)) {
        next.delete(purchaseId);
      } else {
        next.add(purchaseId);
      }
      return next;
    });
  }

  canViewTicket(purchase: EventManagementPurchase): boolean {
    return Boolean(purchase.id);
  }

  async viewTicket(purchase: EventManagementPurchase): Promise<void> {
    if (this.isGeneratingPdf()) return;

    this.isGeneratingPdf.set(purchase.id);
    try {
      const pdfDataUrl = await this.adminEventsService.getTicketPdf(
        purchase.id,
      );
      if (!this.browser.openPdfPreview(pdfDataUrl, 'Ticket PDF')) {
        logger.error('Popup blocked');
        toast.error('Popup blocked. Please allow popups to view the ticket.');
      } else {
        toast.success('Ticket PDF opened.');
      }
    } catch (error) {
      logger.error('Failed to generate ticket PDF', error);
      toast.error('Failed to generate ticket PDF.');
    } finally {
      this.isGeneratingPdf.set(null);
    }
  }

  isPurchaseRefunding(purchaseId: EventManagementPurchase['id']): boolean {
    return this.refundingPurchaseIds().has(purchaseId);
  }

  private getRefundedAmountCents(purchase: EventManagementPurchase): number {
    if (purchase.refundedAmountCents !== undefined) {
      return Math.min(purchase.refundedAmountCents, purchase.amount);
    }

    if (purchase.tickets.length === 0) {
      return purchase.status === 'refunded' ? purchase.amount : 0;
    }

    const refundedTicketCount = purchase.tickets.filter(
      (ticket) => ticket.status === 'refunded',
    ).length;
    return Math.round(
      (refundedTicketCount / purchase.tickets.length) * purchase.amount,
    );
  }

  private getRemainingRefundableCents(
    purchase: EventManagementPurchase,
  ): number {
    return Math.max(0, purchase.amount - this.getRefundedAmountCents(purchase));
  }

  private getStandardRefundAmountCents(
    purchase: EventManagementPurchase,
  ): number {
    if (purchase.tickets.length === 0) return 0;

    const validTicketCount = purchase.tickets.filter(
      (ticket) => ticket.status === 'valid',
    ).length;
    return Math.round(
      (validTicketCount / purchase.tickets.length) * purchase.amount,
    );
  }

  canRefundPayment(purchase: EventManagementPurchase): boolean {
    if (purchase.amount === 0) {
      return purchase.tickets.some((ticket) => ticket.status === 'valid');
    }

    return (
      this.getStandardRefundAmountCents(purchase) > 0 &&
      purchase.tickets.some((ticket) => ticket.status === 'valid')
    );
  }

  canForceRefundAll(purchase: EventManagementPurchase): boolean {
    return (
      purchase.amount > 0 && this.getRemainingRefundableCents(purchase) > 0
    );
  }

  buyerActionLabel(purchase: EventManagementPurchase): string {
    const name = purchase.userName || purchase.userEmail || 'buyer';
    const email =
      purchase.userEmail && purchase.userEmail !== name
        ? `, ${purchase.userEmail}`
        : '';
    return `${name}${email}, order ${this.idSuffix(purchase.id)}`;
  }

  private startPurchaseRefund(purchaseId: EventManagementPurchase['id']): void {
    this.refundingPurchaseIds.update((current) => {
      const next = new Set(current);
      next.add(purchaseId);
      return next;
    });
  }

  private finishPurchaseRefund(
    purchaseId: EventManagementPurchase['id'],
  ): void {
    this.refundingPurchaseIds.update((current) => {
      if (!current.has(purchaseId)) return current;
      const next = new Set(current);
      next.delete(purchaseId);
      return next;
    });
  }

  refundPayment(purchase: EventManagementPurchase): void {
    if (
      this.isPurchaseRefunding(purchase.id) ||
      !this.canRefundPayment(purchase)
    )
      return;

    const standardRefundAmountCents =
      this.getStandardRefundAmountCents(purchase);
    const amount = (standardRefundAmountCents / 100).toFixed(2);
    const ticketLabel = purchase.quantity === 1 ? 'ticket' : 'tickets';
    const isFree = purchase.amount === 0;

    this.alertDialog.confirm({
      zTitle: isFree ? 'Cancel Tickets' : 'Refund Payment',
      zDescription: isFree
        ? `Cancel ${purchase.quantity} ${ticketLabel} for ${purchase.userName}? This will invalidate the ticket${purchase.quantity === 1 ? '' : 's'} and cannot be undone.`
        : `Refund $${amount} to ${purchase.userName} for ${purchase.quantity} ${ticketLabel}? Only unused tickets will be refunded. This action cannot be undone.`,
      zOkText: isFree ? 'Cancel Tickets' : 'Refund Payment',
      zCancelText: isFree ? 'Keep Tickets' : 'Keep Payment',
      zOkDestructive: true,
      zMaskClosable: false,
      zOnOk: () => {
        void this.performRefund(purchase, isFree);
      },
    });
  }

  forceRefundAll(purchase: EventManagementPurchase): void {
    if (
      this.isPurchaseRefunding(purchase.id) ||
      !this.canForceRefundAll(purchase)
    )
      return;

    const remainingAmountCents = this.getRemainingRefundableCents(purchase);
    const amount = (remainingAmountCents / 100).toFixed(2);
    const ticketLabel = purchase.quantity === 1 ? 'ticket' : 'tickets';
    const isFullBalance = remainingAmountCents === purchase.amount;
    const hasUnrefundedTickets = purchase.tickets.some(
      (ticket) => ticket.status !== 'refunded',
    );

    this.alertDialog.confirm({
      zTitle: 'Force Refund All',
      zDescription:
        `${isFullBalance ? 'Refund the full' : 'Refund the remaining'} $${amount} ${isFullBalance ? 'payment' : 'balance'} for ${purchase.quantity} ${ticketLabel} purchased by ${purchase.userName}? ` +
        `${hasUnrefundedTickets ? 'This also invalidates any tickets that were already used, and processor fees will not be recovered.' : 'Processor fees will not be recovered.'} This action cannot be undone.`,
      zOkText: 'Force Refund All',
      zCancelText: 'Keep Payment',
      zOkDestructive: true,
      zMaskClosable: false,
      zOnOk: () => {
        void this.performForceRefundAll(purchase);
      },
    });
  }

  private async performRefund(
    purchase: EventManagementPurchase,
    isFree: boolean,
  ): Promise<void> {
    if (this.isPurchaseRefunding(purchase.id)) return;

    this.startPurchaseRefund(purchase.id);
    this.isRefunding.set(purchase.id);
    try {
      await this.adminEventsService.refundPayment(purchase.id);
      toast.success(
        isFree
          ? 'Tickets cancelled successfully'
          : 'Payment refunded successfully',
      );
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to refund payment', error);
      toast.error(
        isFree ? 'Failed to cancel tickets' : 'Failed to refund payment',
      );
    } finally {
      this.isRefunding.set(null);
      this.finishPurchaseRefund(purchase.id);
    }
  }

  private async performForceRefundAll(
    purchase: EventManagementPurchase,
  ): Promise<void> {
    if (this.isPurchaseRefunding(purchase.id)) return;

    this.startPurchaseRefund(purchase.id);
    this.isRefunding.set(purchase.id);
    try {
      await this.adminEventsService.forceRefundAll(purchase.id);
      toast.success('Full payment refunded successfully');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to force refund payment', error);
      toast.error('Failed to force refund payment');
    } finally {
      this.isRefunding.set(null);
      this.finishPurchaseRefund(purchase.id);
    }
  }

  refundPurchaseTicket(
    purchase: EventManagementPurchase,
    ticket: EventManagementPurchase['tickets'][number],
  ): void {
    if (ticket.status !== 'valid' || this.isPurchaseRefunding(purchase.id))
      return;

    const perTicketAmount =
      purchase.quantity > 0
        ? Math.round(purchase.amount / purchase.quantity)
        : 0;
    const isFree = perTicketAmount === 0;
    const amount = (perTicketAmount / 100).toFixed(2);

    this.alertDialog.confirm({
      zTitle: isFree ? 'Cancel Ticket' : 'Refund Ticket',
      zDescription: isFree
        ? `Cancel one ticket for ${purchase.userName}? This will invalidate this ticket and cannot be undone.`
        : `Refund $${amount} for one ticket from ${purchase.userName}? This action cannot be undone.`,
      zOkText: isFree ? 'Cancel Ticket' : 'Refund Ticket',
      zCancelText: 'Keep Ticket',
      zOkDestructive: true,
      zMaskClosable: false,
      zOnOk: () => {
        void this.performSingleTicketRefund(ticket.id, purchase.id, isFree);
      },
    });
  }

  private async performSingleTicketRefund(
    ticketId: EventManagementPurchase['tickets'][number]['id'],
    purchaseId: EventManagementPurchase['id'],
    isFree: boolean,
  ): Promise<void> {
    if (this.isPurchaseRefunding(purchaseId)) return;

    this.startPurchaseRefund(purchaseId);
    this.isRefundingTicket.set(ticketId);
    try {
      await this.adminEventsService.refundTicket(ticketId);
      toast.success(
        isFree
          ? 'Ticket cancelled successfully'
          : 'Ticket refunded successfully',
      );
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Single ticket refund failed', error);
      toast.error('Failed to refund ticket');
    } finally {
      this.isRefundingTicket.set(null);
      this.finishPurchaseRefund(purchaseId);
    }
  }

  private idSuffix(id: string): string {
    return (id.length <= 8 ? id : id.slice(-6)).toUpperCase();
  }
}
