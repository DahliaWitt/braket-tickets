import '../../../../../test-setup';
import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {describe, it, expect, vi} from 'vitest';
import {toast} from 'ngx-sonner';
import {EventPosterUploaderComponent} from './event-poster-uploader.component';
import {EventPosterUploaderHarness} from './event-poster-uploader.component.harness';

// ---------------------------------------------------------------------------
// Test host
// ---------------------------------------------------------------------------

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [EventPosterUploaderComponent],
  template: `
    <app-event-poster-uploader
      [currentPosterUrl]="currentPosterUrl()"
      [uploadProgress]="uploadProgress()"
      (fileChanged)="onFileChanged($event)"
    />
  `,
})
class TestHostComponent {
  readonly currentPosterUrl = signal<string | null>(null);
  readonly uploadProgress = signal<number | null>(null);
  lastEmittedFile: File | null = undefined!;

  onFileChanged(file: File | null): void {
    this.lastEmittedFile = file;
  }
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

async function setup(
  options: {
    currentPosterUrl?: string | null;
    uploadProgress?: number | null;
  } = {},
): Promise<{
  fixture: ComponentFixture<TestHostComponent>;
  harness: EventPosterUploaderHarness;
  host: TestHostComponent;
  component: EventPosterUploaderComponent;
}> {
  await TestBed.configureTestingModule({
    imports: [TestHostComponent],
    providers: [provideZonelessChangeDetection()],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHostComponent);
  const host = fixture.componentInstance;
  host.currentPosterUrl.set(options.currentPosterUrl ?? null);
  host.uploadProgress.set(options.uploadProgress ?? null);
  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    EventPosterUploaderHarness,
  );

  const component = fixture.debugElement.children[0]
    .componentInstance as EventPosterUploaderComponent;

  return {fixture, harness, host, component};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventPosterUploaderComponent', () => {
  describe('empty state', () => {
    it('shows empty placeholder when no poster and no preview', async () => {
      const {harness} = await setup();
      expect(await harness.isEmpty()).toBe(true);
      expect(await harness.hasPreviewImage()).toBe(false);
      expect(await harness.hasCurrentImage()).toBe(false);
    });

    it('does not show clear button when no file is selected', async () => {
      const {harness} = await setup();
      expect(await harness.hasClearButton()).toBe(false);
    });

    it('restricts the file input to accepted raster image formats', async () => {
      const {harness} = await setup();
      expect(await harness.getAcceptedMimeTypes()).toBe(
        'image/jpeg,image/png,image/gif,image/webp',
      );
    });

    it('uses the native file input as the sole interactive upload control', async () => {
      const {harness} = await setup();

      expect(await harness.getUploadZoneRole()).toBeNull();
      expect(await harness.getFileInputAriaLabel()).toBe(
        'Upload event poster — click or drag an image here',
      );

      await harness.focusFileInput();
      expect(await harness.isFileInputFocused()).toBe(true);
    });

    it('uses the calibrated muted text token for the browse hint', async () => {
      const {harness} = await setup();
      expect(await harness.browseHintUsesOpaqueMutedText()).toBe(true);
    });
  });

  describe('currentPosterUrl input', () => {
    it('shows current poster image when a URL is provided', async () => {
      const {harness} = await setup({
        currentPosterUrl: 'https://example.com/poster.jpg',
      });
      expect(await harness.hasCurrentImage()).toBe(true);
      expect(await harness.getCurrentImageLoading()).toBe('eager');
      expect(await harness.isEmpty()).toBe(false);
    });
  });

  describe('effectivePosterUrl computed', () => {
    it('returns currentPosterUrl when no preview is set', async () => {
      const {component} = await setup({
        currentPosterUrl: 'https://example.com/poster.jpg',
      });
      expect(component.effectivePosterUrl()).toBe(
        'https://example.com/poster.jpg',
      );
    });

    it('returns null when neither currentPosterUrl nor preview is set', async () => {
      const {component} = await setup();
      expect(component.effectivePosterUrl()).toBeNull();
    });

    it('returns the preview URL (blob) when a file has been selected', async () => {
      const {component} = await setup({
        currentPosterUrl: 'https://example.com/poster.jpg',
      });
      // Stub URL.createObjectURL since jsdom does not implement it
      const fakeBlob = 'blob:fake-url';
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(fakeBlob);
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'flyer.jpg', {type: 'image/jpeg'});
      const event = {target: {files: [file]}} as unknown as globalThis.Event;
      component.onFileChange(event);

      expect(component.effectivePosterUrl()).toBe(fakeBlob);
      vi.restoreAllMocks();
    });
  });

  describe('file selection', () => {
    it('emits the selected File via fileChanged output', async () => {
      const {host, component} = await setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'flyer.png', {type: 'image/png'});
      const event = {target: {files: [file]}} as unknown as globalThis.Event;
      component.onFileChange(event);

      expect(host.lastEmittedFile).toBe(file);
      vi.restoreAllMocks();
    });

    it('sets fileName after selecting a file', async () => {
      const {component} = await setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'awesome-flyer.jpg', {
        type: 'image/jpeg',
      });
      const event = {target: {files: [file]}} as unknown as globalThis.Event;
      component.onFileChange(event);

      expect(component.fileName()).toBe('awesome-flyer.jpg');
      vi.restoreAllMocks();
    });

    it('shows the clear button after a file is selected', async () => {
      const {fixture, harness, component} = await setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'flyer.jpg', {type: 'image/jpeg'});
      const event = {target: {files: [file]}} as unknown as globalThis.Event;
      component.onFileChange(event);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasClearButton()).toBe(true);
      vi.restoreAllMocks();
    });

    it('rejects unsupported files like CSV and shows the accepted formats', async () => {
      const {host, component} = await setup();
      const toastSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');

      const file = new File(['name,email'], 'attendees.csv', {
        type: 'text/csv',
      });
      const event = {target: {files: [file]}} as unknown as globalThis.Event;
      component.onFileChange(event);

      expect(host.lastEmittedFile).toBeNull();
      expect(component.fileName()).toBe('');
      expect(component.posterPreviewUrl()).toBeNull();
      expect(toastSpy).toHaveBeenCalledWith(
        'Unsupported file type. Accepted formats: JPG, PNG, GIF, WEBP.',
      );
    });

    it('clears an existing local preview when a replacement file is unsupported', async () => {
      const {host, component} = await setup({
        currentPosterUrl: 'https://example.com/poster.jpg',
      });
      const toastSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      const revokeObjectURLSpy = vi
        .spyOn(URL, 'revokeObjectURL')
        .mockReturnValue(undefined);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:old-preview');

      const validFile = new File(['data'], 'flyer.jpg', {type: 'image/jpeg'});
      component.onFileChange({
        target: {files: [validFile]},
      } as unknown as globalThis.Event);

      const invalidFile = new File(['name,email'], 'attendees.csv', {
        type: 'text/csv',
      });
      component.onFileChange({
        target: {files: [invalidFile]},
      } as unknown as globalThis.Event);

      expect(host.lastEmittedFile).toBeNull();
      expect(component.fileName()).toBe('');
      expect(component.posterPreviewUrl()).toBeNull();
      expect(component.effectivePosterUrl()).toBe(
        'https://example.com/poster.jpg',
      );
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:old-preview');
      expect(toastSpy).toHaveBeenCalledWith(
        'Unsupported file type. Accepted formats: JPG, PNG, GIF, WEBP.',
      );
    });
  });

  describe('clearFile', () => {
    it('emits null via fileChanged when clearing the selection', async () => {
      const {host, component} = await setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'flyer.jpg', {type: 'image/jpeg'});
      component.onFileChange({
        target: {files: [file]},
      } as unknown as globalThis.Event);

      component.clearFile();
      expect(host.lastEmittedFile).toBeNull();
      vi.restoreAllMocks();
    });

    it('clears fileName and posterPreviewUrl on clear', async () => {
      const {component} = await setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'flyer.jpg', {type: 'image/jpeg'});
      component.onFileChange({
        target: {files: [file]},
      } as unknown as globalThis.Event);
      component.clearFile();

      expect(component.fileName()).toBe('');
      expect(component.posterPreviewUrl()).toBeNull();
      vi.restoreAllMocks();
    });

    it('falls back to currentPosterUrl after clearing a selected file', async () => {
      const {component} = await setup({
        currentPosterUrl: 'https://example.com/poster.jpg',
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'flyer.jpg', {type: 'image/jpeg'});
      component.onFileChange({
        target: {files: [file]},
      } as unknown as globalThis.Event);
      component.clearFile();

      expect(component.effectivePosterUrl()).toBe(
        'https://example.com/poster.jpg',
      );
      vi.restoreAllMocks();
    });
  });

  describe('upload progress', () => {
    it('does not show progress overlay when uploadProgress is null', async () => {
      const {harness} = await setup({uploadProgress: null});
      expect(await harness.hasProgressOverlay()).toBe(false);
    });

    it('shows progress overlay when uploadProgress is non-null', async () => {
      const {harness} = await setup({uploadProgress: 42});
      expect(await harness.hasProgressOverlay()).toBe(true);
      expect(await harness.isFileInputDisabled()).toBe(true);
    });
  });

  describe('drag-and-drop', () => {
    // jsdom does not implement DragEvent or DataTransfer, so we use minimal plain-object mocks
    // cast to the required types. The component only accesses the specific properties tested here.
    function makeDragEnterEvent(): DragEvent {
      return {
        preventDefault: vi.fn(),
        type: 'dragenter',
      } as unknown as DragEvent;
    }

    function makeDragLeaveEvent(relatedTarget: Node | null = null): DragEvent {
      const el = document.createElement('div');
      // relatedTarget outside the component's subtree → should clear isDragOver
      return {
        preventDefault: vi.fn(),
        type: 'dragleave',
        currentTarget: el,
        relatedTarget,
      } as unknown as DragEvent;
    }

    function makeDropEvent(file: File | null): DragEvent {
      const files = file ? [file] : [];
      return {
        preventDefault: vi.fn(),
        type: 'drop',
        dataTransfer: {files},
      } as unknown as DragEvent;
    }

    it('isDragOver returns false when no drag is in progress', async () => {
      const {harness} = await setup();
      expect(await harness.isDragOver()).toBe(false);
    });

    it('sets isDragOver signal on dragenter and clears on dragleave', async () => {
      const {fixture, component} = await setup();

      component.onDragEnter(makeDragEnterEvent());
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.isDragOver()).toBe(true);

      // Simulate leaving the zone entirely (relatedTarget outside the component)
      component.onDragLeave(makeDragLeaveEvent(null));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.isDragOver()).toBe(false);
    });

    it('handles a dropped file and emits via fileChanged', async () => {
      const {fixture, host, component} = await setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-drop');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'drop-flyer.jpg', {type: 'image/jpeg'});
      component.onDrop(makeDropEvent(file));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(host.lastEmittedFile).toBe(file);
      expect(component.fileName()).toBe('drop-flyer.jpg');
      expect(component.isDragOver()).toBe(false);
      vi.restoreAllMocks();
    });

    it('ignores drops when an upload is in progress', async () => {
      const {fixture, host, component} = await setup({uploadProgress: 50});
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(
        'blob:should-not-be-used',
      );
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      const file = new File(['data'], 'blocked.jpg', {type: 'image/jpeg'});
      component.onDrop(makeDropEvent(file));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(host.lastEmittedFile).toBeUndefined();
      vi.restoreAllMocks();
    });

    it('hasPreview returns true when a current poster URL is set', async () => {
      const {harness} = await setup({
        currentPosterUrl: 'https://example.com/poster.jpg',
      });
      expect(await harness.hasPreview()).toBe(true);
    });

    it('hasPreview returns false in empty state', async () => {
      const {harness} = await setup();
      expect(await harness.hasPreview()).toBe(false);
    });
  });
});
