/**
 * ESLint Rule: no-sequential-db-queries
 *
 * Detects N+1 query patterns in Convex backend code by flagging sequential
 * `await ctx.db.get()` or `await ctx.db.query()` calls inside loops.
 *
 * Correct pattern (parallelized):
 *   const docs = await Promise.all(ids.map(id => ctx.db.get('table', id)));
 *
 * Anti-pattern (N+1):
 *   for (const id of ids) {
 *     const doc = await ctx.db.get('table', id);  // ← flagged
 *   }
 *
 * @type {import('eslint').Rule.RuleModule}
 */
/**
 * Checks if a node is inside a loop statement (for, for-in, for-of, while, do-while).
 * @param {import('eslint').Rule.Node} node
 * @returns {boolean}
 */
function isInsideLoop(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'ForStatement' ||
      current.type === 'ForInStatement' ||
      current.type === 'ForOfStatement' ||
      current.type === 'WhileStatement' ||
      current.type === 'DoWhileStatement'
    ) {
      return true;
    }
    // Stop walking at function boundaries
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      // But if the function is a callback in .map/.forEach/.reduce,
      // it's effectively a loop body — keep checking
      if (current.parent && current.parent.type === 'CallExpression') {
        const callee = current.parent.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          ['forEach', 'reduce'].includes(callee.property.name)
        ) {
          // This is a forEach/reduce callback — treat as a loop
          current = current.parent;
          continue;
        }
      }
      return false;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Checks if a MemberExpression matches a given dot path like 'ctx.db.get'.
 * @param {import('estree').MemberExpression} node
 * @param {string[]} parts
 * @returns {boolean}
 */
function matchesDotPath(node, parts) {
  if (parts.length === 1) {
    return (
      node.type === 'Identifier' && node.name === parts[0]
    );
  }
  if (
    node.type !== 'MemberExpression' ||
    node.property.type !== 'Identifier' ||
    node.property.name !== parts[parts.length - 1]
  ) {
    return false;
  }
  return matchesDotPath(node.object, parts.slice(0, -1));
}

const sequentialDbGetRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow sequential ctx.db.get/query calls inside loops (N+1 query pattern)',
      category: 'Performance',
      recommended: true,
    },
    messages: {
      sequentialDbGet:
        'Avoid awaiting ctx.db.get() inside a loop — this causes N+1 queries. ' +
        'Use Promise.all() with .map(), or use batchGetDocuments() from lib/batch_utils.',
      sequentialDbQuery:
        'Avoid awaiting ctx.db.query() inside a loop — this causes N+1 queries. ' +
        'Collect IDs first, then batch-query outside the loop.',
      sequentialRunQuery:
        'Avoid awaiting ctx.runQuery() inside a loop — this causes N+1 queries. ' +
        'Batch the work into a single query that accepts multiple IDs.',
    },
    schema: [],
  },

  create(context) {
    return {
      AwaitExpression(node) {
        const argument = node.argument;
        // Check for direct call: await ctx.db.get(...) or await ctx.db.query(...)
        if (argument.type !== 'CallExpression') return;

        const callee = argument.callee;
        if (callee.type !== 'MemberExpression') return;

        // Match ctx.db.get, ctx.db.query, ctx.runQuery
        const patterns = [
          { path: ['ctx', 'db', 'get'], messageId: 'sequentialDbGet' },
          { path: ['ctx', 'db', 'query'], messageId: 'sequentialDbQuery' },
          { path: ['ctx', 'runQuery'], messageId: 'sequentialRunQuery' },
        ];

        for (const pattern of patterns) {
          if (matchesDotPath(callee, pattern.path)) {
            if (isInsideLoop(node)) {
              context.report({
                node,
                messageId: pattern.messageId,
              });
            }
            return;
          }
        }
      },
    };
  },
};

// Export as ESLint plugin format (for oxlint JS plugins)
module.exports = {
  meta: {
    name: 'no-sequential-db-queries',
  },
  rules: {
    'sequential-db-get': sequentialDbGetRule,
  },
};

// Also export the rule directly for backward compatibility with ESLint
module.exports.sequentialDbGetRule = sequentialDbGetRule;
