import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { AppQrComponent } from './qr.component';
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-qr [data]="'test-data'" />`,
  imports: [AppQrComponent],
})
class TestHostComponent {}

describe('AppQrComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
  });

  it('should create and generate qr', async () => {
    fixture.detectChanges();

    const qrElement = (fixture.nativeElement as HTMLElement).querySelector('app-qr');
    expect(qrElement).toBeTruthy();

    // Wait for effect to run (effect is async)
    // Poll for the image to appear with a reasonable timeout
    let img: HTMLImageElement | null = null;
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      fixture.detectChanges();
      await fixture.whenStable();
      img = (fixture.nativeElement as HTMLElement).querySelector('img');
      if (img && img.src && img.src.includes('data:image/png;base64,')) {
        break;
      }
    }

    expect(img).toBeTruthy();
    expect(img?.src).toContain('data:image/png;base64,');
  });
});
