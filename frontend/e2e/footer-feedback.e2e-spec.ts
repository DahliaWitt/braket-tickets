import {test, expect} from './helpers/test-setup';

test.describe('Footer feedback', () => {
  test('opens from mobile dark mode and remains visible through outside pointer handling', async ({
    authedPage,
  }) => {
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

    const dialog = authedPage.getByRole('dialog', {name: 'Feedback'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/what should we know/i)).toBeVisible();

    await authedPage.mouse.click(4, 4);

    await expect(dialog).toBeVisible();
  });
});
