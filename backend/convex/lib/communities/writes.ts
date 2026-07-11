import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {derivePublicationStatus} from '../../lib/community_status';
import {generateSlug, ensureUniqueSlug} from '../../lib/slugify';
import {isCommunitySlug} from '@shared/domain/community-slug';
import {assertUploadConfirmed} from '../../lib/upload_validation';
import {applyClearableField} from '../../lib/patch';
import {
  MAX_CODE_OF_CONDUCT_LENGTH,
  MAX_COMMUNITY_CONTACT_LENGTH,
  MAX_COMMUNITY_DESCRIPTION_LENGTH,
  MAX_COMMUNITY_EMAIL_LENGTH,
  MAX_COMMUNITY_NAME_LENGTH,
  MAX_COMMUNITY_SLUG_LENGTH,
  MAX_COMMUNITY_WEBSITE_LENGTH,
  MAX_VETTING_OPTION_LENGTH,
  MAX_VETTING_QUESTION_LENGTH,
  validateArrayField,
  validateStringLength,
} from '../../lib/validation';
import {
  throwAppError,
  throwInvalidInput,
  throwInvalidState,
} from '../../lib/errors';
import {
  isOrganizerChargeReady,
  type OrganizerStripeConnectState,
} from '../../lib/stripe_connect_state';

type QueryableDb = Pick<QueryCtx['db'], 'query'>;
type ConfirmedUploadDb = MutationCtx['db'];
type CommunityVettingQuestions = Doc<'organizers'>['vettingQuestions'];

export type CommunityCreateFields = {
  name: string;
  email?: string;
  contactInfo?: string;
  vettingQuestions?: CommunityVettingQuestions;
  status?: CommunityPublicationStatus;
  description?: string;
  isPublicDirectory?: boolean; // defaults to true at create time
  slug?: string;
  codeOfConduct?: string;
};

export type CommunityUpdateFields = {
  name?: string;
  // `null` is an explicit clear sentinel on these optional fields; an omitted
  // key means "leave unchanged".
  email?: string | null;
  contactInfo?: string | null;
  vettingQuestions?: CommunityVettingQuestions;
  status?: CommunityPublicationStatus;
  description?: string | null;
  website?: string | null;
  isPublicDirectory?: boolean;
  logoStorageId?: Id<'_storage'> | null;
  slug?: string | null;
  codeOfConduct?: string;
};

export type CommunityUpdatePatch = Partial<{
  name: string;
  email: string;
  contactInfo: string;
  vettingQuestions: CommunityVettingQuestions;
  status: CommunityPublicationStatus;
  description: string;
  website: string;
  isPublicDirectory: boolean;
  logoStorageId: Id<'_storage'> | null;
  slug: string;
  codeOfConduct: string;
}>;

function validateCommunityVettingQuestions(
  vettingQuestions: CommunityVettingQuestions,
): void {
  if (!vettingQuestions) return;

  for (const question of vettingQuestions) {
    validateStringLength(
      question.question,
      'Question',
      MAX_VETTING_QUESTION_LENGTH,
    );
    if (question.options) {
      validateArrayField(
        question.options,
        'Options',
        50,
        MAX_VETTING_OPTION_LENGTH,
      );
    }
  }
}

function validateCommunityWebsite(website: string | null | undefined): void {
  validateStringLength(website, 'Website', MAX_COMMUNITY_WEBSITE_LENGTH);

  if (website === undefined || website === null || website === '') {
    return;
  }

  try {
    const parsed = new URL(website);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('bad protocol');
    }
  } catch {
    throwInvalidInput('Website must be a valid HTTP or HTTPS URL', {
      field: 'website',
    });
  }
}

function validateManualCommunitySlug(slug: string): string {
  const trimmed = slug.trim();
  validateStringLength(trimmed, 'Slug', MAX_COMMUNITY_SLUG_LENGTH);

  if (!isCommunitySlug(trimmed)) {
    throwAppError(
      'INVALID_INPUT',
      'Slug must use lowercase letters, numbers, and single hyphens only',
      {field: 'slug'},
    );
  }

  return trimmed;
}

function resolveCreateStatus(
  status: CommunityPublicationStatus | undefined,
): CommunityPublicationStatus {
  // Create-time default is 'draft' — explicit new rows start unpublished. This
  // is intentionally distinct from `derivePublicationStatus`, which interprets
  // legacy-stored undefined (pre-status-field rows) as 'published'.
  return status ?? 'draft';
}

function validatePublishTransition(
  nextStatus: CommunityPublicationStatus,
  previousStatus: CommunityPublicationStatus,
  organizer: OrganizerStripeConnectState | undefined,
): void {
  if (nextStatus !== 'published' || previousStatus === 'published') return;
  if (isOrganizerChargeReady(organizer)) return;
  throwInvalidState(
    'Publishing a community requires Stripe Connect or platform payment setup',
  );
}

export function validatePublishedCommunityRequirements(
  status: CommunityPublicationStatus,
  vettingQuestions: CommunityVettingQuestions,
): void {
  if (status !== 'published') return;
  if (vettingQuestions && vettingQuestions.length > 0) return;
  throwInvalidState(
    'Published communities must have at least one vetting question',
  );
}

export function validateCommunityFields(args: {
  name?: string;
  // `null` is the clear sentinel on the update path; the length/format helpers
  // below all treat `null` as "no value" and skip it.
  email?: string | null;
  contactInfo?: string | null;
  vettingQuestions?: CommunityVettingQuestions;
  description?: string | null;
  website?: string | null;
  codeOfConduct?: string;
}): void {
  validateStringLength(args.name, 'Name', MAX_COMMUNITY_NAME_LENGTH);
  validateStringLength(args.email, 'Email', MAX_COMMUNITY_EMAIL_LENGTH);
  validateStringLength(
    args.contactInfo,
    'Contact info',
    MAX_COMMUNITY_CONTACT_LENGTH,
  );
  validateStringLength(
    args.description,
    'Description',
    MAX_COMMUNITY_DESCRIPTION_LENGTH,
  );
  validateCommunityWebsite(args.website);
  validateCommunityVettingQuestions(args.vettingQuestions);
  validateStringLength(
    args.codeOfConduct,
    'Code of Conduct',
    MAX_CODE_OF_CONDUCT_LENGTH,
  );
}

export async function resolveCommunitySlugForCreate(
  db: QueryableDb,
  args: {
    name: string;
    slug?: string;
  },
): Promise<string> {
  const baseSlug =
    args.slug !== undefined
      ? validateManualCommunitySlug(args.slug)
      : generateSlug(args.name);
  validateStringLength(baseSlug, 'Slug', MAX_COMMUNITY_SLUG_LENGTH);

  return ensureUniqueSlug(baseSlug, async (slug) =>
    db
      .query('organizers')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first(),
  );
}

export async function prepareCommunityCreateData(
  db: QueryableDb,
  args: CommunityCreateFields,
): Promise<{
  name: string;
  email?: string;
  contactInfo?: string;
  vettingQuestions?: CommunityVettingQuestions;
  status: CommunityPublicationStatus;
  description?: string;
  isPublicDirectory: boolean;
  slug: string;
  codeOfConduct?: string;
}> {
  validateCommunityFields(args);
  const status = resolveCreateStatus(args.status);
  validatePublishedCommunityRequirements(status, args.vettingQuestions);
  validatePublishTransition(status, 'draft', undefined);

  return {
    name: args.name,
    email: args.email,
    contactInfo: args.contactInfo,
    vettingQuestions: args.vettingQuestions,
    status,
    description: args.description,
    isPublicDirectory: args.isPublicDirectory ?? true,
    slug: await resolveCommunitySlugForCreate(db, args),
    codeOfConduct: args.codeOfConduct,
  };
}

export async function buildCommunityUpdatePatch(
  db: QueryableDb,
  confirmedUploadDb: ConfirmedUploadDb,
  uploaderUserId: Id<'users'>,
  currentOrganizer: Doc<'organizers'>,
  organizerId: Id<'organizers'>,
  args: CommunityUpdateFields,
): Promise<CommunityUpdatePatch> {
  validateCommunityFields(args);

  const nextVettingQuestions =
    args.vettingQuestions ?? currentOrganizer.vettingQuestions;
  const previousStatus = derivePublicationStatus(currentOrganizer);
  const nextStatus = args.status ?? previousStatus;
  const isPublishingTransition =
    previousStatus !== 'published' && nextStatus === 'published';
  const isExplicitPublishedUpdate = args.status === 'published';
  const isUpdatingVettingQuestions = args.vettingQuestions !== undefined;
  if (
    nextStatus === 'published' &&
    (isPublishingTransition ||
      isExplicitPublishedUpdate ||
      isUpdatingVettingQuestions)
  ) {
    validatePublishedCommunityRequirements(nextStatus, nextVettingQuestions);
  }
  validatePublishTransition(nextStatus, previousStatus, currentOrganizer);

  const updates: CommunityUpdatePatch = {};
  if (args.name !== undefined) updates.name = args.name;
  // `null` clears the field (removed via ctx.db.patch); a string sets it; an
  // omitted key leaves the stored value untouched.
  applyClearableField(updates, 'email', args.email, currentOrganizer.email);
  applyClearableField(
    updates,
    'contactInfo',
    args.contactInfo,
    currentOrganizer.contactInfo,
  );
  if (args.vettingQuestions !== undefined)
    updates.vettingQuestions = args.vettingQuestions;
  if (args.status !== undefined) updates.status = args.status;
  applyClearableField(
    updates,
    'description',
    args.description,
    currentOrganizer.description,
  );
  applyClearableField(
    updates,
    'website',
    args.website,
    currentOrganizer.website,
  );
  if (args.isPublicDirectory !== undefined) {
    updates.isPublicDirectory = args.isPublicDirectory;
  }
  if (args.codeOfConduct !== undefined)
    updates.codeOfConduct = args.codeOfConduct;

  if (args.logoStorageId) {
    await assertUploadConfirmed(
      confirmedUploadDb,
      args.logoStorageId,
      'logoStorageId',
      uploaderUserId,
    );
  }
  if (args.logoStorageId !== undefined) {
    updates.logoStorageId = args.logoStorageId;
  }

  if (args.slug === null) {
    // Explicit clear: drop the manual slug. No format/uniqueness check applies.
    applyClearableField(updates, 'slug', null, currentOrganizer.slug);
  } else if (args.slug !== undefined) {
    const slugValue = validateManualCommunitySlug(args.slug);
    validateStringLength(slugValue, 'Slug', MAX_COMMUNITY_SLUG_LENGTH);

    const existing = await db
      .query('organizers')
      .withIndex('by_slug', (q) => q.eq('slug', slugValue))
      .first();
    if (existing && existing._id !== organizerId) {
      throwAppError('CONFLICT', 'This slug is already taken');
    }
    updates.slug = slugValue;
  }

  return updates;
}
