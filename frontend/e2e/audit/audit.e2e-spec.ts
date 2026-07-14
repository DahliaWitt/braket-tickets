import * as fs from 'node:fs';
import * as path from 'node:path';
import {expect, test} from './audit-fixtures';
import {writeJsonReport, writeHtmlReport} from './audit-report';
import {AUDIT_ROUTES} from './audit-routes';
import {runChecks} from './audit-checks';
import type {AuditRouteResult} from './audit-types';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import type {ConvexHelper} from '../helpers/test-setup';

// Run all routes sequentially — shared page state and seed data ordering require it.
test.describe.configure({mode: 'serial'});

const VIEWPORTS = {
  desktop: {width: 1440, height: 900},
  mobile: {width: 390, height: 844},
} as const;

const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

/** All collected results across viewports and routes, written to disk in afterAll. */
const allResults: AuditRouteResult[] = [];

/**
 * Resolve :param placeholders in route paths from seeded entity IDs.
 * seedData values are Convex Id types — coerce to string for URL interpolation.
 */
function resolvePath(path: string, seedData: Record<string, unknown>): string {
  const resolved = path
    .replace(':eventId', String(seedData['publishedEvent'] ?? ''))
    .replace(':id', String(seedData['communityAdminEvent'] ?? ''));

  const remaining = resolved.match(/:[a-zA-Z]+/g);
  if (remaining) {
    console.warn(
      `[audit] Unresolved placeholders in "${path}": ${remaining.join(', ')}`,
    );
  }
  return resolved;
}

/**
 * Build a skipped AuditRouteResult when seed data is unavailable.
 */
function makeSkippedResult(
  route: (typeof AUDIT_ROUTES)[number],
  viewport: 'desktop' | 'mobile',
  missing: string[],
  theme?: Theme,
): AuditRouteResult {
  return {
    route,
    viewport,
    ...(theme !== undefined ? {theme} : {}),
    timestamp: new Date().toISOString(),
    screenshotPath: '',
    consoleErrors: [],
    findings: [],
    durationMs: 0,
    skipped: true,
    skipReason: `Missing seed data: ${missing.join(', ')}`,
  };
}

/** Absolute path to the shared backend seed assets directory. */
const SEED_ASSETS_DIR = path.resolve(
  __dirname,
  '../../../backend/scripts/seed-assets',
);

interface UploadResult {
  storageId: string;
}

/**
 * Upload a single seed image file to Convex storage and return its storage ID.
 * Mirrors the uploadImage() helper in backend/scripts/seed.ts — reads from disk,
 * generates an upload URL via Convex, POSTs the binary, returns the storage ID.
 */
async function uploadSeedImage(
  filename: string,
  convexHelper: ConvexHelper,
): Promise<string> {
  const filePath = path.join(SEED_ASSETS_DIR, filename);
  const data = fs.readFileSync(filePath);

  const uploadUrl = await convexHelper.mutation(
    api.testing.utilities.generateSeedUploadUrl,
    {},
  );

  const res = await fetch(uploadUrl as string, {
    method: 'POST',
    headers: {'Content-Type': 'image/jpeg'},
    body: data,
  });

  if (!res.ok) {
    throw new Error(`Image upload failed for ${filename}: ${res.status}`);
  }

  const json = (await res.json()) as UploadResult;
  return json.storageId;
}

/**
 * Seed the full demo dataset and return IDs keyed for route resolution.
 * Creates 7 users, calls seedDemoData once, then grants the global admin
 * community_admin access so adminPage can reach community admin routes.
 */
async function seedAllDemoData(
  convexHelper: ConvexHelper,
): Promise<Record<string, unknown>> {
  // Create 7 demo users
  const [cooperId, kimId, nomiId, barneyId, charlieId, tobiasId, cherylId] =
    await Promise.all([
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-cooper-${Date.now()}@example.com`,
        name: 'Cooper',
      }),
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-kim-${Date.now()}@example.com`,
        name: 'Kim',
      }),
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-nomi-${Date.now()}@example.com`,
        name: 'Nomi',
      }),
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-barney-${Date.now()}@example.com`,
        name: 'Barney',
      }),
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-charlie-${Date.now()}@example.com`,
        name: 'Charlie',
      }),
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-tobias-${Date.now()}@example.com`,
        name: 'Tobias',
      }),
      convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `audit-cheryl-${Date.now()}@example.com`,
        name: 'Cheryl',
      }),
    ]);

  // Upload real event posters and community logos to Convex storage.
  // This mirrors the uploadImage() flow from backend/scripts/seed.ts — reads
  // from backend/scripts/seed-assets/, generates upload URLs via Convex,
  // POSTs binaries,
  // and passes the resulting storage IDs to seedDemoData.
  const [
    concreteWax,
    lowFrequency,
    nightMarket,
    springFundraiser,
    rooftopListening,
    lot45Logo,
    sisterCityLogo,
    midnightSoundLogo,
  ] = await Promise.all([
    uploadSeedImage('concrete-wax.jpg', convexHelper),
    uploadSeedImage('low-frequency.jpg', convexHelper),
    uploadSeedImage('night-market.jpg', convexHelper),
    uploadSeedImage('spring-fundraiser.jpg', convexHelper),
    uploadSeedImage('rooftop-listening.jpg', convexHelper),
    uploadSeedImage('logo-lot45.jpg', convexHelper),
    uploadSeedImage('logo-sister-city.jpg', convexHelper),
    uploadSeedImage('logo-midnight-sound.jpg', convexHelper),
  ]);

  const demo = await convexHelper.mutation(api.testing.demo.seedDemoData, {
    cooperId: cooperId as Id<'users'>,
    kimId: kimId as Id<'users'>,
    nomiId: nomiId as Id<'users'>,
    barneyId: barneyId as Id<'users'>,
    charlieId: charlieId as Id<'users'>,
    tobiasId: tobiasId as Id<'users'>,
    cherylId: cherylId as Id<'users'>,
    posterIds: {
      concreteWax,
      lowFrequency,
      nightMarket,
      springFundraiser,
      rooftopListening,
    },
    logoIds: {
      lot45: lot45Logo as Id<'_storage'>,
      sisterCity: sisterCityLogo as Id<'_storage'>,
      midnightSound: midnightSoundLogo as Id<'_storage'>,
    },
  });

  // Grant the global-admin fixture user community_admin on Anfangszeit
  // so adminPage (global-admin@example.com) can access community admin routes.
  const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!adminUser)
    throw new Error(
      'global-admin@example.com not found — run global.setup.ts first',
    );
  const adminUserTyped = adminUser as {_id: Id<'users'>};

  await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
    userId: adminUserTyped._id,
    organizerId: demo.communities.lot45Id,
    grantedBy: adminUserTyped._id,
  });

  // Map seed data keys to the IDs that route resolution expects.
  // - publishedEvent: Concrete & Wax (published, public_viewable, Anfangszeit)
  // - communityAdminEvent: Low Frequency (ended event with real sales + check-in data)
  //   Switched from Concrete & Wax so Event Management shows meaningful chart data:
  //   salesByDay entries from 5 completed purchases and check-in stats from 4 attendees.
  // - publishedEventWithTickets: Concrete & Wax (Charlie holds valid tickets)
  return {
    publishedEvent: demo.events.concreteWaxId,
    communityAdminEvent: demo.events.lowFrequencyId,
    publishedEventWithTickets: demo.events.concreteWaxId,
    ...demo.communities,
    ...demo.events,
  };
}

test.describe('Seed invariants', () => {
  test('Concrete & Wax is seeded as vetting-gated', async ({convexHelper}) => {
    const seedData = await seedAllDemoData(convexHelper);
    const event = await convexHelper.query(api.testing.events.getEvent, {
      eventId: seedData.publishedEvent as Id<'events'>,
    });

    expect(event?.title).toBe('Concrete & Wax');
    expect(event?.visibility).toBe('public_viewable');
  });
});

// ---------------------------------------------------------------------------
// Desktop viewport
// ---------------------------------------------------------------------------

test.describe('Visual Audit — Desktop', () => {
  // Seed data shared across all desktop route groups
  let seedData: Record<string, unknown> = {};

  test.beforeAll(async ({convexHelper}) => {
    seedData = await seedAllDemoData(convexHelper);
  });

  // -------- Anon routes --------

  test.describe('Anon routes — desktop', () => {
    const anonRoutes = AUDIT_ROUTES.filter((r) => r.role === 'anon');
    for (const route of anonRoutes) {
      for (const theme of THEMES) {
        test(`[desktop/${theme}] ${route.label}`, async ({
          page,
          auditConfig,
        }) => {
          await page.setViewportSize(VIEWPORTS.desktop);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'desktop', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            page,
            resolvedRoute,
            'desktop',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- User routes --------

  test.describe('User routes — desktop', () => {
    const userRoutes = AUDIT_ROUTES.filter((r) => r.role === 'user');
    for (const route of userRoutes) {
      for (const theme of THEMES) {
        test(`[desktop/${theme}] ${route.label}`, async ({
          authedPage,
          auditConfig,
        }) => {
          await authedPage.setViewportSize(VIEWPORTS.desktop);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'desktop', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            authedPage,
            resolvedRoute,
            'desktop',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- Community Admin routes --------

  test.describe('Community Admin routes — desktop', () => {
    const communityAdminRoutes = AUDIT_ROUTES.filter(
      (r) => r.role === 'communityAdmin',
    );
    for (const route of communityAdminRoutes) {
      for (const theme of THEMES) {
        test(`[desktop/${theme}] ${route.label}`, async ({
          adminPage,
          auditConfig,
        }) => {
          await adminPage.setViewportSize(VIEWPORTS.desktop);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'desktop', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            adminPage,
            resolvedRoute,
            'desktop',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- Root Admin routes --------

  test.describe('Root Admin routes — desktop', () => {
    const rootAdminRoutes = AUDIT_ROUTES.filter((r) => r.role === 'rootAdmin');
    for (const route of rootAdminRoutes) {
      for (const theme of THEMES) {
        test(`[desktop/${theme}] ${route.label}`, async ({
          adminPage,
          auditConfig,
        }) => {
          await adminPage.setViewportSize(VIEWPORTS.desktop);
          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            adminPage,
            resolvedRoute,
            'desktop',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- Scanner routes --------

  test.describe('Scanner routes — desktop', () => {
    const scannerRoutes = AUDIT_ROUTES.filter((r) => r.role === 'scanner');
    for (const route of scannerRoutes) {
      for (const theme of THEMES) {
        // Note: No scannerPage fixture exists yet. adminPage (root admin) has
        // superset permissions that include scanner access. The rendered UI
        // is identical for both roles on the /scanner route.
        test(`[desktop/${theme}] ${route.label}`, async ({
          adminPage,
          auditConfig,
        }) => {
          await adminPage.setViewportSize(VIEWPORTS.desktop);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'desktop', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            adminPage,
            resolvedRoute,
            'desktop',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile viewport
// ---------------------------------------------------------------------------

test.describe('Visual Audit — Mobile', () => {
  let seedData: Record<string, unknown> = {};

  test.beforeAll(async ({convexHelper}) => {
    seedData = await seedAllDemoData(convexHelper);
  });

  // -------- Anon routes --------

  test.describe('Anon routes — mobile', () => {
    const anonRoutes = AUDIT_ROUTES.filter((r) => r.role === 'anon');
    for (const route of anonRoutes) {
      for (const theme of THEMES) {
        test(`[mobile/${theme}] ${route.label}`, async ({
          page,
          auditConfig,
        }) => {
          await page.setViewportSize(VIEWPORTS.mobile);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'mobile', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            page,
            resolvedRoute,
            'mobile',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- User routes --------

  test.describe('User routes — mobile', () => {
    const userRoutes = AUDIT_ROUTES.filter((r) => r.role === 'user');
    for (const route of userRoutes) {
      for (const theme of THEMES) {
        test(`[mobile/${theme}] ${route.label}`, async ({
          authedPage,
          auditConfig,
        }) => {
          await authedPage.setViewportSize(VIEWPORTS.mobile);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'mobile', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            authedPage,
            resolvedRoute,
            'mobile',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- Community Admin routes --------

  test.describe('Community Admin routes — mobile', () => {
    const communityAdminRoutes = AUDIT_ROUTES.filter(
      (r) => r.role === 'communityAdmin',
    );
    for (const route of communityAdminRoutes) {
      for (const theme of THEMES) {
        test(`[mobile/${theme}] ${route.label}`, async ({
          adminPage,
          auditConfig,
        }) => {
          await adminPage.setViewportSize(VIEWPORTS.mobile);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'mobile', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            adminPage,
            resolvedRoute,
            'mobile',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- Root Admin routes --------

  test.describe('Root Admin routes — mobile', () => {
    const rootAdminRoutes = AUDIT_ROUTES.filter((r) => r.role === 'rootAdmin');
    for (const route of rootAdminRoutes) {
      for (const theme of THEMES) {
        test(`[mobile/${theme}] ${route.label}`, async ({
          adminPage,
          auditConfig,
        }) => {
          await adminPage.setViewportSize(VIEWPORTS.mobile);
          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            adminPage,
            resolvedRoute,
            'mobile',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });

  // -------- Scanner routes --------

  test.describe('Scanner routes — mobile', () => {
    const scannerRoutes = AUDIT_ROUTES.filter((r) => r.role === 'scanner');
    for (const route of scannerRoutes) {
      for (const theme of THEMES) {
        // Note: No scannerPage fixture exists yet. adminPage (root admin) has
        // superset permissions that include scanner access. The rendered UI
        // is identical for both roles on the /scanner route.
        test(`[mobile/${theme}] ${route.label}`, async ({
          adminPage,
          auditConfig,
        }) => {
          await adminPage.setViewportSize(VIEWPORTS.mobile);

          if (route.seedRequirements?.length) {
            const missing = route.seedRequirements.filter(
              (req) => !seedData[req],
            );
            if (missing.length > 0) {
              allResults.push(
                makeSkippedResult(route, 'mobile', missing, theme),
              );
              test.skip(true, `Missing seed data: ${missing.join(', ')}`);
              return;
            }
          }

          const resolvedRoute = {
            ...route,
            path: resolvePath(route.path, seedData),
          };
          const result = await runChecks(
            adminPage,
            resolvedRoute,
            'mobile',
            auditConfig,
            theme,
          );
          allResults.push(result);
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Write results to disk after all tests complete
// ---------------------------------------------------------------------------

test.afterAll(async ({auditConfig}) => {
  if (allResults.length === 0) return;

  try {
    const {path: jsonPath, report} = writeJsonReport(
      allResults,
      auditConfig.llmProvider,
      auditConfig.reportDir,
    );
    console.log(`[audit] JSON report: ${jsonPath}`);

    const htmlPath = writeHtmlReport(report, auditConfig.reportDir);
    console.log(`[audit] HTML report: ${htmlPath}`);
    console.log(`[audit] Open in browser: file://${htmlPath}`);
  } catch (err) {
    console.error('[audit] Failed to generate reports:', err);
  }
});
