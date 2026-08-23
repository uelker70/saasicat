// A page takes at most five props. Anything more is a wiring exercise.
//
// The count is the visible half of the contract in ADR 0008: `TenantsPage` took
// 23, `BundlesPage` 22, `PilotsPage` 21, and mounting one of them in a consumer
// app cost between 8 and 145 lines of glue with no rule saying which. The
// ceiling is what makes the number a decision rather than a drift.
//
// The limit per directory is configuration, not a constant here: `src/ui/`
// primitives legitimately take more than a page does, and a rule that hard-codes
// the tree cannot be reused by a consumer who arranges theirs differently.

/** @type {import('eslint').Rule.RuleModule} */
export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'limit the number of props a component declares, per directory',
        },
        schema: [
            {
                type: 'object',
                additionalProperties: { type: 'integer', minimum: 1 },
            },
        ],
        messages: {
            tooMany:
                '{{count}} props in {{directory}} — the ceiling is {{limit}}. ' +
                'Data belongs in a resource, presentation in `options`; see ADR 0008.',
        },
    },

    create(context) {
        const [limits = {}] = context.options;
        const filename = context.filename ?? context.getFilename();

        const directory = Object.keys(limits)
            .filter((prefix) => filename.includes(prefix))
            // The longest match wins, so `src/ui/page` can be stricter than `src/ui`.
            .sort((a, b) => b.length - a.length)[0];
        if (!directory) return {};

        return {
            CallExpression(node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineProps') return;

                const [typeArgument] =
                    node.typeArguments?.params ?? node.typeParameters?.params ?? [];
                const count = countMembers(typeArgument) ?? countProperties(node.arguments[0]);
                if (count === null) return;

                const limit = limits[directory];
                if (count > limit) {
                    context.report({
                        node,
                        messageId: 'tooMany',
                        data: { count: String(count), limit: String(limit), directory },
                    });
                }
            },
        };
    },
};

/** `defineProps<{ a: X; b: Y }>()` */
function countMembers(typeArgument) {
    if (!typeArgument || typeArgument.type !== 'TSTypeLiteral') return null;
    return typeArgument.members.filter((member) => member.type === 'TSPropertySignature').length;
}

/** `defineProps({ a: String })` — the runtime form, still counted. */
function countProperties(argument) {
    if (!argument || argument.type !== 'ObjectExpression') return null;
    return argument.properties.filter((property) => property.type === 'Property').length;
}
