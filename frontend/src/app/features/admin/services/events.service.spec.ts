import {TestBed} from '@angular/core/testing';
import {EventsService} from '@/features/admin/services/events.service';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';

describe('EventsService', () => {
  let service: EventsService;
  let convexClientMock: MockConvexClient;

  const mockEvents = [
    {
      _id: '1',
      title: 'Event 1',
      date: '2023-01-01',
      price: 100,
      totalTickets: 100,
      status: 'published',
      _creationTime: 123,
    },
  ];

  beforeEach(() => {
    convexClientMock = createMockConvexClient();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        EventsService,
        {provide: CONVEX, useValue: convexClientMock},
        {provide: AuthService, useValue: {}}, // Minimal mock
      ],
    });
    service = TestBed.inject(EventsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAll', () => {
    it('should return a list of mapped events', async () => {
      convexClientMock.client.query.mockResolvedValue(mockEvents);

      const events = await service.getAll();

      expect(events.length).toBe(1);
      expect(events[0]._id).toBe('1');
      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.events.public.list,
        {},
      );
    });
  });

  describe('getUpcoming', () => {
    it('should call upcoming query with no arguments (cutoff is server-side)', async () => {
      convexClientMock.client.query.mockResolvedValue(mockEvents);

      const events = await service.getUpcoming();

      expect(events.length).toBe(1);
      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.events.public.upcoming,
        {},
      );
    });
  });

  describe('getOneForEdit', () => {
    it('should fetch an event through the admin edit query', async () => {
      convexClientMock.client.query.mockResolvedValue(mockEvents[0]);

      const event = await service.getOneForEdit('event-id');

      expect(event).toBe(mockEvents[0]);
      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.events.management.getForEdit,
        {id: 'event-id'},
      );
    });

    it('should retry transient edit-query failures', async () => {
      convexClientMock.client.query
        .mockRejectedValueOnce(new Error('Function execution timed out'))
        .mockResolvedValue(mockEvents[0]);

      await expect(service.getOneForEdit('event-id')).resolves.toBe(
        mockEvents[0],
      );
      expect(convexClientMock.client.query).toHaveBeenCalledTimes(2);
    });

    it('should not retry not-found edit-query failures', async () => {
      convexClientMock.client.query.mockRejectedValue(
        new Error('Event not found'),
      );

      await expect(service.getOneForEdit('event-id')).rejects.toThrow(
        'Event not found',
      );
      expect(convexClientMock.client.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('should call remove mutation', async () => {
      await service.delete('1');
      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.events.management.remove,
        {id: '1'},
      );
    });
  });

  describe('getBatchAvailability', () => {
    it('should return empty object without querying when no IDs are provided', async () => {
      const result = await service.getBatchAvailability([]);

      expect(result).toEqual({});
      expect(convexClientMock.client.query).not.toHaveBeenCalledWith(
        api.events.public.getBatchAvailability,
        expect.anything(),
      );
    });

    it('should chunk IDs into batches of 50 and merge responses', async () => {
      const ids = Array.from({length: 120}, (_, i) => `event-${i + 1}`);
      convexClientMock.client.query.mockImplementation(
        (_fn, args: {eventIds: string[]; now: number}) =>
          Object.fromEntries(
            args.eventIds.map((id) => [id, {isSoldOut: false}]),
          ),
      );

      const result = await service.getBatchAvailability(ids);

      expect(convexClientMock.client.query).toHaveBeenCalledTimes(3);
      expect(convexClientMock.client.query).toHaveBeenNthCalledWith(
        1,
        api.events.public.getBatchAvailability,
        expect.objectContaining({eventIds: ids.slice(0, 50)}),
      );
      expect(convexClientMock.client.query).toHaveBeenNthCalledWith(
        2,
        api.events.public.getBatchAvailability,
        expect.objectContaining({eventIds: ids.slice(50, 100)}),
      );
      expect(convexClientMock.client.query).toHaveBeenNthCalledWith(
        3,
        api.events.public.getBatchAvailability,
        expect.objectContaining({eventIds: ids.slice(100, 120)}),
      );
      expect(Object.keys(result)).toHaveLength(120);
      expect(result['event-1']).toEqual({isSoldOut: false});
      expect(result['event-120']).toEqual({isSoldOut: false});
    });
  });

  describe('createWithPoster', () => {
    it('should include organizerId when provided', async () => {
      convexClientMock.mutation.mockResolvedValue('new-event-id');

      const eventData = {
        title: 'Test Event',
        date: '2024-01-01',
        price: 1000,
        totalTickets: 50,
        status: 'published' as const,
        visibility: 'public' as const,
        organizerId: 'org-id' as Id<'organizers'>,
      };

      await service.createWithPoster(eventData);

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.events.management.create,
        expect.objectContaining({
          organizerId: 'org-id',
        }),
      );
    });

    it('should handle organizerId', async () => {
      convexClientMock.mutation.mockResolvedValue('new-event-id');

      const eventData = {
        title: 'Test Event',
        date: '2024-01-01',
        price: 1000,
        totalTickets: 50,
        status: 'published' as const,
        visibility: 'public' as const,
        organizerId: 'org-id' as Id<'organizers'>,
      };

      await service.createWithPoster(eventData);

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.events.management.create,
        expect.objectContaining({
          organizerId: 'org-id',
        }),
      );
    });
  });

  describe('updateWithPoster', () => {
    it('should include organizerId when provided', async () => {
      const eventData = {
        title: 'Updated Event',
        organizerId: 'org-id' as Id<'organizers'>,
      };

      await service.updateWithPoster({
        id: 'event-id' as Id<'events'>,
        ...eventData,
      });

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.events.management.update,
        expect.objectContaining({
          id: 'event-id',
          organizerId: 'org-id',
        }),
      );
    });
  });

  describe('uploadPoster confirmUpload integration', () => {
    // Closure-based state shared between the mock class and each test
    const xhrState = {
      status: 200,
      responseText: JSON.stringify({storageId: 'storage-abc'}),
      capturedLoadHandler: undefined as (() => void) | undefined,
      capturedAbortHandler: undefined as (() => void) | undefined,
      wasAborted: false,
    };

    const eventData = {
      title: 'Test Event',
      date: '2024-01-01',
      price: 1000,
      totalTickets: 50,
      status: 'published' as const,
      visibility: 'public' as const,
      organizerId: 'org-id' as Id<'organizers'>,
    };

    beforeEach(() => {
      xhrState.capturedLoadHandler = undefined;
      xhrState.capturedAbortHandler = undefined;
      xhrState.wasAborted = false;
      xhrState.status = 200;
      xhrState.responseText = JSON.stringify({storageId: 'storage-abc'});

      // Must be a regular function (not arrow) so it can be called with `new`
      function MockXHR(this: Record<string, unknown>) {
        this.open = vi.fn();
        this.setRequestHeader = vi.fn();
        this.upload = {addEventListener: vi.fn()};
        this.addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === 'load') xhrState.capturedLoadHandler = handler;
          if (event === 'abort') xhrState.capturedAbortHandler = handler;
        });
        this.abort = vi.fn(() => {
          xhrState.wasAborted = true;
          // Fire the abort handler if one was registered
          xhrState.capturedAbortHandler?.();
        });
        // Fire load handler synchronously when send() is called (listeners already registered)
        this.send = vi.fn(() => {
          if (!xhrState.wasAborted) {
            xhrState.capturedLoadHandler?.();
          }
        });
        Object.defineProperty(this, 'status', {get: () => xhrState.status});
        Object.defineProperty(this, 'responseText', {
          get: () => xhrState.responseText,
        });
      }
      vi.stubGlobal('XMLHttpRequest', MockXHR);

      // generateUploadUrl returns the upload URL; events.create returns the new ID
      convexClientMock.mutation
        .mockResolvedValueOnce({valid: true})
        .mockResolvedValueOnce('https://upload.example.com')
        .mockResolvedValueOnce('new-event-id');
    });

    it('resolves storageId and creates event when confirmUpload returns valid: true', async () => {
      convexClientMock.action.mockResolvedValue({
        valid: true,
        storageId: 'storage-abc' as Id<'_storage'>,
      });

      const file = new File(['jpeg-bytes'], 'photo.jpg', {type: 'image/jpeg'});
      // send() fires the load handler synchronously, triggering confirmUpload
      await service.createWithPoster(eventData, file);

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.storage.files.validateUpload,
        {
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          fileSize: file.size,
        },
      );
      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.storage.files.confirmUpload,
        {
          storageId: 'storage-abc',
          mimeType: 'image/jpeg',
        },
      );
      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.events.management.create,
        expect.objectContaining({poster: 'storage-abc'}),
      );
    });

    it('rejects with the server error message when confirmUpload returns valid: false', async () => {
      convexClientMock.action.mockResolvedValue({
        valid: false,
        error: 'Magic bytes do not match declared MIME type',
      });

      const file = new File(['bad-bytes'], 'fake.jpg', {type: 'image/jpeg'});
      await expect(service.createWithPoster(eventData, file)).rejects.toThrow(
        'Magic bytes do not match declared MIME type',
      );
    });

    it('rejects with default message when confirmUpload returns valid: false with no error', async () => {
      convexClientMock.action.mockResolvedValue({valid: false});

      const file = new File(['bad-bytes'], 'fake.jpg', {type: 'image/jpeg'});
      await expect(service.createWithPoster(eventData, file)).rejects.toThrow(
        'File validation failed',
      );
    });

    it('rejects when confirmUpload action itself throws', async () => {
      convexClientMock.action.mockRejectedValue(new Error('Network error'));

      const file = new File(['jpeg-bytes'], 'photo.jpg', {type: 'image/jpeg'});
      await expect(service.createWithPoster(eventData, file)).rejects.toThrow(
        'Network error',
      );
    });
  });

  describe('uploadPoster abort behavior', () => {
    const eventData = {
      title: 'Test Event',
      date: '2024-01-01',
      price: 1000,
      totalTickets: 50,
      status: 'published' as const,
      visibility: 'public' as const,
      organizerId: 'org-id' as Id<'organizers'>,
    };

    it('rejects immediately when signal is already aborted before upload starts', async () => {
      const controller = new AbortController();
      controller.abort();

      const file = new File(['jpeg-bytes'], 'photo.jpg', {type: 'image/jpeg'});

      // Setup mock for generateUploadUrl
      convexClientMock.mutation
        .mockResolvedValueOnce({valid: true})
        .mockResolvedValueOnce('https://upload.example.com');

      await expect(
        service.createWithPoster(eventData, file, undefined, controller.signal),
      ).rejects.toThrow('The operation was aborted.');

      // Verify it rejected before even trying to upload
      expect(convexClientMock.mutation).toHaveBeenCalledTimes(2); // validateUpload + generateUploadUrl
    });

    it('rejects with AbortError when signal aborts during upload', async () => {
      let capturedAbortListener: (() => void) | undefined;
      let xhrAbortCalled = false;

      function MockXHR(this: Record<string, unknown>) {
        this.open = vi.fn();
        this.setRequestHeader = vi.fn();
        this.upload = {addEventListener: vi.fn()};
        this.addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === 'abort') {
            capturedAbortListener = handler;
          }
        });
        this.abort = vi.fn(() => {
          xhrAbortCalled = true;
          // Simulate XHR abort behavior - fire the abort handler
          capturedAbortListener?.();
        });
        this.send = vi.fn(); // Don't auto-fire load handler
        Object.defineProperty(this, 'status', {get: () => 200});
        Object.defineProperty(this, 'responseText', {
          get: () => JSON.stringify({storageId: 'storage-abc'}),
        });
      }
      vi.stubGlobal('XMLHttpRequest', MockXHR);

      convexClientMock.mutation
        .mockResolvedValueOnce({valid: true})
        .mockResolvedValueOnce('https://upload.example.com');

      const controller = new AbortController();
      const file = new File(['jpeg-bytes'], 'photo.jpg', {type: 'image/jpeg'});

      const promise = service.createWithPoster(
        eventData,
        file,
        undefined,
        controller.signal,
      );

      // Abort after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();

      await expect(promise).rejects.toThrow('The operation was aborted.');

      expect(xhrAbortCalled).toBe(true);
    });

    it('does not call XHR abort when signal is not provided', async () => {
      let abortCalled = false;
      let capturedLoadHandler: (() => void) | undefined;

      function MockXHR(this: Record<string, unknown>) {
        this.open = vi.fn();
        this.setRequestHeader = vi.fn();
        this.upload = {addEventListener: vi.fn()};
        this.addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === 'load') capturedLoadHandler = handler;
        });
        this.abort = vi.fn(() => {
          abortCalled = true;
        });
        this.send = vi.fn(() => {
          // Simulate immediate success
          capturedLoadHandler?.();
        });
        Object.defineProperty(this, 'status', {get: () => 200});
        Object.defineProperty(this, 'responseText', {
          get: () => JSON.stringify({storageId: 'storage-abc'}),
        });
      }
      vi.stubGlobal('XMLHttpRequest', MockXHR);

      convexClientMock.mutation
        .mockResolvedValueOnce({valid: true})
        .mockResolvedValueOnce('https://upload.example.com');
      convexClientMock.action.mockResolvedValue({
        valid: true,
        storageId: 'storage-abc',
      });

      const file = new File(['jpeg-bytes'], 'photo.jpg', {type: 'image/jpeg'});

      // Don't provide a signal
      try {
        await service.createWithPoster(eventData, file);
      } catch {
        // Ignore errors - we just want to verify abort wasn't called
      }

      expect(abortCalled).toBe(false);
    });

    it('accepts optional AbortSignal without affecting normal operation', async () => {
      // Setup a normal successful upload with a non-aborted signal
      const controller = new AbortController();
      let capturedLoadHandler: (() => void) | undefined;

      function MockXHR(this: Record<string, unknown>) {
        this.open = vi.fn();
        this.setRequestHeader = vi.fn();
        this.upload = {addEventListener: vi.fn()};
        this.addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === 'load') capturedLoadHandler = handler;
        });
        this.abort = vi.fn();
        this.send = vi.fn(() => capturedLoadHandler?.());
        Object.defineProperty(this, 'status', {get: () => 200});
        Object.defineProperty(this, 'responseText', {
          get: () => JSON.stringify({storageId: 'storage-abc'}),
        });
      }
      vi.stubGlobal('XMLHttpRequest', MockXHR);

      convexClientMock.mutation
        .mockResolvedValueOnce({valid: true})
        .mockResolvedValueOnce('https://upload.example.com');
      convexClientMock.action.mockResolvedValue({
        valid: true,
        storageId: 'storage-abc',
      });
      convexClientMock.mutation.mockResolvedValueOnce('new-event-id');

      const file = new File(['jpeg-bytes'], 'photo.jpg', {type: 'image/jpeg'});

      await service.createWithPoster(
        eventData,
        file,
        undefined,
        controller.signal,
      );

      // Verify normal flow completed
      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.storage.files.confirmUpload,
        expect.objectContaining({storageId: 'storage-abc'}),
      );
    });
  });

  describe('uploadRichTextImage', () => {
    const xhrState = {
      status: 200,
      responseText: JSON.stringify({storageId: 'storage-abc'}),
      capturedLoadHandler: undefined as (() => void) | undefined,
    };

    const noopProgress = (): void => undefined;

    beforeEach(() => {
      xhrState.capturedLoadHandler = undefined;
      xhrState.status = 200;
      xhrState.responseText = JSON.stringify({storageId: 'storage-abc'});

      function MockXHR(this: Record<string, unknown>) {
        this.open = vi.fn();
        this.setRequestHeader = vi.fn();
        this.upload = {addEventListener: vi.fn()};
        this.addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === 'load') xhrState.capturedLoadHandler = handler;
        });
        this.abort = vi.fn();
        this.send = vi.fn(() => xhrState.capturedLoadHandler?.());
        Object.defineProperty(this, 'status', {get: () => xhrState.status});
        Object.defineProperty(this, 'responseText', {
          get: () => xhrState.responseText,
        });
      }
      vi.stubGlobal('XMLHttpRequest', MockXHR);

      // validateUpload, then generateUploadUrl
      convexClientMock.mutation
        .mockResolvedValueOnce({valid: true})
        .mockResolvedValueOnce('https://upload.example.com');
    });

    it('resolves to the storageId + preview url when confirmUpload returns valid: true', async () => {
      convexClientMock.action.mockResolvedValue({
        valid: true,
        storageId: 'storage-abc' as Id<'_storage'>,
        url: 'https://files.example.com/storage-abc.png',
      });

      const file = new File(['png-bytes'], 'inline.png', {type: 'image/png'});
      const {storageId, url} = await service.uploadRichTextImage(
        file,
        noopProgress,
      );

      expect(storageId).toBe('storage-abc');
      expect(url).toBe('https://files.example.com/storage-abc.png');
      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.storage.files.confirmUpload,
        {storageId: 'storage-abc', mimeType: 'image/png'},
      );
    });

    it('rejects with the server error when confirmUpload returns valid: false', async () => {
      convexClientMock.action.mockResolvedValue({
        valid: false,
        error: 'Magic bytes do not match declared MIME type',
      });

      const file = new File(['bad-bytes'], 'fake.png', {type: 'image/png'});
      await expect(
        service.uploadRichTextImage(file, noopProgress),
      ).rejects.toThrow('Magic bytes do not match declared MIME type');
    });

    it('rejects when confirmUpload is valid but returns no url', async () => {
      convexClientMock.action.mockResolvedValue({
        valid: true,
        storageId: 'storage-abc' as Id<'_storage'>,
      });

      const file = new File(['png-bytes'], 'inline.png', {type: 'image/png'});
      await expect(
        service.uploadRichTextImage(file, noopProgress),
      ).rejects.toThrow('image upload failed');
    });
  });
});
