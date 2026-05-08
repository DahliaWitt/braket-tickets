import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {computed, signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {vi} from 'vitest';
import {ThemeToggleComponent} from './theme-toggle.component';
import {
  BraDarkMode,
  type DarkModeOptions,
  EDarkModes,
} from '@ui/services/dark-mode';
import {ThemeToggleButtonHarness} from './theme-toggle.component.harness';

class BraDarkModeStub {
  readonly theme = signal<DarkModeOptions>(EDarkModes.SYSTEM);
  readonly themeMode = computed<EDarkModes.LIGHT | EDarkModes.DARK>(() =>
    this.theme() === EDarkModes.SYSTEM
      ? EDarkModes.LIGHT
      : (this.theme() as EDarkModes.LIGHT | EDarkModes.DARK),
  );
  readonly toggleTheme = vi.fn((mode?: DarkModeOptions) => {
    if (mode) {
      this.theme.set(mode);
    } else {
      const next =
        this.themeMode() === EDarkModes.DARK
          ? EDarkModes.LIGHT
          : EDarkModes.DARK;
      this.theme.set(next);
    }
  });
}

describe('ThemeToggleComponent', () => {
  let fixture: ComponentFixture<ThemeToggleComponent>;
  let component: ThemeToggleComponent;
  let darkMode: BraDarkModeStub;

  beforeEach(async () => {
    darkMode = new BraDarkModeStub();

    await TestBed.configureTestingModule({
      imports: [ThemeToggleComponent],
      providers: [{provide: BraDarkMode, useValue: darkMode}],
    }).compileComponents();

    fixture = TestBed.createComponent(ThemeToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('Primary Button', () => {
    it('primary click fires darkMode.toggleTheme() with no arguments', async () => {
      const loader = TestbedHarnessEnvironment.loader(fixture);
      const harness = await loader.getHarness(ThemeToggleButtonHarness);
      await harness.clickPrimary();
      expect(darkMode.toggleTheme).toHaveBeenCalledWith();
      expect(darkMode.toggleTheme).toHaveBeenCalledTimes(1);
    });

    it('aria-label is accurate for effective theme mode — dark mode shows "Switch to light theme"', async () => {
      darkMode.theme.set(EDarkModes.DARK);
      fixture.detectChanges();
      const loader = TestbedHarnessEnvironment.loader(fixture);
      const harness = await loader.getHarness(ThemeToggleButtonHarness);
      expect(await harness.getPrimaryAriaLabel()).toBe('Switch to light theme');
    });

    it('aria-label is accurate for effective theme mode — light mode shows "Switch to dark theme"', async () => {
      darkMode.theme.set(EDarkModes.LIGHT);
      fixture.detectChanges();
      const loader = TestbedHarnessEnvironment.loader(fixture);
      const harness = await loader.getHarness(ThemeToggleButtonHarness);
      expect(await harness.getPrimaryAriaLabel()).toBe('Switch to dark theme');
    });
  });

  describe('Icon Computation', () => {
    it('should compute icon by current theme state', () => {
      const iconSignal = (
        component as unknown as {currentIcon: () => 'sun' | 'moon' | 'sun-moon'}
      ).currentIcon;

      expect(iconSignal()).toBe('sun-moon');

      darkMode.theme.set(EDarkModes.LIGHT);
      fixture.detectChanges();
      expect(iconSignal()).toBe('sun');

      darkMode.theme.set(EDarkModes.DARK);
      fixture.detectChanges();
      expect(iconSignal()).toBe('moon');
    });
  });

  describe('Theme Selection', () => {
    it('should delegate selected theme to dark mode service', () => {
      component.setTheme(EDarkModes.LIGHT);
      component.setTheme(EDarkModes.DARK);
      component.setTheme(EDarkModes.SYSTEM);

      expect(darkMode.toggleTheme).toHaveBeenNthCalledWith(1, EDarkModes.LIGHT);
      expect(darkMode.toggleTheme).toHaveBeenNthCalledWith(2, EDarkModes.DARK);
      expect(darkMode.toggleTheme).toHaveBeenNthCalledWith(
        3,
        EDarkModes.SYSTEM,
      );
    });
  });

  it('exposes the chevron trigger with menu semantics', () => {
    const chevron = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="theme-chevron-btn"]',
    );

    expect(chevron).toBeTruthy();
    expect(chevron?.getAttribute('aria-haspopup')).toBe('menu');
    expect(chevron?.getAttribute('aria-label')).toBe('Theme options');
  });
});
