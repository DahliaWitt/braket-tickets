import {getContactDialogDescription} from './event-details-copy';

describe('getContactDialogDescription', () => {
  it('describes the email-only contact flow without awkward mail app copy', () => {
    expect(
      getContactDialogDescription({
        email: 'hello@voidcollective.test',
      }),
    ).toBe(
      'Open an email draft, or copy the address and write from wherever works for you.',
    );
  });

  it('describes the available community contact methods', () => {
    expect(
      getContactDialogDescription({
        email: 'hello@voidcollective.test',
        contactInfo: 'DM us @void.collective',
      }),
    ).toBe(
      "Choose email or use the community's preferred contact instructions.",
    );

    expect(
      getContactDialogDescription({
        contactInfo: 'DM us @void.collective',
      }),
    ).toBe("Use the community's preferred contact instructions below.");

    expect(getContactDialogDescription({})).toBe(
      'This community has not shared a direct contact method yet.',
    );
  });
});
