/**
 * Page Objects for E2E Tests
 *
 * These page objects mirror the CDK component harnesses API
 * but work with Playwright for E2E testing.
 */

export { LandingPage } from './landing.page';
export { LoginPage } from './login.page';
export { ComponentHarnessAdapter, E2EPageObject } from '../helpers/harness-environment';
