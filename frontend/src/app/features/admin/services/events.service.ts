import {Injectable} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {logger} from '@/utils/logger';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';
import {compareEventDatesDescending} from '@/features/admin/utils/event-date.utils';
import {getAcceptedImageFormatsMessage} from '@/features/admin/utils/image-upload-policy';
import {isNonRetryableReadError, retryWithDelays} from '@/utils/async-control';
import {
  type AdminEventListItem,
  type EditableEvent,
  type EventDetail,
  type EventListItem,
  type UpcomingEvent,
} from '@/core/models/event.types';

type CreateEventArgs = FunctionArgs<typeof api.events.management.create>;
type UpdateEventArgs = FunctionArgs<typeof api.events.management.update>;
/** Backend contract for {@link api.storage.files.confirmUpload}. Never redefine. */
type ConfirmUploadResult = FunctionReturnType<
  typeof api.storage.files.confirmUpload
>;
const MAX_EVENT_IDS_PER_BATCH = 50;
const EVENT_READ_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;

function parseUploadStorageId(responseText: string): string {
  const parsed: unknown = JSON.parse(responseText);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Upload response must be an object');
  }
  const storageId: unknown = Reflect.get(parsed, 'storageId');
  if (typeof storageId !== 'string' || storageId.length === 0) {
    throw new Error('Upload response missing storageId');
  }
  return storageId;
}

export type EventAvailability = FunctionReturnType<
  typeof api.events.public.getAvailability
>;
export type BatchAvailability = FunctionReturnType<
  typeof api.events.public.getBatchAvailability
>;
export const EMPTY_BATCH_AVAILABILITY: BatchAvailability = {};

/**
 * Service for managing events in the ticket platform.
 * Provides CRUD operations, availability queries, and poster management.
 *
 * @remarks
 * All methods communicate with the Convex backend via convex-angular injected client/query helpers.
 * Event data is returned using Convex-generated read models.
 */
@Injectable({
  providedIn: 'root',
})
export class EventsService {
  private convex = injectConvex();

  /**
   * Fetches upcoming events (today or later).
   * The date cutoff is computed server-side using the platform timezone
   * (`America/Los_Angeles`) so results are consistent across all clients.
   *
   * @returns Array of upcoming events sorted by date
   */
  getUpcoming(): Promise<UpcomingEvent[]> {
    return this.convex.query(api.events.public.upcoming, {});
  }

  /**
   * Fetches all public events, sorted by date (newest first).
   *
   * @returns Array of all events
   */
  getAll(): Promise<EventListItem[]> {
    return this.convex
      .query(api.events.public.list, {})
      .then((events) =>
        events.toSorted((a, b) => compareEventDatesDescending(a.date, b.date)),
      );
  }

  /**
   * Fetches all events for admin view, including drafts and hidden events.
   * Requires admin authentication.
   *
   * @returns Array of all events sorted by date (newest first)
   */
  getAdminAll(): Promise<AdminEventListItem[]> {
    return this.convex
      .query(api.events.management.adminList, {})
      .then((events) =>
        events.toSorted((a, b) => compareEventDatesDescending(a.date, b.date)),
      );
  }

  /**
   * Fetches a single event by ID.
   *
   * @param id - The event ID
   * @returns The event details
   * @throws Error if event is not found
   */
  getOne(id: string): Promise<EventDetail> {
    return this.convex
      .query(api.events.public.get, {id: id as Id<'events'>})
      .then((event) => {
        if (!event) throw new Error('Event not found');
        return event;
      });
  }

  /**
   * Fetches a single event for editing — enforces community admin authorization.
   * Use this instead of getOne() in admin edit flows to prevent cross-community access.
   */
  getOneForEdit(id: string): Promise<EditableEvent> {
    return retryWithDelays({
      delaysMs: EVENT_READ_RETRY_DELAYS_MS,
      run: () =>
        this.convex.query(api.events.management.getForEdit, {
          id: id as Id<'events'>,
        }),
      shouldRetry: (error, attemptIndex) => {
        if (isNonRetryableReadError(error)) return false;
        return attemptIndex < EVENT_READ_RETRY_DELAYS_MS.length - 1;
      },
    });
  }

  /**
   * Fetches ticket availability information for a single event.
   * Includes total tickets, sold count, remaining, and user's ticket count.
   *
   * @param id - The event ID
   * @returns Availability info including ticket counts and sales status, or null if event not found
   */
  getAvailability(id: string): Promise<EventAvailability> {
    return this.convex.query(api.events.public.getAvailability, {
      eventId: id as Id<'events'>,
      now: Math.floor(Date.now() / 60000) * 60000,
    });
  }

  /**
   * Fetches ticket availability for multiple events in a single query.
   * More efficient than calling getAvailability for each event.
   *
   * @param ids - Array of event IDs
   * @returns Map of event ID to availability info
   */
  getBatchAvailability(ids: string[]): Promise<BatchAvailability> {
    if (ids.length === 0) {
      return Promise.resolve(EMPTY_BATCH_AVAILABILITY);
    }

    const now = Math.floor(Date.now() / 60000) * 60000;
    const chunks: Id<'events'>[][] = [];
    for (let i = 0; i < ids.length; i += MAX_EVENT_IDS_PER_BATCH) {
      chunks.push(ids.slice(i, i + MAX_EVENT_IDS_PER_BATCH) as Id<'events'>[]);
    }

    return Promise.all(
      chunks.map((eventIds) =>
        this.convex.query(api.events.public.getBatchAvailability, {
          eventIds,
          now,
        }),
      ),
    ).then(
      (results) =>
        Object.assign({}, ...(results as object[])) as BatchAvailability,
    );
  }

  /**
   * Creates a new event without a poster image.
   * Use createWithPoster() when uploading a poster.
   *
   * @param args - Event creation arguments (title, date, venue, etc.)
   * @returns The created event
   */
  create(args: CreateEventArgs): Promise<Id<'events'>> {
    return this.convex.mutation(api.events.management.create, args);
  }

  /**
   * Updates an existing event without changing the poster.
   * Use updateWithPoster() when uploading a new poster.
   *
   * @param args - Event update arguments including the event ID
   * @returns Resolves when the update completes
   */
  async update(args: UpdateEventArgs): Promise<void> {
    await this.convex.mutation(api.events.management.update, args);
  }

  /**
   * Creates a new event with optional poster image upload.
   * Handles file upload to storage and links the poster to the event.
   *
   * @param args - Event creation arguments (excluding poster)
   * @param posterFile - Optional poster image file to upload
   * @returns The created event ID
   */
  async createWithPoster(
    args: Omit<CreateEventArgs, 'poster'>,
    posterFile?: File,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<Id<'events'>> {
    let poster: Id<'_storage'> | undefined;
    if (posterFile && posterFile.size > 0) {
      poster = await this.uploadPoster(posterFile, onProgress, signal);
    }

    return this.convex.mutation(api.events.management.create, {
      ...args,
      poster,
    });
  }

  /**
   * Updates an existing event with optional new poster image.
   * If a poster file is provided, uploads it and links to the event.
   *
   * @param args - Event update arguments (excluding poster)
   * @param posterFile - Optional new poster image file to upload
   * @returns Resolves when the update completes
   */
  async updateWithPoster(
    args: Omit<UpdateEventArgs, 'poster'>,
    posterFile?: File,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let poster: string | undefined = undefined;

    if (posterFile && posterFile.size > 0) {
      const storageId = await this.uploadPoster(posterFile, onProgress, signal);
      poster = storageId;
    }

    await this.convex.mutation(api.events.management.update, {
      ...args,
      ...(poster ? {poster} : {}),
    });
  }

  /**
   * Shared upload core: validateUpload -> generateUploadUrl -> XHR PUT (with
   * progress) -> confirmUpload. Resolves with the confirmUpload result (valid or
   * not) plus the parsed storageId so callers can decide how to surface failures.
   *
   * Rejects only on transport-level failures (validation-precheck failure,
   * non-2xx upload, network error, abort, or the confirmUpload action throwing).
   * A `{valid: false}` confirmation resolves normally — the caller inspects it.
   *
   * @param file - The image file to upload
   * @param onProgress - Optional progress callback (integer percent 0-100)
   * @param signal - Optional AbortSignal to cancel the upload
   * @throws Error if the upload fails, is aborted, or confirmUpload throws
   */
  private async uploadAndConfirm(
    file: File,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<{result: ConfirmUploadResult; storageId: Id<'_storage'>}> {
    const validation = await this.convex.mutation(
      api.storage.files.validateUpload,
      {
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      },
    );
    if (!validation.valid) {
      throw new Error(
        validation.error ??
          `File validation failed. ${getAcceptedImageFormatsMessage()}`,
      );
    }

    logger.debug(
      'Generating upload URL for file:',
      file.name,
      file.type,
      file.size,
    );
    const uploadUrl = await this.convex.mutation(
      api.storage.files['generateUploadUrl'],
      {},
    );

    logger.debug('Uploading to:', uploadUrl);
    const contentType = file.type || 'application/octet-stream';

    return new Promise<{
      result: ConfirmUploadResult;
      storageId: Id<'_storage'>;
    }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Content-Type', contentType);

      // Handle abort signal
      const abortHandler = () => {
        xhr.abort();
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };

      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', abortHandler, {once: true});
      }

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const storageId = parseUploadStorageId(xhr.responseText);
            logger.debug('Upload successful, storageId:', storageId);
            const typedStorageId = storageId as Id<'_storage'>;
            this.convex
              .action(api.storage.files.confirmUpload, {
                storageId: typedStorageId,
                mimeType: contentType,
              })
              .then((result) => {
                resolve({result, storageId: typedStorageId});
              })
              .catch((err: unknown) => {
                reject(
                  err instanceof Error
                    ? err
                    : new Error('File validation failed'),
                );
              });
          } catch {
            reject(new Error('Failed to parse upload response'));
          }
        } else {
          logger.error('Upload failed:', xhr.status, xhr.statusText);
          reject(new Error('Failed to upload file'));
        }
      });

      xhr.addEventListener('error', () => {
        logger.error('Upload network error');
        reject(new Error('Failed to upload file'));
      });

      xhr.send(file);
    });
  }

  /**
   * Uploads a poster image file to Convex storage.
   *
   * @param file - The image file to upload
   * @param onProgress - Optional progress callback
   * @param signal - Optional AbortSignal to cancel the upload
   * @returns The storage ID for the uploaded file
   * @throws Error if upload fails or is aborted
   */
  private async uploadPoster(
    file: File,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<Id<'_storage'>> {
    const {result, storageId} = await this.uploadAndConfirm(
      file,
      onProgress,
      signal,
    );
    if (!result.valid) {
      throw new Error(result.error ?? 'File validation failed');
    }
    return storageId;
  }

  /**
   * Uploads an inline image for the rich-text email editor and resolves to the
   * confirmed upload's `storageId` plus a signed preview `url`.
   *
   * The `storageId` is the durable reference persisted into the email body and
   * verified against `confirmedUploads` on send. The `url` is a short-lived
   * signed storage URL used ONLY for composer preview — it is never emailed; the
   * backend re-derives a durable server-owned image src from the storageId.
   *
   * @param file - The image file to upload (already MIME-validated by the editor)
   * @param onProgress - Progress callback (integer percent 0-100)
   * @returns The confirmed `storageId` and a signed preview `url`
   * @throws Error if validation fails, confirmation is invalid, or no URL was returned
   */
  async uploadRichTextImage(
    file: File,
    onProgress: (p: number) => void,
  ): Promise<{storageId: Id<'_storage'>; url: string}> {
    const {result, storageId} = await this.uploadAndConfirm(file, onProgress);
    if (!result.valid || !result.url) {
      throw new Error(result.error ?? 'image upload failed');
    }
    return {storageId, url: result.url};
  }

  /**
   * Gets the poster image URL for an event.
   * Returns the pre-signed URL if available, empty string otherwise.
   *
   * @param event - The Convex-derived event read model
   * @param _filename - Unused, kept for legacy compatibility
   * @param _options - Unused, kept for legacy compatibility
   * @returns The poster URL or empty string if no poster
   */
  getPosterUrl(
    event: {posterUrl?: string | null},
    _filename: string,
    _options?: {thumb?: string},
  ): string {
    if (event.posterUrl) {
      return event.posterUrl;
    }
    return '';
  }

  /**
   * Deletes an event by ID.
   * This operation is permanent and cannot be undone.
   *
   * @param id - The event ID to delete
   */
  async delete(id: string): Promise<void> {
    await this.convex.mutation(api.events.management.remove, {
      id: id as Id<'events'>,
    });
  }
}
