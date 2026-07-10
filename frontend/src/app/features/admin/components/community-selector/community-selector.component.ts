import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {CommunityContextService} from '../../services/community-context.service';
import {AuthService} from '@/core/services/auth.service';
import type {Id} from '@convex/_generated/dataModel';
import {readInputValue} from '@ui/utils/dom-event';
import {
  injectQuery,
  injectQueries,
  skipToken,
  type QueryRequest,
} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {CommunityAdminDefaultService} from '@/features/admin/services/community-admin-default.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';

interface CommunityOption {
  id: Id<'organizers'>;
  name: string;
  slug: string | null | undefined;
}

/**
 * Displays the active community selection control in the admin shell header.
 *
 * - Admin-override mode: renders a static pink label with the override community
 *   name (the dropdown is suppressed; switching is done via the admin portal).
 * - Single community: renders a static pink label with the community name.
 * - Multiple communities: renders a styled `<select>` dropdown that calls
 *   `CommunityContextService.selectCommunity()` on change.
 *
 * The component subscribes to Convex queries to resolve human-readable names
 * for each community ID (batched via `communities.list.list` for root admins,
 * per-ID via `communities.public.get` otherwise). A separate effect propagates
 * resolved names back to `CommunityContextService` so the loader remains
 * read-only. Because these are live subscriptions, names update in real time
 * when organizer documents change.
 */
@Component({
  selector: 'app-community-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardIconComponent],
  template: `
    @if (ctx.isAdminOverride()) {
      @if (ctx.selectedCommunityName()) {
        <span
          class="block max-w-[200px] truncate font-mono text-2xs tracking-widest text-primary uppercase sm:max-w-none"
          data-testid="community-name"
        >
          {{ ctx.selectedCommunityName() }}
        </span>
      }
    } @else if (ctx.hasMultipleCommunities()) {
      <div
        class="flex min-w-0 flex-wrap items-center justify-end gap-3"
        data-testid="community-selector-dropdown"
      >
        <label
          for="community-select"
          class="mono-label hidden text-2xs text-muted-foreground sm:block"
        >
          Community
        </label>
        <select
          id="community-select"
          aria-label="Community"
          class="native-select w-36 max-w-[50vw] rounded-lg border border-border bg-card py-1.5 pl-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary sm:w-auto sm:max-w-xs sm:min-w-44"
          [value]="ctx.selectedCommunityId()"
          (change)="onSelectionChange($event)"
        >
          @for (opt of options(); track opt.id) {
            <option
              [value]="opt.id"
              [selected]="opt.id === ctx.selectedCommunityId()"
            >
              {{ opt.name }}
            </option>
          }
        </select>
        @if (showDefaultPreference()) {
          <button
            type="button"
            z-button
            zType="outline"
            data-testid="set-default-community"
            class="shrink-0 border-border px-3 py-1.5 font-mono text-2xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
            [disabled]="isSelectedDefault() || isSavingDefault()"
            [attr.aria-pressed]="isSelectedDefault()"
            [attr.aria-label]="
              isSelectedDefault()
                ? 'Current community is the default community admin landing page'
                : 'Set current community as default community admin landing page'
            "
            (click)="setSelectedAsDefault()"
          >
            <z-icon zType="check" class="mr-2 h-3.5 w-3.5" />
            {{ isSelectedDefault() ? 'Default' : 'Set default' }}
          </button>
        }
      </div>
    } @else if (ctx.selectedCommunityName()) {
      <span
        class="block max-w-[200px] truncate font-mono text-2xs tracking-widest text-primary uppercase sm:max-w-none"
        data-testid="community-name"
      >
        {{ ctx.selectedCommunityName() }}
      </span>
    }
  `,
})
export class CommunitySelectorComponent {
  protected readonly ctx = inject(CommunityContextService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly defaults = inject(CommunityAdminDefaultService);
  protected readonly isSavingDefault = signal(false);

  /**
   * Which community IDs need display names resolved.
   *
   * Override mode: only the override community. Otherwise: the user's admin
   * communities. In admin-override mode the override community is resolved so
   * its name shows in the static label (the dropdown is hidden).
   */
  private readonly idsToResolve = computed<Id<'organizers'>[]>(() => {
    const overrideId = this.ctx.selectedCommunityId();
    if (this.ctx.isAdminOverride() && overrideId !== null) {
      return [overrideId];
    }
    return this.ctx.communities();
  });

  /**
   * Root admins (non-override) batch-fetch every community once to avoid N+1
   * queries; community admins and override mode resolve names per-ID.
   */
  private readonly isListMode = computed(
    () => this.auth.userRole() === 'root_admin' && !this.ctx.isAdminOverride(),
  );

  /** Batch source (root-admin, non-override). Skipped otherwise. */
  private readonly listQuery = injectQuery(api.communities.list.list, () =>
    this.isListMode() ? {} : skipToken,
  );

  /**
   * Per-ID source (community admin / override). Empty (no active
   * subscriptions) in list mode.
   */
  private readonly nameQueries = injectQueries(() => {
    const requests: Record<
      string,
      QueryRequest<typeof api.communities.public.get>
    > = {};
    if (!this.isListMode()) {
      for (const id of this.idsToResolve()) {
        requests[id] = {query: api.communities.public.get, args: {id}};
      }
    }
    return requests;
  });

  /**
   * Options array for the dropdown; entries appear as their names resolve.
   * Pending per-ID loads (results entry still undefined) are excluded so a
   * placeholder name is never published to setResolvedNames() or rendered in
   * the header. A resolved-but-null community (deleted/no access) does get an
   * 'Unknown' entry — that state is final, not transitional.
   */
  protected readonly options = computed<CommunityOption[]>(() => {
    const ids = this.idsToResolve();
    if (this.isListMode()) {
      const all = this.listQuery.data() ?? [];
      const idSet = new Set(ids.map(String));
      return all
        .filter((c) => idSet.has(String(c._id)))
        .map((c) => ({id: c._id, name: c.name, slug: c.slug ?? null}));
    }
    const results = this.nameQueries.results();
    const options: CommunityOption[] = [];
    for (const id of ids) {
      const community = results[id];
      if (community === undefined) continue;
      options.push({
        id,
        name: community?.name ?? 'Unknown',
        slug: community?.slug ?? null,
      });
    }
    return options;
  });

  protected readonly showDefaultPreference = computed(
    () => !this.ctx.isAdminOverride() && this.ctx.communities().length > 1,
  );

  protected readonly isSelectedDefault = computed(() =>
    this.defaults.isDefaultCommunity(this.ctx.selectedCommunityId()),
  );

  private readonly resolvedNamesEffect = effect(() => {
    this.ctx.setResolvedNames(
      new Map(this.options().map((option) => [option.id, option.name])),
    );
  });

  onSelectionChange(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    const id = value as Id<'organizers'>;
    this.ctx.selectCommunity(id);
    const option = this.options().find((opt) => opt.id === id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        community: option?.slug ?? null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  async setSelectedAsDefault(): Promise<void> {
    if (!this.showDefaultPreference() || this.isSavingDefault()) return;
    const id = this.ctx.selectedCommunityId();
    if (id === null) return;
    this.isSavingDefault.set(true);
    try {
      await this.defaults.setDefaultCommunity(id);
      toast.success('Default community saved');
    } catch (error) {
      logger.error('Failed to save default community', error);
      toast.error('Could not save default community');
    } finally {
      this.isSavingDefault.set(false);
    }
  }
}
