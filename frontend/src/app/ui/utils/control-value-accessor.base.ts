import {signal} from '@angular/core';
import type {ControlValueAccessor} from '@angular/forms';

export abstract class ControlValueAccessorBase<
  T,
> implements ControlValueAccessor {
  readonly disabled = signal(false);

  protected onChange: (value: T) => void = () => undefined;

  protected onTouched: () => void = () => undefined;

  abstract writeValue(obj: T): void;

  registerOnChange(fn: (value: T) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
