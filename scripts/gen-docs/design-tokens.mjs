// `docs/reference/design-tokens.md` — every `--sa-*` a consumer may read or
// override, with the layer it belongs to and its value in both themes.
//
// The design guide explains the three layers and when to reach for which. This
// page is the lookup beside it: a name, a value, and — for a role — what it
// becomes in the dark theme. Neither can be maintained by hand at this size,
// and a stale token list is worse than none: it invites an override of a name
// that no longer resolves, which fails silently.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TARGET = 'docs/reference/design-tokens.md';

const THEME = 'packages/ui-vue/src/ui/theme';

const LAYERS = [
    {
        file: 'tokens.primitive.css',
        title: 'Layer 1 — primitives',
        blurb:
            'The raw palette and the raw steps. Literals live here and nowhere ' +
            'else. Read these only when you are defining a role of your own.',
    },
    {
        file: 'tokens.scale.css',
        title: 'Layer 2 — scales',
        blurb:
            'Sizes, identical in every theme. Spacing, type, radii, shadows, ' +
            'z-index and motion. A component reads these directly.',
    },
];

/**
 * Declarations in a stylesheet, in source order.
 *
 * A hand-written scanner rather than a pattern: the values contain
 * parentheses, commas and nested `var()` calls, and the only thing that ends a
 * declaration is the first `;` at depth zero.
 */
/**
 * Blanks `/* … *\/` runs, keeping every other byte where it was.
 *
 * Prose mentions token names — this file's own comments do — and a scanner that
 * reads comments reads those as declarations. Blanking rather than deleting so
 * offsets still describe the file the caller passed in.
 *
 * Exported because this repository has now made the same mistake four times in
 * one afternoon: token names read out of prose here, a `describe(` read out of
 * a doc comment in the suite guard, and a `{` inside a commented-out example
 * selector taken for the start of a block. One implementation, one answer.
 */
export function withoutComments(css) {
    let out = '';
    let index = 0;
    while (index < css.length) {
        const open = css.indexOf('/*', index);
        if (open === -1) return out + css.slice(index);
        const close = css.indexOf('*/', open + 2);
        const end = close === -1 ? css.length : close + 2;
        out += css.slice(index, open) + ' '.repeat(end - open);
        index = end;
    }
    return out;
}

export function declarations(source) {
    const css = withoutComments(source);
    const found = [];
    let index = 0;
    while (index < css.length) {
        const start = css.indexOf('--sa-', index);
        if (start === -1) break;
        const colon = css.indexOf(':', start);
        if (colon === -1) break;

        const name = css.slice(start, colon).trim();
        // A `var(--sa-x)` reference also starts with `--sa-`; a declaration is
        // one that begins a statement, so what precedes it is `{`, `;` or a
        // newline of whitespace.
        const before = css.slice(0, start).trimEnd();
        const previous = before.charAt(before.length - 1);
        if (!['{', ';', ''].includes(previous) || name.includes(' ')) {
            // Past the NAME, not past the colon. A rejected candidate's next
            // colon can belong to the declaration AFTER it — a `--sa-` in a
            // selector or an attribute value begins nothing and has no colon of
            // its own — so advancing there drops that declaration silently.
            // Not what emptied the roles table (blanking comments is), but the
            // same shape of mistake one line down.
            index = start + '--sa-'.length;
            continue;
        }

        let depth = 0;
        let end = colon + 1;
        while (end < css.length) {
            const character = css[end];
            if (character === '(') depth += 1;
            else if (character === ')') depth -= 1;
            else if (character === ';' && depth === 0) break;
            end += 1;
        }
        found.push({ name, value: css.slice(colon + 1, end).trim() });
        index = end + 1;
    }
    return found;
}

export async function render({ root }) {
    const read = (file) => readFileSync(join(root, THEME, file), 'utf8');

    const sections = LAYERS.map(({ file, title, blurb }) => {
        const rows = declarations(read(file));
        if (rows.length < 10) throw new Error(`${file}: only ${rows.length} tokens found`);
        const table = rows
            .map(({ name, value }) => `| \`${name}\` | \`${collapse(value)}\` |`)
            .join('\n');
        return `## ${title}\n\n${blurb}\n\n| Token | Value |\n| ----- | ----- |\n${table}`;
    });

    const light = new Map(
        declarations(read('tokens.semantic.light.css')).map((d) => [d.name, d.value]),
    );
    const dark = new Map(
        declarations(read('tokens.semantic.dark.css')).map((d) => [d.name, d.value]),
    );
    if (light.size < 20) throw new Error(`only ${light.size} roles found in the light theme`);

    const roles = [...light.keys()]
        .map((name) => {
            const other = dark.get(name);
            if (other === undefined) throw new Error(`${name} is declared in light only`);
            return `| \`${name}\` | \`${collapse(light.get(name))}\` | \`${collapse(other)}\` |`;
        })
        .join('\n');

    sections.push(
        '## Layer 3 — roles\n\n' +
            'What a colour is *for*. This is the layer a consumer overrides, and\n' +
            'the only one that differs between themes. Both themes declare the same\n' +
            'keys — a role in one and not the other is a page that goes unreadable\n' +
            'the moment somebody flips the switch.\n\n' +
            `| Role | Light | Dark |\n| ---- | ----- | ---- |\n${roles}`,
    );

    return [
        '# Design tokens',
        '',
        'Every `--sa-*` the admin UI declares, by layer. The rules for using them —',
        'which layer to read, what may not appear where, and the contrast floor a',
        'role has to clear — are in the',
        '[design guide](../explanation/design-guide.md).',
        '',
        `Generated from \`${THEME}\`. Do not edit by hand:`,
        '`node scripts/gen-docs/index.mjs --write`.',
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}

/** Multi-line values (gradients, shadows) become one line in a table cell. */
function collapse(value) {
    return value
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
        .replaceAll('|', '\\|');
}
