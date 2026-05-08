import type { OverlayRef } from '@angular/cdk/overlay';
import type { ElementRef } from '@angular/core';

export function focusSelectDropdown(overlayRef?: OverlayRef): void {
  if (!overlayRef?.hasAttached()) return;
  const dropdownElement = overlayRef.overlayElement.querySelector('[role="listbox"]') as HTMLElement;
  dropdownElement?.focus();
}

export function focusSelectButton(elementRef: ElementRef<HTMLElement>): void {
  const button = elementRef.nativeElement.querySelector('button');
  button?.focus();
}
