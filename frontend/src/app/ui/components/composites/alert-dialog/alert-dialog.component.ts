import {A11yModule} from '@angular/cdk/a11y';
import {OverlayModule} from '@angular/cdk/overlay';
import {CdkPortalOutlet, PortalModule} from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  type TemplateRef,
  type Type,
  type ViewContainerRef,
  ViewEncapsulation,
  viewChild,
} from '@angular/core';

import type {ClassValue} from 'clsx';

import {mergeClasses} from '@ui/utils/merge-classes';
import {noopFn} from '@ui/utils/noop';

import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {BraDialogPortalContainerBase} from '../dialog-core/dialog-portal-container.base';
import type {BraAlertDialogRef} from './alert-dialog-ref';
import {alertDialogVariants} from './alert-dialog.variants';

export type OnClickCallback<T> = (instance: T) => false | void | object;

export class BraAlertDialogOptions<T> {
  zCancelText?: string | null;
  zClosable?: boolean;
  zContent?: string | TemplateRef<T> | Type<T>;
  zCustomClasses?: ClassValue;
  zData?: object;
  zDescription?: string;
  zMaskClosable?: boolean;
  zOkDestructive?: boolean;
  zOkDisabled?: boolean;
  zOkText?: string | null;
  zOnCancel?: OnClickCallback<T> = noopFn;
  zOnOk?: OnClickCallback<T> = noopFn;
  zTitle?: string | TemplateRef<T>;
  zViewContainerRef?: ViewContainerRef;
  zWidth?: string;
}

@Component({
  selector: 'bra-alert-dialog',
  imports: [OverlayModule, PortalModule, ZardButtonComponent, A11yModule],
  templateUrl: './alert-dialog.component.html',
  styles: `
    bra-alert-dialog {
      inset: 0;
      margin: auto;
      width: fit-content;
      height: fit-content;
      transform-origin: center center;
      opacity: 1;
      transform: scale(1);
      transition:
        opacity 150ms ease-out,
        transform 150ms ease-out;
    }

    @starting-style {
      bra-alert-dialog {
        opacity: 0;
        transform: scale(0.9);
      }
    }

    bra-alert-dialog.alert-dialog-leave {
      opacity: 0;
      transform: scale(0.9);
      transition:
        opacity 150ms ease-in,
        transform 150ms ease-in;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
    '[style.width]': 'config.zWidth ? config.zWidth : null',
    role: 'alertdialog',
    '[attr.aria-modal]': 'true',
    '[attr.aria-labelledby]': 'titleId()',
    '[attr.aria-describedby]': 'descriptionId()',
    'animate.enter': 'alert-dialog-enter',
    'animate.leave': 'alert-dialog-leave',
  },
  exportAs: 'zAlertDialog',
})
export class BraAlertDialogComponent<
  TDialog,
> extends BraDialogPortalContainerBase<BraAlertDialogOptions<TDialog>> {
  private readonly portalOutlet = viewChild.required(CdkPortalOutlet);

  readonly okTriggered = output<void>();
  readonly cancelTriggered = output<void>();

  protected readonly classes = computed(() =>
    mergeClasses(alertDialogVariants(), this.config.zCustomClasses),
  );

  protected readonly cancelButtonAriaLabel = computed(() =>
    this.config.zTitle ? null : 'Cancel dialog',
  );

  protected readonly okButtonAriaLabel = computed(() =>
    this.config.zTitle ? null : 'Confirm dialog',
  );

  alertDialogRef?: BraAlertDialogRef<TDialog>;

  constructor() {
    super(
      BraAlertDialogOptions,
      'alert-dialog',
      'Attempting to attach alert dialog content after content is already attached',
    );
  }

  protected getPortalOutlet(): CdkPortalOutlet {
    return this.portalOutlet();
  }

  protected shouldUseFallbackInitialFocus(): boolean {
    const hasCancelControl = this.config.zCancelText !== null;
    const hasEnabledOkControl =
      this.config.zOkText !== null && this.config.zOkDisabled !== true;

    return !hasCancelControl && !hasEnabledOkControl;
  }
}
