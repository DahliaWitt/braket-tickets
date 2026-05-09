import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {BraCommunityAvatarComponent} from './community-avatar.component';
import {BraCommunityAvatarHarness} from './community-avatar.harness';

@Component({
  template: '',
  imports: [BraCommunityAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {}

describe('BraCommunityAvatarComponent', () => {
  async function setup(template: string) {
    TestBed.configureTestingModule({imports: [TestHostComponent]});
    TestBed.overrideComponent(TestHostComponent, {set: {template}});
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const harness = await loader.getHarness(BraCommunityAvatarHarness);
    return {fixture, harness};
  }

  it('should show fallback initial when no logoUrl', async () => {
    const {harness} = await setup(`<bra-community-avatar name="Braket" />`);
    expect(await harness.hasImage()).toBe(false);
    expect(await harness.getInitialText()).toBe('B');
  });

  it('should show image when logoUrl is provided', async () => {
    const {harness} = await setup(
      `<bra-community-avatar name="Braket" logoUrl="https://example.com/logo.png" />`,
    );
    expect(await harness.hasImage()).toBe(true);
    expect(await harness.getImageSrc()).toBe('https://example.com/logo.png');
    expect(await harness.getImageAlt()).toBe('Braket logo');
  });

  it('should show fallback when logoUrl is null', async () => {
    const {harness} = await setup(
      `<bra-community-avatar name="Test" [logoUrl]="null" />`,
    );
    expect(await harness.hasImage()).toBe(false);
    expect(await harness.getInitialText()).toBe('T');
  });

  it('should expose size via data attribute', async () => {
    const {harness} = await setup(
      `<bra-community-avatar name="X" size="lg" />`,
    );
    expect(await harness.getSize()).toBe('lg');
  });

  it('should default to md size', async () => {
    const {harness} = await setup(`<bra-community-avatar name="X" />`);
    expect(await harness.getSize()).toBe('md');
  });

  it('should handle empty name gracefully', async () => {
    const {harness} = await setup(`<bra-community-avatar name=" " />`);
    expect(await harness.getInitialText()).toBe('?');
  });
});
