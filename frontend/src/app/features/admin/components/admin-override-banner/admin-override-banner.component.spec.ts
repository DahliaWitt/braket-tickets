import '../../../../../test-setup';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { describe, it, expect } from 'vitest';
import { AdminOverrideBannerComponent } from './admin-override-banner.component';
import { AdminOverrideBannerHarness } from './admin-override-banner.component.harness';

// ---------------------------------------------------------------------------
// Test host
// ---------------------------------------------------------------------------

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [AdminOverrideBannerComponent],
  template: `
    <app-admin-override-banner [isOverride]="isOverride()" [communityName]="communityName()" />
  `,
})
class TestHostComponent {
  readonly isOverride = signal(false);
  readonly communityName = signal('Test Community');
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

async function setup(options: {
  isOverride?: boolean;
  communityName?: string;
}): Promise<{ fixture: ComponentFixture<TestHostComponent>; harness: AdminOverrideBannerHarness }> {
  await TestBed.configureTestingModule({
    imports: [TestHostComponent],
    providers: [provideZonelessChangeDetection(), provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHostComponent);
  fixture.componentInstance.isOverride.set(options.isOverride ?? false);
  fixture.componentInstance.communityName.set(options.communityName ?? 'Test Community');
  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    AdminOverrideBannerHarness,
  );

  return { fixture, harness };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminOverrideBannerComponent', () => {
  it('isVisible() returns false when isOverride is false', async () => {
    const { harness } = await setup({ isOverride: false });
    expect(await harness.isVisible()).toBe(false);
  });

  it('isVisible() returns true when isOverride is true', async () => {
    const { harness } = await setup({ isOverride: true });
    expect(await harness.isVisible()).toBe(true);
  });

  it('getCommunityNameText() returns the community name', async () => {
    const { harness } = await setup({ isOverride: true, communityName: 'Acid House Collective' });
    expect((await harness.getCommunityNameText()).trim()).toBe('Acid House Collective');
  });

  it('getPortalLinkHref() returns /admin/communities', async () => {
    const { harness } = await setup({ isOverride: true });
    expect(await harness.getPortalLinkHref()).toBe('/admin/communities');
  });

  it('defaults to hidden (loading state behavior)', async () => {
    // isOverride starts as false (default) — banner should not be visible.
    // This documents that the loading state (where isMemberOf returns undefined)
    // correctly maps to isOverride=false in the parent component, since
    // undefined === false evaluates to false, keeping the banner hidden.
    const { harness } = await setup({});
    expect(await harness.isVisible()).toBe(false);
  });
});
