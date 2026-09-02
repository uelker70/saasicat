// `docs/reference/ports.md` — every port an application can implement.
//
// A port is the seam between the platform and a store or a side effect, and the
// list of them is the honest answer to "what do I have to write?". It is read
// off the interfaces in `@saasicat/core`, with each method's own doc comment,
// because a hand-kept list of sixteen interfaces and their methods is a
// promise that goes stale on the first rename.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const TARGET = 'docs/reference/ports.md';

const PORTS_DIR = 'packages/core/src/ports';

/** A file's name says which area its ports belong to. */
const AREA = {
    'admin-ports.types.ts': 'Administration',
    'billing-ports.types.ts': 'Billing',
    'catalog-ports.types.ts': 'Catalogue',
    'checkout-ports.types.ts': 'Checkout',
    'core-ports.types.ts': 'Core',
    'persistence-ports.types.ts': 'Persistence bundles',
    'promo-ports.types.ts': 'Promo codes',
    'settings-ports.types.ts': 'Configuration',
};

/**
 * Every interface in the ports directory, by name, with the text it came from.
 *
 * One index over all the files rather than one per file: heritage crosses file
 * boundaries, and resolving it per file means a base one directory over is
 * silently missing from the member list. That is the same defect this
 * generator was already caught with once, one boundary away.
 */
export function indexDeclarations(files) {
    const index = new Map();
    for (const { file, text } of files) {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        for (const statement of source.statements) {
            if (ts.isInterfaceDeclaration(statement)) {
                index.set(statement.name.text, { declaration: statement, source, text });
            }
        }
    }
    return index;
}

/**
 * The interfaces whose name ends in `Port`, with their methods.
 *
 * Inherited members count. `UserManagementPort extends SuperAdminProvisioningPort`,
 * and an implementer has to write `countSuperAdmins()` and `createSuperAdmin()`
 * whether or not that interface declares them itself — a page that claims to
 * list every member and skips two is worse than one that never claimed it.
 *
 * A base the index does not hold is an error rather than an omission: it means
 * the port extends something outside this directory, and the page would then
 * be quietly incomplete in exactly the way it promises not to be.
 */
export function portsIn(file, index) {
    const membersOf = (name, seen = new Set()) => {
        if (seen.has(name)) return [];
        seen.add(name);

        const entry = index.get(name);
        if (!entry) throw new Error(`${name} extends something outside ${PORTS_DIR}`);
        const { declaration, source, text } = entry;

        const inherited = (declaration.heritageClauses ?? []).flatMap((clause) =>
            clause.types.flatMap((type) => membersOf(type.expression.getText(), seen)),
        );

        const own = declaration.members
            .filter((member) => ts.isMethodSignature(member) || ts.isPropertySignature(member))
            .map((member) => ({
                name: member.name.getText(),
                signature: oneLine(member.getText(source)),
                summary: leadingSummary(text, member.getFullStart()),
            }));

        return [...inherited, ...own];
    };

    const found = [];
    for (const [name, entry] of index) {
        if (!name.endsWith('Port')) continue;
        if (entry.declaration.getSourceFile().fileName !== file) continue;
        found.push({
            name,
            summary: leadingSummary(entry.text, entry.declaration.getFullStart()),
            members: membersOf(name),
        });
    }
    return found;
}

/** The first sentence of the doc comment attached to a node, if it has one. */
function leadingSummary(text, fullStart) {
    const ranges = ts.getLeadingCommentRanges(text, fullStart) ?? [];
    const last = ranges[ranges.length - 1];
    if (!last) return '';
    const comment = text.slice(last.pos, last.end);
    const body = comment
        .split('\n')
        .map((line) => line.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)/, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace('*/', '')
        .trim();
    const stop = body.indexOf('. ');
    return (stop === -1 ? body : body.slice(0, stop + 1)).trim();
}

/**
 * A signature on one line, without the member terminator.
 *
 * The terminator is the LAST semicolon, not the first: `replace(';', '')` on
 * `write(input: { actor: AdminActor; entity: string })` takes the one inside
 * the object type and leaves the real one standing, which is what the shipped
 * page carried until this was found — a signature an adapter author copies and
 * cannot compile.
 */
function oneLine(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
        .replace(/;$/, '')
        .replaceAll('|', '\\|');
}

export async function render({ root }) {
    const sections = [];
    let total = 0;

    const files = readdirSync(join(root, PORTS_DIR))
        .filter((file) => file.endsWith('.ts'))
        .sort()
        .map((file) => ({ file, text: readFileSync(join(root, PORTS_DIR, file), 'utf8') }));
    const index = indexDeclarations(files);

    for (const { file } of files) {
        const area = AREA[file];
        if (!area) throw new Error(`${file} is new — give it a heading in ports.mjs`);

        const ports = portsIn(file, index);
        if (!ports.length) continue;
        total += ports.length;

        const blocks = ports.map((port) => {
            const rows = port.members
                .map((member) => `| \`${member.signature}\` | ${member.summary || '—'} |`)
                .join('\n');
            return (
                `### \`${port.name}\`\n\n${port.summary || ''}\n\n` +
                (rows ? `| Member | What it does |\n| ------ | ------------ |\n${rows}` : '')
            ).replace('\n\n\n', '\n\n');
        });

        sections.push(`## ${area}\n\n${blocks.join('\n\n')}`);
    }

    if (total < 10) throw new Error(`only ${total} ports found — has the directory moved?`);

    return [
        '# Ports',
        '',
        'Every seam between the platform and something it cannot own: a database, an',
        'audit trail, an MFA secret, a tenant list. You implement the ones your',
        'integration needs and bind them at module registration;',
        '`@saasicat/adapter-prisma` and `@saasicat/adapter-drizzle` implement most of',
        'them against the canonical schema already.',
        '',
        'Why the seam is here, and what an adapter may and may not decide:',
        '[ADR 0007](../explanation/adr/0007-ports-and-adapters.md).',
        '',
        `Generated from \`${PORTS_DIR}\` — ${total} ports. Do not edit by hand:`,
        '`node scripts/gen-docs/index.mjs --write`.',
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}
