import {type HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {vi} from 'vitest';
import {ZardButtonComponentHarness} from './button.component.harness';
import {ZardButtonComponent} from './button.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" z-button>Default</button>
    <button type="button" z-button [zDisabled]="true">Disabled</button>
    <button type="button" z-button [zLoading]="true">Loading</button>
  `,
  imports: [ZardButtonComponent],
})
class TestHostComponent {}

describe('ZardButtonComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, ZardButtonComponent],
      providers: [],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should have text', async () => {
    const button = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Default'}),
    );
    expect(await button.getText()).toContain('Default');
  });

  it('should be disabled', async () => {
    const button = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Disabled'}),
    );
    expect(await button.isDisabled()).toBe(true);
  });

  it('should show loading spinner, mark busy, and disable when loading', async () => {
    const button = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Loading'}),
    );
    expect(await button.isLoading()).toBe(true);
    expect(await button.getAriaBusy()).toBe('true');
    expect(await button.isDisabled()).toBe(true);
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-button id="custom-btn" (click)="onClick()">Custom</z-button>
    <a id="link-btn" z-button href="/events/test-id-123">Link</a>
    <a
      id="disabled-link-btn"
      z-button
      href="/events/disabled"
      [zDisabled]="true"
      (click)="onDisabledLinkClick()"
      >Disabled Link</a
    >
    <a
      id="loading-link-btn"
      z-button
      href="/events/loading"
      [zLoading]="true"
      (click)="onLoadingLinkClick()"
      >Loading Link</a
    >
  `,
  imports: [ZardButtonComponent],
})
class CustomButtonTestHostComponent {
  onClick = vi.fn();
  onDisabledLinkClick = vi.fn();
  onLoadingLinkClick = vi.fn();
}

describe('ZardButtonComponent (Custom Element)', () => {
  let fixture: ComponentFixture<CustomButtonTestHostComponent>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomButtonTestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomButtonTestHostComponent);
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should handle Enter key to trigger click', async () => {
    const button = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Custom'}),
    );
    await button.keydown('Enter');
    expect(fixture.componentInstance.onClick).toHaveBeenCalledTimes(1);
  });

  it('should handle Space key to trigger click', async () => {
    const button = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Custom'}),
    );
    await button.keydown(' ');
    expect(fixture.componentInstance.onClick).toHaveBeenCalledTimes(1);
  });

  it('preserves native link semantics for anchor buttons', async () => {
    const link = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Link'}),
    );

    expect(await link.getRole()).toBeNull();
    expect(await link.getTabIndex()).toBeNull();
    expect(await link.getHref()).toBe('/events/test-id-123');
  });

  it('keeps disabled anchor buttons out of navigation and the tab order', async () => {
    const link = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Disabled Link'}),
    );

    expect(await link.getRole()).toBeNull();
    expect(await link.getAriaDisabled()).toBe('true');
    expect(await link.getTabIndex()).toBe('-1');
    expect(await link.isDisabled()).toBe(true);

    await link.click();

    expect(
      fixture.componentInstance.onDisabledLinkClick,
    ).not.toHaveBeenCalled();
  });

  it('keeps loading anchor buttons out of navigation and the tab order', async () => {
    const link = await loader.getHarness(
      ZardButtonComponentHarness.with({text: 'Loading Link'}),
    );

    expect(await link.getRole()).toBeNull();
    expect(await link.getAriaDisabled()).toBe('true');
    expect(await link.getTabIndex()).toBe('-1');
    expect(await link.isDisabled()).toBe(true);

    await link.click();

    expect(fixture.componentInstance.onLoadingLinkClick).not.toHaveBeenCalled();
  });
});
