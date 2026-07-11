import {ComponentHarness, type HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {vi} from 'vitest';
import {BraDropdownMenuContentComponent} from './dropdown-menu-content.component';
import {BraDropdownDirective} from './dropdown-trigger.directive';
import {BraDropdownService} from './dropdown.service';

class BraDropdownServiceStub {
  readonly activeTrigger = signal<HTMLElement | null>(null);
  readonly isOpen = vi.fn(() => this.activeTrigger() !== null);
  readonly toggle = vi.fn();
  readonly openHover = vi.fn();
  readonly scheduleHoverClose = vi.fn();
  readonly cancelHoverClose = vi.fn();
  readonly close = vi.fn();
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      braDropdown
      [braDropdownMenu]="menuContent"
      [zTrigger]="trigger()"
      [zDisabled]="disabled()"
    >
      Open Menu
    </button>

    <bra-dropdown-menu-content #menuContent>
      <div role="menuitem">Item</div>
    </bra-dropdown-menu-content>
  `,
  imports: [BraDropdownDirective, BraDropdownMenuContentComponent],
})
class TestHostComponent {
  readonly trigger = signal<'click' | 'hover'>('click');
  readonly disabled = signal(false);
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      braDropdown
      [braDropdownMenu]="menuContent"
      aria-label="Custom label"
    >
      Open Menu
    </button>

    <bra-dropdown-menu-content #menuContent>
      <div role="menuitem">Item</div>
    </bra-dropdown-menu-content>
  `,
  imports: [BraDropdownDirective, BraDropdownMenuContentComponent],
})
class AriaLabelHostComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      id="custom-trigger-id"
      braDropdown
      [braDropdownMenu]="menuContent"
    >
      Open Menu
    </button>

    <bra-dropdown-menu-content #menuContent>
      <div role="menuitem">Item</div>
    </bra-dropdown-menu-content>
  `,
  imports: [BraDropdownDirective, BraDropdownMenuContentComponent],
})
class ExistingIdHostComponent {}

class DropdownTriggerHarness extends ComponentHarness {
  static hostSelector = 'button[braDropdown]';

  async getAriaLabel(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-label');
  }

  async getAriaExpanded(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-expanded');
  }

  async getAriaControls(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-controls');
  }
}

describe('BraDropdownDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let loader: HarnessLoader;
  let dropdownService: BraDropdownServiceStub;

  const getDirective = (): BraDropdownDirective =>
    fixture.debugElement
      .query(By.directive(BraDropdownDirective))
      .injector.get(BraDropdownDirective);

  beforeEach(async () => {
    dropdownService = new BraDropdownServiceStub();

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDropdownService, useValue: dropdownService},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should add fallback aria-label from trigger text when not provided', async () => {
    const trigger = await loader.getHarness(DropdownTriggerHarness);

    expect(await trigger.getAriaLabel()).toBe('Open Menu');
    expect(await trigger.getAriaExpanded()).toBe('false');
    expect(await trigger.getAriaControls()).toBeNull();
  });

  it('should set aria-expanded and aria-controls when this trigger is active', async () => {
    const triggerNativeElement = fixture.debugElement.query(
      By.directive(BraDropdownDirective),
    ).nativeElement as HTMLElement;
    const directive = getDirective();

    dropdownService.activeTrigger.set(triggerNativeElement);
    fixture.detectChanges();
    await fixture.whenStable();

    const harness = await loader.getHarness(DropdownTriggerHarness);
    expect(await harness.getAriaExpanded()).toBe('true');
    expect(await harness.getAriaControls()).toBe(directive.menuId);
  });

  it('should not override existing aria-label', async () => {
    TestBed.resetTestingModule();
    const explicitLabelService = new BraDropdownServiceStub();

    await TestBed.configureTestingModule({
      imports: [AriaLabelHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDropdownService, useValue: explicitLabelService},
      ],
    }).compileComponents();

    const labeledFixture = TestBed.createComponent(AriaLabelHostComponent);
    labeledFixture.detectChanges();
    await labeledFixture.whenStable();

    const labeledLoader = TestbedHarnessEnvironment.loader(labeledFixture);
    const trigger = await labeledLoader.getHarness(DropdownTriggerHarness);

    expect(await trigger.getAriaLabel()).toBe('Custom label');
  });

  it('should toggle on click only when click trigger is active', async () => {
    const directive = getDirective() as unknown as {onClick(): void};

    directive.onClick();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);

    component.trigger.set('hover');
    fixture.detectChanges();

    directive.onClick();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);
  });

  it('should open on hover enter and schedule a grace close on hover leave in hover mode', () => {
    component.trigger.set('hover');
    fixture.detectChanges();
    const directive = getDirective();
    const hoverDirective = directive as unknown as {
      onHoverEnter(): void;
      onHoverLeave(): void;
    };

    hoverDirective.onHoverEnter();
    expect(dropdownService.openHover).toHaveBeenCalledTimes(1);
    expect(dropdownService.openHover).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      directive.menuId,
      directive.triggerId,
      200,
    );
    expect(dropdownService.toggle).not.toHaveBeenCalled();

    hoverDirective.onHoverLeave();
    expect(dropdownService.scheduleHoverClose).toHaveBeenCalledTimes(1);
  });

  it('should ignore hover enter/leave in click mode', () => {
    // default trigger is 'click'
    const hoverDirective = getDirective() as unknown as {
      onHoverEnter(): void;
      onHoverLeave(): void;
    };

    hoverDirective.onHoverEnter();
    hoverDirective.onHoverLeave();

    expect(dropdownService.openHover).not.toHaveBeenCalled();
    expect(dropdownService.scheduleHoverClose).not.toHaveBeenCalled();
  });

  it('should not open on hover enter when disabled', () => {
    component.trigger.set('hover');
    component.disabled.set(true);
    fixture.detectChanges();
    const hoverDirective = getDirective() as unknown as {onHoverEnter(): void};

    hoverDirective.onHoverEnter();

    expect(dropdownService.openHover).not.toHaveBeenCalled();
  });

  it('should close the open menu when the trigger is destroyed while expanded', () => {
    const triggerNativeElement = fixture.debugElement.query(
      By.directive(BraDropdownDirective),
    ).nativeElement as HTMLElement;

    dropdownService.activeTrigger.set(triggerNativeElement);
    fixture.detectChanges();

    fixture.destroy();

    expect(dropdownService.close).toHaveBeenCalledTimes(1);
  });

  it('should not close on destroy when this trigger is not expanded', () => {
    fixture.destroy();

    expect(dropdownService.close).not.toHaveBeenCalled();
  });

  it('should ignore toggle actions when disabled', () => {
    component.disabled.set(true);
    fixture.detectChanges();
    const directive = getDirective() as unknown as {
      toggleDropdown(): void;
      openDropdown(): void;
    };

    directive.toggleDropdown();
    directive.openDropdown();

    expect(dropdownService.toggle).not.toHaveBeenCalled();
  });

  it('should open via openDropdown only when this trigger is not expanded', () => {
    const directive = getDirective() as unknown as {openDropdown(): void};
    const triggerNativeElement = fixture.debugElement.query(
      By.directive(BraDropdownDirective),
    ).nativeElement as HTMLElement;

    directive.openDropdown();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);

    dropdownService.activeTrigger.set(triggerNativeElement);
    fixture.detectChanges();

    directive.openDropdown();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);
  });

  it('should call toggleDropdown when enabled', () => {
    const directive = getDirective() as unknown as {toggleDropdown(): void};

    directive.toggleDropdown();
    directive.toggleDropdown();

    expect(dropdownService.toggle).toHaveBeenCalledTimes(2);
  });

  it('should preserve a consumer-supplied id and use it as triggerId', async () => {
    TestBed.resetTestingModule();
    const existingIdService = new BraDropdownServiceStub();

    await TestBed.configureTestingModule({
      imports: [ExistingIdHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDropdownService, useValue: existingIdService},
      ],
    }).compileComponents();

    const existingIdFixture = TestBed.createComponent(ExistingIdHostComponent);
    existingIdFixture.detectChanges();
    await existingIdFixture.whenStable();

    const triggerEl = existingIdFixture.debugElement.query(
      By.directive(BraDropdownDirective),
    ).nativeElement as HTMLElement;
    const directive = existingIdFixture.debugElement
      .query(By.directive(BraDropdownDirective))
      .injector.get(BraDropdownDirective);

    expect(triggerEl.id).toBe('custom-trigger-id');
    expect(directive.triggerId).toBe('custom-trigger-id');
  });

  it('should generate a trigger id when none is supplied', () => {
    const triggerEl = fixture.debugElement.query(
      By.directive(BraDropdownDirective),
    ).nativeElement as HTMLElement;
    const directive = getDirective();

    expect(triggerEl.id).toMatch(/^bra-dropdown-trigger-\d+$/);
    expect(directive.triggerId).toBe(triggerEl.id);
  });
});
