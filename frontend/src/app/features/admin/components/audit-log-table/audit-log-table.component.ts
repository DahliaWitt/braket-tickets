import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {formatDate} from '@angular/common';
import {RouterLink} from '@angular/router';
import {injectPaginatedQuery, skipToken} from 'convex-angular';
import {ADMIN_DATETIME} from '@/features/admin/utils/date-formats';
import {type FunctionReturnType} from 'convex/server';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {type ZardIcon} from '@ui/components/primitives/icon/icons';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';

export type AuditLogEntry = FunctionReturnType<
  typeof api.communities.management.audit.listAuditLogs
>['page'][number];

type AuditLogAction = AuditLogEntry['action'];

export const ACTION_DISPLAY: Record<
  AuditLogAction,
  {icon: ZardIcon; label: string}
> = {
  'account.email_change.cancelled': {
    icon: 'mail',
    label: 'EMAIL CHANGE CANCELLED',
  },
  'account.email_change.completed': {
    icon: 'mail',
    label: 'EMAIL CHANGE COMPLETED',
  },
  'account.email_change.failed': {icon: 'mail', label: 'EMAIL CHANGE FAILED'},
  'account.email_change.requested': {
    icon: 'mail',
    label: 'EMAIL CHANGE REQUESTED',
  },
  'account.email_change.verification_queued': {
    icon: 'mail',
    label: 'EMAIL VERIFICATION QUEUED',
  },
  'account.password.created': {icon: 'key', label: 'PASSWORD CREATED'},
  'account.provider.linked': {icon: 'link', label: 'PROVIDER LINKED'},
  'account.provider.unlinked': {icon: 'link', label: 'PROVIDER UNLINKED'},
  'admin_invite.cancel': {icon: 'shield', label: 'ADMIN INVITE CANCELLED'},
  'admin_invite.create': {icon: 'shield', label: 'ADMIN INVITE SENT'},
  'admin_invite.redeem': {icon: 'shield', label: 'ADMIN INVITE REDEEMED'},
  'application.reinstate': {icon: 'user-check', label: 'REINSTATED ACCESS'},
  'application.review': {icon: 'user-check', label: 'REVIEWED APPLICATION'},
  'application.revoke': {icon: 'user-check', label: 'REVOKED ACCESS'},
  'auth.social_signin.blocked': {
    icon: 'shield',
    label: 'SOCIAL SIGN-IN BLOCKED',
  },
  'auth.social_signin.linked_existing': {
    icon: 'link',
    label: 'SOCIAL ACCOUNT LINKED',
  },
  'auth.social_signup.completed': {
    icon: 'user-plus',
    label: 'SOCIAL SIGN-UP COMPLETED',
  },
  'auth_sync.backfill.collision': {
    icon: 'shield',
    label: 'AUTH BACKFILL COLLISION',
  },
  'auth_sync.backfill.linked': {icon: 'link', label: 'AUTH BACKFILL LINKED'},
  'auth_sync.backfill.skipped': {
    icon: 'shield',
    label: 'AUTH BACKFILL SKIPPED',
  },
  'community_admin.grant': {icon: 'shield', label: 'GRANTED ADMIN'},
  'community_admin.member_repair': {
    icon: 'shield',
    label: 'ADMIN MEMBERSHIP REPAIRED',
  },
  'community_admin.revoke': {icon: 'shield', label: 'REVOKED ADMIN'},
  'community_scanner.grant': {icon: 'shield', label: 'GRANTED SCANNER'},
  'community_scanner.revoke': {icon: 'shield', label: 'REVOKED SCANNER'},
  'event.broadcast-email.send.all_holders': {
    icon: 'send',
    label: 'SENT BROADCAST EMAIL',
  },
  'event.create': {icon: 'calendar', label: 'CREATED EVENT'},
  'event.delete': {icon: 'calendar', label: 'DELETED EVENT'},
  'event.management.view': {icon: 'calendar', label: 'VIEWED EVENT DATA'},
  'event.marketing-email.auto-cancelled': {
    icon: 'send',
    label: 'MARKETING EMAIL AUTO-CANCELLED',
  },
  'event.organizer_reassign.from': {
    icon: 'calendar',
    label: 'REASSIGNED EVENT (FROM)',
  },
  'event.organizer_reassign.to': {
    icon: 'calendar',
    label: 'REASSIGNED EVENT (TO)',
  },
  'event.reminder-email.send.approved_no_ticket': {
    icon: 'send',
    label: 'SENT REMINDER EMAIL',
  },
  event_roster_exported: {icon: 'calendar', label: 'EXPORTED ROSTER'},
  'event.update': {icon: 'calendar', label: 'UPDATED EVENT'},
  'guest.add': {icon: 'user-plus', label: 'ADDED GUEST'},
  'guest.check-in': {icon: 'scan-line', label: 'CHECKED IN GUEST'},
  'guest.import': {icon: 'user-plus', label: 'IMPORTED GUESTS'},
  'guest.update': {icon: 'pencil', label: 'UPDATED GUEST'},
  'imported_tickets.check-in': {
    icon: 'scan-line',
    label: 'CHECKED IN EXTERNAL TICKET',
  },
  'imported_tickets.import': {
    icon: 'user-plus',
    label: 'IMPORTED EXTERNAL TICKETS',
  },
  'imported_tickets.remove': {
    icon: 'trash',
    label: 'REMOVED EXTERNAL TICKET',
  },
  'imported_tickets.batch_remove': {
    icon: 'trash',
    label: 'REMOVED IMPORT BATCH',
  },
  'imported_tickets.redact': {
    icon: 'user-plus',
    label: 'REDACTED EXTERNAL TICKETS',
  },
  'magic_link.create': {icon: 'wand-2', label: 'CREATED MAGIC LINK'},
  'magic_link.delete': {icon: 'wand-2', label: 'DELETED MAGIC LINK'},
  'magic_link.disable': {icon: 'wand-2', label: 'DISABLED MAGIC LINK'},
  'magic_link.pause': {icon: 'wand-2', label: 'PAUSED MAGIC LINK'},
  'magic_link.redemption': {icon: 'wand-2', label: 'MAGIC LINK REDEEMED'},
  'magic_link.resume': {icon: 'wand-2', label: 'RESUMED MAGIC LINK'},
  'marketing_email.cancelled': {
    icon: 'send',
    label: 'MARKETING EMAIL CANCELLED',
  },
  'marketing_email.scheduled': {
    icon: 'send',
    label: 'MARKETING EMAIL SCHEDULED',
  },
  'marketing_email.sent': {icon: 'send', label: 'MARKETING EMAIL SENT'},
  'organizer.cascadeUnpublishEvents': {
    icon: 'calendar',
    label: 'UNPUBLISHED EVENTS',
  },
  'organizer.cleanupOrphanedAnswers': {
    icon: 'settings',
    label: 'CLEANED ORPHANED ANSWERS',
  },
  'organizer.setPlatformOrganizer:false': {
    icon: 'settings',
    label: 'UNSET PLATFORM ORGANIZER',
  },
  'organizer.setPlatformOrganizer:true': {
    icon: 'settings',
    label: 'SET PLATFORM ORGANIZER',
  },
  'organizer.update': {icon: 'settings', label: 'UPDATED ORGANIZER'},
  'payment.force-refund-all': {
    icon: 'credit-card',
    label: 'FORCE REFUNDED ALL',
  },
  'payment.refund': {icon: 'credit-card', label: 'REFUNDED TICKET'},
  'ticket.check-in': {icon: 'scan-line', label: 'CHECKED IN TICKET'},
  'ticket.check-in.revert': {icon: 'scan-line', label: 'REVERTED CHECK-IN'},
  'ticket.refund': {icon: 'credit-card', label: 'REFUNDED TICKET'},
  trust_link_cascade_deleted: {icon: 'link', label: 'CASCADE DELETED LINK'},
  trust_link_created: {icon: 'link', label: 'CREATED TRUST LINK'},
  trust_link_paused: {icon: 'link', label: 'PAUSED LINK'},
  trust_link_resumed: {icon: 'link', label: 'RESUMED LINK'},
  trust_link_revoked: {icon: 'link', label: 'REVOKED LINK'},
  'user.revoke': {icon: 'user-check', label: 'REVOKED USER'},
  'vetting.reminder-email.send.no_application': {
    icon: 'send',
    label: 'SENT VETTING REMINDER',
  },
};

function humanizeAction(action: string): string {
  return action.replace(/[._:-]+/g, ' ').toUpperCase();
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function detailSummary(entry: AuditLogEntry): string {
  if (entry.eventName) return entry.eventName;
  if (entry.deletedEventName) return `${entry.deletedEventName} (deleted)`;
  if (entry.applicationUserName) return entry.applicationUserName;
  if (entry.targetUserName) return entry.targetUserName;
  if (entry.magicLinkLabel) return entry.magicLinkLabel;
  if (entry.trustLinkLabel) return entry.trustLinkLabel;
  if (entry.reason) return entry.reason;
  return '—';
}

function actionDisplay(entry: AuditLogEntry): {icon: ZardIcon; label: string} {
  const hit = ACTION_DISPLAY[entry.action];
  if (hit) return hit;
  return {icon: 'activity', label: humanizeAction(entry.action)};
}

const CATEGORY_OPTIONS = [
  {value: '', label: 'All Categories'},
  {value: 'event', label: 'Events'},
  {value: 'application', label: 'Applications'},
  {value: 'check-in', label: 'Check-ins'},
  {value: 'payment', label: 'Payments'},
  {value: 'trust-link', label: 'Trust Links'},
  {value: 'role', label: 'Roles'},
  {value: 'magic-link', label: 'Magic Links'},
  {value: 'account', label: 'Account'},
] as const;

type AuditLogCategory = Exclude<(typeof CATEGORY_OPTIONS)[number]['value'], ''>;

const AUDIT_LOG_CATEGORIES = new Set<AuditLogCategory>([
  'event',
  'application',
  'check-in',
  'payment',
  'trust-link',
  'role',
  'magic-link',
  'account',
]);

function isAuditLogCategory(value: string): value is AuditLogCategory {
  return AUDIT_LOG_CATEGORIES.has(value as AuditLogCategory);
}

const TIME_WINDOW_OPTIONS = [
  {value: 'all', label: 'All Time'},
  {value: '7d', label: 'Last 7 days'},
  {value: '30d', label: 'Last 30 days'},
  {value: '90d', label: 'Last 90 days'},
];

@Component({
  selector: 'app-audit-log-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ZardButtonComponent,
    ZardIconComponent,
    ZardSkeletonComponent,
    RouterLink,
    EmptyStateComponent,
  ],
  styles: [
    `
      .audit-row-enter {
        transform: translateY(4px);
        animation: auditRowIn 300ms ease forwards;
      }

      @keyframes auditRowIn {
        to {
          transform: translateY(0);
        }
      }

      .audit-detail-expand {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 200ms ease-out;
      }

      .audit-detail-expand.expanded {
        grid-template-rows: 1fr;
      }

      .audit-detail-expand > div {
        overflow: hidden;
      }

      @media (prefers-reduced-motion: reduce) {
        .audit-row-enter {
          animation: none;
          transform: none;
        }
        .audit-detail-expand {
          transition: none;
        }
      }
    `,
  ],
  templateUrl: './audit-log-table.component.html',
})
export class AuditLogTableComponent {
  readonly organizerId = input<Id<'organizers'> | undefined>(undefined);

  // Expose Math.min for use in template animation-delay expressions
  protected readonly Math = Math;

  readonly selectedCategory = signal<AuditLogCategory | undefined>(undefined);
  readonly selectedTimeWindow = signal<string>('all');
  readonly expandedEntryId = signal<string | null>(null);

  readonly categoryOptions = CATEGORY_OPTIONS;
  readonly timeWindowOptions = TIME_WINDOW_OPTIONS;

  readonly skeletonRows = [1, 2, 3, 4, 5];

  readonly sinceTimestamp = computed(() => {
    const window = this.selectedTimeWindow();
    if (window === 'all') return undefined;
    const days = window === '7d' ? 7 : window === '30d' ? 30 : 90;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  });

  readonly hasActiveFilter = computed(
    () =>
      this.selectedCategory() !== undefined ||
      this.selectedTimeWindow() !== 'all',
  );

  // Note: the spec recommends numItems=100 when filters are active to reduce sparse pages.
  // convex-angular paginated query initialNumItems is static and cannot be changed reactively.
  // The query resets on every filter change anyway (new cursor), which partially mitigates
  // the sparse-page risk. A compound index (by_organizer_action) can be added in a follow-up
  // if filtering performance becomes an issue.
  private readonly auditQuery = injectPaginatedQuery(
    api.communities.management.audit.listAuditLogs,
    () => {
      const orgId = this.organizerId();
      return orgId
        ? {
            organizerId: orgId,
            actionCategory: this.selectedCategory(),
            sinceTimestamp: this.sinceTimestamp(),
          }
        : skipToken;
    },
    {initialNumItems: 25},
  );

  readonly results = this.auditQuery.results;
  readonly isDone = this.auditQuery.isExhausted;
  readonly isLoading = this.auditQuery.isLoadingFirstPage;
  readonly isLoadingMore = this.auditQuery.isLoadingMore;

  // Expose helper functions to the template
  readonly relativeTime = relativeTime;
  readonly detailSummary = detailSummary;
  readonly actionDisplay = actionDisplay;

  expandLabel(entry: AuditLogEntry): string {
    return this.entryToggleLabel(entry, this.expandedEntryId() === entry._id);
  }

  private entryToggleLabel(entry: AuditLogEntry, isOpen: boolean): string {
    const verb = isOpen ? 'Collapse' : 'Expand';
    return `${verb} details for ${actionDisplay(entry).label.toLowerCase()} by ${entry.adminName}`;
  }

  expandedPanelId(entry: AuditLogEntry): string {
    return `audit-log-expanded-detail-${entry._id}`;
  }

  expandedTriggerId(entry: AuditLogEntry): string {
    return `audit-log-detail-trigger-${entry._id}`;
  }

  mobileExpandedPanelId(entry: AuditLogEntry): string {
    return `audit-log-mobile-expanded-detail-${entry._id}`;
  }

  mobileExpandedTriggerId(entry: AuditLogEntry): string {
    return `audit-log-mobile-detail-trigger-${entry._id}`;
  }

  toggleExpanded(entry: AuditLogEntry): void {
    this.expandedEntryId.update((current) =>
      current === entry._id ? null : entry._id,
    );
  }

  toggleExpandedFromKeyboard(event: Event, entry: AuditLogEntry): void {
    event.preventDefault();
    this.toggleExpanded(entry);
  }

  loadMore(): void {
    if (this.isLoadingMore() || this.isDone()) return;
    this.auditQuery.loadMore(25);
  }

  onCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedCategory.set(
      value === '' ? undefined : isAuditLogCategory(value) ? value : undefined,
    );
    this.expandedEntryId.set(null);
  }

  onTimeWindowChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedTimeWindow.set(value);
    this.expandedEntryId.set(null);
  }

  clearFilters(): void {
    this.selectedCategory.set(undefined);
    this.selectedTimeWindow.set('all');
    this.expandedEntryId.set(null);
  }

  protected absoluteTime(timestamp: number): string {
    return formatDate(timestamp, ADMIN_DATETIME, 'en-US');
  }
}
