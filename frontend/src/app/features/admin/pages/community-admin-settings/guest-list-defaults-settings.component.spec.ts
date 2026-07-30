import '../../../../../test-setup';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {GuestListDefaultsSettingsComponent} from './guest-list-defaults-settings.component';
import {GuestListDefaultsSettingsHarness} from './guest-list-defaults-settings.component.harness';

describe('GuestListDefaultsSettingsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuestListDefaultsSettingsComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('shows the effective two-slot defaults and snapshot help', async () => {
    const fixture = TestBed.createComponent(GuestListDefaultsSettingsComponent);
    fixture.componentRef.setInput('artistSlots', 2);
    fixture.componentRef.setInput('staffSlots', 2);
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListDefaultsSettingsHarness,
    );

    expect(await harness.getArtistSlots()).toBe('2');
    expect(await harness.getStaffSlots()).toBe('2');
    expect(await harness.getHelpText()).toBe(
      'Defaults are copied when a person is assigned. Changing a default affects future assignments only. Existing event assignments keep their current grant.',
    );
    expect(await harness.getHelpAriaDescribedBy()).toBe(
      'guest-list-defaults-help-text',
    );
  });

  it('emits both saved defaults as non-negative integers', async () => {
    const fixture = TestBed.createComponent(GuestListDefaultsSettingsComponent);
    fixture.componentRef.setInput('artistSlots', 2);
    fixture.componentRef.setInput('staffSlots', 2);
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListDefaultsSettingsHarness,
    );
    const saved = vi.fn();
    fixture.componentInstance.save.subscribe(saved);

    await harness.setArtistSlots('4');
    await harness.setStaffSlots('1');
    await harness.clickSave();

    expect(saved).toHaveBeenCalledWith({artistSlots: 4, staffSlots: 1});
  });

  it('preserves unsaved edits until a default input actually changes', async () => {
    const fixture = TestBed.createComponent(GuestListDefaultsSettingsComponent);
    fixture.componentRef.setInput('artistSlots', 2);
    fixture.componentRef.setInput('staffSlots', 2);
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListDefaultsSettingsHarness,
    );

    await harness.setArtistSlots('7');
    await fixture.whenStable();

    expect(await harness.getArtistSlots()).toBe('7');
    expect(await harness.getStaffSlots()).toBe('2');

    fixture.componentRef.setInput('staffSlots', 4);
    await fixture.whenStable();

    expect(await harness.getArtistSlots()).toBe('2');
    expect(await harness.getStaffSlots()).toBe('4');
  });
});
