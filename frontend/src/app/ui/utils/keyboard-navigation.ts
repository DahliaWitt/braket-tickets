/**
 * Keyboard navigation utility for list-based UI components (dropdown, select, etc.)
 */

export interface KeyboardNavItem {
  focus(): void;
  dataset: DOMStringMap;
  getAttribute(name: string): string | null;
}

export function navigateItems(
  direction: number,
  items: KeyboardNavItem[],
  focusedIndex: number,
  onFocus: (index: number) => void,
): void {
  if (items.length === 0) {
    return;
  }

  let nextIndex = focusedIndex + direction;

  if (nextIndex < 0) {
    nextIndex = items.length - 1;
  } else if (nextIndex >= items.length) {
    nextIndex = 0;
  }

  onFocus(nextIndex);
}

export function focusItemAtIndex<T extends KeyboardNavItem>(
  items: T[],
  index: number,
  setFocusedIndex: (index: number) => void,
): void {
  if (index >= 0 && index < items.length) {
    setFocusedIndex(index);
    updateItemFocus(items, index);
  }
}

export function updateItemFocus<T extends KeyboardNavItem>(
  items: T[],
  focusedIndex: number,
): void {
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (index === focusedIndex) {
      item.focus();
      item.dataset['highlighted'] = '';
    } else {
      delete item.dataset['highlighted'];
    }
  }
}

export function focusInitialItem<T extends KeyboardNavItem>(
  items: T[],
  setFocusedIndex: (index: number) => void,
): number {
  if (items.length === 0) {
    return -1;
  }

  const activeIndex = items.findIndex((item) => item.getAttribute('data-active') === 'true');
  const initialIndex = activeIndex >= 0 ? activeIndex : 0;

  setFocusedIndex(initialIndex);
  updateItemFocus(items, initialIndex);
  return initialIndex;
}

export function selectFocusedItem<T extends KeyboardNavItem>(
  items: T[],
  focusedIndex: number,
): T | null {
  if (focusedIndex >= 0 && focusedIndex < items.length) {
    return items[focusedIndex];
  }
  return null;
}

export type KeyboardNavKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'Enter'
  | ' '
  | 'Escape'
  | 'Home'
  | 'End';

export const NAVIGATION_KEYS: KeyboardNavKey[] = [
  'ArrowDown',
  'ArrowUp',
  'Enter',
  ' ',
  'Escape',
  'Home',
  'End',
];
