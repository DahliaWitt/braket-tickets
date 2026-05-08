import { ComponentHarness, type HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { BraDropdownMenuContentComponent } from './dropdown-menu-content.component';
import { BraDropdownDirective } from './dropdown-trigger.directive';
import { BraDropdownService } from './dropdown.service';

class BraDropdownServiceStub {
  readonly openState = signal(false);
  readonly isOpen = vi.fn(() => this.openState());
  readonly toggle = vi.fn();
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
    <button type="button" braDropdown [braDropdownMenu]="menuContent" aria-label="Custom label">
      Open Menu
    </button>

    <bra-dropdown-menu-content #menuContent>
      <div role="menuitem">Item</div>
    </bra-dropdown-menu-content>
  `,
  imports: [BraDropdownDirective, BraDropdownMenuContentComponent],
})
class AriaLabelHostComponent {}

class DropdownTriggerHarness extends ComponentHarness {
  static hostSelector = 'button[braDropdown]';

  async getAriaLabel(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-label');
  }

  async getAriaExpanded(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-expanded');
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
        { provide: BraDropdownService, useValue: dropdownService },
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
  });

  it('should not override existing aria-label', async () => {
    TestBed.resetTestingModule();
    const explicitLabelService = new BraDropdownServiceStub();

    await TestBed.configureTestingModule({
      imports: [AriaLabelHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BraDropdownService, useValue: explicitLabelService },
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
    const directive = getDirective() as unknown as { onClick(): void };

    directive.onClick();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);

    component.trigger.set('hover');
    fixture.detectChanges();

    directive.onClick();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);
  });

  it('should toggle on hover only when hover trigger is active', () => {
    component.trigger.set('hover');
    fixture.detectChanges();
    const directive = getDirective() as unknown as { onHoverToggle(): void };

    directive.onHoverToggle();
    directive.onHoverToggle();

    expect(dropdownService.toggle).toHaveBeenCalledTimes(2);
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

  it('should open via openDropdown only when dropdown is closed', () => {
    const directive = getDirective() as unknown as { openDropdown(): void };

    directive.openDropdown();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);

    dropdownService.openState.set(true);
    fixture.detectChanges();

    directive.openDropdown();
    expect(dropdownService.toggle).toHaveBeenCalledTimes(1);
  });

  it('should call toggleDropdown when enabled', () => {
    const directive = getDirective() as unknown as { toggleDropdown(): void };

    directive.toggleDropdown();
    directive.toggleDropdown();

    expect(dropdownService.toggle).toHaveBeenCalledTimes(2);
  });
});
