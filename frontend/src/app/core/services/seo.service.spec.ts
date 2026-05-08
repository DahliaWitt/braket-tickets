import {describe, it, expect, vi, beforeEach} from 'vitest';
import {TestBed} from '@angular/core/testing';
import {Router, NavigationEnd} from '@angular/router';
import {Meta} from '@angular/platform-browser';
import {Subject} from 'rxjs';
import {SeoService} from '@/core/services/seo.service';

describe('SeoService', () => {
  let service: SeoService;
  let mockMeta: {
    updateTag: ReturnType<typeof vi.fn>;
    removeTag: ReturnType<typeof vi.fn>;
  };
  let mockRouter: {events: Subject<unknown>; url: string};

  beforeEach(() => {
    mockMeta = {
      updateTag: vi.fn(),
      removeTag: vi.fn(),
    };

    mockRouter = {
      events: new Subject(),
      url: '/',
    };

    TestBed.configureTestingModule({
      providers: [
        SeoService,
        {provide: Meta, useValue: mockMeta},
        {provide: Router, useValue: mockRouter},
      ],
    });

    service = TestBed.inject(SeoService);
  });

  describe('init', () => {
    it('should handle initial homepage URL by removing robots tag', () => {
      mockRouter.url = '/';

      service.init();

      expect(mockMeta.removeTag).toHaveBeenCalledWith('name="robots"');
      expect(mockMeta.updateTag).not.toHaveBeenCalled();
    });

    it('should handle initial empty URL as homepage', () => {
      mockRouter.url = '';

      service.init();

      expect(mockMeta.removeTag).toHaveBeenCalledWith('name="robots"');
    });

    it('should add noindex for initial non-homepage URL', () => {
      mockRouter.url = '/events/123';

      service.init();

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });
  });

  describe('navigation events', () => {
    beforeEach(() => {
      service.init();
      mockMeta.updateTag.mockClear();
      mockMeta.removeTag.mockClear();
    });

    it('should remove robots tag when navigating to homepage', () => {
      mockRouter.events.next(new NavigationEnd(1, '/', '/'));

      expect(mockMeta.removeTag).toHaveBeenCalledWith('name="robots"');
      expect(mockMeta.updateTag).not.toHaveBeenCalled();
    });

    it('should add noindex when navigating to event page', () => {
      mockRouter.events.next(
        new NavigationEnd(1, '/events/abc123', '/events/abc123'),
      );

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });

    it('should add noindex when navigating to admin pages', () => {
      mockRouter.events.next(new NavigationEnd(1, '/admin', '/admin'));

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });

    it('should add noindex when navigating to login page', () => {
      mockRouter.events.next(new NavigationEnd(1, '/login', '/login'));

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });

    it('should use urlAfterRedirects for robots decision', () => {
      // Simulate redirect from /old to /
      mockRouter.events.next(new NavigationEnd(1, '/old', '/'));

      expect(mockMeta.removeTag).toHaveBeenCalledWith('name="robots"');
    });

    it('should ignore non-NavigationEnd events', () => {
      // Emit a non-NavigationEnd event
      mockRouter.events.next({type: 'NavigationStart'});

      expect(mockMeta.updateTag).not.toHaveBeenCalled();
      expect(mockMeta.removeTag).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      service.init();
      mockMeta.updateTag.mockClear();
      mockMeta.removeTag.mockClear();
    });

    it('should handle URLs with query parameters as non-homepage', () => {
      mockRouter.events.next(
        new NavigationEnd(1, '/?ref=twitter', '/?ref=twitter'),
      );

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });

    it('should handle URLs with hash fragments as non-homepage', () => {
      mockRouter.events.next(new NavigationEnd(1, '/#section', '/#section'));

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });

    it('should handle deeply nested URLs', () => {
      mockRouter.events.next(
        new NavigationEnd(
          1,
          '/admin/events/123/attendees/456',
          '/admin/events/123/attendees/456',
        ),
      );

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });
  });
});
