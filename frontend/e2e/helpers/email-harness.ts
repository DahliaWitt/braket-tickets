import {Page, expect} from '@playwright/test';
import {ConvexTestingHelper} from 'convex-helpers/testing';
import {api} from '@convex/_generated/api';
import {pollUntil} from './async-control';

/**
 * Type for a sent email record from testEmails table.
 */
interface SentEmail {
  to: string;
  subject: string;
  html: string; // Contains captured email HTML in test mode
}

export class EmailHarness {
  private lastEmailHtml: string | null = null;

  constructor(
    private page: Page,
    private convexHelper: ConvexTestingHelper,
  ) {}

  /**
   * Retrieves the latest email for a recipient and opens the captured message.
   */
  async navigateToLatestEmail(
    email: string,
    subjectRegex?: RegExp,
    options?: {timeoutMs?: number; pollIntervalMs?: number},
  ) {
    const timeoutMs = options?.timeoutMs ?? 45000;
    const pollIntervalMs = options?.pollIntervalMs ?? 1000;
    const previewUrl = await pollUntil({
      timeoutMs,
      intervalMs: pollIntervalMs,
      getValue: async () => {
        const emails = (await this.convexHelper.query(
          api.testing.email.getSentEmails,
          {
            to: email,
          },
        )) as SentEmail[];
        // Filter by subject if provided
        const matchedEmail = emails.find((e) =>
          subjectRegex ? subjectRegex.test(e.subject) : true,
        );

        if (!matchedEmail) {
          return null;
        }

        console.log(`Found email with subject: "${matchedEmail.subject}"`);
        return matchedEmail.html;
      },
    });

    if (!previewUrl) {
      throw new Error(
        `No email found for ${email} ${subjectRegex ? `matching ${subjectRegex} ` : ''}after ${timeoutMs}ms.`,
      );
    }

    this.lastEmailHtml = previewUrl;

    if (previewUrl.startsWith('http')) {
      console.log(`Navigating to Ethereal Preview: ${previewUrl}`);
      await this.page.goto(previewUrl);
      await this.page.waitForLoadState('domcontentloaded');
      return;
    }

    await this.page.setContent(previewUrl, {waitUntil: 'domcontentloaded'});
  }

  /**
   * Verifies that specific text is present in the Ethereal preview (checks both page and iframe).
   */
  async expectText(text: string | RegExp) {
    // Ethereal displays email in an iframe, but also shows plain/html text tabs
    // Try the main page first, then fall back to iframe
    try {
      await expect(this.page.locator('body')).toContainText(text, {
        timeout: 5000,
      });
    } catch {
      // Try the email content iframe (specifically the one in #message)
      const iframe = this.page.frameLocator('#message iframe');
      await expect(iframe.locator('body')).toContainText(text);
    }
  }

  /**
   * Verifies that an attachment with the given filename exists in the Ethereal preview.
   */
  async expectAttachment(filename: string) {
    // Ethereal (Nodemailer) renders attachments in a specific section
    // Usually in a list with a download link
    // Third-party Ethereal DOM — .attachments CSS class is outside our control
    const attachmentLocator = this.page
      .locator('.attachments')
      .getByText(filename);
    await expect(attachmentLocator).toBeVisible();
  }

  /**
   * Verifies that a QR code image exists in the email body.
   */
  async expectQRCode() {
    // Look for an image with an alt tag containing "QR Code"
    const qrLocator = this.page.locator('img[alt*="QR Code"]');
    await expect(qrLocator).toBeVisible();
  }

  /**
   * Extracts a link from the email body matching a pattern and navigates to it.
   * Ethereal renders email HTML in an iframe, so we extract the href and navigate directly.
   */
  async clickLink(regex: RegExp): Promise<string> {
    let href: string | null = null;

    // Ethereal renders message content in an iframe. Captured local HTML is
    // rendered directly into the page, so fall back to the main document.
    const iframeLocator = this.page.locator('#message iframe');
    try {
      await expect(iframeLocator).toBeVisible({timeout: 15000});
      const iframeHandle = await iframeLocator.elementHandle();
      const iframe = await iframeHandle?.contentFrame();
      if (iframe) {
        // Wait for at least one link to appear in the iframe
        await iframe.waitForSelector('a[href]', {timeout: 10000});
        href = await iframe.evaluate(
          ({source, flags}) => {
            const pattern = new RegExp(source, flags);
            const links = Array.from(
              document.querySelectorAll<HTMLAnchorElement>(
                'a[href]:not([href^="mailto:"])',
              ),
            );
            const matched =
              links.find((link) => pattern.test(link.textContent ?? '')) ??
              links.find((link) =>
                pattern.test(link.getAttribute('href') ?? ''),
              );
            return matched?.getAttribute('href') ?? null;
          },
          {source: regex.source, flags: regex.flags},
        );
      }
    } catch {
      // No iframe means this is a locally captured email rendered directly.
    }

    // Fallback for non-iframe email clients/previews.
    if (!href) {
      href = await this.page.evaluate(
        ({source, flags}) => {
          const pattern = new RegExp(source, flags);
          const links = Array.from(
            document.querySelectorAll<HTMLAnchorElement>(
              'a[href]:not([href^="mailto:"])',
            ),
          );
          const matched =
            links.find((link) => pattern.test(link.textContent ?? '')) ??
            links.find((link) => pattern.test(link.getAttribute('href') ?? ''));
          return matched?.getAttribute('href') ?? null;
        },
        {source: regex.source, flags: regex.flags},
      );
    }

    if (!href && this.lastEmailHtml?.trim().startsWith('<')) {
      await this.page.setContent(this.lastEmailHtml, {
        waitUntil: 'domcontentloaded',
      });
      href = await this.page.evaluate(
        ({source, flags}) => {
          const pattern = new RegExp(source, flags);
          const links = Array.from(
            document.querySelectorAll<HTMLAnchorElement>(
              'a[href]:not([href^="mailto:"])',
            ),
          );
          const matched =
            links.find((link) => pattern.test(link.textContent ?? '')) ??
            links.find((link) => pattern.test(link.getAttribute('href') ?? ''));
          return matched?.getAttribute('href') ?? null;
        },
        {source: regex.source, flags: regex.flags},
      );
    }

    if (!href) {
      throw new Error(`No link found matching regex: ${regex}`);
    }

    console.log(`Navigating to link: ${href}`);
    await this.page.goto(href, {waitUntil: 'domcontentloaded'});
    return href;
  }
}
