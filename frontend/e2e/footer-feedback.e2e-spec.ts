import {test, expect} from './helpers/test-setup';

test.describe('Footer feedback', () => {
  test('opens from mobile dark mode', async ({authedPage}) => {
    await authedPage.setViewportSize({width: 390, height: 844});
    await authedPage.addInitScript(() => {
      window.localStorage.setItem('theme', 'dark');
    });

    await authedPage.goto('/');
    await expect(authedPage.locator('html')).toHaveAttribute(
      'data-theme',
      'dark',
    );

    await authedPage
      .locator('footer')
      .getByRole('button', {name: /feedback/i})
      .click();

    await expect(
      authedPage
        .getByText('What should we know?')
        .or(authedPage.getByText('Feedback is unavailable right now.')),
    ).toBeVisible();
  });
});
