import {type HarnessLoader} from '@angular/cdk/testing';
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {OverlayModule} from '@angular/cdk/overlay';
import {PortalModule} from '@angular/cdk/portal';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {FooterComponent} from './footer';
import {FooterHarness} from './footer.harness';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {FooterFeedbackDialogComponent} from './footer-feedback-dialog.component';
import {FooterFeedbackDialogHarness} from './footer-feedback-dialog.component.harness';
import {type BraDialogOptions} from '@ui/components/composites/dialog/dialog.component';
import {BraDialogComponentHarness} from '@ui/components/composites/dialog/dialog.harness';
import {AnalyticsService} from '@/core/services/analytics.service';

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
  const dialogServiceMock = {
    create: vi.fn<(config: BraDialogOptions<unknown, unknown>) => void>(),
  };

  beforeEach(async () => {
    dialogServiceMock.create.mockReset();

    await TestBed.configureTestingModule({
      imports: [FooterHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: BraDialogService, useValue: dialogServiceMock},
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

  it('opens the feedback dialog with the correct config', async () => {
    await harness.clickFeedback();

    expect(dialogServiceMock.create).toHaveBeenCalledOnce();
    const [config] = dialogServiceMock.create.mock.calls[0] ?? [];
    expect(config).toMatchObject({
      zTitle: 'Feedback',
      zDescription: 'Tell us what happened or what you want to see next.',
      zContent: FooterFeedbackDialogComponent,
      zHideFooter: true,
      zMaskClosable: false,
      zWidth: 'min(32rem, calc(100vw - 2rem))',
    });
  });
});

describe('FooterComponent feedback overlay', () => {
  let fixture: ComponentFixture<FooterHostComponent>;
  let harness: FooterHarness;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FooterHostComponent, OverlayModule, PortalModule],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: AnalyticsService, useValue: {captureFeedback: vi.fn()}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FooterHostComponent);
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(FooterHarness);
  });

  it('renders the feedback dialog through the real overlay service', async () => {
    await harness.clickFeedback();

    const documentLoader =
      TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await documentLoader.getHarness(BraDialogComponentHarness);
    const feedbackDialog = await documentLoader.getHarness(
      FooterFeedbackDialogHarness,
    );

    expect(await dialog.getTitleText()).toBe('Feedback');
    expect(await feedbackDialog.submitDisabled()).toBe(true);
  });
});
