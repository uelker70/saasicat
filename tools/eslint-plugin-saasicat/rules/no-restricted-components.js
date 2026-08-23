// A Quasar shell component belongs to `src/ui/`, not to a page.
//
// `<q-dialog>`, `<q-table>`, `<q-card>`, `<q-banner>`, `<q-page>` are the five a
// page reached for when a primitive was missing, and each time the page then
// owned a piece of the design system: its own dialog padding, its own table
// header, its own empty state. That is how eight files ended up declaring the
// same bordered pill with different tokens.
//
// The roster exists to answer these five (`AdminDialog`, `AdminTable`,
// `AdminSection`, `AdminBanner`, `AdminPage`). Everything else Quasar ships is
// fair game — a button is a button, and wrapping it would add a layer that only
// forwards.
//
// Three source-scanning regexes did this before. This reads the template AST,
// so a component in a comment or a string no longer trips it.

/** @type {import('eslint').Rule.RuleModule} */
export default {
    meta: {
        type: 'problem',
        docs: { description: 'forbid framework components a primitive already answers' },
        schema: [
            {
                type: 'object',
                properties: {
                    components: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                    },
                    allow: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            restricted: '`<{{name}}>` belongs to the design system. Use `{{use}}`.',
        },
    },

    create(context) {
        const [{ components = {}, allow = [] } = {}] = context.options;
        const filename = context.filename ?? context.getFilename();
        if (allow.some((allowed) => filename.includes(allowed))) return {};

        const parserServices = context.sourceCode.parserServices ?? context.parserServices;
        const template = parserServices?.defineTemplateBodyVisitor;
        if (!template) return {};

        return template({
            VElement(node) {
                const name = node.rawName;
                const use = components[name];
                if (use) context.report({ node, messageId: 'restricted', data: { name, use } });
            },
        });
    },
};
