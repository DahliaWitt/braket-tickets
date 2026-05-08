import '../../../../test-setup';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { AdminComponent } from './admin.component';
import { AdminComponentHarness } from './admin.component.harness';
import { CONVEX } from 'convex-angular';
import { CommunitiesService } from '@/core/services/communities.service';
import { vi } from 'vitest';
import { createMockConvexClient, type MockConvexClient } from '@/testing/mock-types';

describe('AdminComponent', () => {
  let fixture: ComponentFixture<AdminComponent>;
  let mockConvexClient: MockConvexClient;
  let harness: AdminComponentHarness;

  beforeEach(async () => {
    mockConvexClient = createMockConvexClient();
    const onUpdate = vi.fn().mockImplementation((_query, _args, onData: (data: unknown[]) => void) => {
      onData([]);
      return () => void 0;
    });
    mockConvexClient.onUpdate = onUpdate;
    mockConvexClient.client.onUpdate = onUpdate;

    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: CONVEX, useValue: mockConvexClient },
        { provide: CommunitiesService, useValue: { list: vi.fn().mockResolvedValue([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    fixture.componentRef.setInput('tab', 'communities');
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(fixture, AdminComponentHarness);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should verify sub-components render', async () => {
    expect(await harness.hasCommunityList()).toBe(true);
  });

  it('falls back to communities tab when an invalid tab is provided', async () => {
    fixture.componentRef.setInput('tab', 'nonexistent');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.activeTab()).toBe('communities');
  });

  it('should render all navigation tabs', () => {
    return expect(harness.getTabLabels()).resolves.toEqual(
      expect.arrayContaining(['Communities']),
    );
  });
});
