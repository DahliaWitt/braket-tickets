import {Injectable, inject, DestroyRef} from '@angular/core';
import {Router, NavigationEnd} from '@angular/router';
import {Meta} from '@angular/platform-browser';
import {filter} from 'rxjs/operators';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

/**
 * Minimal SEO service that adds noindex to all non-homepage routes.
 * Events are promoted directly - we don't want search engine discovery.
 */
@Injectable({providedIn: 'root'})
export class SeoService {
  private meta = inject(Meta);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  init(): void {
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.updateRobotsMeta(event.urlAfterRedirects);
      });

    // Handle initial page load
    this.updateRobotsMeta(this.router.url);
  }

  private updateRobotsMeta(url: string): void {
    // Only allow indexing of the homepage
    const isHomepage = url === '/' || url === '';

    if (isHomepage) {
      // Homepage: allow indexing
      this.meta.removeTag('name="robots"');
    } else {
      // All other pages: noindex, nofollow
      this.meta.updateTag({name: 'robots', content: 'noindex, nofollow'});
    }
  }
}
