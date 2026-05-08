import { Injectable, computed, signal } from '@angular/core';
import { injectQuery } from 'convex-angular';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

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

  /** True while the initial query result has not yet arrived. */
  readonly isLoading = this.communitiesQuery.isLoading;

  /** True when the user administers more than one community (drives selector UI visibility). */
  readonly hasMultipleCommunities = computed(() => this.communities().length > 1);

  /** Holds the user's explicit community selection. Null means "use auto-selection". */
  private readonly _selectedId = signal<Id<'organizers'> | null>(null);

  /**
   * The active community ID.
   *
   * Resolution order:
   * 1. Explicit selection via selectCommunity() / setAdminOverrideCommunity().
   * 2. First community in the list (auto-select fallback).
   * 3. Null if the list is empty.
   */
  readonly selectedCommunityId = computed<Id<'organizers'> | null>(() => {
    const explicit = this._selectedId();
    if (explicit !== null) return explicit;
    const list = this.communities();
    return list.length > 0 ? list[0] : null;
  });

  /**
   * True when the selected community is not in the user's own communities list.
   * Guards against false positives while the list is still loading.
   */
  readonly isAdminOverride = computed<boolean>(() => {
    const selected = this.selectedCommunityId();
    if (selected === null) return false;
    if (this.isLoading()) return false;
    return !this.communities().includes(selected);
  });

  /**
   * Resolved display names for community IDs, populated by the parent shell after
   * fetching organizer documents. Keyed by Id<'organizers'>.
   */
  private readonly _resolvedNames = signal<Map<string, string>>(new Map());

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

  resolvedNameFor(id: Id<'organizers'>): string | null {
    return this._resolvedNames().get(id) ?? null;
  }
}
