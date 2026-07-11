import '../../../../../test-setup';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {describe, it, expect, vi} from 'vitest';
import {toast} from 'ngx-sonner';
import {
  RichTextEditorComponent,
  type RichTextImageUploadFn,
} from './rich-text-editor.component';
import {RichTextEditorHarness} from './rich-text-editor.component.harness';

const PARAGRAPH_DOC = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{type: 'text', text: 'hello world'}],
    },
  ],
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [RichTextEditorComponent],
  template: `
    <app-rich-text-editor
      [initialJson]="initialJson()"
      [imageUpload]="imageUpload()"
      [disabled]="disabled()"
      [ariaLabelledby]="ariaLabelledby()"
      (jsonChange)="onJsonChange($event)"
      (textChange)="onTextChange($event)"
    />
  `,
})
class TestHostComponent {
  readonly initialJson = signal<string | null>(null);
  readonly imageUpload = signal<RichTextImageUploadFn | null>(null);
  readonly disabled = signal(false);
  readonly ariaLabelledby = signal<string | null>(null);

  lastJson: string | null = null;
  lastText: string | null = null;

  onJsonChange(json: string): void {
    this.lastJson = json;
  }
  onTextChange(text: string): void {
    this.lastText = text;
  }
}

interface Setup {
  fixture: ComponentFixture<TestHostComponent>;
  host: TestHostComponent;
  component: RichTextEditorComponent;
  harness: RichTextEditorHarness;
}

async function setup(
  options: {
    initialJson?: string | null;
    imageUpload?: RichTextImageUploadFn | null;
    disabled?: boolean;
    ariaLabelledby?: string | null;
  } = {},
): Promise<Setup> {
  await TestBed.configureTestingModule({
    imports: [TestHostComponent],
    providers: [provideZonelessChangeDetection()],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHostComponent);
  const host = fixture.componentInstance;
  host.initialJson.set(options.initialJson ?? null);
  host.imageUpload.set(options.imageUpload ?? null);
  host.disabled.set(options.disabled ?? false);
  host.ariaLabelledby.set(options.ariaLabelledby ?? null);

  fixture.detectChanges();
  await fixture.whenStable();
  // afterNextRender creates the editor; flush once more so it exists.
  fixture.detectChanges();
  await fixture.whenStable();

  const component = fixture.debugElement.children[0]
    .componentInstance as RichTextEditorComponent;
  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    RichTextEditorHarness,
  );

  return {fixture, host, component, harness};
}

async function flush(
  fixture: ComponentFixture<TestHostComponent>,
): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('RichTextEditorComponent', () => {
  it('creates the editor after render', async () => {
    const {component} = await setup();
    expect(component.getEditor()).not.toBeNull();
  });

  describe('accessible name', () => {
    it('falls back to a generic aria-label when no labelledby is provided', async () => {
      const {harness} = await setup();
      expect(await harness.getBodyAriaLabelledby()).toBeNull();
      expect(await harness.getBodyAriaLabel()).toBe('message body');
    });

    it('exposes aria-labelledby (and drops aria-label) when a label id is given', async () => {
      const {harness} = await setup({ariaLabelledby: 'message-label'});
      expect(await harness.getBodyAriaLabelledby()).toBe('message-label');
      expect(await harness.getBodyAriaLabel()).toBeNull();
    });
  });

  describe('formatting toggles update the emitted JSON', () => {
    it('applies bold to the selection and emits updated JSON', async () => {
      const {component, host, harness, fixture} = await setup({
        initialJson: PARAGRAPH_DOC,
      });

      component.getEditor()?.commands.selectAll();
      await harness.clickBold();
      await flush(fixture);

      expect(host.lastJson).toContain('"type":"bold"');
      expect(await harness.getSerializedJson()).toContain('"type":"bold"');
      expect(await harness.isBoldActive()).toBe(true);
    });

    it('wraps the document in a bullet list and emits updated JSON', async () => {
      const {host, harness, fixture} = await setup({
        initialJson: PARAGRAPH_DOC,
      });

      await harness.clickBulletList();
      await flush(fixture);

      expect(host.lastJson).toContain('"type":"bulletList"');
      expect(await harness.isBulletListActive()).toBe(true);
    });

    it('wraps the document in an ordered list and emits updated JSON', async () => {
      const {host, harness, fixture} = await setup({
        initialJson: PARAGRAPH_DOC,
      });

      await harness.clickOrderedList();
      await flush(fixture);

      expect(host.lastJson).toContain('"type":"orderedList"');
      expect(await harness.isOrderedListActive()).toBe(true);
    });
  });

  describe('links', () => {
    it('rejects a javascript: URL and does not modify the document', async () => {
      const {component, harness, fixture} = await setup({
        initialJson: PARAGRAPH_DOC,
      });
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');

      component.getEditor()?.commands.selectAll();
      await harness.insertLink('javascript:alert(1)');
      await flush(fixture);

      expect(errorSpy).toHaveBeenCalledWith(
        'links must start with http, https, or mailto',
      );
      expect(await harness.getSerializedJson()).not.toContain('"type":"link"');
      // Rejected input keeps the editor open so the user can correct it.
      expect(await harness.isLinkEditorOpen()).toBe(true);

      errorSpy.mockRestore();
    });

    it('accepts an https URL and adds a link mark', async () => {
      const {component, harness, fixture} = await setup({
        initialJson: PARAGRAPH_DOC,
      });

      component.getEditor()?.commands.selectAll();
      await harness.insertLink('https://example.com/party');
      await flush(fixture);

      const json = await harness.getSerializedJson();
      expect(json).toContain('"type":"link"');
      expect(json).toContain('https://example.com/party');
      expect(await harness.isLinkEditorOpen()).toBe(false);
    });
  });

  describe('image insertion', () => {
    it('runs the injected upload flow and inserts the storageId + preview src', async () => {
      const storageId = 'kg2confirmedstorageid';
      const previewUrl = 'https://cdn.example.com/poster.png';
      const uploadFn = vi.fn<RichTextImageUploadFn>().mockResolvedValue({
        storageId,
        previewUrl,
      });
      const {component, host, harness, fixture} = await setup({
        imageUpload: uploadFn,
      });

      const file = new File(['bytes'], 'poster.png', {type: 'image/png'});
      await component.onImageFileSelected(makeFileEvent(file));
      await flush(fixture);

      expect(uploadFn).toHaveBeenCalledTimes(1);
      expect(uploadFn.mock.calls[0][0]).toBe(file);

      const json = await harness.getSerializedJson();
      expect(json).toContain('"type":"image"');
      // The load-bearing storageId is persisted; the preview src is display-only.
      expect(json).toContain(storageId);
      expect(json).toContain(previewUrl);
      expect(host.lastJson).toContain(storageId);
    });

    it('drops a late upload insert when the document is reset mid-upload', async () => {
      let resolveUpload!: (value: {
        storageId: string;
        previewUrl: string;
      }) => void;
      const uploadFn = vi.fn<RichTextImageUploadFn>(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve;
          }),
      );
      const {component, harness, fixture} = await setup({
        imageUpload: uploadFn,
      });

      const file = new File(['bytes'], 'poster.png', {type: 'image/png'});
      // Start the upload but leave it pending on the deferred promise.
      const uploadDone = component.onImageFileSelected(makeFileEvent(file));
      await flush(fixture);
      expect(component.isUploadingImage()).toBe(true);

      // A send/reset clears the draft while the upload is still in flight.
      component.reset();

      // The upload now resolves — its insert must be dropped, not applied to
      // the freshly reset draft.
      resolveUpload({
        storageId: 'kg2confirmedstorageid',
        previewUrl: 'https://cdn.example.com/poster.png',
      });
      await uploadDone;
      await flush(fixture);

      expect(await harness.getSerializedJson()).not.toContain('"type":"image"');
      expect(component.isUploadingImage()).toBe(false);
    });

    it('rejects an unsupported file type before uploading', async () => {
      const uploadFn = vi.fn<RichTextImageUploadFn>();
      const {component, harness, fixture} = await setup({
        imageUpload: uploadFn,
      });
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');

      const file = new File(['a,b'], 'list.csv', {type: 'text/csv'});
      await component.onImageFileSelected(makeFileEvent(file));
      await flush(fixture);

      expect(uploadFn).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        'Unsupported file type. Accepted formats: JPG, PNG, GIF, WEBP.',
      );
      expect(await harness.getSerializedJson()).not.toContain('"type":"image"');

      errorSpy.mockRestore();
    });

    it('rejects a non-http(s) preview URL returned by the uploader (never inserts base64)', async () => {
      const uploadFn = vi.fn<RichTextImageUploadFn>().mockResolvedValue({
        storageId: 'kg2confirmedstorageid',
        previewUrl: 'data:image/png;base64,AAAA',
      });
      const {component, harness, fixture} = await setup({
        imageUpload: uploadFn,
      });
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');

      const file = new File(['bytes'], 'poster.png', {type: 'image/png'});
      await component.onImageFileSelected(makeFileEvent(file));
      await flush(fixture);

      expect(uploadFn).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        'image upload returned an unsupported url',
      );
      expect(await harness.getSerializedJson()).not.toContain('"type":"image"');

      errorSpy.mockRestore();
    });

    it('disables the image button when no uploader is provided', async () => {
      const {harness} = await setup({imageUpload: null});
      expect(await harness.isImageButtonDisabled()).toBe(true);
    });

    it('restricts the file input to accepted raster image formats', async () => {
      const {harness} = await setup({imageUpload: vi.fn()});
      expect(await harness.getAcceptedImageTypes()).toBe(
        'image/jpeg,image/png,image/gif,image/webp',
      );
    });
  });
});

/** Builds a change Event whose target exposes the given file, matching the
 * shape the component reads without depending on jsdom's FileList. */
function makeFileEvent(file: File): Event {
  return {
    target: {files: [file], value: ''},
  } as unknown as Event;
}
