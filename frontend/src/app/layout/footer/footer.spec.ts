import {describe, it, expect, beforeEach, vi} from 'vitest';
import {type HarnessLoader} from '@angular/cdk/testing';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {FooterComponent} from './footer';
import {FooterHarness} from './footer.harness';
import {BraToastService} from '@ui/components/composites/toast/toast.service';
import {FeedbackService} from '@/core/services/feedback.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-footer />',
  imports: [FooterComponent],
})
class FooterHostComponent {}

describe('FooterComponent', () => {
  let fixture: ComponentFixture<FooterHostComponent>;
  let harness: FooterHarness;
  let loader: HarnessLoader;
  const feedbackServiceMock = {
    open: vi.fn(),
  };
  const toastMock = {
    error: vi.fn(),
  };

  beforeEach(async () => {
    feedbackServiceMock.open.mockReset();
    feedbackServiceMock.open.mockResolvedValue(true);
    toastMock.error.mockReset();

    await TestBed.configureTestingModule({
      imports: [FooterHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: FeedbackService, useValue: feedbackServiceMock},
        {provide: BraToastService, useValue: toastMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FooterHostComponent);
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(FooterHarness);
  });

  it('should wrap links in a nav landmark with aria-label', async () => {
    expect(await harness.hasFooterLandmark()).toBe(true);
  });

  it('does not render a help link', async () => {
    expect(await harness.getNavText()).not.toContain('Help');
  });

  it('opens the Sentry feedback form', async () => {
    await harness.clickFeedback();

    expect(feedbackServiceMock.open).toHaveBeenCalledOnce();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('shows a toast when Sentry feedback is unavailable', async () => {
    feedbackServiceMock.open.mockResolvedValueOnce(false);

    await harness.clickFeedback();

    await vi.waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'feedback is unavailable right now',
      ),
    );
  });

  it('shows a toast when Sentry feedback throws', async () => {
    feedbackServiceMock.open.mockRejectedValueOnce(
      new Error('feedback failed'),
    );

    await harness.clickFeedback();

    await vi.waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'feedback is unavailable right now',
      ),
    );
  });
});
