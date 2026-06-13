import {DOCUMENT} from '@angular/common';
import {TestBed} from '@angular/core/testing';
import {describe, expect, it, vi} from 'vitest';
import {BrowserPlatformService} from './browser-platform.service';

describe('BrowserPlatformService', () => {
  function setup() {
    const appended: HTMLElement[] = [];
    const removed: HTMLElement[] = [];
    const createElement = vi.fn((tagName: string) => {
      const node = window.document.createElement(tagName);
      vi.spyOn(node, 'click').mockImplementation(() => undefined);
      return node;
    });
    const documentStub = {
      defaultView: {
        location: {
          origin: 'https://example.test',
          reload: vi.fn(),
          assign: vi.fn(),
        },
        open: vi.fn(),
        setTimeout: vi.fn(() => 1),
        localStorage: {
          getItem: vi.fn((key: string) => (key === 'debug' ? 'true' : null)),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        sessionStorage: {
          getItem: vi.fn((key: string) => (key === 'reload' ? '123' : null)),
          setItem: vi.fn(),
        },
        getComputedStyle: vi.fn(() => ({
          getPropertyValue: vi.fn((name: string) =>
            name === '--primary' ? '1 2 3' : '',
          ),
        })),
        navigator: {
          clipboard: {
            writeText: vi.fn().mockResolvedValue(undefined),
          },
        },
        URL: {
          createObjectURL: vi.fn(() => 'blob:download'),
          revokeObjectURL: vi.fn(),
        },
      },
      body: {
        appendChild: vi.fn((node: HTMLElement) => {
          appended.push(node);
          return node;
        }),
        removeChild: vi.fn((node: HTMLElement) => {
          removed.push(node);
          return node;
        }),
      },
      createElement,
      getElementById: vi.fn(() => null),
      documentElement: window.document.documentElement,
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        BrowserPlatformService,
        {provide: DOCUMENT, useValue: documentStub},
      ],
    });

    return {
      service: TestBed.inject(BrowserPlatformService),
      documentStub,
      createElement,
      appended,
      removed,
    };
  }

  it('builds absolute URLs from the browser origin', () => {
    const {service} = setup();

    expect(service.absoluteUrl('/confirm/password-reset')).toBe(
      'https://example.test/confirm/password-reset',
    );
  });

  it('wraps local storage access behind a safe API', () => {
    const {service, documentStub} = setup();

    expect(service.getLocalStorageItem('debug')).toBe('true');

    service.setLocalStorageItem('theme', 'dark');
    service.removeLocalStorageItem('theme');

    expect(documentStub.defaultView?.localStorage.setItem).toHaveBeenCalledWith(
      'theme',
      'dark',
    );
    expect(
      documentStub.defaultView?.localStorage.removeItem,
    ).toHaveBeenCalledWith('theme');
  });

  it('wraps session storage access behind a safe API', () => {
    const {service, documentStub} = setup();

    expect(service.getSessionStorageItem('reload')).toBe('123');

    expect(service.setSessionStorageItem('reload', '456')).toBe(true);

    expect(
      documentStub.defaultView?.sessionStorage.setItem,
    ).toHaveBeenCalledWith('reload', '456');
  });

  it('reports session storage write failures', () => {
    const {service, documentStub} = setup();
    vi.mocked(
      documentStub.defaultView!.sessionStorage.setItem,
    ).mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });

    expect(service.setSessionStorageItem('reload', '456')).toBe(false);
  });

  it('focuses and clicks elements by id through the document boundary', () => {
    const {service, documentStub} = setup();
    const button = window.document.createElement('button');
    const focusSpy = vi
      .spyOn(button, 'focus')
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(button, 'click')
      .mockImplementation(() => undefined);
    vi.mocked(documentStub.getElementById).mockReturnValue(button);

    service.focusElementById('tab-login');
    service.clickElementById('posterUpload');

    expect(documentStub.getElementById).toHaveBeenCalledWith('tab-login');
    expect(documentStub.getElementById).toHaveBeenCalledWith('posterUpload');
    expect(focusSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('reads computed CSS variables through the browser boundary', () => {
    const {service, documentStub} = setup();

    expect(service.getRootComputedStyleProperty('--primary')).toBe('1 2 3');
    expect(documentStub.defaultView?.getComputedStyle).toHaveBeenCalledWith(
      documentStub.documentElement,
    );
  });

  it('downloads blobs with a temporary anchor and defers object URL revocation', () => {
    const {service, documentStub, appended, removed} = setup();
    const blob = new Blob(['id,name']);

    service.downloadBlob(blob, 'attendees.csv');

    expect(documentStub.defaultView?.URL.createObjectURL).toHaveBeenCalledWith(
      blob,
    );
    expect(appended).toHaveLength(1);
    expect((appended[0] as HTMLAnchorElement).download).toBe('attendees.csv');
    expect(removed).toEqual(appended);
    expect(
      documentStub.defaultView?.URL.revokeObjectURL,
    ).not.toHaveBeenCalled();
    expect(documentStub.defaultView?.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      60_000,
    );
  });

  it('cleans up blob downloads when the click throws', () => {
    const {service, documentStub, createElement, appended, removed} = setup();
    const blob = new Blob(['id,name']);
    const link = window.document.createElement('a');
    vi.spyOn(link, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });
    createElement.mockReturnValueOnce(link);

    expect(() => service.downloadBlob(blob, 'attendees.csv')).toThrow(
      'click failed',
    );

    expect(appended).toEqual([link]);
    expect(removed).toEqual([link]);
    expect(documentStub.defaultView?.URL.revokeObjectURL).toHaveBeenCalledWith(
      'blob:download',
    );
    expect(documentStub.defaultView?.setTimeout).not.toHaveBeenCalled();
  });

  it('writes clipboard text through the browser boundary', async () => {
    const {service, documentStub} = setup();

    await service.writeClipboardText('ticket_123');

    expect(
      documentStub.defaultView?.navigator.clipboard.writeText,
    ).toHaveBeenCalledWith('ticket_123');
  });

  it('rejects clipboard writes when the Clipboard API is unavailable', async () => {
    const {service, documentStub} = setup();
    const defaultView = documentStub.defaultView as unknown as {
      navigator: {clipboard?: unknown};
    };
    delete defaultView.navigator.clipboard;

    await expect(service.writeClipboardText('ticket_123')).rejects.toThrow(
      'Clipboard API unavailable',
    );
  });

  it('opens PDF previews through a writable popup without document.write', () => {
    const {service, documentStub} = setup();
    const iframe = {src: '', style: {cssText: ''}, setAttribute: vi.fn()};
    const body = {style: {margin: ''}, appendChild: vi.fn()};
    const popup = {
      document: {
        createElement: vi.fn().mockReturnValue(iframe),
        write: vi.fn(),
        body,
        title: '',
      },
    };
    vi.mocked(documentStub.defaultView!.open).mockReturnValue(
      popup as unknown as Window,
    );

    expect(
      service.openPdfPreview(
        'data:application/pdf;base64,abc123',
        'Ticket PDF',
      ),
    ).toBe(true);

    expect(documentStub.defaultView?.open).toHaveBeenCalledWith('', '_blank');
    expect(popup.document.write).not.toHaveBeenCalled();
    expect(popup.document.createElement).toHaveBeenCalledWith('iframe');
    expect(iframe.src).toBe('data:application/pdf;base64,abc123');
    expect(iframe.style.cssText).toBe(
      'border:0; position:fixed; top:0; left:0; width:100%; height:100%;',
    );
    expect(iframe.setAttribute).toHaveBeenCalledWith('allowfullscreen', '');
    expect(body.style.margin).toBe('0');
    expect(body.appendChild).toHaveBeenCalledWith(iframe);
    expect(popup.document.title).toBe('Ticket PDF');
  });

  it('reports blocked PDF preview popups', () => {
    const {service, documentStub} = setup();
    vi.mocked(documentStub.defaultView!.open).mockReturnValue(null);

    expect(
      service.openPdfPreview(
        'data:application/pdf;base64,abc123',
        'Ticket PDF',
      ),
    ).toBe(false);
  });
});
