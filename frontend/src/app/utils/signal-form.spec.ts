import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import type { MaybeFieldTree } from '@angular/forms/signals';
import { form, required } from '@angular/forms/signals';
import {
  castSignalFormField,
  isSignalFormFieldInvalid,
  notBlank,
  signalFormFieldHasError,
} from './signal-form';

function field<T>(
  state: {
    touched?: boolean;
    invalid?: boolean;
    errors?: { kind: string; message?: string }[];
    dirty?: boolean;
  } = {},
): MaybeFieldTree<T> {
  return (() => ({
    touched: () => state.touched ?? false,
    dirty: () => state.dirty ?? false,
    invalid: () => state.invalid ?? false,
    errors: () => state.errors ?? [],
  })) as unknown as MaybeFieldTree<T>;
}

describe('Signal Forms helpers', () => {
  it('marks a field invalid only after touch or submission', () => {
    const untouchedInvalid = field<string>({ invalid: true });
    const touchedInvalid = field<string>({ touched: true, invalid: true });

    expect(isSignalFormFieldInvalid(untouchedInvalid)).toBe(false);
    expect(isSignalFormFieldInvalid(untouchedInvalid, true)).toBe(true);
    expect(isSignalFormFieldInvalid(touchedInvalid)).toBe(true);
  });

  it('can include dirty state for forms that surface invalid edits before blur', () => {
    const dirtyInvalid = field<string>({ dirty: true, invalid: true });

    expect(isSignalFormFieldInvalid(dirtyInvalid)).toBe(false);
    expect(isSignalFormFieldInvalid(dirtyInvalid, false, { includeDirty: true })).toBe(true);
  });

  it('treats missing field values as valid and without errors', () => {
    expect(isSignalFormFieldInvalid(null)).toBe(false);
    expect(isSignalFormFieldInvalid(undefined, true)).toBe(false);
    expect(signalFormFieldHasError(null, 'required')).toBe(false);
  });

  it('matches validation error kinds case-insensitively', () => {
    const email = field<string>({
      errors: [{ kind: 'EMAIL' }, { kind: 'minLength', message: 'Too short' }],
    });

    expect(signalFormFieldHasError(email, 'email')).toBe(true);
    expect(signalFormFieldHasError(email, 'minLength')).toBe(true);
    expect(signalFormFieldHasError(email, 'required')).toBe(false);
  });

  it('casts a dynamic field while preserving null', () => {
    const raw = field<unknown>();

    expect(castSignalFormField<string>(raw)).toBe(raw);
    expect(castSignalFormField<string>(null)).toBeNull();
  });
});

describe('notBlank validator', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('marks whitespace-only string invalid with required error', () => {
    TestBed.runInInjectionContext(() => {
      const model = signal({ name: '' });
      const f = form(model, (fb) => {
        required(fb.name);
        notBlank(fb.name);
      });

      expect(f().invalid()).toBe(true);

      model.set({ name: '   ' });
      expect(f().invalid()).toBe(true);
      expect((f as unknown as { name: () => { errors(): { kind: string }[] } }).name().errors().some((e) => e.kind === 'required')).toBe(true);

      model.set({ name: 'Alice' });
      expect(f().invalid()).toBe(false);
    });
  });

  it('does not fire for non-string values', () => {
    TestBed.runInInjectionContext(() => {
      const model = signal({ count: 0 });
      const f = form(model, (fb) => {
        required(fb.count);
      });

      model.set({ count: 5 });
      expect(f().invalid()).toBe(false);
    });
  });
});
