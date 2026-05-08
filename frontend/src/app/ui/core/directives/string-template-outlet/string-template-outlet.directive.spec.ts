import {
  ChangeDetectionStrategy,
  Component,
  type TemplateRef,
  viewChild,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  BraStringTemplateOutletDirective,
  type BraStringTemplateOutletContext,
} from './string-template-outlet.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *zStringTemplateOutlet="content(); context: context()">
      String: {{ content() }}
    </ng-container>

    <ng-template #customTpl let-value>Template: {{ value }}</ng-template>
  `,
  imports: [BraStringTemplateOutletDirective],
})
class TestHostComponent {
  readonly content = signal<string | TemplateRef<void>>('initial');
  readonly context = signal<BraStringTemplateOutletContext | undefined>(undefined);

  readonly customTpl = viewChild<TemplateRef<void>>('customTpl');
}

describe('BraStringTemplateOutletDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
  });

  it('should render string content', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('String: initial');
  });

  it('should update when string content changes', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    host.content.set('updated');
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('String: updated');
  });

  it('should render template with context', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const tpl = host.customTpl();
    expect(tpl).toBeTruthy();

    host.content.set(tpl!);
    host.context.set({ $implicit: 'template_value' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Template: template_value',
    );
  });

  it('should switch from string to template', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('String: initial');

    const tpl = host.customTpl();
    host.content.set(tpl!);
    host.context.set({ $implicit: 'switched' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Template: switched');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('String:');
  });

  it('should switch from template back to string', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    // First set to template
    const tpl = host.customTpl();
    host.content.set(tpl!);
    host.context.set({ $implicit: 'template_mode' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Template: template_mode');

    // Switch back to string
    host.content.set('back_to_string');
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('String: back_to_string');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Template:');
  });

  it('should update template context without recreating view', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const tpl = host.customTpl();
    host.content.set(tpl!);
    host.context.set({ $implicit: 'first' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Template: first');

    // Update context value (same shape)
    host.context.set({ $implicit: 'second' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Template: second');
  });
});
