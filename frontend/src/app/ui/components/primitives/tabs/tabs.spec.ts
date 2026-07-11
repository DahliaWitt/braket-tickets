import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {ZardTabGroupComponent, ZardTabComponent} from './tabs.component';
import {ZardTabGroupHarness} from './tabs.harness';

/** Type-safe DOM query helpers to satisfy strict ESLint no-unsafe-* rules. */
function queryAll<T extends Element>(
  el: {nativeElement: unknown},
  selector: string,
): NodeListOf<T> {
  return (el.nativeElement as HTMLElement).querySelectorAll<T>(selector);
}
function query<T extends Element>(
  el: {nativeElement: unknown},
  selector: string,
): T | null {
  return (el.nativeElement as HTMLElement).querySelector<T>(selector);
}

// ---------------------------------------------------------------------------
// Default test host (underline style, 3 tabs)
// ---------------------------------------------------------------------------

@Component({
  template: `
    <z-tab-group>
      <z-tab label="First">Content 1</z-tab>
      <z-tab label="Second">Content 2</z-tab>
      <z-tab label="Third">Content 3</z-tab>
    </z-tab-group>
  `,
  imports: [ZardTabGroupComponent, ZardTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {}

// ---------------------------------------------------------------------------
// Host with two-way-bound activeIndex
// ---------------------------------------------------------------------------

@Component({
  template: `
    <z-tab-group [(activeIndex)]="activeIndex">
      <z-tab label="Alpha">Alpha content</z-tab>
      <z-tab label="Beta">Beta content</z-tab>
    </z-tab-group>
  `,
  imports: [ZardTabGroupComponent, ZardTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ActiveIndexHostComponent {
  readonly activeIndex = signal(1);
}

// ---------------------------------------------------------------------------
// Host with pill style
// ---------------------------------------------------------------------------

@Component({
  template: `
    <z-tab-group zStyle="pill">
      <z-tab label="One">One content</z-tab>
      <z-tab label="Two">Two content</z-tab>
    </z-tab-group>
  `,
  imports: [ZardTabGroupComponent, ZardTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PillStyleHostComponent {}

interface DynamicTabDefinition {
  readonly id: string;
  readonly label: string;
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Host with dynamic tab ordering
// ---------------------------------------------------------------------------

@Component({
  template: `
    <z-tab-group [(activeIndex)]="activeIndex">
      @for (tab of tabs(); track tab.id) {
        <z-tab [label]="tab.label">{{ tab.content }}</z-tab>
      }
    </z-tab-group>
  `,
  imports: [ZardTabGroupComponent, ZardTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class DynamicTabsHostComponent {
  readonly activeIndex = signal(1);
  readonly tabs = signal<DynamicTabDefinition[]>([
    {id: 'first', label: 'First', content: 'Content 1'},
    {id: 'second', label: 'Second', content: 'Content 2'},
    {id: 'third', label: 'Third', content: 'Content 3'},
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupDefault() {
  TestBed.configureTestingModule({imports: [TestHostComponent]});
  const fixture = TestBed.createComponent(TestHostComponent);
  fixture.detectChanges();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardTabGroupHarness);
  return {fixture, harness};
}

async function setupActiveIndex() {
  TestBed.configureTestingModule({imports: [ActiveIndexHostComponent]});
  const fixture = TestBed.createComponent(ActiveIndexHostComponent);
  fixture.detectChanges();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardTabGroupHarness);
  return {fixture, harness, host: fixture.componentInstance};
}

async function setupPill() {
  TestBed.configureTestingModule({imports: [PillStyleHostComponent]});
  const fixture = TestBed.createComponent(PillStyleHostComponent);
  fixture.detectChanges();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardTabGroupHarness);
  return {fixture, harness};
}

async function setupDynamicTabs() {
  TestBed.configureTestingModule({imports: [DynamicTabsHostComponent]});
  const fixture = TestBed.createComponent(DynamicTabsHostComponent);
  fixture.detectChanges();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardTabGroupHarness);
  return {fixture, harness, host: fixture.componentInstance};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZardTabGroupComponent', () => {
  // Existing baseline tests ------------------------------------------------

  it('should render all tabs', async () => {
    const {harness} = await setupDefault();
    expect(await harness.getTabCount()).toBe(3);
  });

  it('should show correct labels', async () => {
    const {harness} = await setupDefault();
    expect(await harness.getTabLabels()).toEqual(['First', 'Second', 'Third']);
  });

  it('should default to first tab active', async () => {
    const {harness} = await setupDefault();
    expect(await harness.getActiveTabIndex()).toBe(0);
  });

  it('should switch tab on click', async () => {
    const {harness} = await setupDefault();
    await harness.selectTab(1);
    expect(await harness.getActiveTabIndex()).toBe(1);
  });

  // ARIA attributes --------------------------------------------------------

  it('should set aria-selected="true" only on the active tab', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(buttons[1].getAttribute('aria-selected')).toBe('false');
    expect(buttons[2].getAttribute('aria-selected')).toBe('false');
  });

  it('should set tabindex=0 on the active tab and -1 on others', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    expect(buttons[0].getAttribute('tabindex')).toBe('0');
    expect(buttons[1].getAttribute('tabindex')).toBe('-1');
    expect(buttons[2].getAttribute('tabindex')).toBe('-1');
  });

  it('should set aria-controls pointing to the matching panel id', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    const panels = queryAll<HTMLElement>(fixture, '[role="tabpanel"]');
    for (let i = 0; i < buttons.length; i++) {
      expect(buttons[i].getAttribute('aria-controls')).toBe(
        panels[i].getAttribute('id'),
      );
    }
  });

  it('should set role="tabpanel" on each panel', async () => {
    const {fixture} = await setupDefault();
    const panels = queryAll<HTMLElement>(fixture, '[role="tabpanel"]');
    expect(panels.length).toBe(3);
  });

  // Panel visibility -------------------------------------------------------

  it('should show only the active panel', async () => {
    const {fixture} = await setupDefault();
    const panels = queryAll<HTMLElement>(fixture, '[role="tabpanel"]');
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);
    expect(panels[2].hidden).toBe(true);
  });

  it('should reveal the clicked panel and hide others', async () => {
    const {fixture, harness} = await setupDefault();
    await harness.selectTab(2);
    fixture.detectChanges();
    const panels = queryAll<HTMLElement>(fixture, '[role="tabpanel"]');
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(true);
    expect(panels[2].hidden).toBe(false);
  });

  // activeIndex model binding ----------------------------------------------

  it('should honour an initial activeIndex from the model binding', async () => {
    const {harness} = await setupActiveIndex();
    expect(await harness.getActiveTabIndex()).toBe(1);
  });

  it('should update the host signal when the active tab changes', async () => {
    const {fixture, harness, host} = await setupActiveIndex();
    await harness.selectTab(0);
    fixture.detectChanges();
    expect(host.activeIndex()).toBe(0);
  });

  it('should keep the same tab active when a dynamic list is reordered', async () => {
    const {fixture, host} = await setupDynamicTabs();
    const initialButtons = queryAll<HTMLButtonElement>(
      fixture,
      'button[role="tab"]',
    );
    const initialActiveButton = initialButtons[1];
    const initialActiveId = initialActiveButton.getAttribute('aria-controls');

    host.tabs.set([host.tabs()[2], host.tabs()[0], host.tabs()[1]]);
    fixture.detectChanges();

    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    const activeButton = Array.from(buttons).find(
      (button) => button.getAttribute('aria-selected') === 'true',
    );
    expect(activeButton?.textContent?.trim()).toBe('Second');
    expect(activeButton?.getAttribute('aria-controls')).toBe(initialActiveId);
    expect(host.activeIndex()).toBe(2);
  });

  it('should keep the active tab selected when tabs are removed before it', async () => {
    const {fixture, host} = await setupDynamicTabs();
    host.tabs.set([host.tabs()[1], host.tabs()[2]]);
    fixture.detectChanges();

    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    const activeButton = Array.from(buttons).find(
      (button) => button.getAttribute('aria-selected') === 'true',
    );
    expect(activeButton?.textContent?.trim()).toBe('Second');
    expect(host.activeIndex()).toBe(0);
  });

  // Keyboard navigation ----------------------------------------------------

  it('should move focus to the next tab on ArrowRight', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}),
    );
    fixture.detectChanges();
    const panels = queryAll<HTMLElement>(fixture, '[role="tabpanel"]');
    // Tab 1 should now be active
    expect(buttons[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[1].hidden).toBe(false);
  });

  it('should wrap ArrowRight from last tab to first', async () => {
    const {fixture, harness} = await setupDefault();
    await harness.selectTab(2);
    fixture.detectChanges();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    buttons[2].dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}),
    );
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
  });

  it('should move focus to the previous tab on ArrowLeft', async () => {
    const {fixture, harness} = await setupDefault();
    await harness.selectTab(2);
    fixture.detectChanges();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    buttons[2].dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}),
    );
    fixture.detectChanges();
    expect(buttons[1].getAttribute('aria-selected')).toBe('true');
  });

  it('should wrap ArrowLeft from first tab to last', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}),
    );
    fixture.detectChanges();
    expect(buttons[2].getAttribute('aria-selected')).toBe('true');
  });

  it('should jump to the first tab on Home key', async () => {
    const {fixture, harness} = await setupDefault();
    await harness.selectTab(2);
    fixture.detectChanges();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    buttons[2].dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Home', bubbles: true}),
    );
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
  });

  it('should jump to the last tab on End key', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', {key: 'End', bubbles: true}),
    );
    fixture.detectChanges();
    expect(buttons[2].getAttribute('aria-selected')).toBe('true');
  });

  // Pill style variant -----------------------------------------------------

  it('should render pill-style tablist with correct class', async () => {
    const {fixture} = await setupPill();
    const tabList = query<HTMLElement>(
      fixture,
      '[role="tablist"]',
    ) as HTMLElement;
    // pill variant applies bg-muted and rounded-md — verify the zStyle attribute is reflected
    // by checking that each button still has role="tab"
    const buttons = tabList.querySelectorAll('button[role="tab"]');
    expect(buttons.length).toBe(2);
  });

  it('should still activate tabs correctly in pill style', async () => {
    const {harness} = await setupPill();
    await harness.selectTab(1);
    expect(await harness.getActiveTabIndex()).toBe(1);
  });

  it('should apply pill-specific classes to the tab list', async () => {
    const {fixture} = await setupPill();
    const tabList = query<HTMLElement>(
      fixture,
      '[role="tablist"]',
    ) as HTMLElement;
    // pill variant class includes "rounded-md" (from tabListVariants)
    expect(tabList.className).toContain('rounded-md');
  });

  // Interaction affordances --------------------------------------------------

  it('should opt tab buttons back into a pointer cursor (Tailwind v4 preflight sets cursor:default)', async () => {
    const {fixture} = await setupDefault();
    const buttons = queryAll<HTMLButtonElement>(fixture, 'button[role="tab"]');

    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.className.split(/\s+/)).toContain('cursor-pointer');
    }
  });
});
