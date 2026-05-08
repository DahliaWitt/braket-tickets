import path from 'path';

export type FrontendScreenshotAuthMode = 'none' | 'user' | 'admin';

export interface FrontendScreenshotOptions {
  auth: FrontendScreenshotAuthMode;
  fullPage: boolean;
  outPath: string;
  route: string;
  selector: string | null;
  timeoutMs: number;
  waitForText: string | null;
}

function sanitizeRouteForFilename(route: string): string {
  const trimmed = route.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return 'home';
  }
  return trimmed.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export function parseFrontendScreenshotArgs(
  args: string[],
  projectRoot: string,
): FrontendScreenshotOptions {
  let route: string | null = null;
  let auth: FrontendScreenshotAuthMode = 'none';
  let fullPage = true;
  let outPath: string | null = null;
  let selector: string | null = null;
  let timeoutMs = 15_000;
  let waitForText: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }

    if (!arg.startsWith('--')) {
      if (route === null) {
        route = arg;
        continue;
      }
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    if (arg === '--auth') {
      const value = args[index + 1];
      if (value !== 'none' && value !== 'user' && value !== 'admin') {
        throw new Error(`Invalid --auth value: ${value ?? '<missing>'}`);
      }
      auth = value;
      index += 1;
      continue;
    }

    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --out');
      }
      outPath = path.isAbsolute(value) ? value : path.join(projectRoot, value);
      index += 1;
      continue;
    }

    if (arg === '--selector') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --selector');
      }
      selector = value;
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      const value = Number.parseInt(args[index + 1] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${args[index + 1] ?? '<missing>'}`);
      }
      timeoutMs = value;
      index += 1;
      continue;
    }

    if (arg === '--wait-for-text') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --wait-for-text');
      }
      waitForText = value;
      index += 1;
      continue;
    }

    if (arg === '--viewport') {
      fullPage = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (route === null) {
    throw new Error('A route is required, e.g. `pnpm run screenshot:frontend -- /account`');
  }

  if (!route.startsWith('/')) {
    throw new Error(`Route must start with "/": ${route}`);
  }

  return {
    auth,
    fullPage,
    outPath:
      outPath ??
      path.join(projectRoot, 'frontend', '__screenshots__', `${sanitizeRouteForFilename(route)}.png`),
    route,
    selector,
    timeoutMs,
    waitForText,
  };
}
