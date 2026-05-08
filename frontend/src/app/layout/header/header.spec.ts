import '../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideRouter} from '@angular/router';
import {HeaderComponent, type NavItem} from './header';
import {HeaderHarness} from './header.harness';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should have skip to content link', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      HeaderHarness,
    );
    const text = await harness.getSkipLinkText();
    expect(text).toContain('Skip to main content');
  });

  describe('focus restoration (BRA-341)', () => {
    const navItems: NavItem[] = [{label: 'Events', routerLink: '/events'}];
    let harness: HeaderHarness;

    beforeEach(async () => {
      fixture.componentRef.setInput('navItems', navItems);
      fixture.detectChanges();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        HeaderHarness,
      );
    });

    it('should restore focus to hamburger button when menu is closed', async () => {
      component.toggleMobileMenu();
      fixture.detectChanges();

      component.closeMobileMenu();
      fixture.detectChanges();

      expect(await harness.isMenuToggleFocused()).toBe(true);
    });

    it('should not steal focus when menu is already closed', async () => {
      // menu is closed (default state) — Escape should be a no-op
      component.closeMobileMenu();
      fixture.detectChanges();

      expect(await harness.isMenuToggleFocused()).toBe(false);
    });
  });

  describe('scroll lock (BRA-380)', () => {
    const navItems: NavItem[] = [{label: 'Events', routerLink: '/events'}];

    beforeEach(() => {
      fixture.componentRef.setInput('navItems', navItems);
      fixture.detectChanges();
    });

    afterEach(() => {
      document.body.style.overflow = '';
    });

    it('should lock body scroll when mobile menu opens', () => {
      component.toggleMobileMenu();
      fixture.detectChanges();

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should unlock body scroll when mobile menu closes', () => {
      component.toggleMobileMenu();
      fixture.detectChanges();

      component.closeMobileMenu();
      fixture.detectChanges();

      expect(document.body.style.overflow).toBe('');
    });

    it('should restore body scroll on component destroy', () => {
      component.toggleMobileMenu();
      fixture.detectChanges();
      expect(document.body.style.overflow).toBe('hidden');

      fixture.destroy();

      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('focus trap fix (BRA-337)', () => {
    const navItems: NavItem[] = [
      {label: 'Events', routerLink: '/events'},
      {label: 'About', routerLink: '/about'},
    ];

    beforeEach(() => {
      fixture.componentRef.setInput('navItems', navItems);
      fixture.detectChanges();
    });

    it('mobile nav should not have tabindex="0" on the nav container', async () => {
      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        HeaderHarness,
      );
      expect(await harness.getMobileNavTabindex()).toBeNull();
    });

    it('mobile nav should have inert attribute when menu is closed', async () => {
      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        HeaderHarness,
      );
      expect(await harness.isMobileNavInert()).toBe(true);
    });

    it('mobile nav should not have inert attribute when menu is open', async () => {
      component.toggleMobileMenu();
      fixture.detectChanges();
      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        HeaderHarness,
      );
      expect(await harness.isMobileNavInert()).toBe(false);
    });
  });
});
