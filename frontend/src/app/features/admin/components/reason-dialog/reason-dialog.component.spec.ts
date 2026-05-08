import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {ReasonDialogComponent} from './reason-dialog.component';
import {ReasonDialogHarness} from './reason-dialog.harness';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {describe, it, expect, beforeEach} from 'vitest';

describe('ReasonDialogComponent', () => {
  let fixture: ComponentFixture<ReasonDialogComponent>;
  let component: ReasonDialogComponent;
  let harness: ReasonDialogHarness;

  async function createComponent(visibilityLabel: string) {
    await TestBed.configureTestingModule({
      imports: [ReasonDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BRA_MODAL_DATA, useValue: {visibilityLabel}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReasonDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ReasonDialogHarness,
    );
  }

  beforeEach(async () => {
    await createComponent('VISIBLE TO THE APPLICANT');
  });

  it('should render the textarea', async () => {
    const reason = await harness.getReason();
    expect(reason).toBe('');
  });

  it('should render the label', async () => {
    const label = await harness.getLabelText();
    expect(label).toContain('Reason');
  });

  it('should show the visibility label in helper text', async () => {
    const label = await harness.getVisibilityLabel();
    expect(label).toBe('VISIBLE TO THE APPLICANT');
  });

  it('should update the reason signal when input changes', async () => {
    await harness.setReason('This is the reason');
    fixture.detectChanges();
    expect(component.reason()).toBe('This is the reason');
  });

  it('should start with an empty reason signal', () => {
    expect(component.reason()).toBe('');
  });

  describe('with VISIBLE TO THE MEMBER label', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule();
      await createComponent('VISIBLE TO THE MEMBER');
    });

    it('should show "VISIBLE TO THE MEMBER" in helper text', async () => {
      const label = await harness.getVisibilityLabel();
      expect(label).toBe('VISIBLE TO THE MEMBER');
    });
  });
});

describe('ReasonDialogHarness', () => {
  let fixture: ComponentFixture<ReasonDialogComponent>;
  let harness: ReasonDialogHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReasonDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: BRA_MODAL_DATA,
          useValue: {visibilityLabel: 'VISIBLE TO THE APPLICANT'},
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReasonDialogComponent);
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ReasonDialogHarness,
    );
  });

  it('should get and set reason via harness', async () => {
    expect(await harness.getReason()).toBe('');
    await harness.setReason('test reason');
    fixture.detectChanges();
    expect(await harness.getReason()).toBe('test reason');
  });

  it('should get visibility label via harness', async () => {
    const label = await harness.getVisibilityLabel();
    expect(label).toBe('VISIBLE TO THE APPLICANT');
  });
});
