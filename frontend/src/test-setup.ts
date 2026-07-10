import {getTestBed} from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {beforeEach, vi} from 'vitest';
import {
  resetMockAuthClient,
  sharedMockAuthClient,
} from './testing/mock-auth-client';

vi.mock('./lib/auth.client', () => ({
  authClient: sharedMockAuthClient,
}));

beforeEach(() => {
  resetMockAuthClient(sharedMockAuthClient);
});

function createMemoryStorage(): Storage {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    get length() {
      return storage.size;
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
}

// Fix Node.js 22+ native storage overriding jsdom's implementation.
// Accessing the native localStorage/sessionStorage getters without
// `--localstorage-file` emits a warning in this runtime, so install memory
// storage directly instead of probing either window or globalThis first.
//
// Known issue — can be removed once resolved upstream:
//   https://github.com/nodejs/node/issues/60303
//   https://github.com/vitest-dev/vitest/issues/8757
if (typeof window !== 'undefined') {
  const localStorageShim = createMemoryStorage();
  const sessionStorageShim = createMemoryStorage();

  Object.defineProperty(window, 'localStorage', {
    value: localStorageShim,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageShim,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorageShim,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageShim,
    writable: true,
    configurable: true,
  });
}

// Mock matchMedia for JSDOM - BraDarkMode service requires it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  }),
});

// Polyfill ResizeObserver for JSDOM - ApexCharts requires it
globalThis.ResizeObserver = class ResizeObserver {
  observe() {
    return;
  }
  unobserve() {
    return;
  }
  disconnect() {
    return;
  }
};

// Polyfill IntersectionObserver for JSDOM - Angular @defer requires it
// This mock allows manual triggering of intersection events in tests
class MockIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: readonly number[] = [];
  private callback: IntersectionObserverCallback;
  private elements = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '';
    this.thresholds = options?.threshold
      ? Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold]
      : [];
  }

  observe(target: Element): void {
    this.elements.add(target);
  }

  unobserve(target: Element): void {
    this.elements.delete(target);
  }

  disconnect(): void {
    this.elements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(entries: Partial<IntersectionObserverEntry>[]): void {
    const fullEntries = entries.map((entry) => ({
      isIntersecting: true,
      target: document.createElement('div'),
      boundingClientRect: entry.boundingClientRect ?? ({} as DOMRectReadOnly),
      intersectionRatio: 1,
      intersectionRect: entry.intersectionRect ?? ({} as DOMRectReadOnly),
      rootBounds: null,
      time: Date.now(),
      ...entry,
    }));

    this.callback(fullEntries, this as unknown as IntersectionObserver);
  }
}

globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Polyfill getBBox for JSDOM - ApexCharts requires it
Object.defineProperty(SVGElement.prototype, 'getBBox', {
  writable: true,
  value: () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }),
});

// Polyfill requestSubmit for JSDOM - Angular Signal Forms uses it
if (
  typeof HTMLFormElement !== 'undefined' &&
  !HTMLFormElement.prototype.requestSubmit
) {
  HTMLFormElement.prototype.requestSubmit = function () {
    this.dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
  };
}

// Mock BroadcastChannel for environments that don't support it (JSDOM)
if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class MockBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) {
      this.name = name;
    }
    postMessage() {
      return;
    }
    close() {
      return;
    }
    addEventListener() {
      return;
    }
    removeEventListener() {
      return;
    }
    dispatchEvent() {
      return true;
    }
  };
}

// Initialize Angular test environment only if not already initialized
const testBed = getTestBed();
if (!testBed.platform) {
  testBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}
