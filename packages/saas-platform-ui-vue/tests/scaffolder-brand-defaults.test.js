import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The visual fixture must brand itself the way a scaffolded app does.
//
// Since the accent and the four status roles read Quasar's `--q-*` variables,
// the brand variables are an INPUT to every colour the baselines record. A
// fixture with different ones measures a screen no user ever sees — and that is
// not hypothetical: the previous fixture carried Quasar's stock palette under a
// comment claiming "these are the defaults the scaffolder emits", and the two
// had diverged on five of seven values.

const TEMPLATE = fileURLToPath(
    new URL('../../create-saasicat-admin/templates/src/styles/theme.scss.tpl', import.meta.url),
);
const FIXTURE = fileURLToPath(new URL('../tests-e2e/visual/theme.scss', import.meta.url));

/** `$name: #value;` pairs, ignoring comments and blank lines. */
function brandVariables(path) {
    const found = new Map();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const match = /^\s*\$([a-z-]+)\s*:\s*([^;]+);/.exec(line);
        if (match) found.set(match[1], match[2].trim());
    }
    return found;
}

describe('the visual fixture brands itself like a scaffolded app', () => {
    const template = brandVariables(TEMPLATE);
    const fixture = brandVariables(FIXTURE);

    test('the template declares the brand variables the platform reads', () => {
        // Without this the next two assertions pass vacuously on an empty map —
        // a renamed template or a changed syntax would read as agreement.
        assert.deepEqual(
            [...template.keys()].sort(),
            ['accent', 'info', 'negative', 'positive', 'primary', 'secondary', 'warning'],
            'the scaffolder template no longer declares the expected brand variables',
        );
    });

    test('fixture and template agree on every value', () => {
        for (const [name, value] of template) {
            assert.equal(
                fixture.get(name),
                value,
                `$${name} is ${fixture.get(name)} in the visual fixture and ${value} in the ` +
                    `scaffolder template. The baselines would record a brand no app ships.`,
            );
        }
    });

    test('the fixture adds no brand variable of its own', () => {
        assert.deepEqual([...fixture.keys()].sort(), [...template.keys()].sort());
    });
});
