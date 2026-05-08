import type { Preview } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { withThemeByClassName } from '@storybook/addon-themes';
import { provideZonelessChangeDetection } from '@angular/core';
import { setCompodocJson } from '@storybook/addon-docs/angular';

try {
  const docJson = await import('./documentation.json');
  setCompodocJson(docJson.default);
} catch (_e) {
  // Skip compodoc if file is missing (e.g. in fresh CI builds)
}

const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [provideZonelessChangeDetection()],
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
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      viewports: {
        mobileNarrow: { name: 'Mobile Narrow', styles: { width: '320px', height: '568px' } },
        mobile: { name: 'Mobile', styles: { width: '375px', height: '812px' } },
        tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
      },
    },
    a11y: {},
  },
};

export default preview;
