import '../../../../../test-setup';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { BraDropdownMenuContentComponent } from './dropdown-menu-content.component';

describe('BraDropdownMenuContentComponent', () => {
  let fixture: ComponentFixture<BraDropdownMenuContentComponent>;
  let component: BraDropdownMenuContentComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BraDropdownMenuContentComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BraDropdownMenuContentComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('class', 'custom-menu-content');
    fixture.detectChanges();
  });

  it('should expose content template with menu accessibility attributes', () => {
    const template = component.contentTemplate();
    const view = template.createEmbeddedView({});
    view.detectChanges();

    const menuElement = view.rootNodes.find(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );

    expect(menuElement).toBeDefined();
    expect(menuElement?.getAttribute('role')).toBe('menu');
    expect(menuElement?.getAttribute('tabindex')).toBe('-1');
    expect(menuElement?.getAttribute('aria-orientation')).toBe('vertical');
    expect(menuElement?.className).toContain('custom-menu-content');

    view.destroy();
  });

  it('should keep host hidden and render menu classes through computed signal', () => {
    const hostElement = fixture.nativeElement as HTMLElement;
    const classes = (
      component as unknown as {
        contentClasses: () => string;
      }
    ).contentClasses;

    expect(hostElement.style.display).toBe('none');
    expect(classes()).toContain('custom-menu-content');
  });
});
