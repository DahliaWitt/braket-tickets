import {TestBed} from '@angular/core/testing';
import {DOCUMENT} from '@angular/common';
import {PLATFORM_ID} from '@angular/core';
import {vi, describe, it, expect, afterEach, type Mock} from 'vitest';
import {BraDarkMode, EDarkModes, type DarkModeOptions} from './dark-mode';

describe('BraDarkMode', () => {
  let service: BraDarkMode;
  let mockDocument: Document;
  let mockLocalStorage: Record<string, string>;
  let mockMediaQueryList: {
    matches: boolean;
    addEventListener: Mock;
    removeEventListener: Mock;
  };

  const createMockDocument = (_isDarkMode = false): Partial<Document> => {
    const htmlElement = {
      classList: {
        toggle: vi.fn(),
      },
      setAttribute: vi.fn(),
      style: {colorScheme: ''},
    };

    return {
      documentElement: htmlElement as unknown as HTMLElement,
      defaultView: {
        matchMedia: vi.fn().mockReturnValue(mockMediaQueryList),
      } as unknown as Window & typeof globalThis,
    };
  };

  const setupService = (
    options: {
      isBrowser?: boolean;
      storedTheme?: DarkModeOptions | null;
      systemPrefersDark?: boolean;
    } = {},
  ): BraDarkMode => {
    const {
      isBrowser = true,
      storedTheme = null,
      systemPrefersDark = false,
    } = options;

    mockLocalStorage = {};
    if (storedTheme) {
      mockLocalStorage['theme'] = storedTheme;
    }

    mockMediaQueryList = {
      matches: systemPrefersDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockDocument = createMockDocument(systemPrefersDark) as Document;

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          mockLocalStorage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockLocalStorage[key];
        }),
        clear: vi.fn(),
      },
      writable: true,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BraDarkMode,
        {provide: DOCUMENT, useValue: mockDocument},
        {provide: PLATFORM_ID, useValue: isBrowser ? 'browser' : 'server'},
      ],
    });

    return TestBed.inject(BraDarkMode);
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be created', () => {
      service = setupService();
      expect(service).toBeTruthy();
    });

    it('should default to system theme when no stored value', () => {
      service = setupService({storedTheme: null, systemPrefersDark: true});
      expect(service.getCurrentTheme()).toBe(EDarkModes.SYSTEM);

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', true);
      expect(html.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        EDarkModes.DARK,
      );
    });

    it('should use stored light theme on init', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      expect(service.getCurrentTheme()).toBe(EDarkModes.LIGHT);
    });

    it('should use stored dark theme on init', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      expect(service.getCurrentTheme()).toBe(EDarkModes.DARK);
    });

    it('should use stored system theme on init', () => {
      service = setupService({storedTheme: EDarkModes.SYSTEM});
      expect(service.getCurrentTheme()).toBe(EDarkModes.SYSTEM);
    });

    it('should apply dark mode when system prefers dark and theme is system', () => {
      service = setupService({
        storedTheme: EDarkModes.SYSTEM,
        systemPrefersDark: true,
      });

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', true);
      expect(html.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        EDarkModes.DARK,
      );
    });

    it('should apply light mode when system prefers light and theme is system', () => {
      service = setupService({
        storedTheme: EDarkModes.SYSTEM,
        systemPrefersDark: false,
      });

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', false);
      expect(html.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        EDarkModes.LIGHT,
      );
    });

    it('should add system change listener when theme is system', () => {
      service = setupService({storedTheme: EDarkModes.SYSTEM});
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });

    it('should not add system change listener when theme is explicit', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      expect(mockMediaQueryList.addEventListener).not.toHaveBeenCalled();
    });
  });

  describe('theme signal', () => {
    it('should return readonly theme signal', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      expect(service.theme()).toBe(EDarkModes.DARK);
    });

    it('should update theme signal when theme changes', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      expect(service.theme()).toBe(EDarkModes.LIGHT);

      service.toggleTheme(EDarkModes.DARK);
      expect(service.theme()).toBe(EDarkModes.DARK);
    });
  });

  describe('themeMode computed', () => {
    it('should return DARK when explicit dark theme', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      expect(service.themeMode()).toBe(EDarkModes.DARK);
    });

    it('should return LIGHT when explicit light theme', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      expect(service.themeMode()).toBe(EDarkModes.LIGHT);
    });

    it('should return DARK when system theme and system prefers dark', () => {
      service = setupService({
        storedTheme: EDarkModes.SYSTEM,
        systemPrefersDark: true,
      });
      expect(service.themeMode()).toBe(EDarkModes.DARK);
    });

    it('should return LIGHT when system theme and system prefers light', () => {
      service = setupService({
        storedTheme: EDarkModes.SYSTEM,
        systemPrefersDark: false,
      });
      expect(service.themeMode()).toBe(EDarkModes.LIGHT);
    });

    it('should react to system preference changes while in system mode', () => {
      service = setupService({
        storedTheme: EDarkModes.SYSTEM,
        systemPrefersDark: false,
      });

      const changeHandler = mockMediaQueryList.addEventListener.mock
        .calls[0]?.[1] as ((event: MediaQueryListEvent) => void) | undefined;

      expect(service.themeMode()).toBe(EDarkModes.LIGHT);
      expect(changeHandler).toBeInstanceOf(Function);

      changeHandler?.({matches: true} as MediaQueryListEvent);
      expect(service.themeMode()).toBe(EDarkModes.DARK);
      expect(
        mockDocument.documentElement.classList.toggle,
      ).toHaveBeenLastCalledWith('dark', true);
      expect(
        mockDocument.documentElement.setAttribute,
      ).toHaveBeenLastCalledWith('data-theme', EDarkModes.DARK);

      changeHandler?.({matches: false} as MediaQueryListEvent);
      expect(service.themeMode()).toBe(EDarkModes.LIGHT);
      expect(
        mockDocument.documentElement.classList.toggle,
      ).toHaveBeenLastCalledWith('dark', false);
      expect(
        mockDocument.documentElement.setAttribute,
      ).toHaveBeenLastCalledWith('data-theme', EDarkModes.LIGHT);
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from dark to light without target', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      service.toggleTheme();

      expect(service.getCurrentTheme()).toBe(EDarkModes.LIGHT);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'theme',
        EDarkModes.LIGHT,
      );
    });

    it('should toggle from light to dark without target', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      service.toggleTheme();

      expect(service.getCurrentTheme()).toBe(EDarkModes.DARK);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'theme',
        EDarkModes.DARK,
      );
    });

    it('should set explicit target mode', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      service.toggleTheme(EDarkModes.SYSTEM);

      expect(service.getCurrentTheme()).toBe(EDarkModes.SYSTEM);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'theme',
        EDarkModes.SYSTEM,
      );
    });

    it('should apply dark class when toggling to dark', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      vi.clearAllMocks();

      service.toggleTheme(EDarkModes.DARK);

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', true);
      expect(html.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        EDarkModes.DARK,
      );
    });

    it('should remove dark class when toggling to light', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      vi.clearAllMocks();

      service.toggleTheme(EDarkModes.LIGHT);

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', false);
      expect(html.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        EDarkModes.LIGHT,
      );
    });

    it('should add system listener when toggling to system', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      vi.clearAllMocks();

      service.toggleTheme(EDarkModes.SYSTEM);

      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });

    it('should remove system listener when toggling from system to explicit', () => {
      service = setupService({storedTheme: EDarkModes.SYSTEM});
      vi.clearAllMocks();

      service.toggleTheme(EDarkModes.DARK);

      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });
  });

  describe('getCurrentTheme', () => {
    it('should return current theme value', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      expect(service.getCurrentTheme()).toBe(EDarkModes.DARK);
    });
  });

  describe('SSR (non-browser) behavior', () => {
    it('should default to system when not in browser', () => {
      service = setupService({isBrowser: false});
      expect(service.getCurrentTheme()).toBe(EDarkModes.SYSTEM);
    });

    it('should not modify DOM when not in browser', () => {
      service = setupService({isBrowser: false});
      service.toggleTheme(EDarkModes.DARK);

      // Should still be SYSTEM because toggle is no-op in SSR
      expect(service.getCurrentTheme()).toBe(EDarkModes.SYSTEM);
    });

    it('should return LIGHT from themeMode when not in browser', () => {
      service = setupService({isBrowser: false});
      // SSR defaults to light (isDarkMode returns false)
      expect(service.themeMode()).toBe(EDarkModes.LIGHT);
    });
  });

  describe('explicit theme overrides', () => {
    it('should use dark theme regardless of system preference', () => {
      service = setupService({
        storedTheme: EDarkModes.DARK,
        systemPrefersDark: false,
      });

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', true);
    });

    it('should use light theme regardless of system preference', () => {
      service = setupService({
        storedTheme: EDarkModes.LIGHT,
        systemPrefersDark: true,
      });

      const html = mockDocument.documentElement;
      expect(html.classList.toggle).toHaveBeenCalledWith('dark', false);
    });
  });

  describe('color scheme style', () => {
    it('should set colorScheme to dark when dark mode', () => {
      service = setupService({storedTheme: EDarkModes.DARK});
      expect(mockDocument.documentElement.style.colorScheme).toBe(
        EDarkModes.DARK,
      );
    });

    it('should set colorScheme to light when light mode', () => {
      service = setupService({storedTheme: EDarkModes.LIGHT});
      expect(mockDocument.documentElement.style.colorScheme).toBe(
        EDarkModes.LIGHT,
      );
    });
  });
});
