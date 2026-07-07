import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type OnDestroy,
  type OnInit,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {type api} from '@convex/_generated/api';
import {type FunctionReturnType} from 'convex/server';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {logger} from '@/utils/logger';
import {QR_SCANNER_CTOR, type QrScannerCtor} from './qr-scanner.token';

type CheckInResult = FunctionReturnType<typeof api.events.check_in.checkIn>;

@Component({
  selector: 'app-check-in-scanner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardCardComponent],
  template: `
    <div
      [class.hidden]="!isExpanded() && !isScanning()"
      class="animate-in fade-in slide-in-from-top-4 md:slide-in-from-top-0 space-y-4 duration-300 md:animate-none lg:sticky lg:top-24 lg:block"
    >
      <z-card
        [zTitle]="'Scanner'"
        class="ph-no-capture border-border bg-card/60 shadow-2xl backdrop-blur-sm"
      >
        <div class="space-y-4">
          <div
            class="group relative aspect-square overflow-hidden rounded-xl border border-border bg-black shadow-inner dark:bg-black"
          >
            <video
              #videoElement
              playsinline
              muted
              [style.display]="isScanning() ? 'block' : 'none'"
              class="h-full w-full object-cover"
              aria-label="QR code scanner camera feed"
              [attr.aria-hidden]="!isScanning()"
            ></video>

            @if (!isScanning()) {
              <div
                class="absolute inset-0 flex flex-col items-center justify-center bg-muted/50 p-8 text-center"
              >
                <button
                  type="button"
                  class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted shadow-lg transition-transform active:scale-95"
                  (click)="startScanning()"
                  aria-label="Start QR code scanning"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden="true"
                  >
                    <path d="M21 12V3H3v18h9" />
                    <path d="M16 6a3 3 0 0 1 3 3" />
                    <path d="M16 10a3 3 0 0 1 3 3" />
                    <path d="M10 6a3 3 0 0 1 3 3" />
                    <path d="M10 10a3 3 0 0 1 3 3" />
                    <path d="M10 14a3 3 0 0 1 3 3" />
                    <path d="M15 17h6" />
                    <path d="M18 14v6" />
                  </svg>
                </button>
                <p class="mono-label text-xs font-bold text-muted-foreground">
                  Camera Off
                </p>
                <p class="mt-2 text-2xs text-muted-foreground uppercase">
                  tap the button to start scanning
                </p>
              </div>
            }

            <!-- Scanner Overlay -->
            @else {
              <div
                class="pointer-events-none absolute inset-0 border-2 border-primary/20"
              >
                <div class="absolute inset-0 flex items-center justify-center">
                  <div
                    class="relative h-2/3 w-2/3 rounded-2xl border border-white/20"
                  >
                    <div
                      class="absolute top-0 left-0 h-8 w-8 rounded-tl-lg border-t-4 border-l-4 border-primary"
                    ></div>
                    <div
                      class="absolute top-0 right-0 h-8 w-8 rounded-tr-lg border-t-4 border-r-4 border-primary"
                    ></div>
                    <div
                      class="absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-b-4 border-l-4 border-primary"
                    ></div>
                    <div
                      class="absolute right-0 bottom-0 h-8 w-8 rounded-br-lg border-r-4 border-b-4 border-primary"
                    ></div>

                    <!-- Scanning line animation -->
                    <div
                      class="absolute inset-x-0 top-0 h-0.5 animate-[check-in-scan_2s_linear_infinite] bg-primary/40 shadow-[0_0_15px_hsl(var(--primary)/0.5)]"
                    ></div>
                  </div>
                </div>
              </div>
            }
          </div>

          <div class="flex gap-2">
            @if (!isScanning()) {
              <z-button
                zType="default"
                zSize="lg"
                (click)="startScanning()"
                [zDisabled]="!hasCamera() || isProcessing()"
                class="flex-1 py-6 font-mono tracking-widest"
              >
                START SCANNER
              </z-button>
            } @else {
              <z-button
                zType="destructive"
                zSize="lg"
                (click)="stopScanning()"
                [zDisabled]="isProcessing()"
                class="flex-1 py-6 font-mono tracking-widest"
              >
                STOP SCANNER
              </z-button>
            }
          </div>

          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="sound-toggle"
              [attr.aria-label]="
                isSoundEnabled()
                  ? 'Mute scanner sounds'
                  : 'Enable scanner sounds'
              "
              (click)="soundToggleRequested.emit()"
              class="inline-flex min-h-9 items-center gap-2 rounded-full border border-border/70 bg-muted/25 px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                @if (isSoundEnabled()) {
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M19 5a9 9 0 0 1 0 14" />
                } @else {
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="22" x2="16" y1="9" y2="15" />
                  <line x1="16" x2="22" y1="9" y2="15" />
                }
              </svg>
              <span>{{ isSoundEnabled() ? 'Sounds On' : 'Sounds Off' }}</span>
            </button>

            @if (showEnableSoundFallback() && isSoundEnabled()) {
              <button
                type="button"
                data-testid="enable-sound-button"
                aria-label="Enable scanner sounds"
                (click)="soundEnableRequested.emit()"
                class="inline-flex min-h-9 items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] text-primary/80 uppercase transition-colors hover:border-primary/30 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
              >
                Tap for Sound
              </button>
            }
          </div>

          @if (cameraError()) {
            <div
              role="alert"
              data-testid="camera-startup-error"
              class="animate-in shake-1 rounded-lg border border-destructive/20 bg-destructive/5 p-4"
            >
              <div class="flex items-start gap-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="mt-0.5 text-destructive"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" x2="12" y1="8" y2="12" />
                  <line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                <div class="space-y-1">
                  <p
                    class="font-mono text-xs font-bold text-destructive uppercase"
                  >
                    {{ cameraError() }}
                  </p>
                  <p
                    class="text-2xs leading-relaxed text-destructive/80 uppercase"
                  >
                    Check browser camera permission, close other apps using the
                    camera, then try again.
                  </p>
                </div>
              </div>
            </div>
          }

          <div aria-live="assertive" aria-atomic="true">
            @if (lastResult()) {
              <div
                role="alert"
                data-testid="scan-result"
                [class]="
                  lastResult()?.success
                    ? 'animate-in zoom-in-95 rounded-xl border border-success/30 bg-success/5 p-5 duration-200'
                    : 'animate-in zoom-in-95 rounded-xl border border-destructive/30 bg-destructive/5 p-5 duration-200'
                "
              >
                <div class="mb-4 flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    @if (lastResult()?.success) {
                      <div
                        class="flex h-8 w-8 items-center justify-center rounded-lg border border-success/30 bg-success/20 shadow-lg shadow-success/20"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-success"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <div>
                        <span
                          class="block font-mono text-sm font-black tracking-tighter text-success uppercase"
                          >VALID</span
                        >
                        <span
                          class="text-2xs font-bold tracking-widest text-success uppercase"
                          >Checked in</span
                        >
                      </div>
                    } @else {
                      <div
                        class="flex h-8 w-8 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/20 shadow-lg shadow-destructive/20"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-destructive"
                        >
                          <line x1="18" x2="6" y1="6" y2="18" />
                          <line x1="6" x2="18" y1="6" y2="18" />
                        </svg>
                      </div>
                      <div>
                        <span
                          class="block font-mono text-sm font-black tracking-tighter text-destructive uppercase"
                          >INVALID</span
                        >
                        <span
                          class="text-2xs font-bold tracking-widest text-destructive uppercase"
                          >Not checked in</span
                        >
                      </div>
                    }
                  </div>
                  <button
                    type="button"
                    (click)="resultCleared.emit()"
                    class="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Clear check-in result"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>

                <p
                  class="mb-4 text-sm leading-relaxed font-medium text-foreground/80 italic"
                >
                  {{ lastResult()?.message }}
                </p>

                @if (lastResult()?.ticket; as t) {
                  <div
                    class="space-y-3 rounded-lg border border-border/50 bg-muted/40 p-4 dark:bg-background/80"
                  >
                    <div class="flex flex-col">
                      <span
                        class="mb-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase"
                        >Name</span
                      >
                      <span class="truncate font-bold text-foreground">{{
                        t.user?.name || 'Anonymous'
                      }}</span>
                      <span class="truncate text-xs text-muted-foreground">{{
                        t.user?.email
                      }}</span>
                    </div>
                    <div
                      class="grid grid-cols-2 gap-4 border-t border-border/80 pt-3"
                    >
                      <div class="flex flex-col">
                        <span
                          class="mono-label mb-1 text-[9px] text-muted-foreground"
                          >Tier</span
                        >
                        <span
                          class="font-mono text-xs font-black text-primary uppercase"
                          >{{ t.tier }}</span
                        >
                      </div>
                      <div class="flex flex-col items-end">
                        <span
                          class="mono-label mb-1 text-[9px] text-muted-foreground"
                          >Ticket ID</span
                        >
                        <span
                          class="font-mono text-2xs text-muted-foreground"
                          >{{ t._id.slice(-8).toUpperCase() }}</span
                        >
                      </div>
                    </div>
                  </div>
                }

                <!-- External (imported) ticket-holder result. Door-legibility
                     first: large holder name readable at arm's length in the
                     dark; the surrounding card border already carries the
                     unambiguous state color (success vs destructive). The mono
                     source badge marks it as an external ticket. -->
                @if (lastResult()?.imported; as m) {
                  <div
                    class="space-y-3 rounded-lg border border-border/50 bg-muted/40 p-4 dark:bg-background/80"
                    data-testid="scan-result-imported"
                  >
                    <div class="flex flex-col">
                      <span
                        class="mb-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase"
                        >Name</span
                      >
                      <span
                        class="truncate text-2xl leading-tight font-black text-foreground"
                        data-testid="scan-result-imported-name"
                        >{{ m.name }}</span
                      >
                    </div>
                    <div
                      class="grid grid-cols-2 gap-4 border-t border-border/80 pt-3"
                    >
                      <div class="flex flex-col">
                        <span
                          class="mono-label mb-1 text-[9px] text-muted-foreground"
                          >Source</span
                        >
                        <span
                          class="w-fit rounded border border-border/70 bg-background/60 px-2 py-0.5 font-mono text-2xs tracking-widest text-foreground uppercase"
                          data-testid="scan-result-imported-source"
                          >{{ m.sourceLabel }}</span
                        >
                      </div>
                      <div class="flex flex-col items-end">
                        <span
                          class="mono-label mb-1 text-[9px] text-muted-foreground"
                          >Ticket Type</span
                        >
                        <span
                          class="font-mono text-xs font-black text-primary uppercase"
                          data-testid="scan-result-imported-type"
                          >{{ m.ticketTypeLabel || 'external ticket' }}</span
                        >
                      </div>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </z-card>
    </div>
  `,
})
export class CheckInScannerComponent implements OnInit, OnDestroy {
  // Two-way binding for scanner panel visibility toggle from parent header button
  readonly isExpanded = model.required<boolean>();

  // From CheckInService via parent
  readonly isProcessing = input.required<boolean>();

  // Last check-in result to display inside the scanner card
  readonly lastResult = input<CheckInResult | null>(null);
  readonly isSoundEnabled = input(true);
  readonly showEnableSoundFallback = input(false);

  // Emits raw QR scan data for parent to handle via CheckInService
  scanned = output<string>();

  // Emits when the user clicks the clear-result button
  resultCleared = output();
  readonly soundToggleRequested = output();
  readonly soundEnableRequested = output();

  readonly isScanning = signal(false);
  readonly hasCamera = signal(false);
  readonly cameraError = signal<string | null>(null);

  readonly videoElementRef =
    viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  private readonly qrScannerCtor = inject(QR_SCANNER_CTOR);
  private qrScanner?: InstanceType<QrScannerCtor>;
  private lastScannedData?: string;

  constructor() {
    effect(() => {
      const result = this.lastResult();
      if (result && !result.success) {
        this.lastScannedData = undefined;
      }
    });
  }

  ngOnInit(): void {
    void this.checkCameraAvailability();
  }

  ngOnDestroy(): void {
    this.stopScanning();
  }

  async checkCameraAvailability(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideo = devices.some((device) => device.kind === 'videoinput');
      this.hasCamera.set(hasVideo);
    } catch (err) {
      logger.error('Error checking camera', err);
      this.hasCamera.set(false);
    }
  }

  async startScanning(): Promise<void> {
    try {
      this.cameraError.set(null);
      const videoEl = this.videoElementRef();
      const video = videoEl?.nativeElement;

      if (!video) {
        this.cameraError.set('Video element not available');
        return;
      }

      // Set scanning state BEFORE starting to ensure video element isn't hidden by display: none
      this.isScanning.set(true);
      this.lastScannedData = undefined;

      this.qrScanner = new this.qrScannerCtor(
        video,
        (result: {data: string}) => {
          this.handleQRCodeDetected(result.data);
        },
        {
          preferredCamera: 'environment',
          highlightScanRegion: true,
          highlightCodeOutline: true,
          onDecodeError: (_error) => {
            // ignore
          },
        },
      );

      await this.qrScanner.start();
    } catch (err) {
      logger.error('Error starting QR scanner', err);
      this.isScanning.set(false);
      this.cameraError.set('Camera could not start.');
    }
  }

  handleQRCodeDetected(data: string): void {
    const trimmed = data.trim();
    if (trimmed === this.lastScannedData) return;

    if (this.isProcessing()) return;

    this.lastScannedData = trimmed;
    this.scanned.emit(trimmed);
  }

  stopScanning(): void {
    if (this.qrScanner) {
      this.qrScanner.stop();
      this.qrScanner.destroy();
      this.qrScanner = undefined;
    }
    this.isScanning.set(false);
    this.lastScannedData = undefined;
  }
}
