import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type TemplateRef,
  ViewContainerRef,
  inject,
  viewChild,
} from '@angular/core';
import {TestBed, type ComponentFixture} from '@angular/core/testing';
import {BraDropdownService} from './dropdown.service';
import {OverlayModule} from '@angular/cdk/overlay';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" #trigger>Trigger</button>
    <ng-template #menu>
      <div role="menu">
        <div bra-dropdown-menu-item tabindex="0">Item 1</div>
        <div bra-dropdown-menu-item tabindex="0">Item 2</div>
      </div>
    </ng-template>
  `,
  imports: [OverlayModule],
  providers: [BraDropdownService],
})
class TestComponent {
  readonly viewContainerRef = inject(ViewContainerRef);
  readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  readonly menu = viewChild<TemplateRef<unknown>>('menu');
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" #trigger>Trigger</button>
    <ng-template #menu>
      <div role="menu">
        <div bra-dropdown-menu-item tabindex="0">Item 1</div>
        <div bra-dropdown-menu-item tabindex="0" data-disabled="">Item 2</div>
        <div bra-dropdown-menu-item tabindex="0">Item 3</div>
      </div>
    </ng-template>
  `,
  imports: [OverlayModule],
  providers: [BraDropdownService],
})
class DisabledItemsTestComponent {
  readonly viewContainerRef = inject(ViewContainerRef);
  readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  readonly menu = viewChild<TemplateRef<unknown>>('menu');
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" #trigger>Trigger</button>
    <ng-template #menu>
      <div role="menu">
        <div bra-dropdown-menu-item tabindex="0">Item 1</div>
        <div bra-dropdown-menu-item tabindex="0" data-active="true">Item 2</div>
      </div>
    </ng-template>
  `,
  imports: [OverlayModule],
  providers: [BraDropdownService],
})
class ActiveItemTestComponent {
  readonly viewContainerRef = inject(ViewContainerRef);
  readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  readonly menu = viewChild<TemplateRef<unknown>>('menu');
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('BraDropdownService', () => {
  let service: BraDropdownService;
  let fixture: ComponentFixture<TestComponent>;
  let component: TestComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OverlayModule, TestComponent],
      providers: [BraDropdownService],
    });

    fixture = TestBed.createComponent(TestComponent);
    component = fixture.componentInstance;
    service = fixture.debugElement.injector.get(BraDropdownService);
    fixture.detectChanges();
  });

  afterEach(() => {
    service.close();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should open dropdown via toggle', () => {
    const trigger = component.trigger()!;
    service.toggle(
      trigger,
      component.menu()!,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    expect(service.isOpen()).toBe(true);
    expect(service.activeTrigger()).toBe(trigger.nativeElement);

    const overlayContainer = document.querySelector('.cdk-overlay-container');
    expect(overlayContainer).toBeTruthy();
    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
  });

  it('should close dropdown when same trigger toggles again', () => {
    const trigger = component.trigger()!;
    const menuRef = component.menu()!;
    service.toggle(
      trigger,
      menuRef,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    expect(service.isOpen()).toBe(true);
    service.toggle(
      trigger,
      menuRef,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    expect(service.isOpen()).toBe(false);
    expect(service.activeTrigger()).toBeNull();

    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeFalsy();
  });

  it('should apply ARIA ids to the menu element', async () => {
    service.toggle(
      component.trigger()!,
      component.menu()!,
      component.viewContainerRef,
      'test-menu-id',
      'test-trigger-id',
    );
    await wait(10);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.id).toBe('test-menu-id');
    expect(menu.getAttribute('aria-labelledby')).toBe('test-trigger-id');
  });

  it('should handle keyboard navigation (ArrowDown)', async () => {
    service.toggle(
      component.trigger()!,
      component.menu()!,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    await wait(10);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();

    const items = menu.querySelectorAll<HTMLElement>(
      '[bra-dropdown-menu-item]',
    );
    expect(items[0].dataset['highlighted']).toBeDefined();

    menu.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}),
    );

    expect(items[1].dataset['highlighted']).toBeDefined();
    expect(items[0].dataset['highlighted']).toBeUndefined();
  });

  it('should handle keyboard navigation (ArrowUp)', async () => {
    service.toggle(
      component.trigger()!,
      component.menu()!,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    await wait(10);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const items = menu.querySelectorAll<HTMLElement>(
      '[bra-dropdown-menu-item]',
    );

    menu.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}),
    );

    expect(items[1].dataset['highlighted']).toBeDefined();
  });

  it('should close on Escape', async () => {
    service.toggle(
      component.trigger()!,
      component.menu()!,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    await wait(10);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;

    menu.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
    );

    expect(service.isOpen()).toBe(false);
  });

  it('should close on outside click', async () => {
    const trigger = component.trigger()!;
    const menuRef = component.menu()!;
    service.toggle(
      trigger,
      menuRef,
      component.viewContainerRef,
      'menu-1',
      'trigger-1',
    );
    await wait(10);

    document.body.click();
    await wait(10);

    expect(service.isOpen()).toBe(false);
  });

  it('should skip disabled items during keyboard navigation', async () => {
    const disabledFixture = TestBed.createComponent(DisabledItemsTestComponent);
    const disabledComponent = disabledFixture.componentInstance;
    const disabledService =
      disabledFixture.debugElement.injector.get(BraDropdownService);

    disabledFixture.detectChanges();
    disabledService.toggle(
      disabledComponent.trigger()!,
      disabledComponent.menu()!,
      disabledComponent.viewContainerRef,
      'menu-disabled',
      'trigger-disabled',
    );
    await wait(10);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const items = menu.querySelectorAll<HTMLElement>(
      '[bra-dropdown-menu-item]',
    );

    menu.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}),
    );

    expect(items[2].dataset['highlighted']).toBeDefined();
    expect(items[1].dataset['highlighted']).toBeUndefined();

    disabledService.close();
    disabledFixture.destroy();
  });

  it('should focus active item first when data-active is set', async () => {
    const activeFixture = TestBed.createComponent(ActiveItemTestComponent);
    const activeComponent = activeFixture.componentInstance;
    const activeService =
      activeFixture.debugElement.injector.get(BraDropdownService);

    activeFixture.detectChanges();
    activeService.toggle(
      activeComponent.trigger()!,
      activeComponent.menu()!,
      activeComponent.viewContainerRef,
      'menu-active',
      'trigger-active',
    );
    await wait(10);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const items = menu.querySelectorAll<HTMLElement>(
      '[bra-dropdown-menu-item]',
    );

    expect(menu).toBeTruthy();
    expect(items[1].dataset['highlighted']).toBeDefined();

    activeService.close();
    activeFixture.destroy();
  });

  describe('multi-trigger isolation', () => {
    it('should track activeTrigger per element, not globally', () => {
      const triggerA = component.trigger()!;
      const menuRef = component.menu()!;

      service.toggle(
        triggerA,
        menuRef,
        component.viewContainerRef,
        'menu-a',
        'trigger-a',
      );
      expect(service.activeTrigger()).toBe(triggerA.nativeElement);
      expect(service.isOpen()).toBe(true);

      service.close();
      expect(service.activeTrigger()).toBeNull();
      expect(service.isOpen()).toBe(false);
    });

    it('should switch activeTrigger when a different trigger opens', () => {
      const secondFixture = TestBed.createComponent(TestComponent);
      const secondComponent = secondFixture.componentInstance;
      secondFixture.detectChanges();

      const triggerA = component.trigger()!;
      const triggerB = secondComponent.trigger()!;

      service.toggle(
        triggerA,
        component.menu()!,
        component.viewContainerRef,
        'menu-a',
        'trigger-a',
      );
      expect(service.activeTrigger()).toBe(triggerA.nativeElement);

      service.toggle(
        triggerB,
        secondComponent.menu()!,
        secondComponent.viewContainerRef,
        'menu-b',
        'trigger-b',
      );
      expect(service.activeTrigger()).toBe(triggerB.nativeElement);
      expect(service.isOpen()).toBe(true);

      secondFixture.destroy();
    });
  });
});
