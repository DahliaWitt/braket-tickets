import * as path from 'path';
import * as fs from 'fs';

import {LOCAL_DIR, findEphemeralPort} from './shared';
import {ConvexBackend} from './ConvexBackend';
import {AngularFrontend} from './AngularFrontend';

// ── HarnessInstance ────────────────────────────────────────────────────────────

export class HarnessInstance {
  readonly backend: ConvexBackend;
  readonly frontend: AngularFrontend | null;

  constructor(backend: ConvexBackend, frontend: AngularFrontend | null) {
    this.backend = backend;
    this.frontend = frontend;
  }

  // ── Static factory methods ─────────────────────────────────────────────────

  /**
   * Start a dev harness: Convex backend + Angular frontend in development mode.
   * Uses port 4200 for the Angular dev server.
   */
  static async dev(opts?: {fresh?: boolean}): Promise<HarnessInstance> {
    const appPort = 4200;
    const backend = new ConvexBackend({mode: 'dev'});
    await backend.start(appPort, {fresh: opts?.fresh});

    const frontend = new AngularFrontend({
      convexUrl: backend.convexUrl,
      convexSiteUrl: backend.convexSiteUrl,
      port: appPort,
      configuration: 'development',
    });
    await frontend.start();

    return new HarnessInstance(backend, frontend);
  }

  /**
   * Start an e2e harness: Convex backend only. Frontend is created separately
   * by entry points (e.g., ng serve or build-and-serve).
   */
  static async e2e(opts?: {
    appPort?: number;
    fresh?: boolean;
  }): Promise<HarnessInstance> {
    const appPort = opts?.appPort ?? (await findEphemeralPort());
    const backend = new ConvexBackend({mode: 'e2e'});
    await backend.start(appPort, {fresh: opts?.fresh});

    return new HarnessInstance(backend, null);
  }

  // ── Active symlink management ──────────────────────────────────────────────

  /**
   * Symlink .convex-local/e2e-active -> backend.workspaceDir.
   * Removes any existing symlink first.
   */
  linkAsActive(): void {
    const symlinkPath = path.join(LOCAL_DIR, 'e2e-active');

    // Remove existing symlink or file at this path
    try {
      fs.unlinkSync(symlinkPath);
    } catch (err: unknown) {
      // ENOENT is expected when the symlink doesn't exist yet
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[HarnessInstance] Failed to remove existing e2e-active symlink: ${msg}`,
        );
      }
    }

    fs.mkdirSync(LOCAL_DIR, {recursive: true});
    fs.symlinkSync(this.backend.workspaceDir, symlinkPath);
  }

  /**
   * Remove the .convex-local/e2e-active symlink if it exists.
   */
  unlinkActive(): void {
    const symlinkPath = path.join(LOCAL_DIR, 'e2e-active');
    try {
      fs.unlinkSync(symlinkPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[HarnessInstance] Failed to remove e2e-active symlink: ${msg}`,
        );
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Stop the frontend (if present), remove the active symlink, and stop the backend.
   */
  async stop(): Promise<void> {
    if (this.frontend !== null) {
      await this.frontend.stop();
    }
    this.unlinkActive();
    await this.backend.stop();
  }
}
