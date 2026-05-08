import '../../../../../test-setup';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { BraDialogComponent, BraDialogOptions } from './dialog.component';
import { PortalModule } from '@angular/cdk/portal';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';

describe('BraDialogComponent Security', () => {
  let fixture: ComponentFixture<BraDialogComponent<unknown, unknown>>;

  beforeEach(async () => {
    const mockOptions = new BraDialogOptions();
    mockOptions.zContent = '<img src=x onerror=alert(1)>';
    mockOptions.zTitle = 'Security Test';

    await TestBed.configureTestingModule({
      imports: [BraDialogComponent, PortalModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BraDialogOptions, useValue: mockOptions },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BraDialogComponent);
    fixture.detectChanges();
  });

  it('should render string content as text (escaped), preventing XSS', () => {
    const contentDebugElement = fixture.debugElement.query(By.css('[data-testid="z-content"]'));
    expect(contentDebugElement).toBeTruthy();

    // Check that the img tag does NOT exist in the DOM
    const imgTag = contentDebugElement.query(By.css('img'));
    expect(imgTag).toBeNull();

    // Check that the text content contains the HTML string (meaning it was escaped)
    expect((contentDebugElement.nativeElement as HTMLElement).textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });
});
