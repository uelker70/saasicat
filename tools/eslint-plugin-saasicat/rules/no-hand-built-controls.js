// A control the design system already ships is not written again by hand.
//
// The package had eight independent `input` implementations under eight
// prefixes and six `button` families, together 784 lines of CSS reproducing
// what `q-input outlined dense` and `q-btn` give you — and what the theme's
// `field.css` and `button.css` already correct for dark mode, for focus, and
// for a dialog's teleported node. A consumer theming Quasar reached the
// filters and missed the editors.
//
// **What is still a `<button>`, and why.** An option surface is not a button
// that needs restyling: a segmented card with two lines of text, a plan chip
// with a colour mark, a bar in a chart, a disclosure trigger that owns
// `aria-expanded`. Quasar ships no component for those, and `q-btn` would have
// to be fought into shape. They stay native, and they say so at the element —
// the tag carries the reason, not a list in this file, because the next person
// to look is looking at the element.

/** @type {import('eslint').Rule.RuleModule} */
export default {
    meta: {
        type: 'problem',
        docs: { description: 'forbid hand-built form controls where a component exists' },
        schema: [
            {
                type: 'object',
                properties: {
                    components: { type: 'object', additionalProperties: { type: 'string' } },
                    allow: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            handBuilt:
                '`<{{name}}>` is a control the design system ships: use `{{use}}`. ' +
                'A hand-built one misses the theme corrections and every Quasar-level ' +
                'setting a consumer makes. If this is an option surface rather than a ' +
                'control, say so with `{{tag}}` on the element.',
        },
    },

    create(context) {
        const [{ components = {}, allow = [] } = {}] = context.options;
        const filename = context.filename ?? context.getFilename();
        if (allow.some((allowed) => filename.includes(allowed))) return {};

        const parserServices = context.sourceCode.parserServices ?? context.parserServices;
        const template = parserServices?.defineTemplateBodyVisitor;
        if (!template) return {};

        // A template comment is not a script comment: `sourceCode.getAllComments()`
        // reads the `<script>` block and returns nothing for the markup. The
        // parser keeps the template's own on the template body, and that is
        // where the declaration a reader writes above the element lives.
        const templateComments = context.sourceCode.ast.templateBody?.comments ?? [];

        return template({
            VElement(node) {
                const name = node.rawName;
                const use = components[name];
                if (!use || declaresException(templateComments, node)) return;
                context.report({
                    node,
                    messageId: 'handBuilt',
                    data: { name, use, tag: EXCEPTION_TAG },
                });
            },
        });
    },
};

/**
 * The comment a native control keeps itself with.
 *
 * Immediately above the element, in the template, and it has to say something:
 * the shape this guards against is a tag that acquires an exception because
 * somebody was in a hurry, and a 30-character reason is a low bar that a hurry
 * does not clear.
 */
const EXCEPTION_TAG = '@optionSurface';
const MIN_REASON = 30;

function declaresException(comments, node) {
    for (const comment of comments) {
        if (!comment.value.includes(EXCEPTION_TAG)) continue;
        if (comment.loc.end.line >= node.loc.start.line) continue;
        if (node.loc.start.line - comment.loc.end.line > 2) continue;
        const reason = comment.value.split(EXCEPTION_TAG)[1] ?? '';
        if (reason.replace(/\s+/g, ' ').trim().length >= MIN_REASON) return true;
    }
    return false;
}
