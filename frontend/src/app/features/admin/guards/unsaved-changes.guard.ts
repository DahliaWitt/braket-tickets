import { inject } from '@angular/core';
import { type CanDeactivateFn } from '@angular/router';
import { BraAlertDialogService } from '@ui/components/composites/alert-dialog/alert-dialog.service';

export interface HasUnsavedChanges {
  isDirty: () => boolean;
}

/**
 * Prompts the user to confirm navigation when a component has unsaved changes.
 * Uses BraAlertDialogService to stay consistent with the app's "Pulp" theme
 * rather than the browser's native confirm() dialog.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.isDirty()) {
    return true;
  }

  const dialogService = inject(BraAlertDialogService);

  return new Promise<boolean>((resolve) => {
    dialogService.confirm({
      zTitle: 'Unsaved Changes',
      zDescription: 'You have unsaved changes that will be lost. Are you sure you want to leave?',
      zOkText: 'Discard Changes',
      zCancelText: 'Keep Editing',
      zOkDestructive: true,
      zMaskClosable: false,
      zOnOk: () => resolve(true),
      zOnCancel: () => resolve(false),
    });
  });
};
