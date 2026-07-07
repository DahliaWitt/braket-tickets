import {TestBed, type ComponentFixture} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {
  AddGuestDialogComponent,
  type AddGuestDialogData,
} from './add-guest-dialog.component';
import {AddGuestDialogComponentHarness} from './add-guest-dialog.component.harness';

describe('AddGuestDialogComponent', () => {
  let fixture: ComponentFixture<AddGuestDialogComponent>;
  let harness: AddGuestDialogComponentHarness;
  let dialogRefMock: {close: ReturnType<typeof vi.fn>};

  async function setup(data: AddGuestDialogData): Promise<void> {
    dialogRefMock = {close: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [AddGuestDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDialogRef, useValue: dialogRefMock},
        {provide: BRA_MODAL_DATA, useValue: data},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddGuestDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AddGuestDialogComponentHarness,
    );
  }

  describe('add mode (no guest in dialog data)', () => {
    beforeEach(async () => {
      await setup({eventId: 'event-1'});
    });

    it('starts with empty fields', async () => {
      expect(await harness.getNameValue()).toBe('');
      expect(await harness.getEmailValue()).toBe('');
      expect(await harness.getNotesValue()).toBe('');
    });

    it('shows the Add Guest submit label', async () => {
      expect(await harness.getSubmitButtonLabel()).toBe('Add Guest');
    });

    it('trims and coerces empty email/notes to undefined on submit', async () => {
      await harness.setName('  Pat Guest  ');
      await harness.setEmail('   ');
      await harness.setNotes('   ');
      await harness.clickSubmit();

      expect(dialogRefMock.close).toHaveBeenCalledWith({
        name: 'Pat Guest',
        email: undefined,
        type: 'guest',
        notes: undefined,
      });
    });
  });

  describe('edit mode (guest present in dialog data)', () => {
    const guest = {
      name: 'Riley Staff',
      email: 'riley@example.com',
      type: 'staff' as const,
      notes: 'VIP access',
    };

    beforeEach(async () => {
      await setup({eventId: 'event-1', guest});
    });

    it('prefills all four fields from data.guest', async () => {
      expect(await harness.getNameValue()).toBe(guest.name);
      expect(await harness.getEmailValue()).toBe(guest.email);
      expect(await harness.getNotesValue()).toBe(guest.notes);
      // guest.type 'staff' renders as the "Staff" option label in the select.
      expect(await harness.getSelectedTypeLabel()).toBe('Staff');
    });

    it('shows the Save Changes submit label', async () => {
      expect(await harness.getSubmitButtonLabel()).toBe('Save Changes');
    });

    it('still trims and coerces empty email/notes to undefined on submit', async () => {
      await harness.setEmail('   ');
      await harness.setNotes('   ');
      await harness.clickSubmit();

      expect(dialogRefMock.close).toHaveBeenCalledWith({
        name: guest.name,
        email: undefined,
        type: guest.type,
        notes: undefined,
      });
    });

    it('submits edited values as the same result shape used for adding', async () => {
      await harness.setName('Riley Updated');
      await harness.clickSubmit();

      expect(dialogRefMock.close).toHaveBeenCalledWith({
        name: 'Riley Updated',
        email: guest.email,
        type: guest.type,
        notes: guest.notes,
      });
    });
  });
});
