import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { OfflineBannerComponent } from './offline-banner.component';

function forceOfflineBannerState(online: boolean): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const navigatorLike = window.navigator as Navigator & Record<string, unknown>;
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigatorLike, 'onLine');

  try {
    Object.defineProperty(navigatorLike, 'onLine', {
      configurable: true,
      get: () => online,
    });
  } catch {
    return () => undefined;
  }

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(navigatorLike, 'onLine', originalDescriptor);
      return;
    }

    Reflect.deleteProperty(navigatorLike, 'onLine');
  };
}

@Component({
  selector: 'storybook-offline-banner-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OfflineBannerComponent],
  template: `
    <div class="min-h-[240px] overflow-hidden rounded-xl border border-border bg-card p-6">
      <app-offline-banner />

      <div class="space-y-3 pt-8">
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          Network state
        </p>
        <h2 class="font-display text-2xl font-bold">
          Queued writes stay visible while the connection is down.
        </h2>
        <p class="max-w-md text-sm text-muted-foreground font-sans">
          The banner is fixed to the top of the viewport in the live app, so this preview keeps some
          content underneath it to show the overlay behavior.
        </p>
      </div>
    </div>
  `,
})
class OfflineBannerStoryShell {
  constructor() {
    const restoreOnlineState = forceOfflineBannerState(false);
    inject(DestroyRef).onDestroy(restoreOnlineState);
  }
}

const meta: Meta<OfflineBannerComponent> = {
  title: 'Braket/Primitives/OfflineBanner',
  component: OfflineBannerComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Offline banner is an app-proven primitive that communicates network loss and queued writes. The story keeps underlying content visible so the fixed overlay behavior reads the way it does in the live app.',
      },
    },
  },
  render: () => ({
    template: `<storybook-offline-banner-shell />`,
  }),
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        imports: [OfflineBannerStoryShell],
      },
    }),
  ],
};

export default meta;
type Story = StoryObj<OfflineBannerComponent>;

export const Offline: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'App-proven offline state with content underneath the banner, matching the way the product preserves context while network requests are queued.',
      },
    },
  },
};
