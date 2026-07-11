import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from './helpers/test-setup';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {EventManagementHarness} from '../src/app/features/admin/pages/event-management/event-management.harness';
import {BroadcastEmailTabComponentHarness} from '../src/app/features/admin/components/broadcast-email-tab/broadcast-email-tab.component.harness';
import {BraDialogHarness} from '../src/app/ui/components/composites/dialog/dialog.component.harness';

/**
 * E2E: rich text broadcast emails (bold, lists, inline images).
 *
 * Covers the full user journey the unit suites cannot: real editor input in a
 * real browser, a real image upload through Convex storage, the send mutation
 * executing the pure-JS renderer inside the actual deployed Convex runtime,
 * and the captured email HTML referencing the durable public image route —
 * which is then fetched over HTTP to prove it serves the published image.
 */

/** Minimal valid 1x1 PNG (real magic bytes — passes confirmUpload validation). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Rich text broadcast email', () => {
  test('composes with bold, list, and an inline image, sends, and the email renders rich HTML with a durable image URL', async ({
    adminPage,
    convexHelper,
  }, testInfo) => {
    // ── Seed: organizer, published event, one valid ticket holder ─────────
    const organizerId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {name: uniqueName('Rich Broadcast Org')},
    );
    const eventTitle = uniqueName('Rich Broadcast Event');
    const eventId = (await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(Date.now() + 86400000).toISOString(),
      price: 1000,
      totalTickets: 50,
      status: 'published',
      organizerId,
    })) as Id<'events'>;
    const holderEmail = `${uniqueName('rich-holder').toLowerCase().replace(/\s+/g, '-')}@example.com`;
    const holderId = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {name: 'Rich Holder', email: holderEmail},
    );
    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: holderId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    // ── Navigate to the event's email tab ─────────────────────────────────
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    await expect(adminPage.locator('header')).toBeVisible({timeout: 10000});
    const env = createEnvironment(adminPage);
    const management = await env.getHarness(EventManagementHarness);
    await management.clickTab('email');

    const broadcastTab = await env.getHarness(
      BroadcastEmailTabComponentHarness,
    );
    // Audience resource must resolve before the send button can enable.
    await expect
      .poll(() => broadcastTab.getRecipientCount(), {timeout: 15000})
      .toContain('1');

    // ── Compose: subject + bold text + bullet list + inline image ─────────
    const subject = uniqueName('rich update');
    await broadcastTab.setSubject(subject);

    const editor = await broadcastTab.getMessageEditorHarness();
    await editor.typeInBody('doors at ');
    await editor.clickBold();
    await editor.typeInBody('ten sharp');
    // New block, wrapped in a bullet list.
    await editor.typeInBody('\n');
    await editor.clickBulletList();
    await editor.typeInBody('bring id');

    // Upload the inline image through the real Convex storage flow. The hidden
    // file input cannot be driven through a CDK TestElement (no file-upload
    // API), so this is the one sanctioned raw-locator escape hatch — scoped to
    // the broadcast editor because the email tab also renders the reminder
    // editor (two rich-text-image-inputs exist on the page).
    await adminPage
      .getByTestId('broadcast-message')
      .getByTestId('rich-text-image-input')
      .setInputFiles({
        name: 'flyer.png',
        mimeType: 'image/png',
        buffer: PNG_1X1,
      });

    // The editor inserts the image node (carrying the confirmed storageId)
    // only after generateUploadUrl → PUT → confirmUpload succeeds.
    await expect
      .poll(() => editor.getSerializedJson(), {timeout: 20000})
      .toContain('storageId');
    const serialized = await editor.getSerializedJson();
    expect(serialized).toContain('"type":"bold"');
    expect(serialized).toContain('"type":"bulletList"');

    // Screenshot artifact of the composed editor (visual verification).
    await adminPage.screenshot({
      path: testInfo.outputPath('rich-editor-compose.png'),
      fullPage: false,
    });

    // ── Send (confirm dialog) ──────────────────────────────────────────────
    await expect
      .poll(() => broadcastTab.isSendButtonDisabled(), {timeout: 10000})
      .toBe(false);
    await broadcastTab.clickSendButton();
    const dialog = await env.getHarness(BraDialogHarness);
    await dialog.clickOk();

    // Reactive confirmation in the UI: the send lands in history. Re-acquire
    // the harness each poll iteration — zoneless harness instances go stale
    // after re-renders (established pattern, see marketing-email spec).
    await expect
      .poll(
        async () => {
          // The post-send dataChanged reload can briefly unmount the tab, so a
          // transient getHarness failure just means "poll again".
          try {
            const freshTab = await createEnvironment(adminPage).getHarness(
              BroadcastEmailTabComponentHarness,
            );
            return await freshTab.getHistoryEntryCount();
          } catch {
            return 0;
          }
        },
        {timeout: 20000},
      )
      .toBeGreaterThan(0);

    // ── Assert the captured email: rich HTML + durable image route ────────
    // convexHelper here is retrieval of the captured out-of-app artifact (the
    // email), which has no DOM in the app to assert against; the rendered
    // assertions below happen in the page via setContent.
    let html = '';
    await expect
      .poll(
        async () => {
          const emails = (await convexHelper.query(
            api.testing.email.getSentEmails,
            {to: holderEmail},
          )) as Array<{subject: string; html: string}>;
          html = emails.find((e) => e.subject === subject)?.html ?? '';
          return html.length > 0;
        },
        {timeout: 30000},
      )
      .toBe(true);

    // Render the captured email and assert through the page.
    await adminPage.setContent(html, {waitUntil: 'domcontentloaded'});
    await expect(
      adminPage.locator('strong', {hasText: 'ten sharp'}),
    ).toBeVisible();
    await expect(adminPage.locator('li', {hasText: 'bring id'})).toBeVisible();
    const emailImage = adminPage.locator('img[src*="/api/images/"]');
    await expect(emailImage).toHaveCount(1);

    // The durable public route must actually serve the published image bytes.
    const imageSrc = await emailImage.getAttribute('src');
    expect(imageSrc).toBeTruthy();
    const response = await adminPage.request.get(imageSrc!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const body = await response.body();
    expect(body.length).toBe(PNG_1X1.length);

    // The email must never leak a signed preview URL or the raw storageId attr.
    expect(html).not.toContain('storageId');
  });
});
