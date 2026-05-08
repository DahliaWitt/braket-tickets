import '../../../../../test-setup';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { ZardSelectItemComponent } from './select-item.component';
import { SelectItemHarness } from './select-item.component.harness';

interface SelectHostMock {
  selectedValue(): string[];
  selectItem(value: string, label: string): void;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-select-item [zValue]="value()" [zDisabled]="disabled()" [class]="itemClass()">
      {{ label() }}
    </z-select-item>
  `,
  imports: [ZardSelectItemComponent],
})
class SelectItemHostComponent {
  readonly value = signal('alpha');
  readonly label = signal('Alpha Label');
  readonly disabled = signal(false);
  readonly itemClass = signal('custom-item');
}

describe('ZardSelectItemComponent', () => {
  let fixture: ComponentFixture<SelectItemHostComponent>;
  let loader: HarnessLoader;
  let component: ZardSelectItemComponent;
  let selectHost: SelectHostMock;

  const getComponent = (): ZardSelectItemComponent =>
    fixture.debugElement.query(By.directive(ZardSelectItemComponent))
      .componentInstance as ZardSelectItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectItemHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectItemHostComponent);
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
    component = getComponent();

    selectHost = {
      selectedValue: vi.fn(() => []),
      selectItem: vi.fn(),
    };
    component.setSelectHost(selectHost);
  });

  it('should delegate click to select host with value and label', async () => {
    const harness = await loader.getHarness(SelectItemHarness);
    await harness.click();

    expect(selectHost.selectItem).toHaveBeenCalledWith('alpha', 'Alpha Label');
  });

  it('should ignore click when disabled and set data-disabled attribute', async () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    const harness = await loader.getHarness(SelectItemHarness);

    await harness.click();

    expect(await harness.getDataDisabled()).toBe('');
    expect(selectHost.selectItem).not.toHaveBeenCalled();
  });

  it('should set data-selected when current value is selected', async () => {
    selectHost.selectedValue = vi.fn(() => ['alpha']);
    component.setSelectHost(selectHost);
    fixture.detectChanges();
    const harness = await loader.getHarness(SelectItemHarness);

    expect(await harness.getDataSelected()).toBe('');
  });

  it('should fallback to false selected state when no select host is attached', () => {
    const localFixture = TestBed.createComponent(SelectItemHostComponent);
    localFixture.detectChanges();
    const localComponent = localFixture.debugElement.query(By.directive(ZardSelectItemComponent))
      .componentInstance as ZardSelectItemComponent;

    const isSelected = (localComponent as unknown as { isSelected: () => boolean }).isSelected;
    expect(isSelected()).toBe(false);
  });

  it('should use compact stroke width branch for selected icon', () => {
    const strokeWidth = (component as unknown as { strokeWidth: () => number }).strokeWidth;

    component.zMode.set('compact');
    fixture.detectChanges();
    expect(strokeWidth()).toBe(3);

    component.zMode.set('normal');
    fixture.detectChanges();
    expect(strokeWidth()).toBe(2);
  });

  it('should resolve label from innerText and fallback to empty string', () => {
    const innerTextFixture = TestBed.createComponent(SelectItemHostComponent);
    innerTextFixture.detectChanges();
    const innerTextComponent = innerTextFixture.debugElement.query(
      By.directive(ZardSelectItemComponent),
    ).componentInstance as ZardSelectItemComponent;
    const innerTextElement = innerTextComponent.elementRef.nativeElement;

    Object.defineProperty(innerTextElement, 'textContent', {
      get: () => null,
      configurable: true,
    });
    Object.defineProperty(innerTextElement, 'innerText', {
      get: () => '  From innerText  ',
      configurable: true,
    });
    expect(innerTextComponent.label()).toBe('From innerText');

    const emptyFixture = TestBed.createComponent(SelectItemHostComponent);
    emptyFixture.detectChanges();
    const emptyComponent = emptyFixture.debugElement.query(By.directive(ZardSelectItemComponent))
      .componentInstance as ZardSelectItemComponent;
    const emptyElement = emptyComponent.elementRef.nativeElement;

    Object.defineProperty(emptyElement, 'textContent', {
      get: () => null,
      configurable: true,
    });
    Object.defineProperty(emptyElement, 'innerText', {
      get: () => null,
      configurable: true,
    });
    expect(emptyComponent.label()).toBe('');
  });
});
