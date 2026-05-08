import {
  Directive,
  type EmbeddedViewRef,
  inject,
  input,
  type OnDestroy,
  TemplateRef,
  ViewContainerRef,
  effect,
  type EffectRef,
} from '@angular/core';

export function isTemplateRef<C = unknown>(value: unknown): value is TemplateRef<C> {
  return value instanceof TemplateRef;
}

export interface BraStringTemplateOutletContext {
  $implicit: unknown;
  [key: string]: unknown;
}

@Directive({
  selector: '[zStringTemplateOutlet]',
  exportAs: 'zStringTemplateOutlet',
})
export class BraStringTemplateOutletDirective<T = unknown> implements OnDestroy {
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly templateRef = inject(TemplateRef<void>);

  private embeddedViewRef: EmbeddedViewRef<BraStringTemplateOutletContext> | null = null;
  private readonly context = {} as BraStringTemplateOutletContext;

  #isFirstChange = true;
  #lastOutletWasTemplate = false;
  #lastTemplateRef: TemplateRef<void> | null = null;
  #lastContext?: BraStringTemplateOutletContext;

  readonly zStringTemplateOutletContext = input<BraStringTemplateOutletContext | undefined>(
    undefined,
  );
  readonly zStringTemplateOutlet = input.required<T | TemplateRef<void>>();

  #hasContextShapeChanged(context: BraStringTemplateOutletContext | undefined): boolean {
    if (!context) {
      return false;
    }
    const prevCtxKeys = Object.keys(this.#lastContext || {});
    const currCtxKeys = Object.keys(context || {});

    if (prevCtxKeys.length === currCtxKeys.length) {
      for (const propName of currCtxKeys) {
        if (!prevCtxKeys.includes(propName)) {
          return true;
        }
      }
      return false;
    } else {
      return true;
    }
  }

  #shouldViewBeRecreated(
    stringTemplateOutlet: TemplateRef<void> | T,
    stringTemplateOutletContext: BraStringTemplateOutletContext | undefined,
  ): boolean {
    const isTemplate = isTemplateRef(stringTemplateOutlet);

    const shouldOutletRecreate =
      this.#isFirstChange ||
      isTemplate !== this.#lastOutletWasTemplate ||
      (isTemplate && stringTemplateOutlet !== this.#lastTemplateRef);

    const shouldContextRecreate = this.#hasContextShapeChanged(stringTemplateOutletContext);
    return shouldContextRecreate || shouldOutletRecreate;
  }

  #updateTrackingState(
    stringTemplateOutlet: TemplateRef<void> | T,
    stringTemplateOutletContext: BraStringTemplateOutletContext | undefined,
  ): void {
    const isTemplate = isTemplateRef(stringTemplateOutlet);
    if (this.#isFirstChange && !isTemplate) {
      this.#isFirstChange = false;
    }

    if (stringTemplateOutletContext !== undefined) {
      this.#lastContext = stringTemplateOutletContext;
    }

    this.#lastOutletWasTemplate = isTemplate;
    this.#lastTemplateRef = isTemplate ? stringTemplateOutlet : null;
  }

  readonly #viewEffect: EffectRef = effect(() => {
    const stringTemplateOutlet = this.zStringTemplateOutlet();
    const stringTemplateOutletContext = this.zStringTemplateOutletContext();

    if (!this.#isFirstChange && isTemplateRef(stringTemplateOutlet)) {
      this.#isFirstChange = true;
    }

    if (!isTemplateRef(stringTemplateOutlet)) {
      this.context['$implicit'] = stringTemplateOutlet;
    }

    const recreateView = this.#shouldViewBeRecreated(
      stringTemplateOutlet,
      stringTemplateOutletContext,
    );
    this.#updateTrackingState(stringTemplateOutlet, stringTemplateOutletContext);

    if (recreateView) {
      this.#recreateView(
        stringTemplateOutlet as TemplateRef<BraStringTemplateOutletContext>,
        stringTemplateOutletContext,
      );
    } else {
      this.#updateContext(stringTemplateOutlet, stringTemplateOutletContext);
    }
  });

  #recreateView(
    outlet: TemplateRef<BraStringTemplateOutletContext>,
    context: BraStringTemplateOutletContext | undefined,
  ): void {
    this.viewContainer.clear();
    if (isTemplateRef(outlet)) {
      this.embeddedViewRef = this.viewContainer.createEmbeddedView(outlet, context);
    } else {
      this.embeddedViewRef = this.viewContainer.createEmbeddedView(this.templateRef, this.context);
    }
  }

  #updateContext(
    outlet: TemplateRef<void> | T,
    context: BraStringTemplateOutletContext | undefined,
  ): void {
    const newCtx = isTemplateRef(outlet) ? context : this.context;
    let oldCtx = this.embeddedViewRef?.context;

    if (!oldCtx) {
      oldCtx = newCtx;
    } else if (newCtx && typeof newCtx === 'object') {
      for (const propName of Object.keys(newCtx)) {
        oldCtx[propName] = newCtx[propName];
      }
    }
    this.#lastContext = oldCtx;
  }

  static ngTemplateContextGuard<T>(
    _dir: BraStringTemplateOutletDirective<T>,
    _ctx: unknown,
  ): _ctx is BraStringTemplateOutletContext {
    return true;
  }

  ngOnDestroy(): void {
    this.#viewEffect.destroy();
    this.viewContainer.clear();
    this.embeddedViewRef = null;
  }
}
