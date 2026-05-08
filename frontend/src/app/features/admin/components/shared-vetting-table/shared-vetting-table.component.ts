import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  input,
  signal,
  linkedSignal,
  type TemplateRef,
  ViewContainerRef,
  viewChild,
} from '@angular/core';
import {injectQuery, skipToken} from 'convex-angular';
import {
  VettingTrustLinksService,
  type TrustLink,
} from '@/features/admin/services/vetting-trust-links.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {toast} from 'ngx-sonner';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';

type OutgoingTrustLink = TrustLink & {direction: 'outgoing'};

@Component({
  selector: 'app-shared-vetting-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardSkeletonComponent, ZardIconComponent],
  template: `
    <!-- Community Selector -->
    @if (!organizerId() && allOrganizers().length > 1) {
      <div class="mb-6" data-testid="organizer-select-container">
        <label
          for="organizer-select"
          class="mono-label mb-2 block text-2xs text-muted-foreground"
        >
          Managing Trust For
        </label>
        <select
          id="organizer-select"
          class="native-select rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          [value]="selectedOrganizerId()"
          (change)="onOrganizerChange($event)"
        >
          @for (org of allOrganizers(); track org._id) {
            <option [value]="org._id">{{ org.name }}</option>
          }
        </select>
      </div>
    }

    @if (!effectiveOrganizerId()) {
      <div
        class="py-10 text-center font-mono text-sm text-muted-foreground"
        data-testid="no-organizers-empty"
      >
        No organizers found. Create an organizer first.
      </div>
    } @else {
      <!-- Outgoing Trust Section -->
      <div class="space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="mono-label text-xs text-muted-foreground">
            Organizers You Trust
          </h2>
          <button
            type="button"
            z-button
            zType="outline"
            data-testid="create-trust-link"
            (click)="openCreateDialog()"
          >
            <z-icon zType="plus" class="mr-1.5 h-3.5 w-3.5" />
            Create Trust Link
          </button>
        </div>

        @if (outgoingLoading()) {
          <!-- Loading Skeleton - Desktop -->
          <div
            class="hidden overflow-hidden rounded-xl border border-border/50 bg-card md:block"
            aria-busy="true"
          >
            <table class="min-w-full border-collapse text-left">
              <thead
                class="bg-muted/50 font-mono text-xs tracking-widest text-muted-foreground uppercase"
              >
                <tr>
                  <th class="border-b border-border p-5 font-medium">
                    Community
                  </th>
                  <th class="border-b border-border p-5 font-medium">
                    Trusted Members
                  </th>
                  <th class="border-b border-border p-5 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border/50">
                @for (i of [1, 2, 3]; track i) {
                  <tr>
                    <td class="p-5"><z-skeleton class="h-5 w-32" /></td>
                    <td class="p-5"><z-skeleton class="h-5 w-8" /></td>
                    <td class="p-5"><z-skeleton class="h-8 w-28" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <!-- Loading Skeleton - Mobile -->
          <div class="space-y-4 md:hidden" aria-busy="true">
            @for (i of [1, 2, 3]; track i) {
              <div
                class="space-y-4 rounded-xl border border-border bg-card/80 p-5"
              >
                <div class="flex items-center justify-between">
                  <z-skeleton class="h-5 w-32" />
                  <z-skeleton class="h-5 w-16" />
                </div>
                <z-skeleton class="h-4 w-full" />
                <z-skeleton class="h-9 w-full" />
              </div>
            }
          </div>
        } @else if (outgoingLinks().length === 0) {
          <div
            class="py-10 text-center text-muted-foreground"
            data-testid="outgoing-empty"
          >
            No trust links created yet.
          </div>
        } @else {
          <!-- Desktop Table -->
          <div
            class="hidden overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl md:block"
          >
            <div class="overflow-x-auto">
              <table class="min-w-full border-collapse text-left">
                <thead
                  class="bg-muted/50 font-mono text-xs tracking-widest text-muted-foreground uppercase"
                >
                  <tr>
                    <th class="border-b border-border p-5 font-medium">
                      Community
                    </th>
                    <th class="border-b border-border p-5 font-medium">
                      Trusted Members
                    </th>
                    <th class="border-b border-border p-5 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border/50">
                  @for (
                    link of outgoingLinks();
                    track link.trustedOrganizerId
                  ) {
                    <tr
                      class="transition-colors hover:bg-muted/30"
                      data-testid="outgoing-row"
                      [attr.data-org-name]="link.trustedOrganizerName"
                    >
                      <td
                        class="p-5 font-display tracking-wide"
                        data-testid="outgoing-name"
                      >
                        {{ link.trustedOrganizerName }}
                      </td>
                      <td class="p-5 font-mono">
                        {{ link.trustedMemberCount ?? 0 }}
                      </td>
                      <td class="p-5">
                        <div class="flex gap-2">
                          <button
                            type="button"
                            z-button
                            zType="destructive"
                            data-testid="remove-button"
                            [attr.aria-label]="
                              'Remove trust link to ' +
                              link.trustedOrganizerName
                            "
                            (click)="removeLink(link)"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <!-- Mobile Card Layout -->
          <div class="space-y-4 md:hidden">
            @for (link of outgoingLinks(); track link.trustedOrganizerId) {
              <div
                class="space-y-4 rounded-xl border border-border bg-card/80 p-5"
                data-testid="outgoing-card"
                [attr.data-org-name]="link.trustedOrganizerName"
              >
                <div class="flex items-center justify-between">
                  <span
                    class="font-display tracking-wide"
                    data-testid="outgoing-name"
                    >{{ link.trustedOrganizerName }}</span
                  >
                </div>

                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span
                      class="font-mono text-2xs tracking-wider text-muted-foreground uppercase"
                    >
                      Trusted Members
                    </span>
                    <div class="font-mono">
                      {{ link.trustedMemberCount ?? 0 }}
                    </div>
                  </div>
                </div>

                <div class="flex gap-2 border-t border-border/50 pt-2">
                  <button
                    type="button"
                    z-button
                    zType="destructive"
                    class="flex-1"
                    data-testid="remove-button"
                    [attr.aria-label]="
                      'Remove trust link to ' + link.trustedOrganizerName
                    "
                    (click)="removeLink(link)"
                  >
                    Remove
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Incoming Trust Section (read-only) -->
      <div class="mt-12 space-y-6 border-t border-border pt-8">
        <h2 class="mono-label text-xs text-muted-foreground">
          Organizers That Trust You
        </h2>

        @if (incomingLoading()) {
          <div class="space-y-2">
            <z-skeleton class="h-12 w-full" />
            <z-skeleton class="h-12 w-full" />
          </div>
        } @else if (incomingLinks().length === 0) {
          <div
            class="py-6 text-center text-sm text-muted-foreground"
            data-testid="incoming-empty"
          >
            No other organizers have created trust links to you yet.
          </div>
        } @else {
          <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            @for (link of incomingLinks(); track link.trustingOrganizerId) {
              <div
                class="rounded-lg border border-border bg-card/50 p-4"
                data-testid="incoming-link"
                [attr.data-org-name]="link.trustingOrganizerName"
              >
                <div
                  class="font-display tracking-wide"
                  data-testid="incoming-name"
                >
                  {{ link.trustingOrganizerName }}
                </div>
                <p class="mt-2 text-2xs text-muted-foreground">
                  Trusts your community
                </p>
              </div>
            }
          </div>
        }
      </div>
    }

    <!-- Template for the "Create Trust Link" dialog content (org selector) -->
    <ng-template #createTrustLinkContent>
      <div class="space-y-2">
        <label
          for="trust-link-org-select"
          class="mono-label block text-2xs text-muted-foreground"
        >
          Select Organizer To Trust
        </label>
        <select
          id="trust-link-org-select"
          data-testid="trust-link-org-select"
          class="native-select w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          [value]="selectedOrgForTrust()"
          (change)="onTrustOrgChange($event)"
        >
          @for (org of availableOrganizers(); track org._id) {
            <option [value]="org._id">{{ org.name }}</option>
          }
        </select>
        <p class="text-xs text-muted-foreground">
          Their approved users will be able to purchase tickets for your events
          without re-vetting.
        </p>
      </div>
    </ng-template>
  `,
})
export class SharedVettingTableComponent {
  /** When provided (from community admin), uses this org directly and hides the internal selector */
  readonly organizerId = input<Id<'organizers'>>();

  private dialogService = inject(BraDialogService);
  private trustLinksService = inject(VettingTrustLinksService);
  private viewContainerRef = inject(ViewContainerRef);

  /** Template for the create trust link dialog content (org selector) */
  private readonly createTrustLinkTemplate = viewChild.required<
    TemplateRef<unknown>
  >('createTrustLinkContent');

  /** All communities — needed for both the selector dropdown and the create dialog */
  private readonly communitiesQuery = injectQuery(
    api.communities.list.list,
    () => ({}),
  );
  readonly allOrganizers = computed(() => this.communitiesQuery.data() ?? []);

  /** Currently selected community, auto-selects first when list loads.
   *  Uses source/computation form so the selection only resets when the
   *  list length changes (e.g. empty→populated), NOT when Convex pushes
   *  a realtime update that merely refreshes the same list contents. */
  readonly selectedOrganizerId = linkedSignal<
    Id<'organizers'>[],
    Id<'organizers'> | null
  >({
    source: () => this.allOrganizers().map((o) => o._id),
    computation: (orgIds, previous) => {
      // Keep current selection if it's still in the list
      if (previous?.value && orgIds.includes(previous.value)) {
        return previous.value;
      }
      // Otherwise pick the first (initial load or selected org was deleted)
      return orgIds[0] ?? null;
    },
  });

  /** The active organizer: external input (community admin) takes priority over internal dropdown */
  readonly effectiveOrganizerId = computed<Id<'organizers'> | null>(() => {
    return this.organizerId() ?? this.selectedOrganizerId();
  });

  /** Handle community selection change from the dropdown */
  onOrganizerChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedOrganizerId.set(value as Id<'organizers'>);
  }

  /** Handle trust org selection change in the create dialog */
  onTrustOrgChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedOrgForTrust.set(value as Id<'organizers'>);
  }

  /** Outgoing trust links query - links created BY the selected organizer */
  private readonly outgoingQuery = injectQuery(
    api.communities.trust_links.list,
    () => {
      const orgId = this.effectiveOrganizerId();
      if (!orgId) return skipToken;
      return {organizerId: orgId, direction: 'outgoing' as const};
    },
  );
  readonly outgoingLinks = computed(
    () => (this.outgoingQuery.data() ?? []) as OutgoingTrustLink[],
  );
  outgoingLoading = this.outgoingQuery.isLoading;

  /** Incoming trust links query - links trusting THIS organizer */
  private readonly incomingQuery = injectQuery(
    api.communities.trust_links.list,
    () => {
      const orgId = this.effectiveOrganizerId();
      if (!orgId) return skipToken;
      return {organizerId: orgId, direction: 'incoming' as const};
    },
  );
  readonly incomingLinks = computed(() => this.incomingQuery.data() ?? []);
  incomingLoading = this.incomingQuery.isLoading;

  /** Organizers available for creating new trust links (excludes self + already linked) */
  readonly availableOrganizers = computed(() => {
    const allOrgs = this.allOrganizers();
    const existingLinkOrgIds = new Set(
      this.outgoingLinks().map((l) => l.trustedOrganizerId),
    );
    const currentOrgId = this.effectiveOrganizerId();

    return allOrgs.filter(
      (org) => org._id !== currentOrgId && !existingLinkOrgIds.has(org._id),
    );
  });

  /** Signal for the organizer selected in the create dialog */
  readonly selectedOrgForTrust = signal<Id<'organizers'> | null>(null);

  openCreateDialog(): void {
    const availableOrgs = this.availableOrganizers();
    if (availableOrgs.length === 0) {
      toast.info('No organizers available to trust');
      return;
    }

    // Pre-select first available org
    this.selectedOrgForTrust.set(availableOrgs[0]._id);

    this.dialogService.create({
      zTitle: 'Create Trust Link',
      zContent: this.createTrustLinkTemplate(),
      zViewContainerRef: this.viewContainerRef,
      zOkText: 'Create Trust Link',
      zCancelText: 'Cancel',
      zOnOk: async () => {
        const selectedOrgId = this.selectedOrgForTrust();
        if (!selectedOrgId) return;

        try {
          await this.trustLinksService.create(
            this.effectiveOrganizerId()!,
            selectedOrgId,
          );
          toast.success('Trust link created');
        } catch (e: unknown) {
          const message =
            e instanceof Error ? e.message : 'Failed to create trust link';
          toast.error(message);
        }
      },
    });
  }

  removeLink(link: TrustLink): void {
    this.dialogService.create({
      zTitle: 'Remove Trust Link',
      zDescription:
        `Are you sure you want to remove trust to ${link.trustedOrganizerName}? ` +
        'Users approved by them will no longer be able to purchase tickets for your events without re-vetting. ' +
        'This action cannot be undone.',
      zOkText: 'Remove',
      zOkDestructive: true,
      zCancelText: 'Cancel',
      zOnOk: async () => {
        try {
          await this.trustLinksService.remove(
            link.trustingOrganizerId,
            link.trustedOrganizerId,
          );
          toast.success(`Trust link to ${link.trustedOrganizerName} removed`);
        } catch (e: unknown) {
          const message =
            e instanceof Error ? e.message : 'Failed to remove trust link';
          toast.error(message);
        }
      },
    });
  }
}
