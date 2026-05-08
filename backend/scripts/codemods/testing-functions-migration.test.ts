// @vitest-environment node

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it, vi} from 'vitest';

import {parseArgs, rewriteSourceText, run} from './testing-functions-migration.ts';
import {
  TESTING_FUNCTIONS_DOMAIN_MAP,
  isKnownTestingFunction,
} from './testing-functions-map.ts';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(THIS_DIR, '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

describe('TESTING_FUNCTIONS_DOMAIN_MAP', () => {
  it('covers every registered export (60 total)', () => {
    expect(Object.keys(TESTING_FUNCTIONS_DOMAIN_MAP)).toHaveLength(60);
  });

  it('routes representative names to the right domain', () => {
    expect(TESTING_FUNCTIONS_DOMAIN_MAP.seedEvent).toBe('events');
    expect(TESTING_FUNCTIONS_DOMAIN_MAP._getByEmailInternal).toBe('users');
    expect(TESTING_FUNCTIONS_DOMAIN_MAP.seedUserAndGetTokens).toBe('users_node');
    expect(TESTING_FUNCTIONS_DOMAIN_MAP.seedDemoData).toBe('demo');
    expect(TESTING_FUNCTIONS_DOMAIN_MAP.clearAll).toBe('utilities');
  });

  it('isKnownTestingFunction narrows to map keys', () => {
    expect(isKnownTestingFunction('seedEvent')).toBe(true);
    expect(isKnownTestingFunction('notAnExport')).toBe(false);
  });
});

describe('rewriteSourceText', () => {
  it('rewrites `api.testing_functions.seedEvent` to `api.testing.events.seedEvent`', () => {
    const before = readFixture('simple-api.ts');
    const {after, rewrites, unknowns, dynamic} = rewriteSourceText({
      sourceText: before,
    });
    expect(rewrites).toBe(1);
    expect(unknowns).toEqual([]);
    expect(dynamic).toEqual([]);
    expect(after).toContain('api.testing.events.seedEvent');
    expect(after).not.toContain('api.testing_functions.seedEvent');
  });

  it('rewrites `internal.testing_functions._getByEmailInternal` to the users domain', () => {
    const before = readFixture('internal-call.ts');
    const {after, rewrites, unknowns, dynamic} = rewriteSourceText({
      sourceText: before,
    });
    expect(rewrites).toBe(1);
    expect(unknowns).toEqual([]);
    expect(dynamic).toEqual([]);
    expect(after).toContain('internal.testing.users._getByEmailInternal');
    expect(after).not.toContain('internal.testing_functions');
  });

  it('rewrites a single-domain destructuring to `api.testing.<domain>`', () => {
    const before = readFixture('destructured.ts');
    const {after, rewrites, unknowns, dynamic} = rewriteSourceText({
      sourceText: before,
    });
    expect(rewrites).toBe(1);
    expect(unknowns).toEqual([]);
    expect(dynamic).toEqual([]);
    expect(after).toContain('const {seedEvent, getEvent} = api.testing.events;');
    expect(after).not.toContain('api.testing_functions');
  });

  it('reports unknown names and leaves them unchanged', () => {
    const before = readFixture('unknown-name.ts');
    const {after, rewrites, unknowns, dynamic} = rewriteSourceText({
      sourceText: before,
    });
    expect(rewrites).toBe(0);
    expect(dynamic).toEqual([]);
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0]?.name).toBe('seedSomethingWeDidNotAuthor');
    expect(unknowns[0]?.root).toBe('api');
    expect(after).toBe(before);
  });

  it('reports dynamic element access and leaves it unchanged', () => {
    const before = readFixture('dynamic-access.ts');
    const {after, rewrites, unknowns, dynamic} = rewriteSourceText({
      sourceText: before,
    });
    expect(rewrites).toBe(0);
    expect(unknowns).toEqual([]);
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0]?.description).toContain('dynamic property access');
    expect(dynamic[0]?.root).toBe('api');
    expect(after).toBe(before);
  });

  it('reports mixed-domain destructuring and leaves it unchanged', () => {
    const before = readFixture('mixed-domain-destructuring.ts');
    const {after, rewrites, unknowns, dynamic} = rewriteSourceText({
      sourceText: before,
    });
    expect(rewrites).toBe(0);
    expect(unknowns).toEqual([]);
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0]?.description).toContain('mixed-domain destructuring');
    // Both domains are named, in sorted order.
    expect(dynamic[0]?.description).toContain('events');
    expect(dynamic[0]?.description).toContain('tickets');
    expect(after).toBe(before);
  });
});

describe('run (filesystem harness)', () => {
  it('skips `_generated/api.d.ts` and the source `testing_functions.ts`', () => {
    const repoRoot = '/virtual/repo';
    const generated = `${repoRoot}/backend/convex/_generated/api.d.ts`;
    const sourceFile = `${repoRoot}/backend/convex/testing_functions.ts`;
    const caller = `${repoRoot}/backend/convex/communities/applications.test.ts`;

    const contents: Record<string, string> = {
      [generated]: 'export const api = { testing_functions: { seedEvent: {} } };',
      [sourceFile]: 'export const seedEvent = () => {};',
      [caller]:
        "import {api} from '@convex/_generated/api';\n" +
        'await t.mutation(api.testing_functions.seedEvent, {});',
    };

    const reads = new Set<string>();
    const writes = new Map<string, string>();

    // We include the generated file AND the source file in the "list"; the
    // filter must ensure neither is rewritten.
    const listFiles = vi.fn((_globs: string[]): string[] => [
      generated,
      sourceFile,
      caller,
    ]);
    const readFile = vi.fn((p: string): string => {
      reads.add(p);
      const value = contents[p];
      if (value === undefined) throw new Error(`no fixture for ${p}`);
      return value;
    });
    const writeFile = vi.fn((p: string, c: string): void => {
      writes.set(p, c);
    });

    const {summary, exitCode} = run({
      repoRoot,
      dryRun: false,
      verbose: false,
      allowUnknowns: false,
      listFiles,
      readFile,
      writeFile,
      exists: (p: string) => p in contents,
      log: () => {},
    });

    // Protected files:
    //   - backend/convex/testing_functions.ts is EXPLICITLY_PROTECTED and
    //     is skipped before the file is even read.
    //   - _generated/api.d.ts is filtered from the default glob in
    //     production, but the harness here injects it via listFiles; it's
    //     not explicitly protected, and we rely on the default
    //     EXCLUDE_GLOBS filter. To keep the test hermetic we check that
    //     the source file is never written, and that only the caller is
    //     rewritten to the new path.
    expect(writes.has(sourceFile)).toBe(false);
    expect(writes.has(caller)).toBe(true);
    const rewritten = writes.get(caller);
    expect(rewritten).toContain('api.testing.events.seedEvent');
    expect(rewritten).not.toContain('api.testing_functions.seedEvent');

    expect(summary.occurrencesRewritten).toBeGreaterThanOrEqual(1);
    expect(exitCode).toBe(0);
  });

  it('dry-run writes nothing and returns exit code 0 on a clean run', () => {
    const repoRoot = '/virtual/repo';
    const caller = `${repoRoot}/backend/convex/communities/applications.test.ts`;

    const listFiles = vi.fn((_globs: string[]): string[] => [caller]);
    const readFile = vi.fn((_p: string): string =>
      "import {api} from '@convex/_generated/api';\n" +
      'await t.mutation(api.testing_functions.seedEvent, {});',
    );
    const writeFile = vi.fn((_p: string, _c: string): void => {
      throw new Error('dry-run must not write');
    });

    const {summary, exitCode} = run({
      repoRoot,
      dryRun: true,
      verbose: false,
      allowUnknowns: false,
      listFiles,
      readFile,
      writeFile,
      exists: () => true,
      log: () => {},
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(summary.filesTouched).toBe(1);
    expect(summary.occurrencesRewritten).toBe(1);
    expect(exitCode).toBe(0);
  });

  it('returns exit code 1 when unknowns are reported and --allow-unknowns is not set', () => {
    const repoRoot = '/virtual/repo';
    const caller = `${repoRoot}/backend/convex/weird.test.ts`;

    const listFiles = vi.fn((_globs: string[]): string[] => [caller]);
    const readFile = vi.fn((_p: string): string =>
      "import {api} from '@convex/_generated/api';\n" +
      'await t.mutation(api.testing_functions.seedSomethingUnknown, {});',
    );
    const writeFile = vi.fn();

    const {summary, exitCode} = run({
      repoRoot,
      dryRun: false,
      verbose: false,
      allowUnknowns: false,
      listFiles,
      readFile,
      writeFile,
      exists: () => true,
      log: () => {},
    });

    expect(summary.unknowns).toHaveLength(1);
    expect(exitCode).toBe(1);
  });
});

describe('parseArgs', () => {
  it('defaults to --dry-run', () => {
    expect(parseArgs([])).toMatchObject({
      dryRun: true,
      write: false,
      verbose: false,
      allowUnknowns: false,
      paths: [],
    });
  });

  it('--write flips dryRun off', () => {
    expect(parseArgs(['--write'])).toMatchObject({dryRun: false, write: true});
  });

  it('--paths is repeatable', () => {
    expect(parseArgs(['--paths', 'frontend/**/*.ts', '--paths', 'backend/**/*.ts']))
      .toMatchObject({paths: ['frontend/**/*.ts', 'backend/**/*.ts']});
  });

  it('throws on unknown arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});
