import {isPlatformBrowser, DOCUMENT} from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';

export enum EDarkModes {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system',
}
export type DarkModeOptions =
  | EDarkModes.LIGHT
  | EDarkModes.DARK
  | EDarkModes.SYSTEM;

@Injectable({
  providedIn: 'root',
})
export class BraDarkMode {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = inject(BrowserPlatformService);

  private static readonly STORAGE_KEY = 'theme';
  private handleThemeChange = (event: MediaQueryListEvent) => {
    this.systemPrefersDarkSignal.set(event.matches);
    this.updateThemeMode(event.matches);
  };
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly themeSignal = signal<DarkModeOptions>(EDarkModes.SYSTEM);
  private readonly systemPrefersDarkSignal = signal(false);
  private darkModeQuery?: MediaQueryList;

  readonly theme = this.themeSignal.asReadonly();

  constructor() {
    if (this.isBrowser) {
      const storedTheme = this.getStoredTheme() || EDarkModes.SYSTEM;
      this.themeSignal.set(storedTheme);

      this.darkModeQuery = this.getDarkModeQuery();
      this.systemPrefersDarkSignal.set(this.darkModeQuery?.matches ?? false);

      // Fixed: Ensure we pass whether it's actually dark or not based on stored + system
      this.updateThemeMode(this.isDarkMode());

      if (storedTheme === EDarkModes.SYSTEM) {
        this.handleSystemChanges(true);
      }
    }

    this.destroyRef.onDestroy(() => {
      this.handleSystemChanges(false);
    });
  }

  readonly themeMode = computed(() => {
    if (this.themeSignal() === EDarkModes.SYSTEM) {
      return this.systemPrefersDarkSignal()
        ? EDarkModes.DARK
        : EDarkModes.LIGHT;
    }
    return this.themeSignal();
  });

  toggleTheme(targetMode?: DarkModeOptions): void {
    if (!this.isBrowser) {
      return;
    }

    if (targetMode) {
      this.applyTheme(targetMode);
    } else {
      const next =
        this.themeMode() === EDarkModes.DARK
          ? EDarkModes.LIGHT
          : EDarkModes.DARK;
      this.applyTheme(next);
    }
  }

  getCurrentTheme(): DarkModeOptions {
    return this.themeSignal();
  }

  private applyTheme(theme: DarkModeOptions): void {
    if (!this.isBrowser) {
      return;
    }

    this.browser.setLocalStorageItem(BraDarkMode.STORAGE_KEY, theme);
    this.themeSignal.set(theme);
    // whenever we apply theme call listener removal
    this.handleSystemChanges(false);

    this.darkModeQuery ??= this.getDarkModeQuery();
    this.systemPrefersDarkSignal.set(this.isDarkMode());
    this.updateThemeMode(this.isDarkMode());
    if (theme === EDarkModes.SYSTEM) {
      this.handleSystemChanges(true);
    }
  }

  private getStoredTheme(): DarkModeOptions | undefined {
    if (!this.isBrowser) {
      return undefined;
    }

    const value = this.browser.getLocalStorageItem(BraDarkMode.STORAGE_KEY);
    if (
      value === EDarkModes.LIGHT ||
      value === EDarkModes.DARK ||
      value === EDarkModes.SYSTEM
    ) {
      return value;
    }
    return undefined;
  }

  private getThemeMode(
    isDarkMode: boolean,
  ): EDarkModes.LIGHT | EDarkModes.DARK {
    return isDarkMode ? EDarkModes.DARK : EDarkModes.LIGHT;
  }

  private updateThemeMode(isDarkMode: boolean): void {
    const themeMode = this.getThemeMode(isDarkMode);
    const html = this.document.documentElement;
    html.classList.toggle('dark', isDarkMode);
    html.setAttribute('data-theme', themeMode);
    html.style.colorScheme = themeMode;
  }

  private getDarkModeQuery(): MediaQueryList | undefined {
    if (!this.isBrowser) {
      return;
    }
    return this.document.defaultView?.matchMedia(
      '(prefers-color-scheme: dark)',
    );
  }

  private isDarkMode(): boolean {
    if (!this.isBrowser) {
      return false;
    }

    const isSystemDarkMode = this.darkModeQuery?.matches ?? false;
    const stored = this.getStoredTheme();

    // Explicit overrides
    if (stored === EDarkModes.DARK) return true;
    if (stored === EDarkModes.LIGHT) return false;

    if (stored === EDarkModes.SYSTEM || stored === undefined) {
      return isSystemDarkMode;
    }

    return false;
  }

  private handleSystemChanges(addListener: boolean): void {
    if (addListener) {
      this.darkModeQuery?.addEventListener('change', this.handleThemeChange);
    } else {
      this.darkModeQuery?.removeEventListener('change', this.handleThemeChange);
    }
  }
}
