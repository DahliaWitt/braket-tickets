import type {ConvexClient} from 'convex/browser';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {getAcceptedImageFormatsMessage} from '@/features/admin/utils/image-upload-policy';

import type {CommunityProfileFormValue} from './community-admin-settings.helpers';

function parseStorageUploadResponse(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Logo upload response was not an object');
  }

  const storageId: unknown = Reflect.get(payload, 'storageId');
  if (typeof storageId !== 'string' || storageId.length === 0) {
    throw new Error('Logo upload response missing storageId');
  }

  return storageId;
}

export async function saveCommunityProfile(
  convex: ConvexClient,
  communityId: Id<'organizers'>,
  profile: CommunityProfileFormValue,
  file: File | null,
  isLogoRemoved: boolean,
): Promise<void> {
  let logoStorageId: Id<'_storage'> | null | undefined = undefined;

  if (file) {
    const validation = await convex.mutation(api.storage.files.validateUpload, {
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
    });
    if (!validation.valid) {
      throw new Error(
        validation.error ??
          `File validation failed. ${getAcceptedImageFormatsMessage()}`,
      );
    }

    const uploadUrl = await convex.mutation(
      api.storage.files.generateUploadUrl,
      {},
    );
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {'Content-Type': file.type},
      body: file,
    });
    if (!response.ok) {
      throw new Error(
        `Logo upload failed: ${response.status} ${response.statusText}`,
      );
    }
    const storageId = parseStorageUploadResponse(await response.json());
    const typedStorageId = storageId as Id<'_storage'>;
    const confirmation = await convex.action(api.storage.files.confirmUpload, {
      storageId: typedStorageId,
      mimeType: file.type,
    });
    if (!confirmation.valid) {
      throw new Error(confirmation.error ?? 'File validation failed');
    }
    logoStorageId = typedStorageId;
  } else if (isLogoRemoved) {
    logoStorageId = null;
  }

  await convex.mutation(api.communities.profile.update, {
    id: communityId,
    name: profile.name,
    email: profile.email || undefined,
    contactInfo: profile.contactInfo || undefined,
    description: profile.description || undefined,
    website: profile.website || undefined,
    slug: profile.slug || undefined,
    status: profile.status,
    isPublicDirectory: profile.isPublicDirectory,
    codeOfConduct: profile.codeOfConduct,
    ...(logoStorageId !== undefined ? {logoStorageId} : {}),
  });
}

export async function grantCommunityAdmin(
  convex: ConvexClient,
  emailInput: string,
  organizerId: Id<'organizers'>,
): Promise<void> {
  const user = await convex.query(api.users.profile.findByExactEmailForAdmin, {
    email: emailInput,
    organizerId,
  });
  if (!user) {
    throw new Error('No Braket account exists for that email yet.');
  }

  await convex.mutation(api.communities.admins.grant, {
    userId: user._id,
    organizerId,
  });
}

export async function revokeCommunityAdmin(
  convex: ConvexClient,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await convex.mutation(api.communities.admins.revoke, {
    userId,
    organizerId,
  });
}

export async function grantCommunityScanner(
  convex: ConvexClient,
  emailInput: string,
  organizerId: Id<'organizers'>,
): Promise<void> {
  const user = await convex.query(api.users.profile.findByExactEmailForAdmin, {
    email: emailInput,
    organizerId,
  });
  if (!user) {
    throw new Error('No Braket account exists for that email yet.');
  }

  await convex.mutation(api.communities.scanners.grant, {
    userId: user._id,
    organizerId,
  });
}

export async function revokeCommunityScanner(
  convex: ConvexClient,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await convex.mutation(api.communities.scanners.revoke, {
    userId,
    organizerId,
  });
}

export async function saveCommunityAdminNotificationPreference(
  convex: ConvexClient,
  organizerId: Id<'organizers'>,
  mode: 'off' | 'all' | 'digest',
  digestHour: number,
): Promise<void> {
  await convex.mutation(
    api.communities.management.notification_preferences
      .setMyNotificationPreference,
    {
      organizerId,
      mode,
      ...(mode === 'digest' ? {digestHour} : {}),
    },
  );
}
