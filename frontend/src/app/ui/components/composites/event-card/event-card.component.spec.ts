import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type HarnessLoader} from '@angular/cdk/testing';
import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {EventCardComponent, type EventCardData} from './event-card.component';
import {EventCardHarness} from './event-card.harness';

// Test host to set inputs
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [EventCardComponent],
  template: `<app-event-card [event]="event()" />`,
})
class TestHostComponent {
  readonly event = signal<EventCardData>({
    _id: 'test-id-123',
    title: 'Test Event',
    date: '2030-06-15',
    price: 2500,
    totalTickets: 100,
    soldCount: 10,
    isSoldOut: false,
  });
}

describe('EventCardComponent', () => {
  let loader: HarnessLoader;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideRouter([]), provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should display event title and date', async () => {
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.getTitle()).toContain('Test Event');
    expect(await harness.getDate()).toBeTruthy();
  });

  it('renders event dates in the platform timezone', async () => {
    host.event.set({
      ...host.event(),
      date: '2026-02-27T07:30:00.000Z',
    });

    const harness = await loader.getHarness(EventCardHarness);

    const dateText = (await harness.getDate()).replace(/\s+/g, ' ');
    expect(dateText).toContain('Feb 26, 2026');
    expect(dateText).toContain('11:30 PM');
  });

  it('renders More Info as a semantic link to the event details route', async () => {
    const harness = await loader.getHarness(EventCardHarness);

    expect(await harness.getMoreInfoHref()).toBe('/events/test-id-123');
    expect(await harness.getMoreInfoRole()).toBeNull();
  });

  it('keeps the poster placeholder exposed as a semantic link when no poster exists', async () => {
    const harness = await loader.getHarness(EventCardHarness);

    expect(await harness.getPosterPlaceholderAriaHidden()).toBeNull();
    expect(await harness.getPosterPlaceholderHref()).toBe(
      '/events/test-id-123',
    );
  });

  it('should show sold out badge when canonical isSoldOut is true', async () => {
    host.event.set({...host.event(), soldCount: 1, isSoldOut: true});
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.isSoldOut()).toBe(true);
  });

  it('should show sold out badge when ticketSalesStatus is ended', async () => {
    host.event.set({...host.event(), ticketSalesStatus: 'ended'});
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.isSoldOut()).toBe(true);
  });

  it('should not show sold out badge for available events', async () => {
    host.event.set({
      ...host.event(),
      soldCount: 10,
      totalTickets: 100,
      isSoldOut: false,
    });
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.isSoldOut()).toBe(false);
  });

  it('should ignore legacy soldCount saturation when canonical isSoldOut is false', async () => {
    host.event.set({
      ...host.event(),
      soldCount: 100,
      totalTickets: 100,
      isSoldOut: false,
    });
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.isSoldOut()).toBe(false);
  });

  it('should display location when provided', async () => {
    host.event.set({...host.event(), location: 'Brooklyn'});
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.getLocation()).toContain('Brooklyn');
  });

  it('should not display location when not provided', async () => {
    host.event.set({...host.event(), location: undefined});
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.getLocation()).toBeNull();
  });

  it('renders Tickets button with buy=true query param to auto-open checkout', async () => {
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.getBuyHref()).toBe('/events/test-id-123?buy=true');
  });

  it('renders action-only ticket button text', async () => {
    host.event.set({
      ...host.event(),
      slidingScaleEnabled: true,
      slidingScaleMin: 0,
      slidingScaleMax: 2500,
      supporterDefaultPrice: 4000,
    });

    const harness = await loader.getHarness(EventCardHarness);
    expect((await harness.getBuyText()).trim()).toBe('Tickets');
  });

  it('uses an action-only buy button accessible name', async () => {
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.getBuyAriaLabel()).toBe('Get tickets for Test Event');
  });

  it('does not emit href when buy button is disabled (sold out)', async () => {
    host.event.set({...host.event(), isSoldOut: true});
    const harness = await loader.getHarness(EventCardHarness);
    expect(await harness.isBuyDisabled()).toBe(true);
    expect(await harness.getBuyHref()).toBeNull();
  });
});
