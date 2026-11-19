import { GraphQLError, Kind } from 'graphql';

// Introspection is disabled in production, and tools such as Apollo Sandbox
// need deeply nested introspection queries, so these subtrees are not counted.
const INTROSPECTION_FIELDS = new Set(['__schema', '__type']);

/**
 * Validation rule rejecting operations whose fields nest deeper than
 * `maxDepth`, e.g. `{ users { posts { title } } }` has depth 3. This stops
 * clients from walking cyclic relations (user → posts → author → posts …)
 * without bound. Fragment depths are memoized, so repeated spreads stay linear.
 */
export function createDepthLimitRule(maxDepth) {
  return (context) => {
    const fragmentDepths = new Map();

    function selectionSetDepth(selectionSet, visiting) {
      let depth = 0;
      for (const selection of selectionSet.selections) {
        depth = Math.max(depth, selectionDepth(selection, visiting));
      }
      return depth;
    }

    function selectionDepth(selection, visiting) {
      switch (selection.kind) {
        case Kind.FIELD:
          if (INTROSPECTION_FIELDS.has(selection.name.value)) return 0;
          return 1 + (selection.selectionSet ? selectionSetDepth(selection.selectionSet, visiting) : 0);
        case Kind.INLINE_FRAGMENT:
          return selectionSetDepth(selection.selectionSet, visiting);
        case Kind.FRAGMENT_SPREAD:
          return fragmentDepth(selection.name.value, visiting);
        default:
          return 0;
      }
    }

    function fragmentDepth(name, visiting) {
      if (fragmentDepths.has(name)) return fragmentDepths.get(name);
      const fragment = context.getFragment(name);
      // Unknown fragments and fragment cycles are reported by graphql-js' own rules.
      if (!fragment || visiting.has(name)) return 0;

      visiting.add(name);
      const depth = selectionSetDepth(fragment.selectionSet, visiting);
      visiting.delete(name);
      fragmentDepths.set(name, depth);
      return depth;
    }

    return {
      OperationDefinition(node) {
        const depth = selectionSetDepth(node.selectionSet, new Set());
        if (depth > maxDepth) {
          const operation = node.name ? `Operation "${node.name.value}"` : 'Anonymous operation';
          context.reportError(
            new GraphQLError(`${operation} has depth ${depth}, which exceeds the maximum query depth of ${maxDepth}.`, {
              nodes: [node],
            })
          );
        }
      },
    };
  };
}
