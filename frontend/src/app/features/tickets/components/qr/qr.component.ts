import {
  Component,
  input,
  computed,
  resource,
  ChangeDetectionStrategy,
} from '@angular/core';
import * as QRCode from 'qrcode';
import {safeResourceValue} from '@/utils/resource';

@Component({
  selector: 'app-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="ph-no-capture inline-block max-w-full rounded-lg bg-white p-2">
      <img
        [src]="qrSrc()"
        class="h-full w-full max-w-full object-contain"
        [alt]="altText()"
        width="200"
        height="200"
      />
    </div>
  `,
})
export class AppQrComponent {
  readonly data = input.required<string>();
  readonly alt = input<string>();

  /** Computed alt text: uses provided alt, otherwise generates descriptive text from data */
  readonly altText = computed(
    () => this.alt() ?? `QR code for ticket ${this.data().slice(-8)}`,
  );

  private qrResource = resource({
    params: () => ({data: this.data()}),
    loader: ({params}) => {
      return QRCode.toDataURL(params.data, {
        color: {dark: '#000000', light: '#ffffff'},
        margin: 1,
        scale: 6,
        errorCorrectionLevel: 'M',
      });
    },
  });

  readonly qrSrc = computed(() => safeResourceValue(this.qrResource) ?? '');
}
