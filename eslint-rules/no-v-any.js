/**
 * ESLint Rule: no-v-any
 *
 * Catches `v.any()` calls from Convex validators. Most uses weaken runtime
 * validation and generated API contracts, so intentional exceptions should
 * carry an inline eslint-disable reason at the call site.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

const CONVEX_VALUES_MODULE = 'convex/values';

const noVAnyRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Convex v.any() validators without an explicit inline exception',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noVAny:
        'Avoid v.any() in Convex validators because it weakens runtime validation and generated API contracts. ' +
        'Use a specific validator, or add an eslint-disable comment explaining why this value is intentionally dynamic.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    /**
     * @param {import('estree').MemberExpression} node
     * @returns {string | null}
     */
    function getStaticPropertyName(node) {
      if (!node.computed && node.property.type === 'Identifier') {
        return node.property.name;
      }
      if (
        node.computed &&
        node.property.type === 'Literal' &&
        typeof node.property.value === 'string'
      ) {
        return node.property.value;
      }
      return null;
    }

    /**
     * @param {import('estree').Identifier} identifier
     * @returns {import('eslint').Scope.Variable | null}
     */
    function findVariable(identifier) {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable;
        scope = scope.upper;
      }
      return null;
    }

    /**
     * @param {import('eslint').Scope.Variable | null}
     * @returns {boolean}
     */
    function isConvexVImport(variable) {
      const definition = variable?.defs[0];
      if (definition?.type !== 'ImportBinding') return false;
      const node = definition.node;
      return (
        node.type === 'ImportSpecifier' &&
        node.imported.type === 'Identifier' &&
        node.imported.name === 'v' &&
        definition.parent?.source.value === CONVEX_VALUES_MODULE
      );
    }

    /**
     * @param {import('eslint').Scope.Variable | null}
     * @returns {boolean}
     */
    function isConvexValuesNamespaceImport(variable) {
      const definition = variable?.defs[0];
      return (
        definition?.type === 'ImportBinding' &&
        definition.node.type === 'ImportNamespaceSpecifier' &&
        definition.parent?.source.value === CONVEX_VALUES_MODULE
      );
    }

    /**
     * @param {import('estree').Expression | import('estree').Super | import('estree').PrivateIdentifier} node
     * @returns {boolean}
     */
    function isConvexVReference(node) {
      if (node.type === 'Identifier') {
        return isConvexVImport(findVariable(node));
      }
      if (node.type !== 'MemberExpression') return false;
      if (getStaticPropertyName(node) !== 'v') return false;
      if (node.object.type !== 'Identifier') return false;
      return isConvexValuesNamespaceImport(findVariable(node.object));
    }

    /**
     * @param {import('estree').CallExpression} node
     * @returns {boolean}
     */
    function isConvexAnyCall(node) {
      const callee = node.callee;
      return (
        callee.type === 'MemberExpression' &&
        getStaticPropertyName(callee) === 'any' &&
        isConvexVReference(callee.object)
      );
    }

    return {
      CallExpression(node) {
        if (!isConvexAnyCall(node)) return;

        context.report({
          node,
          messageId: 'noVAny',
        });
      },
    };
  },
};

const noRawConvexErrorRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct ConvexError construction outside the canonical app error helpers',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noRawConvexError:
        'Do not construct ConvexError directly in Convex feature code. Use backend/convex/lib/errors.ts helpers so errors keep structured {code, message} data.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.filename ?? context.getFilename?.() ?? '';

    if (
      filename.endsWith('/backend/convex/lib/errors.ts') ||
      filename.endsWith('/convex/lib/errors.ts') ||
      filename.endsWith('.test.ts') ||
      filename.endsWith('.spec.ts')
    ) {
      return {};
    }

    function getStaticPropertyName(node) {
      if (!node.computed && node.property.type === 'Identifier') {
        return node.property.name;
      }
      if (
        node.computed &&
        node.property.type === 'Literal' &&
        typeof node.property.value === 'string'
      ) {
        return node.property.value;
      }
      return null;
    }

    function findVariable(identifier) {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable;
        scope = scope.upper;
      }
      return null;
    }

    function isConvexErrorImport(variable) {
      const definition = variable?.defs[0];
      if (definition?.type !== 'ImportBinding') return false;
      const node = definition.node;
      return (
        node.type === 'ImportSpecifier' &&
        node.imported.type === 'Identifier' &&
        node.imported.name === 'ConvexError' &&
        definition.parent?.source.value === CONVEX_VALUES_MODULE
      );
    }

    function isConvexValuesNamespaceImport(variable) {
      const definition = variable?.defs[0];
      return (
        definition?.type === 'ImportBinding' &&
        definition.node.type === 'ImportNamespaceSpecifier' &&
        definition.parent?.source.value === CONVEX_VALUES_MODULE
      );
    }

    function isConvexErrorReference(node) {
      if (node.type === 'Identifier') {
        return isConvexErrorImport(findVariable(node));
      }
      if (node.type !== 'MemberExpression') return false;
      if (getStaticPropertyName(node) !== 'ConvexError') return false;
      if (node.object.type !== 'Identifier') return false;
      return isConvexValuesNamespaceImport(findVariable(node.object));
    }

    return {
      NewExpression(node) {
        if (!isConvexErrorReference(node.callee)) return;
        context.report({
          node,
          messageId: 'noRawConvexError',
        });
      },
    };
  },
};

module.exports = {
  meta: {
    name: 'braket-convex',
  },
  rules: {
    'no-v-any': noVAnyRule,
    'no-raw-convex-error': noRawConvexErrorRule,
  },
};

module.exports.noVAnyRule = noVAnyRule;
module.exports.noRawConvexErrorRule = noRawConvexErrorRule;
