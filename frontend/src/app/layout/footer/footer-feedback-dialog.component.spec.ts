import {type HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {Router, provideRouter} from '@angular/router';
import {vi} from 'vitest';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';

import {AnalyticsService} from '@/core/services/analytics.service';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BraToastService} from '@ui/components/composites/toast/toast.service';
import {FooterFeedbackDialogComponent} from './footer-feedback-dialog.component';
import {FooterFeedbackDialogHarness} from './footer-feedback-dialog.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class HelpStubComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-footer-feedback-dialog />',
  imports: [FooterFeedbackDialogComponent],
})
class HostComponent {}

describe('FooterFeedbackDialogComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let harness: FooterFeedbackDialogHarness;
  let loader: HarnessLoader;
  let analyticsMock: {captureFeedback: ReturnType<typeof vi.fn>};
  let dialogRefMock: {close: ReturnType<typeof vi.fn>};
  let toastMock: {success: ReturnType<typeof vi.fn>};
  let router: Router;

  beforeEach(async () => {
    analyticsMock = {
      captureFeedback: vi.fn(),
    };
    dialogRefMock = {
      close: vi.fn(),
    };
    toastMock = {
      success: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{path: 'help', component: HelpStubComponent}]),
        {provide: AnalyticsService, useValue: analyticsMock},
        {provide: BraDialogRef, useValue: dialogRefMock},
        {provide: BraToastService, useValue: toastMock},
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    await router.navigateByUrl('/help');

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(FooterFeedbackDialogHarness);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures feedback and closes when submit is pressed', async () => {
    await harness.clickCategory('feature_request');
    await harness.setMessage('Add a keyboard shortcut for admin search');
    expect(await harness.submitDisabled()).toBe(false);
    await harness.clickSubmit();

    expect(analyticsMock.captureFeedback).toHaveBeenCalledWith({
      category: 'feature_request',
      message: 'Add a keyboard shortcut for admin search',
      route: '/help',
    });
    expect(dialogRefMock.close).toHaveBeenCalledOnce();
    expect(toastMock.success).toHaveBeenCalledWith('Thanks for the feedback.');
  });

  it('keeps category optional and toggles the selected chip off', async () => {
    await harness.clickCategory('bug');
    expect(await harness.isCategorySelected('bug')).toBe(true);
    expect(await harness.categoryVariant('bug')).toBe('outline');
    expect(await harness.hasCategorySelectedState('bug')).toBe(true);
    const selectedClasses = await harness.categoryClasses('bug');
    expect(selectedClasses).toContain('hover:bg-primary');
    expect(selectedClasses).toContain('hover:text-primary-foreground');
    expect(selectedClasses).toContain('data-selected:bg-primary');
    expect(selectedClasses).toContain('data-selected:text-primary-foreground');
    expect(selectedClasses).not.toContain('hover:bg-accent');
    expect(selectedClasses).not.toContain('hover:text-accent-foreground');

    await harness.clickCategory('bug');
    expect(await harness.isCategorySelected('bug')).toBe(false);
    expect(await harness.categoryVariant('bug')).toBe('outline');
    expect(await harness.hasCategorySelectedState('bug')).toBe(false);

    await harness.setMessage('Bug report is intermittent on mobile Safari.');
    await harness.clickSubmit();

    expect(analyticsMock.captureFeedback).toHaveBeenCalledWith({
      category: null,
      message: 'Bug report is intermittent on mobile Safari.',
      route: '/help',
    });
  });
});
