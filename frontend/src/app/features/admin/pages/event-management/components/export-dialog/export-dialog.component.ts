import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  afterNextRender,
  viewChildren,
} from '@angular/core';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCheckboxComponent} from '@ui/components/primitives/checkbox/checkbox.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {
  AttendeeExportService,
  DEFAULT_EXPORT_FIELDS,
  hasAttendeeRefunds,
  type ExportField,
  type ExportFieldKey,
} from '@/features/admin/services/attendee-export.service';
import {
  type EventManagementPurchase,
  type Guest,
} from '@/features/admin/models/event-management.model';

export interface ExportDialogData {
  purchases: EventManagementPurchase[];
  guests?: Guest[];
  eventTitle: string;
  eventDate?: string;
}

@Component({
  selector: 'app-export-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardCheckboxComponent, ZardIconComponent],
  template: `
    <div class="space-y-6">
      <div class="space-y-4">
        <h3 class="mono-label text-sm text-muted-foreground">Select Fields</h3>
        <div class="grid grid-cols-2 gap-3">
          @for (field of fields(); track field.key; let i = $index) {
            <z-checkbox
              #checkbox
              [attr.data-field-key]="field.key"
              (checkChange)="toggleField(field.key, $event)"
            >
              {{ field.label }}
            </z-checkbox>
          }
        </div>
      </div>

      <div class="space-y-4">
        <h3 class="mono-label text-sm text-muted-foreground">Export Format</h3>
        <div class="flex gap-3">
          <button
            type="button"
            z-button
            [zType]="format() === 'csv' ? 'default' : 'outline'"
            class="flex-1"
            (click)="setFormat('csv')"
          >
            <z-icon zType="file-spreadsheet" class="mr-2" />
            CSV
          </button>
          <button
            type="button"
            z-button
            [zType]="format() === 'pdf' ? 'default' : 'outline'"
            class="flex-1"
            (click)="setFormat('pdf')"
          >
            <z-icon zType="file-text" class="mr-2" />
            PDF
          </button>
        </div>
      </div>

      @if (hasRefundedPurchases()) {
        <div class="space-y-4">
          <h3 class="mono-label text-sm text-muted-foreground">Options</h3>
          <z-checkbox (checkChange)="includeRefunded.set($event)">
            <span class="flex items-center gap-2">
              Include refunded tickets
              <span class="text-xs text-muted-foreground">
                @if (format() === 'pdf') {
                  (shown on separate page)
                } @else {
                  (adds Status column)
                }
              </span>
            </span>
          </z-checkbox>
        </div>
      }

      <div class="flex justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          z-button
          zType="outline"
          (click)="cancel()"
          [zDisabled]="isExporting()"
        >
          Cancel
        </button>
        <button
          type="button"
          z-button
          zType="default"
          [zDisabled]="!hasSelectedFields() || isExporting()"
          (click)="exportData()"
        >
          @if (isExporting()) {
            <z-icon zType="loader-circle" class="animate-spin" />
            Exporting...
          } @else {
            <z-icon zType="download" />
            Export {{ format().toUpperCase() }}
          }
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class ExportDialogComponent {
  private readonly dialogRef = inject(BraDialogRef);
  private readonly data = inject<ExportDialogData>(BRA_MODAL_DATA);
  private readonly exportService = inject(AttendeeExportService);

  readonly checkboxes = viewChildren<ZardCheckboxComponent>('checkbox');

  readonly fields = signal<ExportField[]>(
    DEFAULT_EXPORT_FIELDS.map((f) => ({...f})),
  );
  readonly format = signal<'csv' | 'pdf'>('csv');
  readonly includeRefunded = signal<boolean>(false);
  readonly isExporting = signal<boolean>(false);

  /** Check if there are any refunded purchases */
  readonly hasRefundedPurchases = () => hasAttendeeRefunds(this.data.purchases);

  constructor() {
    afterNextRender(() => {
      // Initialize checkbox states after view is ready
      const checkboxList = this.checkboxes();
      const fieldList = this.fields();

      checkboxList.forEach((checkbox, index) => {
        if (fieldList[index]) {
          checkbox.writeValue(fieldList[index].enabled);
        }
      });
    });
  }

  hasSelectedFields(): boolean {
    return this.fields().some((f) => f.enabled);
  }

  toggleField(key: ExportFieldKey, enabled: boolean): void {
    this.fields.update((fields) =>
      fields.map((f) => (f.key === key ? {...f, enabled} : f)),
    );
  }

  setFormat(format: 'csv' | 'pdf'): void {
    this.format.set(format);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async exportData(): Promise<void> {
    this.isExporting.set(true);
    try {
      await this.exportService.export(
        this.data.purchases,
        {
          fields: this.fields(),
          format: this.format(),
          eventTitle: this.data.eventTitle,
          eventDate: this.data.eventDate,
          includeRefunded: this.includeRefunded(),
        },
        this.data.guests,
      );
      this.dialogRef.close({exported: true});
    } finally {
      this.isExporting.set(false);
    }
  }
}
