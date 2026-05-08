import { Component, ChangeDetectionStrategy, input, output, signal, computed, inject } from '@angular/core';
import { toast } from 'ngx-sonner';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';
import {
  ACCEPTED_IMAGE_FILE_INPUT,
  getAcceptedImageFormatsMessage,
  getUnsupportedImageTypeMessage,
  isAcceptedImageMimeType,
} from '@/features/admin/utils/image-upload-policy';
import { BrowserPlatformService } from '@/core/services/browser-platform.service';

@Component({
  selector: 'app-event-poster-uploader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardIconComponent],
  template: `
    <div class="flex flex-col sm:flex-row gap-6 items-start">
      <!-- Upload zone / preview pane -->
      <div
        data-testid="poster-upload-zone"
        [class]="
          'w-48 aspect-4/5 rounded-sm overflow-hidden flex-none relative cursor-pointer ' +
          'border-2 transition-colors duration-150 ' +
          'focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ' +
          uploadZoneClasses()
        "
        (click)="triggerFilePicker()"
        (keydown.enter)="triggerFilePicker()"
        (keydown.space)="triggerFilePicker()"
        (dragenter)="onDragEnter($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        [attr.aria-label]="uploadZoneAriaLabel()"
        role="button"
        tabindex="0"
      >
        <!-- Hidden file input — programmatically triggered -->
        <input
          #fileInput
          id="posterUpload"
          data-testid="poster-file-input"
          type="file"
          class="sr-only"
          (change)="onFileChange($event)"
          [attr.accept]="acceptedImageFileInput"
          aria-label="Select event flyer image"
        />

        @if (effectivePosterUrl()) {
          <!-- Preview state: image fills the zone -->
          @if (posterPreviewUrl()) {
            <img
              data-testid="poster-preview-image"
              [src]="posterPreviewUrl()!"
              alt="Selected poster preview"
              class="w-full h-full object-cover"
            />
          } @else {
            <img
              data-testid="poster-current-image"
              [src]="currentPosterUrl()!"
              loading="lazy"
              decoding="async"
              alt="Current Poster"
              class="absolute inset-0 w-full h-full object-cover"
            />
          }

          <!-- Hover overlay on preview state -->
          @if (!isDragging()) {
            <div
              data-testid="poster-hover-overlay"
              class="absolute inset-0 flex flex-col items-center justify-center gap-1.5
                     bg-background/0 hover:bg-background/60
                     text-foreground/0 hover:text-foreground
                     transition-all duration-150"
            >
              <z-icon zType="upload-cloud" class="w-6 h-6" />
              <span class="text-2xs font-mono uppercase tracking-widest">Change poster</span>
            </div>
          }
        } @else {
          <!-- Empty state -->
          <div
            data-testid="poster-empty"
            class="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center"
          >
            <z-icon
              zType="upload-cloud"
              [class]="
                'w-8 h-8 transition-transform duration-150 ' +
                (isDragOver() ? 'scale-110 text-primary' : 'text-muted-foreground')
              "
            />
            <span
              [class]="
                'text-2xs font-mono uppercase tracking-widest leading-tight ' +
                (isDragOver() ? 'text-primary' : 'text-muted-foreground')
              "
            >
              {{ isDragOver() ? 'Release to upload' : 'Drop poster here' }}
            </span>
            @if (!isDragOver()) {
              <span class="text-2xs text-muted-foreground/60 font-mono">or click to browse</span>
            }
          </div>
        }

        <!-- Drag-over highlight ring (shown over both empty and preview states) -->
        @if (isDragOver()) {
          <div
            data-testid="drag-over-overlay"
            class="absolute inset-0 pointer-events-none rounded-sm border-2 border-primary"
          ></div>
        }

        <!-- Upload progress overlay -->
        @if (uploadProgress() !== null) {
          <div
            data-testid="upload-progress-overlay"
            class="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-2"
          >
            <span class="text-xs font-mono text-foreground uppercase tracking-widest"
              >Uploading...</span
            >
            <div class="w-3/4 h-1.5 bg-foreground/20 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary rounded-full transition-[width] duration-200"
                [style.width.%]="uploadProgress()"
              ></div>
            </div>
            <span class="text-2xs font-mono text-foreground/70">{{ uploadProgress() }}%</span>
          </div>
        }
      </div>

      <!-- Controls -->
      <div class="space-y-4 grow">
        <div class="space-y-2">
          <span class="block text-xs font-mono text-muted-foreground uppercase tracking-wider"
            >Replace Flyer</span
          >
          <div class="flex items-center gap-4">
            <label
              for="posterUpload"
              class="px-4 py-2 bg-muted border border-border rounded-sm text-foreground/80 text-xs font-mono uppercase tracking-widest cursor-pointer hover:bg-accent/10 hover:border-primary/30 transition-colors"
            >
              [ choose file ]
            </label>
            <span class="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
              {{ fileName() || 'no file selected' }}
            </span>
            @if (fileName()) {
              <button
                type="button"
                data-testid="poster-clear-btn"
                (click)="clearFile(); $event.stopPropagation()"
                class="text-destructive hover:text-destructive/80 text-xs uppercase font-mono"
                aria-label="Cancel file upload"
              >
                [ cancel ]
              </button>
            }
          </div>
          <p class="text-2xs text-muted-foreground font-mono italic">
            Recommended: 4:5 or 1:1 ratio, max 5MB
          </p>
          <p class="text-2xs text-muted-foreground font-mono">
            {{ acceptedImageFormatsMessage }}
          </p>
        </div>
      </div>
    </div>
  `,
})
export class EventPosterUploaderComponent {
  private readonly browser = inject(BrowserPlatformService);

  protected readonly acceptedImageFileInput = ACCEPTED_IMAGE_FILE_INPUT;
  protected readonly acceptedImageFormatsMessage = getAcceptedImageFormatsMessage();

  /** Existing poster URL from the event record (shown when no local preview is selected). */
  readonly currentPosterUrl = input<string | null>(null);

  /**
   * Upload progress percentage (0–100) or null when no upload is in progress.
   * Passed down from the parent, which owns the upload operation.
   */
  readonly uploadProgress = input<number | null>(null);

  /** Emits the selected File when the user picks one, or null when they clear the selection. */
  fileChanged = output<File | null>();

  // ── Internal signals ────────────────────────────────────────────────────────

  readonly posterPreviewUrl = signal<string | null>(null);
  readonly fileName = signal<string>('');
  readonly isDragOver = signal(false);

  /** True while a drag is anywhere over the zone (dragenter fires before dragleave). */
  readonly isDragging = computed(() => this.isDragOver());

  /** Displays the local preview when available, otherwise falls back to the server URL. */
  readonly effectivePosterUrl = computed(() => this.posterPreviewUrl() || this.currentPosterUrl());

  /** CSS classes applied to the upload zone based on current state. */
  protected readonly uploadZoneClasses = computed(() => {
    if (this.isDragOver()) {
      return 'border-primary bg-primary/10';
    }
    if (this.effectivePosterUrl()) {
      return 'border-border';
    }
    return 'border-dashed border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50';
  });

  protected readonly uploadZoneAriaLabel = computed(() => {
    if (this.effectivePosterUrl()) {
      return 'Change event poster — click or drag a new image here';
    }
    return 'Upload event poster — click or drag an image here';
  });

  // ── Drag-and-drop handlers ───────────────────────────────────────────────────

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault(); // required to allow drop
  }

  onDragLeave(event: DragEvent): void {
    // Only clear if leaving the component entirely (not entering a child element)
    const current = event.currentTarget as Element;
    const related = event.relatedTarget as Node | null;
    if (!related || !current.contains(related)) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    // Ignore drops during an active upload
    if (this.uploadProgress() !== null) return;

    const file = event.dataTransfer?.files[0];
    if (file instanceof File) {
      this.handleFile(file);
    }
  }

  // ── File-picker trigger ──────────────────────────────────────────────────────

  triggerFilePicker(): void {
    if (this.uploadProgress() !== null) return;
    this.browser.clickElementById('posterUpload');
  }

  // ── File input handler ───────────────────────────────────────────────────────

  onFileChange(event: globalThis.Event): void {
    const target = event.target;
    if (!target || typeof target !== 'object' || !('files' in target)) return;
    const inputTarget = target as HTMLInputElement;
    // FileList in real browsers; may be an array-like in tests
    const fileList = inputTarget.files;
    const file = fileList ? fileList[0] : null;
    if (!(file instanceof File)) return;
    this.handleFile(file, inputTarget);
  }

  clearFile(): void {
    this.clearSelectedFileState();
    this.fileChanged.emit(null);
  }

  // ── Shared file handling ─────────────────────────────────────────────────────

  private handleFile(file: File, input?: HTMLInputElement): void {
    if (!isAcceptedImageMimeType(file.type)) {
      this.clearSelectedFileState();
      if (input) {
        input.value = '';
      }
      toast.error(getUnsupportedImageTypeMessage());
      this.fileChanged.emit(null);
      return;
    }

    this.clearSelectedFileState();
    this.posterPreviewUrl.set(this.browser.createObjectUrl(file));
    this.fileName.set(file.name);
    this.fileChanged.emit(file);
  }

  private clearSelectedFileState(): void {
    const prev = this.posterPreviewUrl();
    if (prev) this.browser.revokeObjectUrl(prev);
    this.posterPreviewUrl.set(null);
    this.fileName.set('');
  }
}
