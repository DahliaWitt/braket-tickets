import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-dev-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!environment.production) {
      <div
        data-testid="dev-overlay"
        class="fixed bottom-3 left-3 z-40 flex items-center gap-1.5 rounded-full border border-accent/30 px-2.5 py-1 font-mono text-[11px] shadow-lg select-none cursor-pointer transition-colors"
        [class.bg-black/80]="!isLocal()"
        [class.bg-accent]="isLocal()"
        role="button"
        tabindex="0"
        (click)="expanded.set(!expanded())"
        (keydown.enter)="expanded.set(!expanded())"
        (keydown.space)="expanded.set(!expanded())"
        [title]="expanded() ? 'Click to minimize' : 'Dev build overlay — click to expand'"
      >
        <span [class]="'inline-block size-2 rounded-full animate-pulse ' + dotColor()"></span>
        <span [class]="'font-semibold uppercase tracking-wider ' + labelColor()">{{
          label()
        }}</span>
        @if (expanded()) {
          <span [class]="isLocal() ? 'text-black/60' : 'text-muted-foreground'">|</span>
          <span [class]="isLocal() ? 'text-black/80' : 'text-foreground/70'">{{
            environment.build.branch
          }}</span>
          <span [class]="isLocal() ? 'text-black/60' : 'text-muted-foreground'">&#64;</span>
          <span [class]="isLocal() ? 'text-black/80' : 'text-foreground/70'">{{
            environment.build.commitHash
          }}</span>
        }
      </div>
    }
  `,
})
export class DevOverlayComponent {
  readonly environment = environment;
  private readonly platformId = inject(PLATFORM_ID);
  readonly expanded = signal(false);

  readonly isLocal = computed(() => {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  });

  readonly label = computed(() => (this.isLocal() ? 'Local' : 'Dev'));
  readonly dotColor = computed(() => (this.isLocal() ? 'bg-black' : 'bg-accent'));
  readonly labelColor = computed(() => (this.isLocal() ? 'text-gray-950' : 'text-accent'));
}
