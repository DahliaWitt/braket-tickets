import { type HarnessLoader } from '@angular/cdk/testing';
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
import { BraDropdownMenuItemComponent } from './dropdown-item.component';
import { DropdownItemHarness } from './dropdown-item.component.harness';
import { BraDropdownService } from './dropdown.service';

class DropdownServiceStub {
  readonly close = vi.fn();
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bra-dropdown-menu-item [disabled]="disabled()" [inset]="inset()" [variant]="variant()">
      Item label
    </bra-dropdown-menu-item>
  `,
  imports: [BraDropdownMenuItemComponent],
})
class TestHostComponent {
  readonly disabled = signal(false);
  readonly inset = signal(false);
  readonly variant = signal<'default' | 'destructive'>('default');
}

describe('BraDropdownMenuItemComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let loader: HarnessLoader;
  let dropdownService: DropdownServiceStub;
  let itemComponent: BraDropdownMenuItemComponent;

  beforeEach(async () => {
    dropdownService = new DropdownServiceStub();

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
    itemComponent = fixture.debugElement.query(By.directive(BraDropdownMenuItemComponent))
      .componentInstance as BraDropdownMenuItemComponent;

    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should apply accessibility and data attributes for disabled and variant state', async () => {
    component.disabled.set(true);
    component.inset.set(true);
    component.variant.set('destructive');
    fixture.detectChanges();

    const item = await loader.getHarness(DropdownItemHarness);

    expect(await item.getAttribute('aria-disabled')).toBe('true');
    expect(await item.getAttribute('data-disabled')).toBe('true');
    expect(await item.getAttribute('data-inset')).toBe('true');
    expect(await item.getAttribute('data-variant')).toBe('destructive');
  });

  it('should close dropdown on click when enabled', async () => {
    vi.useFakeTimers();
    itemComponent.onClick();

    expect(dropdownService.close).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(dropdownService.close).toHaveBeenCalledTimes(1);
  });

  it('should not close dropdown on click when disabled', async () => {
    vi.useFakeTimers();
    component.disabled.set(true);
    fixture.detectChanges();
    itemComponent.onClick();
    await vi.runAllTimersAsync();

    expect(dropdownService.close).not.toHaveBeenCalled();
  });

  describe('tabindex', () => {
    it('should always have tabindex="-1" so menu items are never in the Tab order', async () => {
      fixture.detectChanges();

      const item = await loader.getHarness(DropdownItemHarness);
      expect(await item.getAttribute('tabindex')).toBe('-1');
    });
  });
});
