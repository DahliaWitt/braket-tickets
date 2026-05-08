import { type ZardSelectItemComponent } from './select-item.component';

function getMatchingItem(
  items: readonly ZardSelectItemComponent[],
  value: string,
): ZardSelectItemComponent | undefined {
  return items.find((item) => item.zValue() === value);
}

export function provideLabelsForMultiselectMode(
  selectedValue: string[],
  maxLabelCount: number,
  items: readonly ZardSelectItemComponent[],
): string[] {
  const labelsToShowCount = selectedValue.length - maxLabelCount;
  const labels: string[] = [];
  let index = 0;
  for (const value of selectedValue) {
    const matchingItem = getMatchingItem(items, value);
    if (matchingItem) {
      labels.push(matchingItem.label());
      index++;
    }
    if (labelsToShowCount && maxLabelCount && index === maxLabelCount) {
      labels.push(`${labelsToShowCount} more item${labelsToShowCount > 1 ? 's' : ''} selected`);
      break;
    }
  }
  return labels;
}

export function provideLabelForSingleSelectMode(
  selectedValue: string,
  manualLabel: string,
  items: readonly ZardSelectItemComponent[],
): string[] {
  if (manualLabel) {
    return [manualLabel];
  }

  const matchingItem = getMatchingItem(items, selectedValue);
  if (matchingItem) {
    return [matchingItem.label()];
  }

  return selectedValue ? [selectedValue] : [];
}
