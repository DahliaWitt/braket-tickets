import {execFileSync} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/**
 * Returns the git ref to diff against for validation scripts.
 *
 * Priority:
 * 1. Explicit --base CLI arg (passed by caller)
 * 2. VALIDATE_BASE_SHA env var (set by pre-push hook from the remote ref)
 * 3. The branch's configured upstream
 * 4. 'origin/develop' as fallback
 */
export function resolveValidationBaseRef(explicitBase?: string): string {
  if (explicitBase) return explicitBase;

  const envBase = process.env['VALIDATE_BASE_SHA'];
  if (envBase) return envBase;

  try {
    return execFileSync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      {stdio: ['ignore', 'pipe', 'ignore'], cwd: PROJECT_ROOT},
    )
      .toString()
      .trim();
  } catch {
    return 'origin/develop';
  }
}
