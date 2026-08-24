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
// The same rule answers the opposite question one package over. In
// `@saasicat/ui-vue-tenant` no Quasar component is right, because those
// components render inside the customer's application and a guest does not
// bring a framework (ADR 0010). Naming five there would be a list that goes
// stale the day Quasar adds a sixth, so that side uses `prefixes` — a namespace
// rather than an enumeration — and the two directions stay one rule.
//
// Three source-scanning regexes did this before. This reads the template AST,
// so a component in a comment or a string no longer trips it.
//
// It reads the tag in both spellings Vue accepts. `<q-dialog>` and `<QDialog>`
// resolve to one component, and this repository writes its OWN components
// PascalCase in templates (`<AdminPage>`, `<AdminTable>`) and only Quasar's
// kebab — so a contributor following the visible house style reaches for
// `<QDialog>`, which is exactly the spelling a kebab-only lookup lets past.

/** `QDialog` → `q-dialog`; a name already kebab is returned unchanged. */
function kebabCase(name) {
    let out = '';
    for (const [index, character] of [...name].entries()) {
        const lower = character.toLowerCase();
        if (character !== lower && index > 0) out += '-';
        out += lower;
    }
    return out;
}

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
                    /**
                     * Whole namespaces, for the case where the answer is "none
                     * of them": `{ 'q-': 'a plain element or …' }` refuses every
                     * component whose kebab name starts with `q-`.
                     */
                    prefixes: {
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
            // A separate sentence, because the namespace case is the opposite
            // claim: there the component is not "already answered by a
            // primitive", it is not available in this package at all.
            outside: '`<{{name}}>` is not available in this package. Use `{{use}}`.',
        },
    },

    create(context) {
        const [{ components = {}, prefixes = {}, allow = [] } = {}] = context.options;
        const filename = context.filename ?? context.getFilename();
        if (allow.some((allowed) => filename.includes(allowed))) return {};

        const parserServices = context.sourceCode.parserServices ?? context.parserServices;
        const template = parserServices?.defineTemplateBodyVisitor;
        if (!template) return {};

        return template({
            VElement(node) {
                const name = kebabCase(node.rawName);
                // A named component wins over its namespace: the specific
                // replacement is the more useful sentence to read.
                if (components[name]) {
                    context.report({
                        node,
                        messageId: 'restricted',
                        data: { name: node.rawName, use: components[name] },
                    });
                    return;
                }
                const namespaced = Object.entries(prefixes).find(([prefix]) =>
                    name.startsWith(prefix),
                );
                if (namespaced) {
                    context.report({
                        node,
                        messageId: 'outside',
                        data: { name: node.rawName, use: namespaced[1] },
                    });
                }
            },
        });
    },
};
