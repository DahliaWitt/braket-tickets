import '../../../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {type ResaleListing} from '@/features/admin/models/event-management.model';
import {EventManagementResaleTabComponent} from './event-management-resale-tab.component';

describe('EventManagementResaleTabComponent', () => {
  let fixture: ComponentFixture<EventManagementResaleTabComponent>;
  let component: EventManagementResaleTabComponent;
  let adminEventsServiceMock: {
    updateResaleSettings: ReturnType<typeof vi.fn>;
  };
  let resaleServiceMock: {
    cancelResaleListing: ReturnType<typeof vi.fn>;
  };
  let alertDialogMock: {
    confirm: ReturnType<typeof vi.fn>;
  };
  /** Result of the most recent auto-confirmed zOnOk (a promise for async work). */
  let lastConfirmRun: unknown;

  const mockListing = {
    _id: 'listing-1',
    _creationTime: 1700000000000,
    ticketId: 'ticket-1',
    eventId: 'event-1',
    sellerId: 'user-1',
    sellerName: 'Jane Doe',
    sellerEmail: 'jane@example.com',
    status: 'listed',
  } as unknown as ResaleListing;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    vi.spyOn(toast, 'error').mockImplementation(() => '');
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    adminEventsServiceMock = {
      updateResaleSettings: vi.fn().mockResolvedValue(undefined),
    };
    resaleServiceMock = {
      cancelResaleListing: vi.fn().mockResolvedValue(undefined),
    };
    lastConfirmRun = undefined;
    alertDialogMock = {
      // Default: auto-confirm and record zOnOk's returned promise so tests
      // can await the confirmed work deterministically.
      confirm: vi.fn((config: {zOnOk?: () => unknown}): void => {
        lastConfirmRun = config.zOnOk?.();
      }),
    };

    await TestBed.configureTestingModule({
      imports: [EventManagementResaleTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminEventsService, useValue: adminEventsServiceMock},
        {provide: ResaleService, useValue: resaleServiceMock},
        {provide: BraAlertDialogService, useValue: alertDialogMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventManagementResaleTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('resaleListings', [mockListing]);
    fixture.detectChanges();
  });

  it('confirms before cancelling a listing, naming the seller', () => {
    component.adminCancelListing(mockListing);

    expect(alertDialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'cancel resale listing',
        zOkDestructive: true,
        zMaskClosable: false,
      }),
    );
    const config = alertDialogMock.confirm.mock.calls[0][0] as {
      zDescription?: string;
    };
    expect(config.zDescription).toContain('Jane Doe');
  });

  it('cancels the listing and toasts on confirm', async () => {
    const dataChangedSpy = vi.fn();
    component.dataChanged.subscribe(dataChangedSpy);

    component.adminCancelListing(mockListing);
    await lastConfirmRun;

    expect(resaleServiceMock.cancelResaleListing).toHaveBeenCalledWith(
      'listing-1',
    );
    expect(toast.success).toHaveBeenCalledWith('resale listing cancelled');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cancel when the confirmation is declined', async () => {
    alertDialogMock.confirm.mockImplementation(() => undefined);

    component.adminCancelListing(mockListing);
    await fixture.whenStable();

    expect(alertDialogMock.confirm).toHaveBeenCalled();
    expect(resaleServiceMock.cancelResaleListing).not.toHaveBeenCalled();
  });

  it('ignores a second cancel while one is in flight', async () => {
    let resolveCancel!: () => void;
    const pendingCancel = new Promise<void>((resolve) => {
      resolveCancel = resolve;
    });
    resaleServiceMock.cancelResaleListing.mockReturnValue(pendingCancel);

    component.adminCancelListing(mockListing);
    // First confirm ran zOnOk synchronously → cancellation is in flight.
    component.adminCancelListing(mockListing);

    expect(alertDialogMock.confirm).toHaveBeenCalledTimes(1);
    expect(resaleServiceMock.cancelResaleListing).toHaveBeenCalledTimes(1);

    resolveCancel();
    await lastConfirmRun;
    expect(component.isCancellingListing()).toBeNull();
  });
});
