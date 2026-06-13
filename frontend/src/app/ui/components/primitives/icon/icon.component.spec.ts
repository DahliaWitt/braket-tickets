import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {ZardIconComponent} from './icon.component';
import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {ZARD_ICONS, type LucideIconData, type ZardIcon} from './icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-icon
      class="animate-spin text-primary"
      [zType]="iconType()"
      [zStrokeWidth]="strokeWidth()"
    />
  `,
  imports: [ZardIconComponent],
})
class TestHostComponent {
  readonly iconType = signal<ZardIcon>('loader-circle');
  readonly strokeWidth = signal(2);
}

describe('ZardIconComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
    fixture.detectChanges();
  });

  const getIconComponent = (): ZardIconComponent =>
    fixture.debugElement.children[0].componentInstance as ZardIconComponent;

  it('should have aria-hidden="true" attribute', () => {
    const iconElement = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('z-icon')!;
    expect(iconElement.getAttribute('aria-hidden')).toBe('true');
  });

  it('should resolve icon names through the internal icon map', () => {
    const iconComponent = getIconComponent();
    const iconSignal = (
      iconComponent as unknown as {icon: () => LucideIconData}
    ).icon;

    expect(iconSignal()).toBe(ZARD_ICONS['loader-circle']);
  });

  it('should return custom icon data directly when zType receives a LucideIconData object', () => {
    const customIcon: LucideIconData = [['path', {d: 'M0 0'}]];
    hostComponent.iconType.set(customIcon);
    fixture.detectChanges();

    const iconComponent = getIconComponent();
    const iconSignal = (
      iconComponent as unknown as {icon: () => LucideIconData}
    ).icon;

    expect(iconSignal()).toBe(customIcon);
  });

  it('should render inline svg markup for the selected icon', () => {
    const svgElement = (fixture.nativeElement as HTMLElement).querySelector(
      'svg',
    );

    expect(svgElement).toBeTruthy();
    expect(svgElement?.innerHTML).toContain('path');
    expect(svgElement?.getAttribute('stroke-width')).toBe('2');
  });

  it('keeps animated icons centered on their own SVG box', () => {
    const svgElement = (
      fixture.nativeElement as HTMLElement
    ).querySelector<SVGElement>('svg')!;

    expect(svgElement.classList.contains('animate-spin')).toBe(true);
    expect(svgElement.classList.contains('block')).toBe(true);
    expect(svgElement.classList.contains('origin-center')).toBe(true);
  });
});
