import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import {Editor, type JSONContent} from '@tiptap/core';
import {cva} from 'class-variance-authority';
import {toast} from 'ngx-sonner';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';
import {
  ACCEPTED_IMAGE_FILE_INPUT,
  getUnsupportedImageTypeMessage,
  isAcceptedImageMimeType,
} from '@/features/admin/utils/image-upload-policy';
import {buildRichTextEmailExtensions} from './rich-text-extensions';
import {isAllowedImageUrl, isAllowedLinkUrl} from './rich-text-url-policy';

/**
 * Uploads an image file and resolves to the confirmed upload's `storageId` plus
 * a short-lived signed `previewUrl`.
 *
 * The `storageId` is the durable, load-bearing reference persisted into the
 * document (and later verified against `confirmedUploads` on send). The
 * `previewUrl` is display-only: it lets the composer show the image immediately
 * but is never emailed — the backend re-derives a durable server-owned `src`
 * from the `storageId` at send time.
 *
 * The rich-text editor is deliberately decoupled from the Convex client: the
 * consumer (integration layer) supplies this function, typically wiring
 * `generateUploadUrl` -> PUT -> `confirmUpload`. When no uploader is provided,
 * the image toolbar button is disabled.
 *
 * @param file the user-selected image file (already MIME-validated by the editor)
 * @param onProgress invoked with an integer percentage (0-100) during upload
 * @returns the confirmed `storageId` and a signed `previewUrl` for display
 */
export type RichTextImageUploadFn = (
  file: File,
  onProgress: (percent: number) => void,
) => Promise<{storageId: string; previewUrl: string}>;

/** Toolbar button styling, keyed on whether its formatting mark is active. */
const toolbarButtonVariants = cva(
  'rounded-sm px-2 py-1 text-2xs font-mono uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      active: {
        true: 'bg-primary/15 text-primary',
        false: 'text-foreground/70 hover:bg-accent/10 hover:text-foreground',
      },
    },
    defaultVariants: {active: false},
  },
);

/**
 * Standalone, zoneless rich-text editor for HTML email bodies (broadcasts +
 * ticket reminders). Wraps vanilla TipTap against a contentEditable host and
 * surfaces the ProseMirror document as serialized JSON plus derived plaintext.
 *
 * The editor schema comes from the shared allowlist via
 * {@link buildRichTextEmailExtensions}, so it is guaranteed identical to the
 * backend renderer/validator schema.
 */
@Component({
  selector: 'app-rich-text-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {class: 'bra-rte block'},
  imports: [ZardIconComponent],
  template: `
    <div
      class="bra-rte__frame rounded-sm border border-border bg-background focus-within:ring-2 focus-within:ring-primary/40"
      data-testid="rich-text-editor"
    >
      <div
        role="toolbar"
        aria-label="text formatting"
        data-testid="rich-text-toolbar"
        class="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5"
      >
        <button
          type="button"
          data-testid="rt-bold"
          [class]="toolbarBtnClass(isBoldActive())"
          [attr.aria-pressed]="isBoldActive()"
          [disabled]="disabled()"
          (click)="toggleBold()"
          aria-label="bold"
          title="bold"
        >
          bold
        </button>
        <button
          type="button"
          data-testid="rt-italic"
          [class]="toolbarBtnClass(isItalicActive())"
          [attr.aria-pressed]="isItalicActive()"
          [disabled]="disabled()"
          (click)="toggleItalic()"
          aria-label="italic"
          title="italic"
        >
          italic
        </button>
        <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
        <button
          type="button"
          data-testid="rt-heading-2"
          [class]="toolbarBtnClass(isHeading2Active())"
          [attr.aria-pressed]="isHeading2Active()"
          [disabled]="disabled()"
          (click)="toggleHeading(2)"
          aria-label="heading level 2"
          title="heading 2"
        >
          h2
        </button>
        <button
          type="button"
          data-testid="rt-heading-3"
          [class]="toolbarBtnClass(isHeading3Active())"
          [attr.aria-pressed]="isHeading3Active()"
          [disabled]="disabled()"
          (click)="toggleHeading(3)"
          aria-label="heading level 3"
          title="heading 3"
        >
          h3
        </button>
        <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
        <button
          type="button"
          data-testid="rt-bullet-list"
          [class]="toolbarBtnClass(isBulletListActive())"
          [attr.aria-pressed]="isBulletListActive()"
          [disabled]="disabled()"
          (click)="toggleBulletList()"
          aria-label="bulleted list"
          title="bulleted list"
        >
          bullets
        </button>
        <button
          type="button"
          data-testid="rt-ordered-list"
          [class]="toolbarBtnClass(isOrderedListActive())"
          [attr.aria-pressed]="isOrderedListActive()"
          [disabled]="disabled()"
          (click)="toggleOrderedList()"
          aria-label="numbered list"
          title="numbered list"
        >
          numbers
        </button>
        <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
        <button
          type="button"
          data-testid="rt-link"
          [class]="toolbarBtnClass(isLinkActive())"
          [attr.aria-pressed]="isLinkActive()"
          [disabled]="disabled()"
          (click)="openLinkEditor()"
          aria-label="add or edit link"
          title="link"
        >
          link
        </button>
        <button
          type="button"
          data-testid="rt-image"
          [class]="toolbarBtnClass(false)"
          [disabled]="isImageButtonDisabled()"
          (click)="triggerImagePicker()"
          [attr.aria-label]="
            imageUpload() ? 'insert image' : 'image upload unavailable'
          "
          title="insert image"
        >
          @if (isUploadingImage()) {
            uploading…
          } @else {
            image
          }
        </button>
      </div>

      @if (isLinkEditorOpen()) {
        <div
          data-testid="rich-text-link-editor"
          class="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-2 py-2"
        >
          <input
            #linkInput
            data-testid="rich-text-link-input"
            type="url"
            inputmode="url"
            class="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm text-foreground"
            [value]="linkUrl()"
            (input)="onLinkInput($event)"
            (keydown.enter)="applyLink(); $event.preventDefault()"
            (keydown.escape)="cancelLink()"
            placeholder="https://…"
            aria-label="link url"
          />
          <button
            type="button"
            data-testid="rich-text-link-apply"
            class="rounded-sm bg-primary px-2 py-1 font-mono text-xs tracking-wider text-primary-foreground uppercase"
            (click)="applyLink()"
          >
            apply
          </button>
          <button
            type="button"
            data-testid="rich-text-link-remove"
            class="rounded-sm border border-border px-2 py-1 font-mono text-xs tracking-wider text-foreground/80 uppercase"
            (click)="removeLink()"
          >
            remove
          </button>
          <button
            type="button"
            data-testid="rich-text-link-cancel"
            class="rounded-sm px-2 py-1 font-mono text-xs tracking-wider text-muted-foreground uppercase"
            (click)="cancelLink()"
          >
            cancel
          </button>
        </div>
      }

      @if (uploadProgress() !== null) {
        <div
          data-testid="rich-text-upload-progress"
          role="status"
          class="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5 font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          <z-icon zType="upload-cloud" class="h-3.5 w-3.5" />
          <span>uploading image… {{ uploadProgress() }}%</span>
        </div>
      }

      <div
        #editorHost
        data-testid="rich-text-editor-host"
        class="bra-rte__content min-h-40 px-3 py-2 text-sm text-foreground"
      ></div>

      <!-- Hidden file input, triggered by the image toolbar button -->
      <input
        #imageFileInput
        type="file"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        data-testid="rich-text-image-input"
        [attr.accept]="acceptedImageFileInput"
        (change)="onImageFileSelected($event)"
      />

      <!-- Inert mirror of the serialized document for test harness access -->
      <div hidden aria-hidden="true" data-testid="rich-text-json">
        {{ json() }}
      </div>
    </div>
  `,
  styles: `
    .bra-rte__content {
      outline: none;
    }
    .bra-rte__content .ProseMirror {
      outline: none;
      min-height: inherit;
    }
    .bra-rte__content h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0.5rem 0;
    }
    .bra-rte__content h3 {
      font-size: 1.1rem;
      font-weight: 600;
      margin: 0.5rem 0;
    }
    .bra-rte__content p {
      margin: 0.5rem 0;
    }
    .bra-rte__content ul {
      list-style: disc;
      padding-left: 1.5rem;
      margin: 0.5rem 0;
    }
    .bra-rte__content ol {
      list-style: decimal;
      padding-left: 1.5rem;
      margin: 0.5rem 0;
    }
    .bra-rte__content a {
      color: var(--primary);
      text-decoration: underline;
    }
    .bra-rte__content img {
      max-width: 100%;
      height: auto;
      border-radius: 0.25rem;
    }
  `,
})
export class RichTextEditorComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** Serialized ProseMirror JSON to seed the editor (e.g. editing a draft). */
  readonly initialJson = input<string | null>(null);

  /**
   * Optional id of the element that visually labels this editor. When provided,
   * the editor exposes `aria-labelledby` (pointing at the visible field label)
   * instead of the generic `aria-label`, so the accessible name matches the
   * visible label.
   */
  readonly ariaLabelledby = input<string | null>(null);

  /**
   * Async image uploader. When absent, the image button is disabled.
   * See {@link RichTextImageUploadFn}.
   */
  readonly imageUpload = input<RichTextImageUploadFn | null>(null);

  /** Disables editing and all toolbar actions. */
  readonly disabled = input(false, {transform: booleanAttribute});

  /** Emits the serialized ProseMirror JSON on every document change. */
  readonly jsonChange = output<string>();

  /** Emits best-effort plaintext (block-separated) on every document change. */
  readonly textChange = output<string>();

  private readonly editorHost =
    viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private readonly imageFileInput =
    viewChild<ElementRef<HTMLInputElement>>('imageFileInput');

  protected readonly acceptedImageFileInput = ACCEPTED_IMAGE_FILE_INPUT;

  private editor: Editor | null = null;

  /** Serialized ProseMirror JSON of the current document. */
  readonly json = signal<string>('');
  /** Best-effort plaintext extraction of the current document. */
  readonly text = signal<string>('');
  /** True when the document has no meaningful content. */
  readonly isEmpty = signal<boolean>(true);

  readonly isBoldActive = signal(false);
  readonly isItalicActive = signal(false);
  readonly isHeading2Active = signal(false);
  readonly isHeading3Active = signal(false);
  readonly isBulletListActive = signal(false);
  readonly isOrderedListActive = signal(false);
  readonly isLinkActive = signal(false);

  readonly isLinkEditorOpen = signal(false);
  readonly linkUrl = signal('');

  readonly isUploadingImage = signal(false);
  readonly uploadProgress = signal<number | null>(null);

  /**
   * Monotonic token bumped whenever the document is reset. An in-flight image
   * upload captures the token before awaiting; if it changes before the upload
   * resolves (a send/reset cleared the draft), the late `insertContent` is
   * dropped so it can never inject an image into a freshly reset draft.
   */
  private uploadGeneration = 0;

  constructor() {
    afterNextRender(() => this.initEditor());

    // Keep editability in sync if the `disabled` input changes after init.
    effect(() => {
      const disabled = this.disabled();
      this.editor?.setEditable(!disabled);
    });

    this.destroyRef.onDestroy(() => {
      this.editor?.destroy();
      this.editor = null;
    });
  }

  /**
   * Escape hatch exposing the underlying TipTap editor for advanced integration
   * (programmatic focus/selection, reading state) and testing. Returns null
   * until the view has rendered. Prefer the signals/outputs above for normal use.
   */
  getEditor(): Editor | null {
    return this.editor;
  }

  /**
   * Clears the document and invalidates any in-flight image upload. Consumers
   * MUST call this instead of reaching into `getEditor().commands.clearContent`
   * when resetting after a send/cancel: bumping the upload generation ensures a
   * late-resolving upload drops its insert rather than mutating the new draft
   * (see {@link uploadAndInsertImage}).
   */
  reset(): void {
    this.uploadGeneration++;
    this.editor?.commands.clearContent(true);
  }

  protected isImageButtonDisabled(): boolean {
    return this.disabled() || !this.imageUpload() || this.isUploadingImage();
  }

  protected toolbarBtnClass(active: boolean): string {
    return toolbarButtonVariants({active});
  }

  private initEditor(): void {
    const content = this.parseInitialContent(this.initialJson());

    // Prefer aria-labelledby (pointing at the visible field label) when supplied
    // so the accessible name matches the visible label; fall back to a generic
    // aria-label otherwise.
    const labelledBy = this.ariaLabelledby();
    const labelAttrs: Record<string, string> = labelledBy
      ? {'aria-labelledby': labelledBy}
      : {'aria-label': 'message body'};

    this.editor = new Editor({
      element: this.editorHost().nativeElement,
      extensions: buildRichTextEmailExtensions(),
      content,
      editable: !this.disabled(),
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          ...labelAttrs,
          'data-testid': 'rich-text-prosemirror',
        },
      },
      onCreate: () => this.syncDocumentState(),
      onUpdate: () => this.syncDocumentState(),
      onSelectionUpdate: () => this.syncActiveStates(),
    });
  }

  private parseInitialContent(raw: string | null): JSONContent | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as JSONContent;
    } catch (error) {
      logger.warn('rich-text-editor: ignoring invalid initialJson', error);
      return undefined;
    }
  }

  private syncDocumentState(): void {
    const editor = this.editor;
    if (!editor) return;
    const serialized = JSON.stringify(editor.getJSON());
    const plaintext = editor.getText({blockSeparator: '\n'});
    this.json.set(serialized);
    this.text.set(plaintext);
    this.isEmpty.set(editor.isEmpty);
    this.jsonChange.emit(serialized);
    this.textChange.emit(plaintext);
    this.syncActiveStates();
  }

  private syncActiveStates(): void {
    const editor = this.editor;
    if (!editor) return;
    this.isBoldActive.set(editor.isActive('bold'));
    this.isItalicActive.set(editor.isActive('italic'));
    this.isHeading2Active.set(editor.isActive('heading', {level: 2}));
    this.isHeading3Active.set(editor.isActive('heading', {level: 3}));
    this.isBulletListActive.set(editor.isActive('bulletList'));
    this.isOrderedListActive.set(editor.isActive('orderedList'));
    this.isLinkActive.set(editor.isActive('link'));
  }

  // ── Toolbar commands ─────────────────────────────────────────────────────

  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleHeading(level: 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({level}).run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  // ── Link editing ─────────────────────────────────────────────────────────

  openLinkEditor(): void {
    const editor = this.editor;
    if (!editor) return;
    const existing: unknown = editor.getAttributes('link')['href'];
    this.linkUrl.set(typeof existing === 'string' ? existing : '');
    this.isLinkEditorOpen.set(true);
  }

  onLinkInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.linkUrl.set(target.value);
    }
  }

  applyLink(): void {
    const editor = this.editor;
    if (!editor) return;
    const url = this.linkUrl().trim();

    if (url.length === 0) {
      this.removeLink();
      return;
    }

    if (!isAllowedLinkUrl(url)) {
      toast.error('links must start with http, https, or mailto');
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({href: url}).run();
    this.isLinkEditorOpen.set(false);
    this.linkUrl.set('');
  }

  removeLink(): void {
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.isLinkEditorOpen.set(false);
    this.linkUrl.set('');
  }

  cancelLink(): void {
    this.isLinkEditorOpen.set(false);
    this.linkUrl.set('');
  }

  // ── Image insertion ──────────────────────────────────────────────────────

  triggerImagePicker(): void {
    if (this.isImageButtonDisabled()) return;
    this.imageFileInput()?.nativeElement.click();
  }

  async onImageFileSelected(event: Event): Promise<void> {
    const target = event.target;
    if (!target || typeof target !== 'object' || !('files' in target)) return;
    const inputTarget = target as HTMLInputElement;
    const fileList = inputTarget.files;
    const file = fileList ? fileList[0] : null;
    // Reset so re-selecting the same file re-triggers a change event.
    inputTarget.value = '';
    if (!(file instanceof File)) return;
    await this.uploadAndInsertImage(file);
  }

  private async uploadAndInsertImage(file: File): Promise<void> {
    const upload = this.imageUpload();
    if (!upload) return;

    if (!isAcceptedImageMimeType(file.type)) {
      toast.error(getUnsupportedImageTypeMessage());
      return;
    }

    const generation = this.uploadGeneration;
    this.isUploadingImage.set(true);
    this.uploadProgress.set(0);
    try {
      const {storageId, previewUrl} = await upload(file, (percent) =>
        this.uploadProgress.set(percent),
      );
      // A send/reset cleared the draft while this upload was in flight; drop the
      // stale insert (and its toast) so it can't mutate the new draft.
      if (generation !== this.uploadGeneration) return;
      // Defensive UX guard on the signed preview url. The storageId is the
      // load-bearing reference; the backend re-derives a durable src from it.
      if (!isAllowedImageUrl(previewUrl)) {
        toast.error('image upload returned an unsupported url');
        return;
      }
      // Insert the custom image node carrying the storageId (persisted) plus the
      // preview src (display-only). setImage() cannot set custom attributes, so
      // use insertContent with the explicit node shape.
      this.editor
        ?.chain()
        .focus()
        .insertContent({
          type: 'image',
          attrs: {storageId, src: previewUrl, alt: file.name},
        })
        .run();
    } catch (error) {
      logger.error('rich-text-editor: image upload failed', error);
      toast.error(
        error instanceof Error ? error.message : 'image upload failed',
      );
    } finally {
      this.isUploadingImage.set(false);
      this.uploadProgress.set(null);
    }
  }
}
