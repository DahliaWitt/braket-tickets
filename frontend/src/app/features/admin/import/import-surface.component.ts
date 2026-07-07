import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {logger} from '@/utils/logger';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {generateId} from '@ui/utils/merge-classes';
import {parseImportText} from './import-parser';
import {buildPreview, extractValidValues} from './import-preview';
import {generateTemplateCsv, templateFilename} from './import-template';
import {
  DEFAULT_SOURCE_LABEL,
  IMPORT_FIELD_LIMITS,
  type ImportTargetConfig,
} from './import-config';
import {
  IMPORT_HEADER_SYNONYMS,
  canonicalHeaderFor,
} from './import-header-synonyms';
import type {HeaderColumn, ImportFieldKey, ParseResult} from './import.types';
import type {
  DedupMode,
  ImportConfirmPayload,
  ImportReport,
  ImportStep,
} from './import-surface.types';

/**
 * Shared, target-agnostic import surface: a full-height stepped flow
 * (input → mapping → preview → report) driven entirely by an
 * `ImportTargetConfig`. Both the guest and buyer targets consume this one
 * component — no duplicated parser, preview, or template code.
 *
 * Backend-free: it parses/validates client-side and emits a structured
 * `ImportConfirmPayload` via `confirmed`. A later wave wires that to the
 * per-target bulk mutation and feeds the result back through `report`.
 *
 * Loaded deferred by consumers (`@defer`) so the management page bundle is
 * unaffected — this component eagerly imports only ZardButton + ZardInput.
 */
@Component({
  selector: 'app-import-surface',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardInputDirective],
  template: `
    <section
      class="ph-no-capture flex min-h-full w-full flex-col gap-6 p-4 md:p-6"
      data-testid="import-surface"
    >
      <!-- Step header -->
      <header class="flex flex-col gap-2">
        <h2
          class="font-display text-xl tracking-wide text-foreground lowercase"
          data-testid="import-title"
        >
          {{ config().copy.title }}
        </h2>
        <ol class="flex flex-wrap gap-3" aria-label="import steps">
          @for (item of stepLabels(); track item.step) {
            <li
              class="mono-label text-2xs"
              [class.text-foreground]="item.step === step()"
              [class.text-muted-foreground]="item.step !== step()"
              [attr.aria-current]="item.step === step() ? 'step' : null"
              [attr.data-active]="item.step === step() ? 'true' : 'false'"
              data-testid="import-step-marker"
            >
              {{ item.label }}
            </li>
          }
        </ol>
      </header>

      @switch (step()) {
        <!-- STEP 1: input -->
        @case ('input') {
          <div class="flex flex-col gap-4" data-testid="import-step-input">
            <label
              for="import-paste"
              class="mono-label text-xs text-muted-foreground"
            >
              paste rows
            </label>
            <textarea
              id="import-paste"
              zInput
              [value]="rawText()"
              (input)="onPasteInput($event)"
              [attr.placeholder]="config().copy.inputHint"
              class="min-h-[160px] w-full font-mono text-sm"
              data-testid="import-paste-input"
            ></textarea>

            <div class="flex flex-wrap items-center gap-3">
              <label
                class="mono-label inline-flex min-h-[24px] cursor-pointer items-center gap-2 text-xs text-primary"
                data-testid="import-file-label"
              >
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  class="sr-only"
                  (change)="onFileSelected($event)"
                  data-testid="import-file-input"
                />
                <span aria-hidden="true">↥</span>
                upload csv
              </label>

              <button
                type="button"
                z-button
                zType="ghost"
                class="min-h-[24px]"
                (click)="downloadTemplate()"
                data-testid="import-template-download"
              >
                download template
              </button>
            </div>

            @if (parseErrorMessage(); as message) {
              <p
                class="text-sm text-destructive"
                role="alert"
                data-testid="import-parse-error"
              >
                {{ message }}
              </p>
            }

            @if (!rawText().trim()) {
              <p
                class="text-sm text-muted-foreground"
                data-testid="import-empty-state"
              >
                {{ config().copy.emptyState }}
              </p>
            }

            <div class="flex justify-end">
              <button
                type="button"
                z-button
                zType="default"
                class="min-h-[24px]"
                [zDisabled]="!canParse()"
                (click)="advanceFromInput()"
                data-testid="import-parse-next"
              >
                next
              </button>
            </div>
          </div>
        }

        <!-- STEP 2: mapping (only when ambiguous) -->
        @case ('mapping') {
          <div class="flex flex-col gap-4" data-testid="import-step-mapping">
            <p class="text-sm text-muted-foreground">
              we couldn't line up your columns automatically — match them here,
              then continue.
            </p>
            <div class="flex flex-col gap-3">
              @for (column of parsedColumns(); track column.index) {
                <div
                  class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between"
                  data-testid="import-mapping-row"
                >
                  <span class="font-mono text-sm text-foreground">
                    {{
                      column.label ||
                        '(unnamed column ' + (column.index + 1) + ')'
                    }}
                  </span>
                  <select
                    class="native-select min-h-[24px] rounded border border-border bg-background px-2 py-1 text-sm"
                    [attr.aria-label]="'map column ' + (column.index + 1)"
                    [value]="mappingValueFor(column.index)"
                    (change)="onMappingChange(column.index, $event)"
                    [attr.data-testid]="'import-mapping-select-' + column.index"
                  >
                    <option value="">ignore this column</option>
                    @for (field of mappableFields(); track field) {
                      <option [value]="field">{{ fieldLabel(field) }}</option>
                    }
                  </select>
                </div>
              }
            </div>

            @if (mappingErrorMessage(); as message) {
              <p
                class="text-sm text-destructive"
                role="alert"
                data-testid="import-mapping-error"
              >
                {{ message }}
              </p>
            }

            <div class="flex justify-between">
              <button
                type="button"
                z-button
                zType="outline"
                class="min-h-[24px]"
                (click)="backToInput()"
                data-testid="import-mapping-back"
              >
                back
              </button>
              <button
                type="button"
                z-button
                zType="default"
                class="min-h-[24px]"
                (click)="applyMapping()"
                data-testid="import-mapping-next"
              >
                next
              </button>
            </div>
          </div>
        }

        <!-- STEP 3: preview -->
        @case ('preview') {
          <div class="flex flex-col gap-4" data-testid="import-step-preview">
            <div class="flex flex-wrap gap-4" data-testid="import-counts">
              <span
                class="mono-label text-2xs text-success"
                data-testid="import-count-valid"
              >
                {{ previewCounts().valid }} valid
              </span>
              <span
                class="mono-label text-2xs text-destructive"
                data-testid="import-count-invalid"
              >
                {{ previewCounts().invalid }} invalid
              </span>
              <span
                class="mono-label text-2xs text-warning"
                data-testid="import-count-duplicate"
              >
                {{ previewCounts().duplicate }} duplicate
              </span>
            </div>

            @if (config().dedupModeSelectable) {
              <label
                class="mono-label inline-flex min-h-[24px] cursor-pointer items-center gap-2 text-xs text-muted-foreground"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4"
                  [checked]="dedupMode() === 'include'"
                  (change)="onDedupToggle($event)"
                  data-testid="import-dedup-toggle"
                />
                include duplicates
              </label>
            }

            @if (config().requiresSourceLabel) {
              <div class="flex flex-col gap-1">
                <label
                  for="import-source"
                  class="mono-label text-xs text-muted-foreground"
                >
                  source
                </label>
                <input
                  id="import-source"
                  zInput
                  [value]="sourceLabel()"
                  (input)="onSourceInput($event)"
                  [attr.maxlength]="sourceLabelMax"
                  placeholder="external"
                  class="w-full max-w-xs"
                  data-testid="import-source-input"
                />
              </div>
            }

            @if (overCap()) {
              <p
                class="text-sm text-destructive"
                role="alert"
                data-testid="import-overcap-error"
              >
                {{ config().copy.overCapMessage(config().maxRows) }}
              </p>
            }

            <div
              class="max-h-[50vh] overflow-auto rounded-xl border border-border"
              data-testid="import-preview-scroll"
              tabindex="0"
              role="region"
              aria-label="import preview rows"
            >
              <table class="w-full border-collapse text-sm">
                <thead class="sticky top-0 bg-muted">
                  <tr>
                    <th
                      class="mono-label px-3 py-2 text-left text-2xs text-muted-foreground"
                    >
                      row
                    </th>
                    <th
                      class="mono-label px-3 py-2 text-left text-2xs text-muted-foreground"
                    >
                      name
                    </th>
                    <th
                      class="mono-label px-3 py-2 text-left text-2xs text-muted-foreground"
                    >
                      state
                    </th>
                    <th
                      class="mono-label px-3 py-2 text-left text-2xs text-muted-foreground"
                    >
                      reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of previewRows(); track row.sourceRowNumber) {
                    <tr
                      class="border-t border-border"
                      [attr.data-partition]="row.partition"
                      data-testid="import-preview-row"
                    >
                      <td class="px-3 py-2 font-mono text-muted-foreground">
                        {{ row.sourceRowNumber }}
                      </td>
                      <td class="px-3 py-2 text-foreground">
                        {{ row.values.name || '—' }}
                      </td>
                      <td
                        class="px-3 py-2"
                        [class.text-success]="row.partition === 'valid'"
                        [class.text-destructive]="row.partition === 'invalid'"
                        [class.text-warning]="row.partition === 'duplicate'"
                      >
                        <span class="mono-label text-2xs">{{
                          row.partition
                        }}</span>
                      </td>
                      <td
                        class="px-3 py-2 text-muted-foreground"
                        data-testid="import-preview-reason"
                      >
                        {{ row.reasons.join('; ') }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="flex justify-between">
              <button
                type="button"
                z-button
                zType="outline"
                class="min-h-[24px]"
                (click)="backToInput()"
                data-testid="import-preview-back"
              >
                back
              </button>
              <button
                type="button"
                z-button
                zType="default"
                class="min-h-[24px]"
                [zDisabled]="!canConfirm()"
                (click)="confirm()"
                data-testid="import-confirm"
              >
                {{ config().copy.confirmLabel }}
                ({{ previewCounts().valid }})
              </button>
            </div>
          </div>
        }

        <!-- STEP 4: report -->
        @case ('report') {
          <div class="flex flex-col gap-4" data-testid="import-step-report">
            @if (report(); as result) {
              @if (result.errorMessage) {
                <p
                  class="text-sm text-destructive"
                  role="alert"
                  data-testid="import-report-error"
                >
                  {{ result.errorMessage }}
                </p>
              } @else {
                <div class="flex flex-wrap gap-4">
                  <span
                    class="mono-label text-2xs text-success"
                    data-testid="import-report-inserted"
                  >
                    {{ result.inserted }} added
                  </span>
                  <span
                    class="mono-label text-2xs text-warning"
                    data-testid="import-report-skipped"
                  >
                    {{ result.skipped }} skipped
                  </span>
                  @if (result.failed) {
                    <span
                      class="mono-label text-2xs text-destructive"
                      data-testid="import-report-failed"
                    >
                      {{ result.failed }} failed
                    </span>
                  }
                </div>
              }
            } @else {
              <p
                class="text-sm text-muted-foreground"
                data-testid="import-report-pending"
              >
                committing your import…
              </p>
            }

            <div class="flex justify-end">
              <button
                type="button"
                z-button
                zType="outline"
                class="min-h-[24px]"
                (click)="reset()"
                data-testid="import-report-done"
              >
                import another
              </button>
            </div>
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }
  `,
})
export class ImportSurfaceComponent {
  private readonly browser = inject(BrowserPlatformService);

  /** Per-target configuration — the only thing that differs between targets. */
  readonly config = input.required<ImportTargetConfig>();

  /**
   * Strong dedup keys already committed (prior imports / existing guests),
   * lowercased. Consumers feed this from the reactive roster/guest subscription
   * for live preview hints. The server remains the authority at commit.
   */
  readonly existingStrongKeys = input<ReadonlySet<string>>(new Set());
  /** Weak name+email keys for "possible duplicate" hints (buyer target). */
  readonly existingWeakKeys = input<ReadonlySet<string>>(new Set());

  /**
   * Post-commit report. Setting this (with the surface on the report step) shows
   * the outcome. The consumer moves the surface to the report step by calling
   * `confirmed` then setting this input once the mutation returns.
   */
  readonly report = input<ImportReport | null>(null);

  /** Emitted when the admin confirms — carries valid rows + options + batch key. */
  readonly confirmed = output<ImportConfirmPayload>();

  readonly sourceLabelMax = IMPORT_FIELD_LIMITS.sourceLabel.max;

  // --- Local state ---
  private readonly step_ = signal<ImportStep>('input');
  readonly step = this.step_.asReadonly();

  readonly rawText = signal('');
  readonly dedupMode = signal<DedupMode>('skip');
  readonly sourceLabel = signal('');

  private readonly parseResult = signal<ParseResult | null>(null);
  private readonly manualMapping = signal<Map<number, ImportFieldKey | null>>(
    new Map(),
  );
  private readonly parseError = signal<string | null>(null);
  private readonly mappingError = signal<string | null>(null);

  /**
   * Whether the mapping step is part of this import's flow. Set once when the
   * initial parse comes back ambiguous and held across manual re-parses (a
   * failed re-map returns an error result, but the mapping step must stay
   * present so the admin can keep editing).
   */
  private readonly mappingRequired = signal(false);
  /** Columns captured when entering mapping — stable across failed re-parses. */
  private readonly mappingColumns = signal<readonly HeaderColumn[]>([]);

  readonly stepLabels = computed(() => {
    const steps: {step: ImportStep; label: string}[] = [
      {step: 'input', label: 'input'},
    ];
    if (this.mappingRequired()) steps.push({step: 'mapping', label: 'mapping'});
    steps.push({step: 'preview', label: 'preview'});
    steps.push({step: 'report', label: 'report'});
    return steps;
  });

  readonly parseErrorMessage = computed(() => this.parseError());
  readonly mappingErrorMessage = computed(() => this.mappingError());

  readonly canParse = computed(() => this.rawText().trim().length > 0);

  readonly parsedColumns = computed<readonly HeaderColumn[]>(() =>
    this.mappingColumns(),
  );

  /** Fields the target accepts, for the mapping-step dropdown. */
  readonly mappableFields = computed<readonly ImportFieldKey[]>(
    () => this.config().acceptedFields,
  );

  private readonly preview = computed(() => {
    const result = this.parseResult();
    if (result?.ok !== true) return null;
    return buildPreview(result.rows, this.config(), {
      dedupMode: this.dedupMode(),
      existingStrongKeys: this.existingStrongKeys(),
      existingWeakKeys: this.existingWeakKeys(),
    });
  });

  readonly previewRows = computed(() => this.preview()?.rows ?? []);
  readonly previewCounts = computed(
    () =>
      this.preview()?.counts ?? {valid: 0, invalid: 0, duplicate: 0, total: 0},
  );
  readonly overCap = computed(() => this.preview()?.overCap ?? false);

  readonly canConfirm = computed(
    () => !this.overCap() && this.previewCounts().valid > 0,
  );

  // --- Input step ---
  onPasteInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      this.rawText.set(target.value);
      this.parseError.set(null);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.files?.length) return;
    const file = target.files[0];
    try {
      const text = await file.text();
      this.rawText.set(text);
      this.parseError.set(null);
    } catch (error) {
      // Route through the central PII-scrubbing logger — never log row contents.
      logger.error('import: failed to read uploaded file', error);
      this.parseError.set(
        'couldn’t read that file — try pasting the rows instead',
      );
    } finally {
      // Reset the input so re-selecting the same file re-triggers change.
      target.value = '';
    }
  }

  onSourceInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.sourceLabel.set(target.value);
    }
  }

  advanceFromInput(): void {
    if (!this.canParse()) return;
    const result = parseImportText(this.rawText(), {
      acceptedFields: new Set(this.config().acceptedFields),
    });
    this.parseResult.set(result);

    if (!result.ok) {
      this.parseError.set(this.friendlyParseError(result));
      return;
    }
    this.parseError.set(null);

    if (result.requiresManualMapping) {
      this.mappingRequired.set(true);
      this.mappingColumns.set(result.columns);
      this.seedManualMappingFromColumns(result.columns);
      this.step_.set('mapping');
      return;
    }
    this.mappingRequired.set(false);
    this.step_.set('preview');
  }

  private friendlyParseError(result: ParseResult): string {
    if (result.ok) return '';
    switch (result.error.code) {
      case 'no-rows-found':
        return 'no rows found — paste some rows or upload a csv first';
      case 'no-name-column':
        return 'we need a name column — map one before continuing';
      case 'duplicate-headers':
        return 'some column names repeat — map them by hand to continue';
    }
  }

  // --- Mapping step ---
  private seedManualMappingFromColumns(columns: readonly HeaderColumn[]): void {
    const seeded = new Map<number, ImportFieldKey | null>();
    for (const column of columns) {
      seeded.set(column.index, column.mappedTo);
    }
    this.manualMapping.set(seeded);
    this.mappingError.set(null);
  }

  mappingValueFor(index: number): string {
    return this.manualMapping().get(index) ?? '';
  }

  onMappingChange(index: number, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const value = target.value;
    const next = new Map(this.manualMapping());
    next.set(index, value === '' ? null : (value as ImportFieldKey));
    this.manualMapping.set(next);
    this.mappingError.set(null);
  }

  applyMapping(): void {
    const result = parseImportText(this.rawText(), {
      acceptedFields: new Set(this.config().acceptedFields),
      manualMapping: this.manualMapping(),
    });
    this.parseResult.set(result);
    if (!result.ok) {
      this.mappingError.set(this.friendlyParseError(result));
      return;
    }
    this.mappingError.set(null);
    this.step_.set('preview');
  }

  backToInput(): void {
    this.step_.set('input');
  }

  // --- Preview step ---
  onDedupToggle(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.dedupMode.set(target.checked ? 'include' : 'skip');
    }
  }

  confirm(): void {
    const preview = this.preview();
    if (!preview || !this.canConfirm()) return;

    const rows = extractValidValues(preview.rows);
    const payload: ImportConfirmPayload = {
      rows,
      dedupMode: this.config().dedupModeSelectable ? this.dedupMode() : 'skip',
      sourceLabel: this.config().requiresSourceLabel
        ? this.sourceLabel().trim() || DEFAULT_SOURCE_LABEL
        : undefined,
      batchKey: generateId('import'),
    };
    this.confirmed.emit(payload);
    // Move to the report step; the consumer sets the `report` input on return.
    this.step_.set('report');
  }

  // --- Template ---
  downloadTemplate(): void {
    const csv = generateTemplateCsv(this.config());
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    this.browser.downloadBlob(blob, templateFilename(this.config()));
  }

  // --- Report ---
  reset(): void {
    this.rawText.set('');
    this.parseResult.set(null);
    this.manualMapping.set(new Map());
    this.parseError.set(null);
    this.mappingError.set(null);
    this.mappingRequired.set(false);
    this.mappingColumns.set([]);
    this.dedupMode.set('skip');
    this.sourceLabel.set('');
    this.step_.set('input');
  }

  // --- Labels ---
  fieldLabel(field: ImportFieldKey): string {
    // Human label for a canonical field, derived from the synonym constant.
    const canonical = IMPORT_HEADER_SYNONYMS[field]?.length
      ? canonicalHeaderFor(field)
      : field;
    return canonical;
  }
}
