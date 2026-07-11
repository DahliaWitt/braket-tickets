import {
  Component,
  inject,
  signal,
  computed,
  linkedSignal,
  resource,
  ChangeDetectionStrategy,
} from '@angular/core';
import {ActivatedRoute, RouterLink, type Params} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {toast} from 'ngx-sonner';
import {readInputChecked} from '@ui/utils/dom-event';
import {
  type CommunityPref,
  type PreferencesResponse,
  UnsubscribePreferencesService,
} from './unsubscribe-preferences.service';

@Component({
  selector: 'app-unsubscribe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ContentLayoutComponent,
    ZardButtonComponent,
    ZardSkeletonComponent,
  ],
  template: `
    <app-content-layout>
      <div class="ph-no-capture mx-auto w-full max-w-2xl py-8 md:py-10">
        <div class="mb-8">
          <h1
            class="font-display text-2xl font-bold tracking-tight text-foreground uppercase"
          >
            Email Preferences
          </h1>
        </div>

        @if (hasError()) {
          <div
            data-testid="unsub-error"
            class="space-y-4 rounded-lg border border-destructive/30 p-6"
          >
            <p
              class="font-mono text-sm tracking-widest text-destructive-text uppercase"
            >
              Invalid unsubscribe link
            </p>
            <p class="text-sm text-muted-foreground">
              This link may have expired or already been used. Sign in to
              manage your preferences, or contact support if you need help.
            </p>
            <a
              routerLink="/account"
              fragment="email-preferences"
              class="inline-block font-mono text-sm text-primary underline"
            >
              Manage preferences in your account settings &rarr;
            </a>
            <a
              href="mailto:contact@braket.gay?subject=Unsubscribe%20help"
              class="block font-mono text-sm text-primary underline"
              data-testid="unsub-support-link"
            >
              Email support &rarr;
            </a>
          </div>
        } @else if (preferencesLoading()) {
          <div data-testid="unsub-loading" class="space-y-3" aria-hidden="true">
            <z-skeleton class="h-16 w-full" />
            <z-skeleton class="h-14 w-full" />
            <z-skeleton class="h-14 w-full" />
          </div>
        } @else if (loadFailed()) {
          <div
            data-testid="unsub-load-error"
            class="space-y-4 rounded-lg border border-destructive/30 p-6"
          >
            <p
              class="font-mono text-sm tracking-widest text-destructive-text uppercase"
            >
              couldn't load your preferences
            </p>
            <p class="text-sm text-muted-foreground">
              something went wrong on our end — your link is still good. try
              again in a moment.
            </p>
            <button
              type="button"
              z-button
              zType="outline"
              zSize="sm"
              (click)="retryLoad()"
              data-testid="unsub-retry-btn"
            >
              try again
            </button>
          </div>
        } @else if (initialPreferences()) {
          <div data-testid="unsub-confirmation" class="space-y-6">
            @if (isDone()) {
              @if (unsubscribedFrom()) {
                <div
                  class="rounded-lg border border-success/30 bg-success/10 p-4"
                >
                  <p class="font-sans text-sm text-foreground">
                    You've been unsubscribed from
                    <strong data-testid="unsub-org-name">{{
                      unsubscribedFrom()!.organizerName
                    }}</strong
                    >.
                  </p>
                  <p class="mt-1 font-sans text-sm text-muted-foreground">
                    You'll still receive transactional emails for tickets
                    you've purchased.
                  </p>
                </div>
              } @else {
                <div
                  class="rounded-lg border border-success/30 bg-success/10 p-4"
                >
                  <p class="font-sans text-sm text-foreground">
                    You've been unsubscribed from marketing emails.
                  </p>
                </div>
              }
            } @else {
              <div
                class="rounded-lg border border-secondary/30 bg-secondary/10 p-4"
                data-testid="unsub-preferences-intro"
              >
                <p class="font-sans text-sm text-foreground">
                  Manage your email preferences below. Changes only affect
                  marketing email; ticket and account emails still go through.
                </p>
              </div>
            }

            @if (globalMarketingOptOut()) {
              <div
                class="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
                data-testid="global-optout-banner"
              >
                <p class="font-medium">
                  You've unsubscribed from eligible communities.
                </p>
                <p class="mt-1">
                  To re-enable marketing emails, visit your
                  <a
                    routerLink="/account"
                    fragment="email-preferences"
                    class="underline"
                    >account settings</a
                  >.
                </p>
              </div>
            }

            @if (otherOptedIn().length > 0) {
              <div class="space-y-3">
                <p class="mono-label text-2xs text-muted-foreground">
                  Other communities you're opted in to
                </p>
                <div class="space-y-2" data-testid="other-prefs-list">
                  @for (pref of preferences(); track pref.organizerId) {
                    @if (pref.optedIn) {
                      <div
                        class="flex items-center justify-between rounded-lg border border-border/50 bg-muted/40 p-3"
                      >
                        <span class="font-sans text-sm text-foreground">{{
                          pref.organizerName
                        }}</span>
                        <label
                          class="flex min-h-11 cursor-pointer items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            [checked]="pref.optedIn"
                            [disabled]="
                              pref.isAdmin ||
                              pendingToggles().has(pref.organizerId)
                            "
                            (change)="onTogglePref($event, pref.organizerId)"
                            class="h-6 w-6 accent-primary"
                            [attr.data-testid]="
                              'pref-toggle-' + pref.organizerId
                            "
                            [attr.aria-label]="
                              'Marketing emails from ' + pref.organizerName
                            "
                          />
                          <span
                            class="font-mono text-2xs text-muted-foreground uppercase"
                            >{{ pref.isAdmin ? 'ADMIN' : 'ON' }}</span
                          >
                        </label>
                      </div>
                    }
                  }
                </div>
              </div>
            }

            @if (hasAnyOptedIn()) {
              <button
                type="button"
                z-button
                zType="ghost"
                zSize="sm"
                (click)="unsubscribeAll()"
                [zLoading]="unsubAllLoading()"
                class="text-destructive-text hover:text-destructive-text"
                data-testid="unsub-all-btn"
              >
                Unsubscribe from eligible communities
              </button>
            }
          </div>
        }
      </div>
    </app-content-layout>
  `,
})
export class UnsubscribeComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly preferencesService = inject(UnsubscribePreferencesService);
  private readonly queryParams = toSignal(this.route.queryParams, {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- types the signal as Params so queryParams()['token'|'error'|'done'] index access typechecks (ng build)
    initialValue: {} as Params,
  });

  readonly isDone = computed(() => this.queryParams()['done'] === 'true');
  readonly token = computed(() => {
    const token: unknown = this.queryParams()['token'];
    return typeof token === 'string' ? token : undefined;
  });

  private readonly preferencesResource = resource({
    params: () => {
      const token = this.token();
      return token ? {token} : undefined;
    },
    loader: async ({params}): Promise<PreferencesResponse | null> => {
      if (!params?.token) return null;

      return this.preferencesService.loadPreferences(params.token);
    },
  });

  readonly initialPreferences = computed(
    () => safeResourceValue(this.preferencesResource) ?? null,
  );
  readonly preferencesLoading = computed(() =>
    this.preferencesResource.isLoading(),
  );
  /**
   * Transient fetch failure (network, 5xx, bad payload). The token itself
   * may be perfectly valid, so this branches into a retry state instead of
   * the invalid-link state.
   */
  readonly loadFailed = computed(
    () => this.preferencesResource.error() !== undefined,
  );
  readonly hasError = computed(() => {
    if (this.queryParams()['error']) return true;
    if (!this.token()) return true;
    if (this.preferencesLoading() || this.loadFailed()) return false;
    return !this.initialPreferences();
  });

  readonly unsubscribedFrom = linkedSignal<{
    organizerName: string;
    organizerId: string;
  } | null>(() => this.initialPreferences()?.unsubscribedFrom ?? null);
  readonly preferences = linkedSignal<CommunityPref[]>(() => {
    const data = this.initialPreferences();
    if (!data) return [];
    return data.preferences.filter(
      (pref) => pref.organizerId !== data.unsubscribedFrom?.organizerId,
    );
  });
  readonly globalMarketingOptOut = linkedSignal(
    () => this.initialPreferences()?.globalMarketingOptOut ?? false,
  );
  readonly otherOptedIn = computed(() =>
    this.preferences().filter((p) => p.optedIn),
  );
  readonly hasAnyOptedIn = computed(() =>
    this.preferences().some((p) => p.optedIn && !p.isAdmin),
  );
  readonly unsubAllLoading = signal(false);
  readonly pendingToggles = signal<ReadonlySet<string>>(new Set<string>());

  retryLoad(): void {
    this.preferencesResource.reload();
  }

  onTogglePref(event: Event, organizerId: string): void {
    const checked = readInputChecked(event.target);
    if (checked === null) return;
    const input =
      event.target instanceof HTMLInputElement ? event.target : null;
    void this.togglePref(organizerId, checked, input);
  }

  async togglePref(
    organizerId: string,
    optedIn: boolean,
    input: HTMLInputElement | null = null,
  ): Promise<void> {
    const token = this.token();
    if (!token) return;
    if (this.pendingToggles().has(organizerId)) return;
    const pref = this.preferences().find((p) => p.organizerId === organizerId);
    if (pref?.isAdmin && !optedIn) return;
    this.pendingToggles.update((pending) => new Set(pending).add(organizerId));
    try {
      await this.preferencesService.togglePreference(
        token,
        organizerId,
        optedIn,
      );
      this.preferences.update((prefs) =>
        prefs.map((p) => (p.organizerId === organizerId ? {...p, optedIn} : p)),
      );
    } catch (err) {
      logger.error('Failed to toggle preference', err);
      // Zoneless change detection will not rewrite the native checkbox: the
      // [checked] binding value never changed, so reset it by hand to keep
      // the box in sync with server state.
      if (input) input.checked = !optedIn;
      toast.error("couldn't update preference, try again");
    } finally {
      this.pendingToggles.update((pending) => {
        const next = new Set(pending);
        next.delete(organizerId);
        return next;
      });
    }
  }

  async unsubscribeAll(): Promise<void> {
    const token = this.token();
    if (!token) return;
    this.unsubAllLoading.set(true);
    try {
      await this.preferencesService.unsubscribeAll(token);
      this.preferences.update((prefs) =>
        prefs.map((p) => (p.isAdmin ? p : {...p, optedIn: false})),
      );
      toast.success('unsubscribed from eligible communities');
    } catch (err) {
      logger.error('Failed to unsubscribe all', err);
      toast.error("couldn't unsubscribe, try again");
    } finally {
      this.unsubAllLoading.set(false);
    }
  }
}
