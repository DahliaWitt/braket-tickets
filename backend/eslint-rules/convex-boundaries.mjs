/**
 * ESLint Plugin: convex-boundaries
 *
 * Enforces Convex module boundaries:
 * - `_impl/**` is private implementation code.
 * - Convex registered-function modules (queries/mutations/actions/http routers)
 *   must not import other registered-function modules.
 *
 * This plugin is intentionally heuristic-based (fast, no TypeScript program).
 *
 * @type {import('eslint').ESLint.Plugin}
 */

import fs from 'node:fs';
import path from 'node:path';

const REGISTERED_BUILDERS = new Set([
  'query',
  'mutation',
  'action',
  'httpAction',
  'internalQuery',
  'internalMutation',
  'internalAction',
]);

const REGISTERED_EXPORT_RE =
  /export\s+(?:const|default)\s+[\w$]+\s*=\s*(query|mutation|action|httpAction|internalQuery|internalMutation|internalAction)\b/;

const REGISTERED_DEFAULT_EXPORT_RE =
  /export\s+default\s+(query|mutation|action|httpAction|internalQuery|internalMutation|internalAction)\b/;

/** @type {Map<string, boolean>} */
const registeredModuleCache = new Map();

function getContextFilename(context) {
  if (typeof context.filename === 'string' && context.filename.length > 0) {
    return context.filename;
  }
  if (typeof context.getFilename === 'function') {
    return context.getFilename();
  }
  return '<input>';
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isTsFile(p) {
  return p.endsWith('.ts') || p.endsWith('.tsx');
}

function isTestFile(filename) {
  return (
    filename.endsWith('.test.ts') ||
    filename.endsWith('.test.tsx') ||
    filename.endsWith('.spec.ts') ||
    filename.endsWith('.spec.tsx')
  );
}

function isInConvexExemptDir(filenamePosix) {
  return (
    filenamePosix.includes('/convex/lib/') ||
    filenamePosix.includes('/convex/_generated/') ||
    filenamePosix.includes('/convex/email/') ||
    filenamePosix.includes('/convex/migrations/') ||
    filenamePosix.includes('/convex/testing/')
  );
}

function containsImplSegment(absPath) {
  return toPosix(absPath).includes('/_impl/');
}

function getImplOwnerDir(absPath) {
  const posix = toPosix(absPath);
  const idx = posix.indexOf('/_impl/');
  if (idx === -1) return null;
  return posix.slice(0, idx);
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveRelativeImport(fromFilename, sourceValue) {
  if (typeof sourceValue !== 'string') return null;
  if (!sourceValue.startsWith('.')) return null;

  const base = path.resolve(path.dirname(fromFilename), sourceValue);

  // Explicit extension
  if (path.extname(base)) {
    return fileExists(base) ? base : null;
  }

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function looksLikeRegisteredConvexModule(targetFilename) {
  if (!targetFilename) return false;
  if (!isTsFile(targetFilename)) return false;

  const cached = registeredModuleCache.get(targetFilename);
  if (cached !== undefined) return cached;

  let text;
  try {
    text = fs.readFileSync(targetFilename, 'utf8');
  } catch {
    registeredModuleCache.set(targetFilename, false);
    return false;
  }

  const isRegistered =
    REGISTERED_EXPORT_RE.test(text) || REGISTERED_DEFAULT_EXPORT_RE.test(text);
  registeredModuleCache.set(targetFilename, isRegistered);
  return isRegistered;
}

const noCrossImplImportRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing another feature/module private `_impl/**` code',
      recommended: true,
    },
    messages: {
      crossImplImport:
        'Do not import private `_impl/**` from outside its owning module. Importer: {{importer}} → {{target}}',
    },
    schema: [],
  },
  create(context) {
    const importer = getContextFilename(context);
    const importerPosix = toPosix(importer);

    return {
      ImportDeclaration(node) {
        const target = resolveRelativeImport(importer, node.source.value);
        if (!target) return;
        if (!containsImplSegment(target)) return;

        const ownerDir = getImplOwnerDir(target);
        if (!ownerDir) return;

        const importerAllowed =
          // Any file inside the owning directory tree.
          importerPosix.startsWith(`${ownerDir}/`) ||
          // Or the sibling owner module file (`<ownerDir>.ts`).
          importerPosix === `${ownerDir}.ts` ||
          importerPosix === `${ownerDir}.tsx`;

        if (importerAllowed) return;

        context.report({
          node,
          messageId: 'crossImplImport',
          data: {
            importer: importerPosix,
            target: toPosix(target),
          },
        });
      },
    };
  },
};

const noRegisteredInImplRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow registering Convex functions inside `_impl/**`',
      recommended: true,
    },
    messages: {
      registeredInImpl:
        'Do not register Convex functions inside `_impl/**`. Move function registration to the owning module file and keep `_impl` for helpers only.',
    },
    schema: [],
  },
  create(context) {
    const filename = getContextFilename(context);
    if (!containsImplSegment(filename)) {
      return {};
    }

    /** @type {Set<string>} */
    const serverNamespaces = new Set();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;

        // Primary pattern: import from our generated server module.
        const isGeneratedServerImport = source.includes('_generated/server');
        const isConvexServerImport = source === 'convex/server';
        if (!isGeneratedServerImport && !isConvexServerImport) return;

        const specifiers = node.specifiers ?? [];
        for (const spec of specifiers) {
          if (spec.type === 'ImportSpecifier') {
            if (spec.imported.type !== 'Identifier') continue;
            if (!REGISTERED_BUILDERS.has(spec.imported.name)) continue;

            context.report({node: spec, messageId: 'registeredInImpl'});
            return;
          }

          if (spec.type === 'ImportNamespaceSpecifier') {
            serverNamespaces.add(spec.local.name);
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier') return;
        if (!serverNamespaces.has(callee.object.name)) return;
        if (callee.property.type !== 'Identifier') return;
        if (!REGISTERED_BUILDERS.has(callee.property.name)) return;

        context.report({
          node: callee.property,
          messageId: 'registeredInImpl',
        });
      },
    };
  },
};

const noConvexModuleImportRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing other Convex registered-function modules (use internal.* or shared lib/**)',
      recommended: false,
    },
    messages: {
      convexModuleImport:
        'Do not import Convex registered-function modules. Use `ctx.runQuery/runMutation(internal.*)` or extract shared helpers into `convex/lib/**`. Importer: {{importer}} → {{target}}',
    },
    schema: [],
  },
  create(context) {
    const importer = getContextFilename(context);
    const importerPosix = toPosix(importer);

    if (isTestFile(importerPosix) || isInConvexExemptDir(importerPosix)) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const target = resolveRelativeImport(importer, node.source.value);
        if (!target) return;

        const targetPosix = toPosix(target);
        if (isInConvexExemptDir(targetPosix)) return;

        if (!looksLikeRegisteredConvexModule(target)) return;

        context.report({
          node,
          messageId: 'convexModuleImport',
          data: {importer: importerPosix, target: targetPosix},
        });
      },
    };
  },
};

export default {
  meta: {
    name: 'convex-boundaries',
  },
  rules: {
    'no-cross-impl-import': noCrossImplImportRule,
    'no-registered-in-impl': noRegisteredInImplRule,
    'no-convex-module-import': noConvexModuleImportRule,
  },
};
