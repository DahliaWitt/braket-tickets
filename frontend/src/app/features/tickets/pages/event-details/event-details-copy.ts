interface ContactDialogOrganizer {
  readonly email?: string | null;
  readonly contactInfo?: string | null;
}

export function getContactDialogDescription(
  org: ContactDialogOrganizer,
): string {
  if (org.email && org.contactInfo) {
    return "Choose email or use the community's preferred contact instructions.";
  }
  if (org.email) {
    return 'Open an email draft, or copy the address and write from wherever works for you.';
  }
  if (org.contactInfo) {
    return "Use the community's preferred contact instructions below.";
  }
  return 'This community has not shared a direct contact method yet.';
}
