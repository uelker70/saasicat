// A page takes no callback props. This is the machine form of ADR 0008.
//
// A function prop is an unbounded contract: the page invents an argument shape,
// the consumer implements it, and the platform can neither check it nor extend
// it. Removing the last of them took phase 4 and 64 props; keeping them gone is
// this rule plus its sibling.
//
// **What this rule cannot see.** It reads one file with no type information, so
// `onSave?: () => void` falls here and `onSave?: SaveHandler` does not — an
// alias needs the checker. `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
// resolves every prop type through the compiler and catches that half, together
// with the `@pageContractException` declaration a genuine exception carries.
// The split is deliberate: ESLint sees a file and answers instantly in the
// editor, the test sees the tree.

/** @type {import('eslint').Rule.RuleModule} */
export default {
    meta: {
        type: 'problem',
        docs: { description: 'forbid function-typed props in the directories given' },
        schema: [
            {
                type: 'object',
                properties: {
                    directories: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            callback:
                '`{{name}}` is a callback prop. A page cannot take one: override the ' +
                'resource operation instead, which composes — see ADR 0008.',
        },
    },

    create(context) {
        const [{ directories = [] } = {}] = context.options;
        const filename = context.filename ?? context.getFilename();
        if (!directories.some((directory) => filename.includes(directory))) return {};

        return {
            CallExpression(node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineProps') return;

                const [typeArgument] =
                    node.typeArguments?.params ?? node.typeParameters?.params ?? [];
                if (!typeArgument || typeArgument.type !== 'TSTypeLiteral') return;

                for (const member of typeArgument.members) {
                    if (member.type !== 'TSPropertySignature') continue;
                    if (!isFunctionType(member.typeAnnotation?.typeAnnotation)) continue;
                    if (declaresException(context, member)) continue;
                    context.report({
                        node: member,
                        messageId: 'callback',
                        data: { name: nameOf(member) },
                    });
                }
            },
        };
    },
};

/**
 * The tag a prop uses to keep a callback, and what it has to carry.
 *
 * The same tag and the same minimum as
 * `pages-take-no-callbacks.test.js` — two guards asking one question have to
 * accept one answer, or the exception that satisfies the compiler-based half
 * lights up red in the editor and somebody deletes the wrong one.
 *
 * The reason lives at the prop, where a reader of that prop is already looking,
 * rather than in a list inside a rule.
 */
const EXCEPTION_TAG = '@pageContractException';
const MIN_REASON = 30;

function declaresException(context, member) {
    const comments = context.sourceCode.getCommentsBefore(member);
    for (const comment of comments) {
        const at = comment.value.indexOf(EXCEPTION_TAG);
        if (at === -1) continue;
        const reason = comment.value
            .slice(at + EXCEPTION_TAG.length)
            .replace(/[*\s]+/g, ' ')
            .trim();
        if (reason.length >= MIN_REASON) return true;
    }
    return false;
}

/** A function type, on its own or as one arm of a union with `undefined`. */
function isFunctionType(node) {
    if (!node) return false;
    if (node.type === 'TSFunctionType') return true;
    if (node.type === 'TSUnionType') return node.types.some(isFunctionType);
    return false;
}

function nameOf(member) {
    const key = member.key;
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'Literal') return String(key.value);
    return 'prop';
}
