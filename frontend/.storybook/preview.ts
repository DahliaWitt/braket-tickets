import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {provideRouter} from '@angular/router';
import type {Preview} from '@storybook/angular';
import {applicationConfig} from '@storybook/angular';
import {withThemeByClassName} from '@storybook/addon-themes';
import {setCompodocJson} from '@storybook/addon-docs/angular';
import {CONVEX} from 'convex-angular';
import {AuthService} from '@/core/services/auth.service';
import {createStoryConvexClient} from '../src/storybook/mocks/convex';
import docJson from './documentation.json';

setCompodocJson(docJson);

@Component({
  selector: 'bt-story-route-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StoryRouteStubComponent {}

class StoryAuthService {
  readonly isAuthenticated = signal(false);
  readonly user = signal(null);
  readonly currentUser = signal(null);
  readonly email = signal(null);
  readonly isLoading = signal(false);
  readonly authInitialized = signal(true);

  userRole(): 'user' {
    return 'user';
  }

  handleOAuthCallback(_ott: string): Promise<void> {
    return Promise.resolve();
  }
}

const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([{path: '**', component: StoryRouteStubComponent}]),
        {provide: CONVEX, useValue: createStoryConvexClient()},
        {provide: AuthService, useClass: StoryAuthService},
      ],
    }),
    withThemeByClassName({
      themes: {
        dark: 'dark',
        light: '',
      },
      defaultTheme: 'dark',
    }),
  ],
  parameters: {
    backgrounds: {disable: true},
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      options: {
        mobileNarrow: {
          name: 'Mobile Narrow',
          styles: {width: '320px', height: '568px'},
          type: 'mobile',
        },
        mobile: {
          name: 'Mobile',
          styles: {width: '375px', height: '812px'},
          type: 'mobile',
        },
        tablet: {
          name: 'Tablet',
          styles: {width: '768px', height: '1024px'},
          type: 'tablet',
        },
        desktop: {
          name: 'Desktop',
          styles: {width: '1440px', height: '900px'},
          type: 'desktop',
        },
      },
    },
    a11y: {},
  },
};

export default preview;
