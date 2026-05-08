import {CurrencyPipe, DatePipe} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {toast} from 'ngx-sonner';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {
  type ResaleListing,
  type ResaleMetrics,
} from '@/features/admin/models/event-management.model';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {extractErrorMessage} from '@/core/utils/error-message.utils';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {logger} from '@/utils/logger';
import {readInputValue} from '@ui/utils/dom-event';

@Component({
  selector: 'app-event-management-resale-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DatePipe,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
    ZardTooltipDirective,
  ],
  templateUrl: './event-management-resale-tab.component.html',
})
export class EventManagementResaleTabComponent {
  private readonly adminEventsService = inject(AdminEventsService);
  private readonly resaleService = inject(ResaleService);

  readonly eventId = input.required<string>();
  readonly resaleListings = input<ResaleListing[]>([]);
  readonly resaleMetrics = input<ResaleMetrics | null>(null);
  readonly resaleEnabled = input(false);
  readonly resaleFeePct = input<number | null>(null);
  readonly dataChanged = output<void>();

  readonly resaleListingCount = computed(
    () =>
      this.resaleListings().filter(
        (listing) =>
          listing.status === 'listed' || listing.status === 'pending',
      ).length,
  );
  readonly lostProcessingFeesCents = computed(() => {
    const value = this.resaleMetrics()?.totalLostProcessingFeesCents ?? 0;
    return value === 0 ? 0 : -Math.abs(value);
  });

  readonly isUpdatingResaleSettings = signal(false);
  readonly isCancellingListing = signal<string | null>(null);

  async toggleResaleEnabled(): Promise<void> {
    if (this.isUpdatingResaleSettings()) return;

    const newValue = !this.resaleEnabled();
    this.isUpdatingResaleSettings.set(true);
    try {
      await this.adminEventsService.updateResaleSettings(this.eventId(), {
        resaleEnabled: newValue,
      });
      toast.success(newValue ? 'Resale enabled' : 'Resale disabled');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to update resale settings', error);
      toast.error('Failed to update resale settings');
    } finally {
      this.isUpdatingResaleSettings.set(false);
    }
  }

  async onResaleFeeInput(event: Event): Promise<void> {
    const valueInput = readInputValue(event.target);
    if (valueInput === null) return;

    const value = parseFloat(valueInput);
    if (isNaN(value) || value < 0 || value > 100) return;

    this.isUpdatingResaleSettings.set(true);
    try {
      await this.adminEventsService.updateResaleSettings(this.eventId(), {
        resaleFeePct: value,
      });
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to update resale fee', error);
      toast.error('Failed to update resale fee');
    } finally {
      this.isUpdatingResaleSettings.set(false);
    }
  }

  async adminCancelListing(listingId: string): Promise<void> {
    if (this.isCancellingListing()) return;

    this.isCancellingListing.set(listingId);
    try {
      await this.resaleService.cancelResaleListing(listingId);
      toast.success('Resale listing cancelled');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to cancel resale listing', error);
      toast.error(extractErrorMessage(error));
    } finally {
      this.isCancellingListing.set(null);
    }
  }
}
