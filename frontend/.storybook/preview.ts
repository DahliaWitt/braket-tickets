import type {Preview} from '@storybook/angular';
import {withThemeByClassName} from '@storybook/addon-themes';
import {setCompodocJson} from '@storybook/addon-docs/angular';
import docJson from './documentation.json';

setCompodocJson(docJson);

const preview: Preview = {
  decorators: [
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
