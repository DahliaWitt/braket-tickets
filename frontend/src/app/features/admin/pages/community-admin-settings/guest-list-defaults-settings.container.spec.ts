import '../../../../../test-setup';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {CONVEX} from 'convex-angular';
import {describe, expect, it, vi} from 'vitest';
import type {Id} from '@convex/_generated/dataModel';
import {createMockConvexClient} from '@/testing/mock-types';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {GuestListDefaultsSettingsContainer} from './guest-list-defaults-settings.container';
import {GuestListDefaultsSettingsContainerHarness} from './guest-list-defaults-settings.container.harness';

async function setup(mode: 'loading' | 'error' | 'ready') {
  const convex = createMockConvexClient();
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        onData: (value: unknown) => void,
        onError: (error: Error) => void,
      ) => {
        if (mode === 'ready') {
          queueMicrotask(() => onData({artistSlots: 7, staffSlots: 3}));
        } else if (mode === 'error') {
          queueMicrotask(() => onError(new Error('network')));
        }
        return () => undefined;
      },
    );
  convex.client.onUpdate = onUpdate;
  convex.onUpdate = onUpdate;
  convex.mutation.mockResolvedValue(null);
  const selectedCommunityId = signal<Id<'organizers'> | null>(
    'organizer-1' as Id<'organizers'>,
  );
  await TestBed.configureTestingModule({
    imports: [GuestListDefaultsSettingsContainer],
    providers: [
      provideZonelessChangeDetection(),
      {provide: CONVEX, useValue: convex},
      {
        provide: CommunityContextService,
        useValue: {selectedCommunityId},
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(GuestListDefaultsSettingsContainer);
  await fixture.whenStable();
  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    GuestListDefaultsSettingsContainerHarness,
  );
  return {convex, harness};
}

describe('GuestListDefaultsSettingsContainer', () => {
  it('does not expose a save form while defaults are loading', async () => {
    const {harness} = await setup('loading');

    expect(await harness.getState()).toBe('loading');
    expect(await harness.getSettings()).toBeNull();
  });

  it('shows a load error without exposing fallback defaults', async () => {
    const {harness} = await setup('error');

    expect(await harness.getState()).toBe('error');
    expect(await harness.getSettings()).toBeNull();
  });

  it('renders the server defaults only after they load', async () => {
    const {harness} = await setup('ready');

    expect(await harness.getState()).toBe('ready');
    const settings = await harness.getSettings();
    expect(await settings?.getArtistSlots()).toBe('7');
    expect(await settings?.getStaffSlots()).toBe('3');
  });
});
