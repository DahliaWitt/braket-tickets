import '../../../../../test-setup';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentHarness, type HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { provideZonelessChangeDetection } from '@angular/core';
import { ZardCardComponent } from './card.component';
import { ZardCardComponentHarness } from './card.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-card
      [zTitle]="'Primary Title'"
      [zDescription]="'Primary Description'"
      [zAction]="'Manage'"
      [zActionAriaLabel]="actionAriaLabel()"
      [zHeaderBorder]="headerBorder()"
      [zFooterBorder]="footerBorder()"
      (zActionClick)="onActionClick()"
    >
      <div>Primary content</div>
      <div card-footer>Primary footer</div>
    </z-card>

    <z-card>
      <div>Secondary content</div>
    </z-card>
  `,
  imports: [ZardCardComponent],
})
class CardHarnessHostComponent {
  readonly headerBorder = signal(false);
  readonly footerBorder = signal(false);
  readonly actionAriaLabel = signal<string | undefined>(undefined);
  readonly actionClicks = signal(0);

  onActionClick(): void {
    this.actionClicks.update((value) => value + 1);
  }
}

class CardHeaderHarness extends ComponentHarness {
  static hostSelector = '[data-slot="card-header"]';

  async getClassAttribute(): Promise<string> {
    const host = await this.host();
    return (await host.getAttribute('class')) ?? '';
  }
}

class CardFooterHarness extends ComponentHarness {
  static hostSelector = '[data-slot="card-footer"]';

  async getClassAttribute(): Promise<string> {
    const host = await this.host();
    return (await host.getAttribute('class')) ?? '';
  }
}

class CardActionHarness extends ComponentHarness {
  static hostSelector = '[data-slot="card-action"]';

  async getAriaLabel(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-label');
  }

  async click(): Promise<void> {
    await (await this.host()).click();
  }
}

describe('ZardCardComponentHarness', () => {
  let fixture: ComponentFixture<CardHarnessHostComponent>;
  let component: CardHarnessHostComponent;
  let loader: HarnessLoader;
  const hasClassToken = (className: string, token: string): boolean =>
    className.split(/\s+/).includes(token);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardHarnessHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(CardHarnessHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should read title and text content through harness', async () => {
    const cards = await loader.getAllHarnesses(ZardCardComponentHarness);

    expect(cards).toHaveLength(2);
    expect(await cards[0].getTitleText()).toContain('Primary Title');
    expect(await cards[0].getText()).toContain('Primary content');
  });

  it('should return empty title text when no title is rendered', async () => {
    const cards = await loader.getAllHarnesses(ZardCardComponentHarness);

    expect(await cards[1].getTitleText()).toBe('');
    expect(await cards[1].getText()).toContain('Secondary content');
  });

  it('should use action text as fallback aria-label and allow overrides', async () => {
    const action = await loader.getHarness(CardActionHarness);
    expect(await action.getAriaLabel()).toBe('Manage');

    component.actionAriaLabel.set('Open management panel');
    fixture.detectChanges();

    expect(await action.getAriaLabel()).toBe('Open management panel');
  });

  it('should emit action click events', async () => {
    const action = await loader.getHarness(CardActionHarness);
    await action.click();
    await action.click();

    expect(component.actionClicks()).toBe(2);
  });

  it('should apply header/footer border classes when enabled', async () => {
    const header = await loader.getHarness(CardHeaderHarness);
    const footer = await loader.getHarness(CardFooterHarness);

    const headerClassBefore = await header.getClassAttribute();
    const footerClassBefore = await footer.getClassAttribute();
    expect(hasClassToken(headerClassBefore, 'border-b')).toBe(false);
    expect(hasClassToken(footerClassBefore, 'border-t')).toBe(false);

    component.headerBorder.set(true);
    component.footerBorder.set(true);
    fixture.detectChanges();

    const headerClassAfter = await header.getClassAttribute();
    const footerClassAfter = await footer.getClassAttribute();
    expect(hasClassToken(headerClassAfter, 'border-b')).toBe(true);
    expect(hasClassToken(footerClassAfter, 'border-t')).toBe(true);
  });
});
