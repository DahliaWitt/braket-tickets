import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import {ZardSelectComponentHarness} from '../../src/app/ui/components/primitives/select/select.component.harness';
import {generateCommunitySlug} from '@shared/domain/community-slug';

test.describe('Admin Community Management', () => {
  test.slow();

  test('should create and verify a community with vetting questions', async ({
    adminPage,
  }) => {
    // 1. Navigate to Communities List
    await adminPage.goto('/admin/communities');
    await expect(
      adminPage.getByRole('heading', {name: 'Communities'}).first(),
    ).toBeVisible();

    // 2. Start Create Flow
    await adminPage.getByRole('link', {name: /Create Community/i}).click();
    await expect(adminPage).toHaveURL(/.*communities\/new/);

    // 3. Fill Basic Info
    const orgName = uniqueName('E2E Community');
    await adminPage.locator('#name').fill(orgName);
    // Slug is required for form validation - derived from name
    const orgSlug = generateCommunitySlug(orgName);
    await adminPage.locator('#slug').fill(orgSlug);
    await adminPage.locator('#email').fill(`e2e-org-${Date.now()}@example.com`);
    await adminPage.locator('#contactInfo').fill('E2E Contact Info');

    // 4. Add Vetting Questions
    // Question 1: Text (default type)
    await adminPage.getByRole('button', {name: /Add Question/i}).click();
    await adminPage.locator('#question-0').fill('Why do you want to join?');

    // Question 2: Dropdown type
    await adminPage.getByRole('button', {name: /Add Question/i}).click();
    await adminPage.locator('#question-1').fill('How did you hear about us?');

    // Open the second z-select (question type for question 2).
    // z-select uses CDK Overlay — options render outside the component tree.
    const env = createEnvironment(adminPage);
    const selects = await env.getAllHarnesses(ZardSelectComponentHarness);
    await selects[1].selectOption('Dropdown');

    // Wait for the options input to appear (conditional on type === 'select')
    const optionsInput = adminPage.locator('#options-1');
    await expect(optionsInput).toBeVisible({timeout: 5000});
    await optionsInput.fill('Friend, Social Media, Other');

    // 5. Submit — the submit button is a <button>, not a link
    // Re-find element before clicking in case form state changes caused re-render
    const createButton = adminPage.getByRole('button', {
      name: /Create Community/i,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for redirect back to the list
    await expect(adminPage).toHaveURL(/.*admin\/communities/, {timeout: 15000});

    // 6. Verify in List — data-testid is "community-entry"
    // .first() for desktop/mobile layout variants
    const communityEntry = adminPage
      .locator('[data-testid="community-entry"]')
      .filter({hasText: orgName})
      .first();
    await expect(communityEntry).toBeVisible({timeout: 15000});

    // 7. Verify Manage works for the newly-created community.
    await communityEntry.getByRole('link', {name: /Manage/i}).click();
    await expect(adminPage).toHaveURL(/.*community-admin\/pending/, {
      timeout: 15000,
    });
    await expect
      .poll(() => new URL(adminPage.url()).searchParams.get('community'), {
        timeout: 10000,
      })
      .toBe(orgSlug);
    await expect(
      adminPage.locator(
        '[data-testid="admin-override-banner"] [data-testid="override-community-name"]',
      ),
    ).toHaveText(orgName, {timeout: 10000});

    // 8. Verify Persistence (Edit View)
    await adminPage.goto('/admin/communities');
    const communityEntryAfterManage = adminPage
      .locator('[data-testid="community-entry"]')
      .filter({hasText: orgName})
      .first();
    await expect(communityEntryAfterManage).toBeVisible({timeout: 15000});
    await communityEntryAfterManage.getByRole('link', {name: /Edit/i}).click();
    await expect(adminPage.locator('#name')).toHaveValue(orgName, {
      timeout: 10000,
    });

    // Verify questions persisted correctly
    await expect(adminPage.locator('#question-0')).toHaveValue(
      'Why do you want to join?',
    );
    const editSelects = await env.getAllHarnesses(ZardSelectComponentHarness);
    await expect(await editSelects[0].getSelectedText()).toContain(
      'Short Text',
    );

    await expect(adminPage.locator('#question-1')).toHaveValue(
      'How did you hear about us?',
    );
    await expect(await editSelects[1].getSelectedText()).toContain('Dropdown');
    await expect(adminPage.locator('#options-1')).toHaveValue(
      'Friend, Social Media, Other',
    );
  });

  test('should reject a route-unsafe manual community slug', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/communities/new');
    await expect(
      adminPage.getByRole('heading', {name: /Create Community/i}),
    ).toBeVisible();

    await adminPage
      .locator('#name')
      .fill(uniqueName('QA Invalid Slug Collective'));
    await adminPage.locator('#slug').fill('Bad Slug!!');

    await expect(
      adminPage.locator('[data-testid="community-slug-error"]'),
    ).toBeVisible();
    await expect(
      adminPage.locator('[data-testid="save-community"]'),
    ).toBeDisabled();
  });
});
