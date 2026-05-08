import '../../../../../test-setup';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { BraToastComponent } from './toast.component';
import { provideZonelessChangeDetection } from '@angular/core';
import { toast } from 'ngx-sonner';
import { vi } from 'vitest';

describe('BraToastComponent', () => {
  let component: BraToastComponent;
  let fixture: ComponentFixture<BraToastComponent>;
  let addListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    addListenerSpy = vi.spyOn(document, 'addEventListener');
    removeListenerSpy = vi.spyOn(document, 'removeEventListener');

    await TestBed.configureTestingModule({
      imports: [BraToastComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(BraToastComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have richColors enabled by default', () => {
    expect(component.richColors()).toBe(true);
  });

  it('should register and cleanup keydown listener for keyboard shortcuts', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const keydownHandler = (
      component as unknown as { handleKeydown: (event: KeyboardEvent) => void }
    ).handleKeydown;
    expect(addListenerSpy).toHaveBeenCalledWith('keydown', keydownHandler);

    fixture.destroy();

    expect(removeListenerSpy).toHaveBeenCalledWith('keydown', keydownHandler);
  });

  it('should dismiss all toasts when Escape is pressed', async () => {
    const dismissSpy = vi.spyOn(toast, 'dismiss');

    const keydownHandler = (
      component as unknown as { handleKeydown: (event: KeyboardEvent) => void }
    ).handleKeydown;
    keydownHandler(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it('should keep Alt+T as a no-op keyboard shortcut', async () => {
    const dismissSpy = vi.spyOn(toast, 'dismiss');

    const keydownHandler = (
      component as unknown as { handleKeydown: (event: KeyboardEvent) => void }
    ).handleKeydown;
    keydownHandler(new KeyboardEvent('keydown', { key: 't', altKey: true }));

    expect(dismissSpy).not.toHaveBeenCalled();
  });
});
