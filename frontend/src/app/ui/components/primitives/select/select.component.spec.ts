import {type HarnessLoader} from '@angular/cdk/testing';
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
import {ZardSelectItemComponent} from './select-item.component';
import {ZardSelectComponent} from './select.component';
import {
  ZardSelectHarness,
  ZardSelectItemHarness,
} from './select.component.harness';
import {logger} from '@/utils/logger';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-select
      [zAriaLabel]="ariaLabel()"
      [zAriaLabelledBy]="ariaLabelledBy()"
      [zDisabled]="disabled()"
      [zMultiple]="multiple()"
      [zMaxLabelCount]="maxLabelCount()"
      [(zValue)]="value"
      (zSelectionChange)="onSelectionChange($event)"
    >
      <z-select-item [zValue]="''">None</z-select-item>
      <z-select-item [zValue]="'alpha'">Alpha</z-select-item>
      <z-select-item [zValue]="'beta'" [zDisabled]="true">Beta</z-select-item>
      <z-select-item [zValue]="'gamma'">Gamma</z-select-item>
    </z-select>
  `,
  imports: [ZardSelectComponent, ZardSelectItemComponent],
})
class TestHostComponent {
  readonly ariaLabel = signal('');
  readonly ariaLabelledBy = signal('');
  readonly disabled = signal(false);
  readonly multiple = signal(false);
  readonly maxLabelCount = signal(1);
  readonly value = signal<string | string[]>('');
  readonly lastSelection = signal<string | string[] | null>(null);

  onSelectionChange(selection: string | string[]) {
    this.lastSelection.set(selection);
  }
}

describe('ZardSelectComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let loader: HarnessLoader;
  let documentRootLoader: HarnessLoader;
  const getSelectComponent = (): ZardSelectComponent =>
    fixture.debugElement.query(By.directive(ZardSelectComponent))
      .componentInstance as ZardSelectComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
    documentRootLoader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  });

  const openDropdown = async (select: ZardSelectHarness): Promise<void> => {
    if (!(await select.isOpen())) {
      await select.clickTrigger();
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };

  it('should apply aria-label to the trigger button', async () => {
    component.ariaLabel.set('Select option');
    fixture.detectChanges();

    const select = await loader.getHarness(ZardSelectHarness);
    expect(await select.getAriaLabel()).toBe('Select option');
  });

  it('should apply aria-labelledby to the trigger button', async () => {
    component.ariaLabelledBy.set('label-id');
    fixture.detectChanges();

    const select = await loader.getHarness(ZardSelectHarness);
    expect(await select.getAriaLabelledBy()).toBe('label-id');
  });

  it('should not have aria attributes when empty', async () => {
    component.ariaLabel.set('');
    component.ariaLabelledBy.set('');
    fixture.detectChanges();

    const select = await loader.getHarness(ZardSelectHarness);
    expect(await select.getAriaLabel()).toBeNull();
    expect(await select.getAriaLabelledBy()).toBeNull();
  });

  it('should open and close from trigger keyboard interactions', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();

    selectComponent.onTriggerKeydown(
      new KeyboardEvent('keydown', {key: 'Enter'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await select.isOpen()).toBe(true);

    selectComponent.onTriggerKeydown(
      new KeyboardEvent('keydown', {key: 'Escape'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await select.isOpen()).toBe(false);
  });

  it('should select focused option via keyboard and emit selection', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    await openDropdown(select);

    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'ArrowDown'}),
    );
    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'Enter'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.value()).toBe('alpha');
    expect(component.lastSelection()).toBe('alpha');
    expect(await select.isOpen()).toBe(false);
  });

  it('should allow selecting empty-string values', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    await openDropdown(select);

    const noneOption = await documentRootLoader.getHarness(
      ZardSelectItemHarness.with({value: ''}),
    );
    await noneOption.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.value()).toBe('');
    expect(component.lastSelection()).toBe('');
  });

  it('should summarize multi-select labels when max label count is reached', async () => {
    component.multiple.set(true);
    component.maxLabelCount.set(2);
    component.value.set(['alpha', 'beta', 'gamma']);
    fixture.detectChanges();
    await fixture.whenStable();

    const select = await loader.getHarness(ZardSelectHarness);
    const triggerText = await select.getTriggerText();

    expect(triggerText).toContain('Alpha');
    expect(triggerText).toContain('Beta');
    expect(triggerText).toContain('1 more item selected');
  });

  it('should keep dropdown open in multiple mode and toggle selections', async () => {
    component.multiple.set(true);
    component.value.set([]);
    fixture.detectChanges();

    const select = await loader.getHarness(ZardSelectHarness);
    await openDropdown(select);

    const alphaOption = await documentRootLoader.getHarness(
      ZardSelectItemHarness.with({value: 'alpha'}),
    );
    await alphaOption.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.value()).toEqual(['alpha']);
    expect(await select.isOpen()).toBe(true);

    await alphaOption.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.value()).toEqual([]);
    expect(await select.isOpen()).toBe(true);
  });

  it('should respect Home and End keyboard navigation for enabled options', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    await openDropdown(select);

    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'Home'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selectComponent.focusedIndex()).toBe(0);

    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'End'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selectComponent.focusedIndex()).toBe(2);
  });

  it('should point aria-activedescendant at the highlighted option after a preceding disabled option', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    await openDropdown(select);

    // Enabled options are None(0), Alpha(1), Gamma(2); Beta is disabled and
    // excluded from navigation. End highlights Gamma, the enabled option that
    // sits after the disabled Beta in the DOM.
    selectComponent.onDropdownKeydown(new KeyboardEvent('keydown', {key: 'End'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selectComponent.focusedIndex()).toBe(2);

    const gammaId = await select.getOptionId('gamma');
    const betaId = await select.getOptionId('beta');
    expect(gammaId).toBeTruthy();

    const activeDescendant = await select.getActiveDescendantId();
    expect(activeDescendant).toBe(gammaId);
    // Must never announce the disabled option that precedes the highlighted one.
    expect(activeDescendant).not.toBe(betaId);
  });

  it('should keep aria-activedescendant aligned with the highlighted option while arrowing past a disabled option', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    await openDropdown(select);

    const alphaId = await select.getOptionId('alpha');
    const betaId = await select.getOptionId('beta');
    const gammaId = await select.getOptionId('gamma');

    // Opening highlights None (index 0). ArrowDown -> Alpha (index 1).
    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'ArrowDown'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selectComponent.focusedIndex()).toBe(1);
    expect(await select.getActiveDescendantId()).toBe(alphaId);

    // ArrowDown skips the disabled Beta and lands on Gamma (index 2).
    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'ArrowDown'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selectComponent.focusedIndex()).toBe(2);

    const activeDescendant = await select.getActiveDescendantId();
    expect(activeDescendant).toBe(gammaId);
    expect(activeDescendant).not.toBe(betaId);
  });

  it('should focus selected item when opening in multiple mode', async () => {
    component.multiple.set(true);
    component.value.set(['gamma']);
    fixture.detectChanges();

    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    await openDropdown(select);

    expect(selectComponent.focusedIndex()).toBe(2);
  });

  it('should not open when disabled', async () => {
    component.disabled.set(true);
    fixture.detectChanges();

    const select = await loader.getHarness(ZardSelectHarness);
    await select.clickTrigger();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await select.isOpen()).toBe(false);
  });

  it('should not open when disabled via ControlValueAccessor', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();

    selectComponent.setDisabledState(true);
    fixture.detectChanges();

    await select.clickTrigger();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await select.isOpen()).toBe(false);
  });

  it('should emit full multiselect value through ControlValueAccessor onChange', async () => {
    component.multiple.set(true);
    component.value.set([]);
    fixture.detectChanges();

    const selectComponent = getSelectComponent();
    const onChange = vi.fn();
    selectComponent.registerOnChange(onChange);

    const select = await loader.getHarness(ZardSelectHarness);
    await openDropdown(select);

    const alphaOption = await documentRootLoader.getHarness(
      ZardSelectItemHarness.with({value: 'alpha'}),
    );

    await alphaOption.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(onChange).toHaveBeenLastCalledWith(['alpha']);

    await alphaOption.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('should normalize null writeValue to empty array in multiple mode', () => {
    component.multiple.set(true);
    fixture.detectChanges();

    const selectComponent = getSelectComponent();
    selectComponent.writeValue(null);
    fixture.detectChanges();

    expect(selectComponent.zValue()).toEqual([]);
  });

  it('should coerce an initial scalar value into an array in multiple mode', async () => {
    component.value.set('alpha');
    component.multiple.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const selectComponent = getSelectComponent();

    expect(component.value()).toEqual(['alpha']);
    expect(selectComponent.zValue()).toEqual(['alpha']);
  });

  it('should invoke onTouched callback when closing with keyboard escape', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    const onTouched = vi.fn();
    selectComponent.registerOnTouched(onTouched);

    await openDropdown(select);
    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'Escape'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(onTouched).toHaveBeenCalledTimes(1);
    expect(await select.isOpen()).toBe(false);
  });

  it('should ignore keyboard selection for focused items without a value attribute', async () => {
    const select = await loader.getHarness(ZardSelectHarness);
    const selectComponent = getSelectComponent();
    const warnSpy = vi
      .spyOn(logger, 'warn')
      .mockImplementation(() => undefined);

    await openDropdown(select);
    selectComponent.focusedIndex.set(0);
    fixture.detectChanges();

    const optionHost = (
      fixture.nativeElement as HTMLElement
    ).ownerDocument.querySelector<HTMLElement>(
      '.cdk-overlay-container z-select-item[value]',
    );
    optionHost?.removeAttribute('value');

    selectComponent.onDropdownKeydown(
      new KeyboardEvent('keydown', {key: 'Enter'}),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(warnSpy).toHaveBeenCalledWith(
      'No value attribute found on selected item:',
      expect.any(HTMLElement),
    );
    expect(component.lastSelection()).toBeNull();
  });
});
