import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { vi } from 'vitest';
import { toast } from 'ngx-sonner';

import { BRA_MODAL_DATA } from '@ui/components/composites/dialog/dialog.service';
import { BraDialogRef } from '@ui/components/composites/dialog/dialog-ref';

import {
  ContactCommunityDialogComponent,
  type ContactCommunityDialogData,
} from './contact-community-dialog.component';
import { ContactCommunityDialogHarness } from './contact-community-dialog.component.harness';

describe('ContactCommunityDialogComponent', () => {
  let fixture: ComponentFixture<ContactCommunityDialogComponent>;
  let dialogData: ContactCommunityDialogData;
  const dialogRef = {
    close: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    dialogData = {
      organizerName: 'Void Collective',
      organizerEmail: 'hello@voidcollective.test',
      organizerContactInfo: 'DM us @void.collective on Instagram',
      eventTitle: 'Void Sessions Vol. 12',
    };

    await TestBed.configureTestingModule({
      imports: [ContactCommunityDialogComponent],
      providers: [
        { provide: BRA_MODAL_DATA, useFactory: () => dialogData },
        { provide: BraDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactCommunityDialogComponent);
    fixture.detectChanges();
    dialogRef.close.mockReset();
  });

  it('renders both email and freeform contact details when present', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ContactCommunityDialogHarness,
    );

    expect(await harness.hasEmailSection()).toBe(true);
    expect(await harness.getEmailText()).toBe('hello@voidcollective.test');
    expect(await harness.hasContactInfoSection()).toBe(true);
    expect(await harness.getContactInfoText()).toContain('DM us @void.collective on Instagram');
    const rootElement = fixture.nativeElement as HTMLElement;
    expect(rootElement.querySelector('z-icon[zType="message-square"]')).not.toBeNull();
  });

  it('copies the organizer email', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ContactCommunityDialogHarness,
    );

    await harness.clickCopyEmail();

    expect(writeText).toHaveBeenCalledWith('hello@voidcollective.test');
    expect(successSpy).toHaveBeenCalledWith('Email copied');
  });

  it('opens an email draft only when the user chooses that action', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ContactCommunityDialogHarness,
    );
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await harness.clickDraftEmail();

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(anchor.href).toContain('mailto:hello@voidcollective.test');
    expect(anchor.href).toContain('Question%20about%20Void%20Sessions%20Vol.%2012');
    expect(clickSpy).toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('shows a fallback message when no contact method exists', async () => {
    dialogData.organizerName = 'Signal House';
    dialogData.organizerEmail = undefined;
    dialogData.organizerContactInfo = '   ';
    dialogData.eventTitle = 'Signal House Assembly';
    fixture = TestBed.createComponent(ContactCommunityDialogComponent);
    fixture.detectChanges();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ContactCommunityDialogHarness,
    );

    expect(await harness.hasEmailSection()).toBe(false);
    expect(await harness.hasContactInfoSection()).toBe(false);
    expect(await harness.getFallbackText()).toContain(
      'Signal House has not shared a direct contact method yet',
    );
  });
});
