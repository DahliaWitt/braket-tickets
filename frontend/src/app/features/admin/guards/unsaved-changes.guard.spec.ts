import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { BraAlertDialogService } from '@ui/components/composites/alert-dialog/alert-dialog.service';
import { unsavedChangesGuard } from './unsaved-changes.guard';
import type { HasUnsavedChanges } from './unsaved-changes.guard';

describe('unsavedChangesGuard', () => {
  let mockDialogService: { confirm: ReturnType<typeof vi.fn> };
  const currentRoute = {} as ActivatedRouteSnapshot;
  const currentState = {} as RouterStateSnapshot;
  const nextState = {} as RouterStateSnapshot;

  beforeEach(() => {
    mockDialogService = {
      confirm: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: BraAlertDialogService, useValue: mockDialogService },
      ],
    });
  });

  it('should allow navigation when form is not dirty', () => {
    const component = { isDirty: signal(false) } as HasUnsavedChanges;

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, currentRoute, currentState, nextState),
    );

    expect(result).toBe(true);
    expect(mockDialogService.confirm).not.toHaveBeenCalled();
  });

  it('should show confirmation dialog when form is dirty', () => {
    const component = { isDirty: signal(true) } as HasUnsavedChanges;

    void TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, currentRoute, currentState, nextState),
    );

    expect(mockDialogService.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Unsaved Changes',
        zOkDestructive: true,
      }),
    );
  });

  it('should resolve true when user confirms discard', async () => {
    const component = { isDirty: signal(true) } as HasUnsavedChanges;

    mockDialogService.confirm.mockImplementation((config: { zOnOk: () => void }) => {
      // Simulate user clicking "Discard Changes"
      config.zOnOk();
    });

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, currentRoute, currentState, nextState),
    );

    await expect(result).resolves.toBe(true);
  });

  it('should resolve false when user cancels', async () => {
    const component = { isDirty: signal(true) } as HasUnsavedChanges;

    mockDialogService.confirm.mockImplementation((config: { zOnCancel: () => void }) => {
      // Simulate user clicking "Keep Editing"
      config.zOnCancel();
    });

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, currentRoute, currentState, nextState),
    );

    await expect(result).resolves.toBe(false);
  });

  it('should reject without registering a global Escape listener when dialog creation fails', async () => {
    const component = { isDirty: signal(true) } as HasUnsavedChanges;
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const error = new Error('dialog creation failed');

    mockDialogService.confirm.mockImplementation(() => {
      throw error;
    });

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, currentRoute, currentState, nextState),
    );

    await expect(result).rejects.toThrow(error);
    expect(addEventListenerSpy.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
    expect(removeEventListenerSpy.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
  });

  it('should disable backdrop click dismissal', () => {
    const component = { isDirty: signal(true) } as HasUnsavedChanges;

    void TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, currentRoute, currentState, nextState),
    );

    expect(mockDialogService.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        zMaskClosable: false,
      }),
    );
  });
});
