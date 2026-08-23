// Every request goes through the injected `HttpClient`. Nothing calls `fetch`.
//
// Three raw fallbacks existed, and each of them lost the consumer's auth header
// silently: the request went out, the server answered 401, and the page showed
// an empty list rather than a failure. The registry refuses to start without a
// client now, so a fallback cannot even be reached — but it can still be
// written, and this is what stops it being written.
//
// `axios` is the second half. `createAxiosHttpClient` is typed structurally and
// imports nothing, which is what keeps axios out of a consumer's install; an
// `import axios from 'axios'` anywhere in the package would undo that.

/** @type {import('eslint').Rule.RuleModule} */
export default {
    meta: {
        type: 'problem',
        docs: { description: 'forbid raw fetch and axios outside the HTTP adapters' },
        schema: [
            {
                type: 'object',
                properties: {
                    allow: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            fetch:
                'Raw `fetch()` — take the injected HttpClient. A request outside it ' +
                "carries none of the app's auth, and answers 401 into an empty list.",
            axios: 'Importing axios here makes it a dependency of every consumer. `createAxiosHttpClient` is structural on purpose.',
        },
    },

    create(context) {
        const [{ allow = [] } = {}] = context.options;
        const filename = context.filename ?? context.getFilename();
        if (allow.some((allowed) => filename.includes(allowed))) return {};

        return {
            CallExpression(node) {
                const callee = node.callee;
                const isBare = callee.type === 'Identifier' && callee.name === 'fetch';
                const isGlobal =
                    callee.type === 'MemberExpression' &&
                    callee.property.type === 'Identifier' &&
                    callee.property.name === 'fetch' &&
                    callee.object.type === 'Identifier' &&
                    ['window', 'globalThis', 'self'].includes(callee.object.name);
                if (isBare || isGlobal) context.report({ node, messageId: 'fetch' });
            },

            ImportDeclaration(node) {
                const source = node.source.value;
                if (typeof source !== 'string') return;
                if (source === 'axios' || source.startsWith('axios/')) {
                    context.report({ node, messageId: 'axios' });
                }
            },
        };
    },
};
