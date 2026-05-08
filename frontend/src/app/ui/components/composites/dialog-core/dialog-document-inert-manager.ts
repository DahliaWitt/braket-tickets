import {isPlatformBrowser} from '@angular/common';
import {DOCUMENT, inject, Injectable, PLATFORM_ID} from '@angular/core';

import {noopFn} from '@ui/utils/noop';

interface InertRestoreState {
  element: HTMLElement;
  previousInert: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class BraDialogDocumentInertManager {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private activeModalCount = 0;
  private restoreStates: InertRestoreState[] = [];

  activate(): () => void {
    if (!isPlatformBrowser(this.platformId)) {
      return noopFn;
    }

    this.activeModalCount += 1;

    if (this.activeModalCount === 1) {
      this.applyInert();
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeModalCount = Math.max(0, this.activeModalCount - 1);

      if (this.activeModalCount === 0) {
        this.restoreInert();
      }
    };
  }

  private applyInert(): void {
    const body = this.document.body;
    const overlayContainer = this.document.querySelector(
      '.cdk-overlay-container',
    );

    this.restoreStates = Array.from(body.children)
      .filter(
        (child) =>
          child !== overlayContainer && !child.contains(overlayContainer),
      )
      .map((element) => ({
        element: element as HTMLElement,
        previousInert: element.getAttribute('inert'),
      }));

    for (const {element} of this.restoreStates) {
      element.setAttribute('inert', '');
    }
  }

  private restoreInert(): void {
    for (const {element, previousInert} of this.restoreStates) {
      if (previousInert === null) {
        element.removeAttribute('inert');
      } else {
        element.setAttribute('inert', previousInert);
      }
    }

    this.restoreStates = [];
  }
}
