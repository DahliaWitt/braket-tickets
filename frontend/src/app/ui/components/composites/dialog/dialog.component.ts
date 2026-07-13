import {CdkTrapFocus} from '@angular/cdk/a11y';
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
  viewChild,
} from '@angular/core';

import {mergeClasses} from '@ui/utils/merge-classes';
import {noopFn} from '@ui/utils/noop';

import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import type {ZardIcon} from '@ui/components/primitives/icon/icons';
import {BraDialogPortalContainerBase} from '../dialog-core/dialog-portal-container.base';
import type {BraDialogRef} from './dialog-ref';
import {dialogVariants} from './dialog.variants';

export type OnClickCallback<R> = (instance: R) => false | void | object;

export class BraDialogOptions<T, U> {
  zCancelIcon?: ZardIcon;
  zCancelText?: string | null;
  zClosable?: boolean;
  zContent?: string | TemplateRef<T> | Type<T>;
  zCustomClasses?: string;
  zData?: U;
  zDescription?: string;
  zHideFooter?: boolean;
  zMaskClosable?: boolean;
  zOkDestructive?: boolean;
  zOkDisabled?: boolean;
  zOkIcon?: ZardIcon;
  zOkText?: string | null;
  zOnCancel?: OnClickCallback<T> = noopFn;
  zOnOk?: OnClickCallback<T> = noopFn;
  zTitle?: string | TemplateRef<T>;
  zViewContainerRef?: ViewContainerRef;
  zWidth?: string;
}

@Component({
  selector: 'bra-dialog',
  imports: [
    CdkTrapFocus,
    OverlayModule,
    PortalModule,
    ZardButtonComponent,
    ZardIconComponent,
  ],
  template: `
    <div
      class="contents"
      data-testid="z-focus-trap"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
    >
      @if (config.zClosable || config.zClosable === undefined) {
        <button
          type="button"
          data-testid="z-close-header-button"
          z-button
          zType="ghost"
          zSize="sm"
          class="absolute top-1 right-1"
          aria-label="Close dialog"
          (click)="onCloseClick()"
        >
          <z-icon zType="x" />
        </button>
      }

      @if (config.zTitle || config.zDescription) {
        <header class="flex flex-col space-y-1.5 text-center sm:text-left">
          @if (config.zTitle) {
            <h4
              data-testid="z-title"
              [id]="titleId()"
              class="text-lg leading-none font-semibold tracking-tight"
            >
              {{ config.zTitle }}
            </h4>

            @if (config.zDescription) {
              <p
                data-testid="z-description"
                [id]="descriptionId()"
                class="text-sm text-muted-foreground"
              >
                {{ config.zDescription }}
              </p>
            }
          }
        </header>
      }

      <main
        class="flex min-h-0 flex-col space-y-4 overflow-y-auto"
        tabindex="-1"
        aria-label="Dialog content"
        data-testid="z-focus-fallback"
        [attr.cdkFocusInitial]="shouldUseFallbackInitialFocus() ? '' : null"
      >
        <ng-template cdkPortalOutlet />

        @if (isStringContent()) {
          <div data-testid="z-content">{{ config.zContent }}</div>
        }
      </main>

      @if (!config.zHideFooter) {
        <footer
          class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2"
        >
          @if (config.zCancelText !== null) {
            <button
              #cancelButton
              type="button"
              data-testid="z-cancel-button"
              z-button
              zType="outline"
              cdkFocusInitial
              (click)="onCloseClick()"
            >
              @if (config.zCancelIcon) {
                <z-icon [zType]="config.zCancelIcon" />
              }

              {{ config.zCancelText || 'cancel' }}
            </button>
          }

          @if (config.zOkText !== null) {
            <button
              type="button"
              data-testid="z-ok-button"
              z-button
              [zType]="config.zOkDestructive ? 'destructive' : 'default'"
              [disabled]="config.zOkDisabled"
              (click)="onOkClick()"
            >
              @if (config.zOkIcon) {
                <z-icon [zType]="config.zOkIcon" />
              }

              {{ config.zOkText || 'confirm' }}
            </button>
          }
        </footer>
      }
    </div>
  `,
  styles: `
    :host {
      opacity: 1;
      transform: scale(1);
      transition:
        opacity 150ms ease-out,
        transform 150ms ease-out;
    }

    @starting-style {
      :host {
        opacity: 0;
        transform: scale(0.9);
      }
    }

    :host.dialog-leave {
      opacity: 0;
      transform: scale(0.9);
      transition:
        opacity 150ms ease-in,
        transform 150ms ease-in;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[style.width]': 'config.zWidth ? config.zWidth : null',
    role: 'dialog',
    '[attr.aria-modal]': 'true',
    '[attr.aria-labelledby]': 'titleId()',
    '[attr.aria-describedby]': 'descriptionId()',
    'animate.enter': 'dialog-enter',
    'animate.leave': 'dialog-leave',
  },
  exportAs: 'zDialog',
})
export class BraDialogComponent<D, U> extends BraDialogPortalContainerBase<
  BraDialogOptions<D, U>
> {
  private readonly portalOutlet = viewChild.required(CdkPortalOutlet);

  readonly okTriggered = output<void>();
  readonly cancelTriggered = output<void>();

  protected readonly classes = computed(() =>
    mergeClasses(dialogVariants(), this.config.zCustomClasses),
  );

  dialogRef?: BraDialogRef<D>;

  constructor() {
    super(
      BraDialogOptions,
      'dialog',
      'Attempting to attach modal content after content is already attached',
    );
  }

  protected getPortalOutlet(): CdkPortalOutlet {
    return this.portalOutlet();
  }

  protected shouldUseFallbackInitialFocus(): boolean {
    const hasHeaderCloseControl = this.config.zClosable !== false;
    const hasFooterControl =
      !this.config.zHideFooter &&
      (this.config.zCancelText !== null ||
        (this.config.zOkText !== null && this.config.zOkDisabled !== true));

    return !hasHeaderCloseControl && !hasFooterControl;
  }

  onCloseClick(): void {
    this.onCancelClick();
  }
}
