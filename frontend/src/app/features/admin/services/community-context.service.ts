import {Injectable, computed, signal} from '@angular/core';
import {injectQuery} from 'convex-angular';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';

/**
 * Tracks which community the current user is administering.
 *
 * Provided at the community-admin shell level (NOT providedIn: 'root') so each
 * shell instance owns its own community scope. Components inside the shell use
 * inject(CommunityContextService) to read and update selection.
 *
 * Reactive query: listMyCommunities — auto-updates when the backend changes.
 * Auto-selection: if exactly one community exists, it is selected without user
 * interaction. If multiple exist, the first is pre-selected until the user
 * explicitly calls selectCommunity().
 */
@Injectable()
export class CommunityContextService {
  /** Real-time query for all communities the authenticated user can administer. */
  private readonly communitiesQuery = injectQuery(
    api.communities.admins.listMyCommunities,
    () => ({}),
  );

  /** All administerable community IDs, or empty array while loading. */
  readonly communities = computed(() => this.communitiesQuery.data() ?? []);

  /** True once `listMyCommunities` has produced a result (retained across transient errors). */
  readonly isLoaded = computed(
    () => this.communitiesQuery.data() !== undefined,
  );

  /** True when `listMyCommunities` failed with no previously loaded data to fall back on. */
  readonly hasError = computed(
    () =>
      this.communitiesQuery.status() === 'error' &&
      this.communitiesQuery.data() === undefined,
  );

  /** True while the initial query result has not yet arrived and has not errored. */
  readonly isLoading = computed(
    () =>
      this.communitiesQuery.isLoading() ||
      (!this.isLoaded() && !this.hasError()),
  );

  /** True when the user administers more than one community (drives selector UI visibility). */
  readonly hasMultipleCommunities = computed(
    () => this.communities().length > 1,
  );

  /** Holds the user's explicit community selection. Null means "use auto-selection". */
  private readonly _selectedId = signal<Id<'organizers'> | null>(null);

  /**
   * The active community ID.
   *
   * Enforces the authorization invariant at the service boundary: only IDs
   * present in `communities()` (which already includes every organizer for
   * platform admins via `listMyCommunities`) can become active. Returns null
   * until `listMyCommunities` has loaded so child views never query an
   * unverified or revoked organizer.
   */
  readonly selectedCommunityId = computed<Id<'organizers'> | null>(() => {
    if (!this.isLoaded()) return null;
    const list = this.communities();
    const explicit = this._selectedId();
    if (explicit !== null && list.includes(explicit)) return explicit;
    return list[0] ?? null;
  });

  /**
   * Kept for backwards compatibility with components/mocks. Because
   * `listMyCommunities` returns all organizers for platform admins and
   * `selectedCommunityId` enforces membership in that list, an unauthorized
   * selection can no longer enter override mode.
   */
  readonly isAdminOverride = computed<boolean>(() => false);

  /**
   * Resolved display names and slugs for community IDs, populated by the
   * community selector after fetching organizer documents. Keyed by Id<'organizers'>.
   */
  private readonly _resolvedNames = signal<Map<string, string>>(new Map());
  private readonly _resolvedSlugs = signal<Map<string, string>>(new Map());

  /** Display name for the currently selected community, or null if unresolved. */
  readonly selectedCommunityName = computed<string | null>(() => {
    const id = this.selectedCommunityId();
    if (id === null) return null;
    return this._resolvedNames().get(id) ?? null;
  });

  /** Explicitly selects a community by ID. */
  selectCommunity(id: Id<'organizers'>): void {
    this._selectedId.set(id);
  }

  /** Back-compat shim — equivalent to `selectCommunity`. */
  setAdminOverrideCommunity(id: Id<'organizers'>): void {
    this._selectedId.set(id);
  }

  /** Back-compat shim — clears the explicit selection, reverting to auto-selection. */
  clearAdminOverride(): void {
    this._selectedId.set(null);
  }

  /**
   * Provides human-readable names for community IDs.
   * Called by the parent shell after resolving organizer documents.
   *
   * @param names - Map from Id<'organizers'> string to display name.
   */
  setResolvedNames(names: Map<string, string>): void {
    this._resolvedNames.set(names);
  }

  setResolvedSlugs(slugs: Map<string, string>): void {
    this._resolvedSlugs.set(slugs);
  }

  resolvedNameFor(id: Id<'organizers'>): string | null {
    return this._resolvedNames().get(id) ?? null;
  }

  resolvedSlugFor(id: Id<'organizers'>): string | null {
    return this._resolvedSlugs().get(id) ?? null;
  }
}
