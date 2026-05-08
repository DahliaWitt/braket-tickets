/**
 * ESLint Rule: no-raw-db-mutations
 *
 * Catches direct `ctx.db.insert/patch/replace/delete` calls in test and seed
 * files. These bypass business logic (validators, side-effects, access checks)
 * and should be replaced with production mutations called via `t.mutation()`.
 *
 * Anti-patterns flagged:
 *   ctx.db.insert('users', { name: 'Alice' })    // direct
 *   ctx.db.patch(id, { name: 'Bob' })             // direct
 *   const { db } = ctx; db.delete(id)             // destructured
 *   const d = ctx.db; d.replace(id, doc)          // aliased
 *
 * @type {import('eslint').Rule.RuleModule}
 */

const MUTATION_METHODS = new Set(['insert', 'patch', 'replace', 'delete']);

/**
 * Returns true if any part of the MemberExpression chain contains an
 * Identifier named `db`.
 * @param {import('estree').Expression} node
 * @returns {boolean}
 */
function chainContainsDb(node) {
  if (node.type === 'Identifier') {
    return node.name === 'db';
  }
  if (node.type === 'MemberExpression') {
    if (node.property.type === 'Identifier' && node.property.name === 'db') {
      return true;
    }
    return chainContainsDb(node.object);
  }
  return false;
}

/**
 * Resolves the original name of a variable by walking the scope chain to find
 * its declaration.
 *
 * - `const { db } = ctx` → returns 'db' (the binding is already named 'db')
 * - `const d = ctx.db`   → returns 'db' (the init is a MemberExpression ending in 'db')
 *
 * @param {string} name - The local variable name to resolve.
 * @param {import('eslint').Scope.Scope} scope
 * @returns {string | null} The resolved 'base' property name, or null if unresolvable.
 */
function resolveNameThroughScope(name, scope) {
  let current = scope;
  while (current) {
    for (const variable of current.variables) {
      if (variable.name !== name) continue;
      for (const def of variable.defs) {
        // Pattern: const { db } = ctx  →  def.node is a Property with key.name === 'db'
        if (def.node.type === 'Property' && def.node.key.type === 'Identifier') {
          return def.node.key.name;
        }
        // Pattern: const d = ctx.db  →  def.node.init is a MemberExpression
        if (
          def.node.type === 'VariableDeclarator' &&
          def.node.init &&
          def.node.init.type === 'MemberExpression' &&
          def.node.init.property.type === 'Identifier'
        ) {
          return def.node.init.property.name;
        }
      }
    }
    current = current.upper;
  }
  return null;
}

const noRawDbMutationRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw ctx.db.insert/patch/replace/delete in test and seed files',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noRawDbMutation:
        'Use production mutations for test/seed setup. Raw db.{{method}}() bypasses business logic. ' +
        'See backend/convex/testing/AGENTS.md for approved patterns.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier') return;

        const methodName = callee.property.name;
        if (!MUTATION_METHODS.has(methodName)) return;

        const receiver = callee.object;

        // Case 1: Direct chain — ctx.db.insert(...)
        // The object of the MemberExpression must contain 'db' somewhere in its chain.
        if (chainContainsDb(receiver)) {
          context.report({
            node,
            messageId: 'noRawDbMutation',
            data: {method: methodName},
          });
          return;
        }

        // Case 2: Identifier call — db.insert(...) or d.insert(...)
        // Walk scope to check if this variable was bound to 'db' or 'ctx.db'.
        if (receiver.type === 'Identifier') {
          const sourceCode = context.getSourceCode
            ? context.getSourceCode()
            : context.sourceCode;
          const scope = sourceCode.getScope
            ? sourceCode.getScope(node)
            : context.getScope();
          const resolvedName = resolveNameThroughScope(
            receiver.name,
            scope,
          );
          if (resolvedName === 'db') {
            context.report({
              node,
              messageId: 'noRawDbMutation',
              data: {method: methodName},
            });
          }
        }
      },
    };
  },
};

// Export as ESLint plugin format (matching the existing eslint-rules pattern)
module.exports = {
  meta: {
    name: 'no-raw-db-mutations',
  },
  rules: {
    'no-raw-db-mutation': noRawDbMutationRule,
  },
};

// Also export the rule directly for backward compatibility with ESLint
module.exports.noRawDbMutationRule = noRawDbMutationRule;
