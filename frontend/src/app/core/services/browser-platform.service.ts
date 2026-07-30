import {DOCUMENT, isPlatformBrowser} from '@angular/common';
import {inject, Injectable, PLATFORM_ID} from '@angular/core';
import {logger} from '@/utils/logger';

@Injectable({
  providedIn: 'root',
})
export class BrowserPlatformService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private get windowRef(): Window | null {
    return this.isBrowser ? this.document.defaultView : null;
  }

  private get urlRef(): typeof URL | null {
    return this.windowRef
      ? (this.windowRef as Window & {URL: typeof URL}).URL
      : null;
  }

  private get localStorageRef(): Storage | null {
    return (
      this.windowRef?.localStorage ??
      (this.isBrowser ? globalThis.localStorage : null)
    );
  }

  private get sessionStorageRef(): Storage | null {
    return (
      this.windowRef?.sessionStorage ??
      (this.isBrowser ? globalThis.sessionStorage : null)
    );
  }

  absoluteUrl(path: string): string {
    const origin = this.windowRef?.location.origin;
    return origin ? new URL(path, origin).toString() : path;
  }

  origin(): string | undefined {
    return this.windowRef?.location.origin;
  }

  /** Returns the current hash in a browser, or null during SSR. */
  locationHash(): string | null {
    return this.windowRef?.location.hash ?? null;
  }

  /**
   * Removes a URL fragment without navigating or adding a history entry.
   * Callers use this before logging, analytics, or network work when a fragment
   * contains a bearer credential.
   */
  replaceUrlWithoutHash(): void {
    const windowRef = this.windowRef;
    if (!windowRef) return;
    const safeUrl = `${windowRef.location.pathname}${windowRef.location.search}`;
    windowRef.history.replaceState(windowRef.history.state, '', safeUrl);
  }

  /**
   * Whether a usable `localStorage` reference exists. Mirrors the condition
   * `auth.client.ts` uses to decide whether the Better Auth crossDomain plugin
   * (localStorage-backed credential) is active, so callers can tell "storage
   * present, key absent" apart from "storage unavailable".
   */
  hasLocalStorage(): boolean {
    return this.localStorageRef !== null;
  }

  getLocalStorageItem(key: string): string | null {
    try {
      return this.localStorageRef?.getItem(key) ?? null;
    } catch (error: unknown) {
      logger.warn('localStorage.getItem failed', {key, error});
      return null;
    }
  }

  setLocalStorageItem(key: string, value: string): void {
    try {
      this.localStorageRef?.setItem(key, value);
    } catch (error: unknown) {
      logger.warn('localStorage.setItem failed', {key, error});
    }
  }

  removeLocalStorageItem(key: string): void {
    try {
      this.localStorageRef?.removeItem(key);
    } catch (error: unknown) {
      logger.warn('localStorage.removeItem failed', {key, error});
    }
  }

  getLocalStorageKeys(): string[] {
    try {
      const storage = this.localStorageRef;
      if (!storage) return [];
      return Array.from({length: storage.length}, (_, index) => storage.key(index))
        .filter((key): key is string => key !== null);
    } catch (error: unknown) {
      logger.warn('localStorage key enumeration failed', {error});
      return [];
    }
  }

  removeLocalStorageItemsWithPrefix(prefix: string): void {
    for (const key of this.getLocalStorageKeys()) {
      if (key.startsWith(prefix)) {
        this.removeLocalStorageItem(key);
      }
    }
  }

  getSessionStorageItem(key: string): string | null {
    try {
      return this.sessionStorageRef?.getItem(key) ?? null;
    } catch (error: unknown) {
      logger.warn('sessionStorage.getItem failed', {key, error});
      return null;
    }
  }

  setSessionStorageItem(key: string, value: string): boolean {
    try {
      const storage = this.sessionStorageRef;
      if (!storage) {
        return false;
      }
      storage.setItem(key, value);
      return true;
    } catch (error: unknown) {
      logger.warn('sessionStorage.setItem failed', {key, error});
      return false;
    }
  }

  reload(): void {
    this.windowRef?.location.reload();
  }

  assign(url: string): void {
    this.windowRef?.location.assign(url);
  }

  open(
    url: string,
    target = '_blank',
    features = 'noopener,noreferrer',
  ): Window | null {
    return this.windowRef?.open(url, target, features) ?? null;
  }

  navigateWithAnchor(href: string, download?: string): void {
    if (!this.windowRef) return;

    const anchor = this.document.createElement('a');
    anchor.href = href;
    if (download) {
      anchor.download = download;
    }
    anchor.rel = 'noopener noreferrer';
    const shouldAttach = anchor instanceof HTMLElement;
    if (shouldAttach) {
      this.document.body.appendChild(anchor);
    }
    anchor.click();
    if (shouldAttach) {
      this.document.body.removeChild(anchor);
    }
  }

  createObjectUrl(blob: Blob): string | null {
    return this.urlRef?.createObjectURL(blob) ?? null;
  }

  revokeObjectUrl(url: string): void {
    this.urlRef?.revokeObjectURL(url);
  }

  activeElement(): Element | null {
    return this.windowRef ? this.document.activeElement : null;
  }

  focusElementById(id: string): void {
    if (!this.windowRef) return;
    const element = this.document.getElementById(id);
    if (element instanceof HTMLElement) {
      element.focus();
    }
  }

  clickElementById(id: string): void {
    if (!this.windowRef) return;
    const element = this.document.getElementById(id);
    if (element instanceof HTMLElement) {
      element.click();
    }
  }

  getComputedStyleProperty(element: Element, propertyName: string): string {
    return (
      this.windowRef
        ?.getComputedStyle(element)
        .getPropertyValue(propertyName)
        .trim() ?? ''
    );
  }

  getRootComputedStyleProperty(propertyName: string): string {
    return this.getComputedStyleProperty(
      this.document.documentElement,
      propertyName,
    );
  }

  downloadBlob(blob: Blob, filename: string): void {
    const url = this.createObjectUrl(blob);
    if (!url || !this.windowRef) return;

    const link = this.document.createElement('a');
    link.href = url;
    link.download = filename;
    let attached = false;
    let clickSucceeded = false;

    try {
      this.document.body.appendChild(link);
      attached = true;
      link.click();
      clickSucceeded = true;
    } finally {
      if (attached) {
        try {
          this.document.body.removeChild(link);
        } catch {
          // Preserve the original download error, if any.
        }
      }
      if (clickSucceeded) {
        this.windowRef.setTimeout(() => this.revokeObjectUrl(url), 60_000);
      } else {
        this.revokeObjectUrl(url);
      }
    }
  }

  async writeClipboardText(text: string): Promise<void> {
    const clipboard = this.windowRef?.navigator.clipboard;
    if (!clipboard) {
      throw new Error('Clipboard API unavailable');
    }
    await clipboard.writeText(text);
  }

  openPdfPreview(pdfDataUrl: string, title: string): boolean {
    const popup = this.windowRef?.open('', '_blank') ?? null;
    if (!popup) {
      return false;
    }

    const iframe = popup.document.createElement('iframe');
    iframe.src = pdfDataUrl;
    iframe.style.cssText =
      'border:0; position:fixed; top:0; left:0; width:100%; height:100%;';
    iframe.setAttribute('allowfullscreen', '');
    popup.document.body.style.margin = '0';
    popup.document.body.appendChild(iframe);
    popup.document.title = title;
    return true;
  }
}
