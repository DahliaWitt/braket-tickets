import {
  ChangeDetectionStrategy,
  Component,
  effect,
  computed,
  contentChildren,
  input,
  model,
  signal,
  type TemplateRef,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import type { ClassValue } from 'clsx';

import { mergeClasses } from '@ui/utils/merge-classes';
import { uniqueComponentId } from '@ui/utils/unique-id';
import { tabGroupVariants, tabListVariants, tabVariants, type ZardTabStyleVariants } from './tabs.variants';

@Component({
  selector: 'z-tab',
  template: `<ng-template #content><ng-content /></ng-template>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ZardTabComponent {
  readonly id = uniqueComponentId('tab');
  readonly label = input.required<string>();
  readonly contentTemplate = viewChild.required<TemplateRef<unknown>>('content');
}

@Component({
  selector: 'z-tab-group',
  imports: [NgTemplateOutlet],
  template: `
    <div [class]="listClasses()" role="tablist" [attr.aria-orientation]="'horizontal'">
      @for (tab of tabs(); track tab.id; let i = $index) {
        <button
          type="button"
          role="tab"
          [attr.id]="'tab-' + groupId + '-' + tab.id"
          [attr.aria-selected]="isTabActive(tab)"
          [attr.tabindex]="isTabActive(tab) ? 0 : -1"
          [attr.aria-controls]="'tabpanel-' + groupId + '-' + tab.id"
          [class]="getTabClasses(tab)"
          (click)="setActive(i)"
          (keydown)="onKeydown($event, i)"
        >
          {{ tab.label() }}
        </button>
      }
    </div>
    @for (tab of tabs(); track tab.id; let i = $index) {
      <div
        role="tabpanel"
        [attr.id]="'tabpanel-' + groupId + '-' + tab.id"
        [attr.aria-labelledby]="'tab-' + groupId + '-' + tab.id"
        [attr.tabindex]="0"
        [hidden]="!isTabActive(tab)"
        class="mt-4 focus-visible:ring-primary/50 outline-none focus-visible:ring-2"
      >
        <ng-container [ngTemplateOutlet]="tab.contentTemplate()!" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'groupClasses()' },
  exportAs: 'zTabGroup',
})
export class ZardTabGroupComponent {
  protected readonly groupId = uniqueComponentId('tab-group');
  private readonly activeTabId = signal<string | null>(null);
  private previousTabsSignature = '';

  readonly zStyle = input<ZardTabStyleVariants>('underline');
  readonly activeIndex = model(0);
  readonly class = input<ClassValue>('');

  readonly tabs = contentChildren(ZardTabComponent);

  protected readonly groupClasses = computed(() =>
    mergeClasses(tabGroupVariants({ zStyle: this.zStyle() }), this.class()),
  );

  protected readonly listClasses = computed(() =>
    mergeClasses(tabListVariants({ zStyle: this.zStyle() })),
  );

  constructor() {
    effect(() => {
      const tabs = this.tabs();
      const tabsSignature = tabs.map((tab) => tab.id).join('|');
      const currentIndex = this.activeIndex();
      const currentTabId = this.activeTabId();

      if (tabs.length === 0) {
        if (currentTabId !== null) {
          this.activeTabId.set(null);
        }
        this.previousTabsSignature = tabsSignature;
        return;
      }

      const clampedIndex = Math.min(Math.max(currentIndex, 0), tabs.length - 1);
      const requestedTab = tabs[clampedIndex];
      const currentTabIndex = currentTabId ? tabs.findIndex((tab) => tab.id === currentTabId) : -1;
      const tabsChanged = tabsSignature !== this.previousTabsSignature;

      if (currentTabId === null || currentTabIndex === -1) {
        this.activeTabId.set(requestedTab.id);
        if (currentIndex !== clampedIndex) {
          this.activeIndex.set(clampedIndex);
        }
      } else if (tabsChanged) {
        if (currentIndex !== currentTabIndex) {
          this.activeIndex.set(currentTabIndex);
        }
      } else if (requestedTab.id !== currentTabId) {
        this.activeTabId.set(requestedTab.id);
      }

      this.previousTabsSignature = tabsSignature;
    });
  }

  protected getTabClasses(tab: ZardTabComponent): string {
    return mergeClasses(
      tabVariants({ zStyle: this.zStyle(), active: this.isTabActive(tab) }),
      'min-h-[44px]',
    );
  }

  protected setActive(index: number): void {
    const tab = this.tabs()[index];
    if (!tab) {
      return;
    }

    this.activeTabId.set(tab.id);
    this.activeIndex.set(index);
  }

  protected onKeydown(event: KeyboardEvent, currentIndex: number): void {
    const tabCount = this.tabs().length;
    let newIndex: number;

    switch (event.key) {
      case 'ArrowRight':
        newIndex = (currentIndex + 1) % tabCount;
        break;
      case 'ArrowLeft':
        newIndex = (currentIndex - 1 + tabCount) % tabCount;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'End':
        newIndex = tabCount - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.setActive(newIndex);
    // Focus the new tab button
    const tabList = (event.target as HTMLElement).parentElement;
    const buttons = tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[newIndex]?.focus();
  }

  protected isTabActive(tab: ZardTabComponent): boolean {
    return this.activeTabId() === tab.id;
  }
}
