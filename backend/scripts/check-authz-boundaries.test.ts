// @vitest-environment node

import {describe, expect, it} from 'vitest';

import {collectConvexSourceFiles, findCheckMatches} from './check-authz-boundaries';

describe('collectConvexSourceFiles', () => {
  it('collects non-test TypeScript files under convex recursively', () => {
    const entries = new Map([
      [
        'convex',
        [
          {name: 'foo.ts', isDirectory: () => false, isFile: () => true},
          {name: 'foo.test.ts', isDirectory: () => false, isFile: () => true},
          {name: 'nested', isDirectory: () => true, isFile: () => false},
          {name: 'ignore.js', isDirectory: () => false, isFile: () => true},
        ],
      ],
      [
        'convex/nested',
        [{name: 'bar.ts', isDirectory: () => false, isFile: () => true}],
      ],
    ]);

    const files = collectConvexSourceFiles(
      'convex',
      ((directory: string) => entries.get(directory) ?? []) as typeof import('node:fs').readdirSync,
    );

    expect(files).toEqual(['convex/foo.ts', 'convex/nested/bar.ts']);
  });
});

describe('findCheckMatches', () => {
  it('reports matches with file and line numbers while honoring exclusions', () => {
    const files = [
      'convex/a.ts',
      'convex/lib/authz.ts',
      'convex/lib/permissions.ts',
      'convex/b.ts',
    ];
    const readFile = (filePath: string): string => {
      switch (filePath) {
        case 'convex/a.ts':
          return [
            'const ok = true;',
            'const canWithGlobalFallback = () => true;',
            'components.authz.rebac.can();',
          ].join('\n');
        case 'convex/lib/authz.ts':
          return 'components.authz.rebac.can();';
        case 'convex/lib/permissions.ts':
          return 'function canWithGlobalFallback() { return true; }';
        case 'convex/b.ts':
          return 'const nothing = 1;';
        default:
          return '';
      }
    };

    expect(
      findCheckMatches(
        {description: 'rebac', pattern: 'components\\.authz\\.rebac\\.'},
        files,
        readFile,
      ),
    ).toEqual('convex/a.ts:3:components.authz.rebac.can();');

    expect(
      findCheckMatches(
        {
          description: 'fallback',
          pattern: '(function|const)\\s+canWithGlobalFallback\\b',
          excludedFiles: ['convex/lib/permissions.ts'],
        },
        files,
        readFile,
      ),
    ).toEqual('convex/a.ts:2:const canWithGlobalFallback = () => true;');
  });
});
