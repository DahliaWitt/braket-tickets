import {
  BasePortalOutlet,
  type CdkPortalOutlet,
  type ComponentPortal,
  type TemplatePortal,
} from '@angular/cdk/portal';
import {
  type ComponentRef,
  computed,
  ElementRef,
  type EmbeddedViewRef,
  inject,
  type ProviderToken,
  type Signal,
} from '@angular/core';

import { generateId } from '@ui/utils/merge-classes';

interface DialogLikeConfig {
  zContent?: unknown;
  zDescription?: string;
  zTitle?: unknown;
}

export abstract class BraDialogPortalContainerBase<
  TConfig extends DialogLikeConfig,
> extends BasePortalOutlet {
  abstract readonly okTriggered: { emit(value: void): void };
  abstract readonly cancelTriggered: { emit(value: void): void };

  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly config: TConfig;

  protected readonly titleId: Signal<string | null>;
  protected readonly descriptionId: Signal<string | null>;
  protected readonly isStringContent = computed(() => typeof this.config.zContent === 'string');

  protected constructor(
    configToken: ProviderToken<TConfig>,
    idPrefix: string,
    private readonly attachErrorMessage: string,
  ) {
    super();
    this.config = inject(configToken);

    const dialogId = generateId(idPrefix);
    this.titleId = computed(() => (this.config.zTitle ? `${dialogId}-title` : null));
    this.descriptionId = computed(() =>
      this.config.zDescription ? `${dialogId}-description` : null,
    );
  }

  getNativeElement(): HTMLElement {
    return this.host.nativeElement as HTMLElement;
  }

  protected abstract getPortalOutlet(): CdkPortalOutlet;

  attachComponentPortal<T>(portal: ComponentPortal<T>): ComponentRef<T> {
    const portalOutlet = this.getPortalOutlet();

    if (portalOutlet.hasAttached()) {
      throw new Error(this.attachErrorMessage);
    }

    return portalOutlet.attachComponentPortal(portal);
  }

  attachTemplatePortal<C>(portal: TemplatePortal<C>): EmbeddedViewRef<C> {
    const portalOutlet = this.getPortalOutlet();

    if (portalOutlet.hasAttached()) {
      throw new Error(this.attachErrorMessage);
    }

    return portalOutlet.attachTemplatePortal(portal);
  }

  onOkClick(): void {
    this.okTriggered.emit();
  }

  onCancelClick(): void {
    this.cancelTriggered.emit();
  }
}
