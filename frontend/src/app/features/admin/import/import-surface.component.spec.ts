import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type HarnessLoader} from '@angular/cdk/testing';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ImportSurfaceComponent} from './import-surface.component';
import {ImportSurfaceComponentHarness} from './import-surface.component.harness';
import {
  BUYER_IMPORT_CONFIG,
  GUEST_IMPORT_CONFIG,
  type ImportTargetConfig,
} from './import-config';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import type {ImportConfirmPayload, ImportReport} from './import-surface.types';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [ImportSurfaceComponent],
  template: `
    <app-import-surface
      [config]="config()"
      [existingStrongKeys]="existingStrong()"
      [report]="report()"
      (confirmed)="onConfirmed($event)"
    />
  `,
})
class TestHostComponent {
  readonly config = signal<ImportTargetConfig>(GUEST_IMPORT_CONFIG);
  readonly existingStrong = signal<ReadonlySet<string>>(new Set());
  readonly report = signal<ImportReport | null>(null);
  readonly lastPayload = signal<ImportConfirmPayload | null>(null);

  onConfirmed(payload: ImportConfirmPayload): void {
    this.lastPayload.set(payload);
  }
}

describe('ImportSurfaceComponent', () => {
  let loader: HarnessLoader;
  let host: TestHostComponent;
  let downloadBlob: ReturnType<
    typeof vi.fn<(blob: Blob, filename: string) => void>
  >;

  beforeEach(async () => {
    downloadBlob = vi.fn();
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: BrowserPlatformService,
          useValue: {downloadBlob},
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.autoDetectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  async function harness(): Promise<ImportSurfaceComponentHarness> {
    return loader.getHarness(ImportSurfaceComponentHarness);
  }

  it('renders the target title in brand voice (lowercase)', async () => {
    const h = await harness();
    expect(await h.getTitleText()).toBe('bulk add guests');
  });

  it('starts on the input step showing the empty state', async () => {
    const h = await harness();
    expect(await h.getActiveStep()).toBe('input');
    expect(await h.isEmptyStateVisible()).toBe(true);
  });

  it('disables next until rows are pasted', async () => {
    const h = await harness();
    expect(await h.isParseNextDisabled()).toBe(true);
    await h.pasteText('Name\nzoe');
    expect(await h.isParseNextDisabled()).toBe(false);
  });

  it('advances to preview and partitions rows', async () => {
    const h = await harness();
    await h.pasteText('Name,Email\nzoe,zoe@example.test\n,bad\nsam,nope');
    await h.clickNext();
    expect(await h.getActiveStep()).toBe('preview');
    expect(await h.getRowCountByPartition('valid')).toBe(1);
    expect(await h.getRowCountByPartition('invalid')).toBe(2);
  });

  it('surfaces per-row reasons in the preview', async () => {
    const h = await harness();
    await h.pasteText('Name,Email\n,zoe@example.test');
    await h.clickNext();
    const reasons = await h.getReasonTexts();
    expect(reasons.some((r) => r.includes('missing name'))).toBe(true);
  });

  it('shows a parse error for header-only input', async () => {
    const h = await harness();
    await h.pasteText('Name,Email');
    await h.clickNext();
    expect(await h.getActiveStep()).toBe('input');
    expect(await h.getParseErrorText()).toContain('no rows found');
  });

  describe('column mapping step', () => {
    it('routes to mapping on duplicate headers and resolves via dropdowns', async () => {
      const h = await harness();
      await h.pasteText('Name,Name,Email\nzoe,zee,zoe@example.test');
      await h.clickNext();
      expect(await h.getActiveStep()).toBe('mapping');
      expect(await h.getMappingRowCount()).toBe(3);

      await h.setColumnMapping(0, 'name');
      await h.setColumnMapping(1, '');
      await h.setColumnMapping(2, 'email');
      await h.clickMappingNext();
      expect(await h.getActiveStep()).toBe('preview');
      expect(await h.getRowCountByPartition('valid')).toBe(1);
    });

    it('shows a mapping error when no name column is chosen', async () => {
      const h = await harness();
      await h.pasteText('Name,Name\nzoe,zee');
      await h.clickNext();
      await h.setColumnMapping(0, '');
      await h.setColumnMapping(1, '');
      await h.clickMappingNext();
      expect(await h.getActiveStep()).toBe('mapping');
      expect(await h.getMappingErrorText()).toContain('name');
    });
  });

  describe('guest target', () => {
    it('hides the dedup toggle and source input', async () => {
      const h = await harness();
      await h.pasteText('Name\nzoe');
      await h.clickNext();
      expect(await h.hasDedupToggle()).toBe(false);
      expect(await h.hasSourceInput()).toBe(false);
    });
  });

  describe('buyer target', () => {
    beforeEach(() => {
      host.config.set(BUYER_IMPORT_CONFIG);
    });

    it('shows the dedup toggle and source input', async () => {
      const h = await harness();
      await h.pasteText('Billing name,Barcode\ndoe jane,ABC');
      await h.clickNext();
      expect(await h.hasDedupToggle()).toBe(true);
      expect(await h.hasSourceInput()).toBe(true);
    });

    it('toggling include duplicates keeps within-batch barcode dupes valid', async () => {
      const h = await harness();
      await h.pasteText('Billing name,Barcode\ndoe jane,ABC\ndoe jane,ABC');
      await h.clickNext();
      expect(await h.getRowCountByPartition('valid')).toBe(1);
      expect(await h.getRowCountByPartition('duplicate')).toBe(1);
      await h.toggleDedup();
      expect(await h.isDedupIncludeChecked()).toBe(true);
      expect(await h.getRowCountByPartition('valid')).toBe(2);
      expect(await h.getRowCountByPartition('duplicate')).toBe(0);
    });

    it('emits the source label defaulting to External when blank', async () => {
      const h = await harness();
      await h.pasteText('Billing name,Barcode\ndoe jane,ABC');
      await h.clickNext();
      await h.clickConfirm();
      const payload = host.lastPayload();
      expect(payload?.sourceLabel).toBe('External');
      expect(payload?.rows).toHaveLength(1);
      expect(payload?.batchKey).toBeTruthy();
    });

    it('emits the entered source label', async () => {
      const h = await harness();
      await h.pasteText('Billing name,Barcode\ndoe jane,ABC');
      await h.clickNext();
      await h.setSourceLabel('RA');
      await h.clickConfirm();
      expect(host.lastPayload()?.sourceLabel).toBe('RA');
    });
  });

  describe('over-cap rejection', () => {
    beforeEach(() => {
      host.config.set({...GUEST_IMPORT_CONFIG, maxRows: 2});
    });

    it('blocks confirm and shows the split-the-file message', async () => {
      const h = await harness();
      await h.pasteText('Name\nzoe\nsam\nlee');
      await h.clickNext();
      expect(await h.isOverCapErrorVisible()).toBe(true);
      expect(await h.isConfirmDisabled()).toBe(true);
    });
  });

  it('downloads the template CSV without navigating away', async () => {
    const h = await harness();
    await h.clickTemplateDownload();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = downloadBlob.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toBe('braket-guest-import-template.csv');
  });

  it('emits a confirm payload with only valid rows', async () => {
    const h = await harness();
    await h.pasteText('Name,Email\nzoe,zoe@example.test\n,bad');
    await h.clickNext();
    await h.clickConfirm();
    const payload = host.lastPayload();
    expect(payload?.rows).toHaveLength(1);
    expect(payload?.rows[0].name).toBe('zoe');
    expect(payload?.dedupMode).toBe('skip');
  });

  it('shows the server report once the consumer sets it', async () => {
    const h = await harness();
    await h.pasteText('Name\nzoe');
    await h.clickNext();
    await h.clickConfirm();
    expect(await h.getActiveStep()).toBe('report');
    host.report.set({inserted: 3, skipped: 1});
    expect(await h.getReportInsertedText()).toContain('3 added');
    expect(await h.getReportSkippedText()).toContain('1 skipped');
  });

  it('shows a terminal error from the server report', async () => {
    const h = await harness();
    await h.pasteText('Name\nzoe');
    await h.clickNext();
    await h.clickConfirm();
    host.report.set({
      inserted: 0,
      skipped: 0,
      errorMessage: 'that batch is too large — split the file',
    });
    expect(await h.getReportErrorText()).toContain('too large');
  });
});
