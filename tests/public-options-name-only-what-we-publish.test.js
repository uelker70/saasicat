// A public option type may not require a package the consumer no longer installs.
//
// `TenantDetailPageOptions.userColumns` is `QTableColumn[]` — Quasar's type, in
// this package's own exported interface. That was harmless while `quasar` was a
// peer dependency the consumer declared. Since ADR 0011 they do not, and the
// example's own page still did `import type { QTableColumn } from 'quasar'`:
// it typechecked on this machine, where pnpm's store happens to be reachable,
// and failed in a clean container. The Docker build is what said so.
//
// Both ends are read from the sources. The types come out of what the exported
// components import from `quasar`; whether each is published comes out of the
// built `quasar` entry's declaration. Naming `QTableColumn` here would keep
// passing on the day a second type leaks in.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'packages/ui-vue/src');
const QUASAR_TYPES = join(ROOT, 'packages/ui-vue/dist/quasar/index.d.ts');

/** The directories the export map hands to a consumer. */
const EXPORTED = ['pages', 'layouts', 'auth', 'ui'];

function componentsUnder(directory, found = []) {
    if (!existsSync(directory)) return found;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) componentsUnder(full, found);
        else if (entry.name.endsWith('.vue')) found.push(full);
    }
    return found;
}

/** The `export interface … { … }` bodies in a single-file component. */
function exportedInterfaces(text) {
    const bodies = [];
    let at = text.indexOf('export interface');
    while (at !== -1) {
        const open = text.indexOf('{', at);
        if (open === -1) break;
        // Brace counting rather than a lazy pattern: an option type holds
        // nested object literals, and the first `}` is not the end of it.
        let depth = 0;
        let index = open;
        for (; index < text.length; index++) {
            if (text[index] === '{') depth += 1;
            else if (text[index] === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        bodies.push(text.slice(open, index));
        at = text.indexOf('export interface', index);
    }
    return bodies;
}

/**
 * The identifiers a text contains, as a set.
 *
 * A `new RegExp(`\\b${name}\\b`)` would be the short way and the repository's
 * own rule refuses it — a name is a value, and a value in a pattern is the
 * shape CodeQL reports. Tokenising answers the same question with one forward
 * walk and no way for a name with a metacharacter in it to mean something else.
 */
function identifiersIn(text) {
    const names = new Set();
    let start = -1;
    for (let index = 0; index <= text.length; index++) {
        const isName = index < text.length && /[\w$]/.test(text[index]);
        if (isName) {
            if (start === -1) start = index;
            continue;
        }
        if (start !== -1) {
            names.add(text.slice(start, index));
            start = -1;
        }
    }
    return names;
}

/** Quasar types an exported component names inside an exported interface. */
function leakedTypes() {
    const leaked = new Map();
    for (const directory of EXPORTED) {
        for (const file of componentsUnder(join(SRC, directory))) {
            const text = readFileSync(file, 'utf8');
            const imported = [...text.matchAll(/import type \{([^}]*)\} from 'quasar'/g)]
                .flatMap((match) => match[1].split(','))
                .map((name) => name.trim())
                .filter(Boolean);
            if (imported.length === 0) continue;

            const named = exportedInterfaces(text).flatMap((body) => [...identifiersIn(body)]);
            const inAnInterface = new Set(named);
            for (const name of imported) {
                if (inAnInterface.has(name)) leaked.set(name, file.slice(SRC.length + 1));
            }
        }
    }
    return leaked;
}

describe('a public option type names only types this package publishes', () => {
    const leaked = leakedTypes();

    test('the sweep found the components and their interfaces', () => {
        // Vacuously true against an empty tree, which a moved directory gives.
        assert.ok(
            componentsUnder(join(SRC, 'pages')).length >= 10,
            'no exported pages found — update this test or restore them',
        );
    });

    test('every Quasar type in an exported interface is re-exported', () => {
        assert.ok(
            existsSync(QUASAR_TYPES),
            `${QUASAR_TYPES} is missing — run the build before this test`,
        );
        const published = identifiersIn(readFileSync(QUASAR_TYPES, 'utf8'));

        const unpublished = [...leaked]
            .filter(([name]) => !published.has(name))
            .map(([name, file]) => `${name} (${file})`);

        assert.deepEqual(
            unpublished,
            [],
            'These appear in an option type a consumer fills in, and they cannot name them: ' +
                'since ADR 0011 a consumer does not install `quasar`. Re-export the type from ' +
                '`src/quasar/index.ts` — a type-only re-export reaches no bundle.',
        );
    });
});
