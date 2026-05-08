import {TestBed} from '@angular/core/testing';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {type BraDialogOptions} from '@ui/components/composites/dialog/dialog.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  PlatformContactDialogComponent,
  type PlatformContactDialogData,
} from './platform-contact-dialog.component';
import {PlatformContactDialogService} from './platform-contact-dialog.service';

describe('PlatformContactDialogService', () => {
  type PlatformContactDialogConfig = BraDialogOptions<
    PlatformContactDialogComponent,
    PlatformContactDialogData
  >;

  let createDialog: ReturnType<
    typeof vi.fn<(config: PlatformContactDialogConfig) => void>
  >;
  let service: PlatformContactDialogService;

  beforeEach(() => {
    createDialog = vi.fn<(config: PlatformContactDialogConfig) => void>();
    TestBed.configureTestingModule({
      providers: [
        PlatformContactDialogService,
        {provide: BraDialogService, useValue: {create: createDialog}},
      ],
    });
    service = TestBed.inject(PlatformContactDialogService);
  });

  it('opens the shared platform contact dialog', () => {
    service.open();

    expect(createDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Contact Braket',
        zContent: PlatformContactDialogComponent,
        zHideFooter: true,
      }),
    );
    expect(createDialog.mock.calls[0]?.[0]?.zData).toEqual({
      email: 'contact@braket.gay',
      mailtoHref: 'mailto:contact@braket.gay',
    });
  });

  it('adds an encoded subject when provided', () => {
    service.open({subject: 'Working with Braket'});

    expect(createDialog.mock.calls[0]?.[0]?.zData).toEqual({
      email: 'contact@braket.gay',
      mailtoHref: 'mailto:contact@braket.gay?subject=Working%20with%20Braket',
    });
  });
});
