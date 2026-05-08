import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  type EventManagementPurchase,
  type Guest,
} from '@/features/admin/models/event-management.model';
import { TicketReminderTabComponent } from '@/features/admin/components/ticket-reminder-tab/ticket-reminder-tab.component';
import { EventManagementPurchasesPanelComponent } from '../event-management-purchases-panel/event-management-purchases-panel.component';

@Component({
  selector: 'app-event-management-buyers-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TicketReminderTabComponent, EventManagementPurchasesPanelComponent],
  templateUrl: './event-management-buyers-tab.component.html',
})
export class EventManagementBuyersTabComponent {
  readonly eventId = input.required<string>();
  readonly communityId = input.required<string>();
  readonly eventTitle = input.required<string>();
  readonly eventDate = input.required<string>();
  readonly purchases = input.required<EventManagementPurchase[]>();
  readonly guests = input<Guest[]>([]);
  readonly reloadToken = input(0);
  readonly dataChanged = output<void>();
}
