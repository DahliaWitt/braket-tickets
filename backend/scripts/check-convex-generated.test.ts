// @vitest-environment node

import {describe, expect, it, vi} from 'vitest';

import {
  TRACKED_CONVEX_GENERATED_FILES,
  collectChangedFiles,
  checkConvexGeneratedFreshness,
} from './check-convex-generated';

describe('collectChangedFiles', () => {
  it('returns files whose contents changed across codegen', () => {
    expect(
      collectChangedFiles(
        {
          'convex/_generated/api.d.ts': 'before-api',
          'convex/_generated/api.js': 'same-api-js',
          'convex/_generated/dataModel.d.ts': 'before-data-model',
          'convex/_generated/server.d.ts': 'same-server-dts',
          'convex/_generated/server.js': 'same-server-js',
        },
        {
          'convex/_generated/api.d.ts': 'after-api',
          'convex/_generated/api.js': 'same-api-js',
          'convex/_generated/dataModel.d.ts': 'after-data-model',
          'convex/_generated/server.d.ts': 'same-server-dts',
          'convex/_generated/server.js': 'same-server-js',
        },
      ),
    ).toEqual([
      'convex/_generated/api.d.ts',
      'convex/_generated/dataModel.d.ts',
    ]);
  });
});

describe('checkConvexGeneratedFreshness', () => {
  it('runs Convex codegen and reports a clean generated tree', () => {
    const run = vi
      .fn<(command: string, args: string[]) => string>()
      .mockReturnValue('');
    const readFile = vi
      .fn<(path: string) => string>()
      .mockImplementation(() => 'same-content');

    const result = checkConvexGeneratedFreshness(run, readFile);

    expect(result).toEqual({ok: true, changedFiles: []});
    expect(run).toHaveBeenNthCalledWith(1, 'pnpm', [
      'convex',
      'codegen',
      '--typecheck',
      'disable',
    ]);
    expect(readFile).toHaveBeenCalledTimes(
      TRACKED_CONVEX_GENERATED_FILES.length * 2,
    );
  });

  it('reports generated files that drifted from source', () => {
    const run = vi
      .fn<(command: string, args: string[]) => string>()
      .mockReturnValue('');
    let readPhase = 'before';
    const readFile = vi
      .fn<(path: string) => string>()
      .mockImplementation((path) => {
        if (readPhase === 'before') {
          if (path === 'convex/_generated/api.d.ts') return 'before-api';
          if (path === 'convex/_generated/server.js') return 'before-server-js';
          return 'stable';
        }
        if (path === 'convex/_generated/api.d.ts') return 'after-api';
        if (path === 'convex/_generated/server.js') return 'after-server-js';
        return 'stable';
      });
    run.mockImplementation(() => {
      readPhase = 'after';
      return '';
    });

    const result = checkConvexGeneratedFreshness(run, readFile);

    expect(result).toEqual({
      ok: false,
      changedFiles: [
        'convex/_generated/api.d.ts',
        'convex/_generated/server.js',
      ],
    });
  });
});
