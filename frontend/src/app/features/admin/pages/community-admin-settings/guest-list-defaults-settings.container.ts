import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {injectConvex, injectQuery, skipToken} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {extractErrorMessage} from '@/core/utils/error-message.utils';
import {logger} from '@/utils/logger';
import {toast} from 'ngx-sonner';
import {
  GuestListDefaultsSettingsComponent,
  type GuestListDefaultValues,
} from './guest-list-defaults-settings.component';

type GuestListSettings = FunctionReturnType<
  typeof api.communities.management.guest_list_settings.get
>;
type UpdateGuestListSettingsArgs = FunctionArgs<
  typeof api.communities.management.guest_list_settings.update
>;

function isGuestListSettings(value: unknown): value is GuestListSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.artistSlots === 'number' &&
    typeof candidate.staffSlots === 'number'
  );
}

@Component({
  selector: 'app-guest-list-defaults-settings-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GuestListDefaultsSettingsComponent],
  template: `
    @if (settingsError()) {
      <p
        role="alert"
        data-testid="guest-list-defaults-error"
        class="border-t border-border p-6 text-sm text-destructive-text"
      >
        Guest list defaults couldn't load. Refresh the page to try again.
      </p>
    } @else if (settings(); as loadedSettings) {
      <app-guest-list-defaults-settings
        [artistSlots]="loadedSettings.artistSlots"
        [staffSlots]="loadedSettings.staffSlots"
        [saving]="saving()"
        (save)="save($event)"
      />
    } @else {
      <p
        role="status"
        data-testid="guest-list-defaults-loading"
        class="border-t border-border p-6 font-mono text-xs text-muted-foreground"
      >
        Loading guest list defaults…
      </p>
    }
  `,
})
export class GuestListDefaultsSettingsContainer {
  private readonly convex = injectConvex();
  private readonly communityContext = inject(CommunityContextService);
  readonly saving = signal(false);
  private readonly settingsQuery = injectQuery(
    api.communities.management.guest_list_settings.get,
    () => {
      const organizerId = this.communityContext.selectedCommunityId();
      return organizerId ? {organizerId} : skipToken;
    },
  );
  readonly settings = computed<GuestListSettings | null>(() => {
    const result: unknown = this.settingsQuery.data();
    return isGuestListSettings(result) ? result : null;
  });
  readonly settingsError = computed(() => this.settingsQuery.error() != null);

  async save(values: GuestListDefaultValues): Promise<void> {
    const organizerId = this.communityContext.selectedCommunityId();
    if (!organizerId || !this.settings()) return;
    const args: UpdateGuestListSettingsArgs = {organizerId, ...values};
    this.saving.set(true);
    try {
      await this.convex.mutation(
        api.communities.management.guest_list_settings.update,
        args,
      );
      toast.success('Guest list defaults saved');
    } catch (error) {
      logger.error('Failed to save guest list defaults', error);
      toast.error(
        extractErrorMessage(error) || 'Failed to save guest list defaults',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
