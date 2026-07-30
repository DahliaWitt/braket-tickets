import '../../../../../test-setup';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {describe, expect, it} from 'vitest';

import {PrivacyPolicyHarness} from './privacy-policy.harness';
import {PrivacyPolicyComponent} from './privacy-policy';

describe('PrivacyPolicyComponent', () => {
  it('exposes the wide notice table as a contained keyboard-focusable region', async () => {
    await TestBed.configureTestingModule({
      imports: [PrivacyPolicyComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(PrivacyPolicyComponent);
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      PrivacyPolicyHarness,
    );

    const attributes = await harness.getNoticeTableRegionAttributes();
    expect(attributes).toMatchObject({
      role: 'region',
      ariaLabel: 'California privacy notice details',
      tabIndex: '0',
    });
    expect(attributes.className).toContain('min-w-0');
    expect(attributes.className).toContain('max-w-full');
    expect(attributes.className).toContain('overflow-x-auto');
  });
});
