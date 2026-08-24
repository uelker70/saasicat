// `docs/reference/ui-primitives.md` — the `Admin*` roster and what each takes.
//
// The design guide names the roster and says when to reach for a primitive
// rather than a Quasar component. This page is the props lookup beside it, read
// off the `defineProps<{…}>()` of each SFC together with the emits it declares.
//
// A hand-written version of this page is the defect one level up: it would go
// stale on the first added prop, and a reader would pass an option that does
// nothing.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export const TARGET = 'docs/reference/ui-primitives.md';

const UI_DIR = 'packages/ui-vue/src/ui';

/** Group headings, keyed by the directory the component sits in. */
const GROUP = {
    page: 'Page skeleton',
    data: 'Data display',
    feedback: 'Feedback',
    overlay: 'Dialogs',
    entitlement: 'Entitlement',
};

function sfcFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) sfcFiles(path, out);
        else if (entry.endsWith('.vue')) out.push(path);
    }
    return out;
}

/** The `<script setup>` block of an SFC, without a parser dependency. */
export function scriptSetup(sfc) {
    const open = sfc.indexOf('<script setup');
    if (open === -1) return null;
    const start = sfc.indexOf('>', open);
    const end = sfc.indexOf('</script>', start);
    if (start === -1 || end === -1) return null;
    return sfc.slice(start + 1, end);
}

/** Props and emits a component declares, from its `defineProps`/`defineEmits`. */
export function componentApi(script, file) {
    const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true);
    const props = [];
    const emits = [];

    const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const [typeArgument] = node.typeArguments ?? [];
            if (node.expression.text === 'defineProps' && typeArgument) {
                if (!ts.isTypeLiteralNode(typeArgument)) {
                    throw new Error(
                        `${file}: defineProps takes a named type, which this cannot read`,
                    );
                }
                for (const member of typeArgument.members) {
                    if (!ts.isPropertySignature(member)) continue;
                    props.push({
                        name: member.name.getText(),
                        optional: Boolean(member.questionToken),
                        type: member.type ? oneLine(member.type.getText()) : 'unknown',
                    });
                }
            }
            if (node.expression.text === 'defineEmits' && typeArgument) {
                emits.push(...emitNames(typeArgument));
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return { props, emits };
}

/**
 * The event names in a `defineEmits` type argument, in either form Vue accepts.
 *
 * `{ (e: 'save', value: X): void }` is the call-signature form, and
 * `{ 'update:open': [value: boolean] }` is the named-tuple one — `AdminAccordion`
 * uses the second, and reading only the first left its event out of the page.
 */
function emitNames(typeNode) {
    const names = [];
    if (!ts.isTypeLiteralNode(typeNode)) return names;
    for (const member of typeNode.members) {
        if (ts.isCallSignatureDeclaration(member)) {
            const [event] = member.parameters;
            const literal = event?.type;
            if (literal && ts.isLiteralTypeNode(literal) && ts.isStringLiteral(literal.literal)) {
                names.push(literal.literal.text);
            }
            continue;
        }
        if (ts.isPropertySignature(member)) {
            const name = member.name;
            if (ts.isStringLiteral(name) || ts.isIdentifier(name)) names.push(name.text);
        }
    }
    return names;
}

function oneLine(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
        .replaceAll('|', '\\|');
}

export async function render({ root }) {
    const groups = new Map();
    let total = 0;

    for (const file of sfcFiles(join(root, UI_DIR)).sort()) {
        const name = file.slice(file.lastIndexOf('/') + 1, -'.vue'.length);
        if (!name.startsWith('Admin')) continue;

        const directory = relative(join(root, UI_DIR), file).split('/')[0];
        const heading = GROUP[directory];
        if (!heading)
            throw new Error(`${directory}/ is new — give it a heading in ui-primitives.mjs`);

        const script = scriptSetup(readFileSync(file, 'utf8'));
        if (!script) throw new Error(`${file} has no <script setup>`);
        const { props, emits } = componentApi(script, file);

        const rows = props.length
            ? props
                  .map(
                      ({ name: prop, optional, type }) =>
                          `| \`${prop}\` | \`${type}\` | ${optional ? 'optional' : '**required**'} |`,
                  )
                  .join('\n')
            : null;

        const block = [
            `### \`<${name}>\``,
            '',
            rows
                ? `| Prop | Type | |\n| ---- | ---- | - |\n${rows}`
                : 'Takes no props — it is composed through its slots.',
            emits.length ? `\nEmits: ${emits.map((e) => `\`${e}\``).join(', ')}.` : '',
        ]
            .join('\n')
            .trimEnd();

        groups.set(heading, [...(groups.get(heading) ?? []), block]);
        total += 1;
    }

    if (total < 15) throw new Error(`only ${total} Admin* components found — has src/ui moved?`);

    const sections = Object.values(GROUP)
        .filter((heading) => groups.has(heading))
        .map((heading) => `## ${heading}\n\n${groups.get(heading).join('\n\n')}`);

    return [
        '# UI primitives',
        '',
        'The `Admin*` roster: the components a standard admin page is built from.',
        'Anything not on this list comes from Quasar directly and is styled through',
        'the theme — buttons, inputs, tabs and badges are Quasar components, and',
        'wrapping them would add a layer that only forwards.',
        '',
        'When to reach for which, and the page recipe they assemble into, are in the',
        '[design guide](../explanation/design-guide.md).',
        '',
        `Generated from \`${UI_DIR}\` — ${total} components. Do not edit by hand:`,
        '`node scripts/gen-docs/index.mjs --write`.',
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}
