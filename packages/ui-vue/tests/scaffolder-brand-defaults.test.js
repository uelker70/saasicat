import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The visual fixture must brand itself the way a scaffolded app does.
//
// `--sa-color-accent` reads Quasar's `--q-primary`, so the brand colour is an
// INPUT to every colour the baselines record. A fixture branded differently
// measures a screen no user ever sees — and that is not hypothetical twice
// over: the first fixture carried Quasar's stock palette under a comment
// claiming to be the scaffolder's defaults, and its replacement had drifted
// from the scaffolder on `$warning` while the same comment still claimed
// agreement. Both were Sass files restating a value. This compares the two
// declarations that remain.

const SCAFFOLDER = fileURLToPath(
    new URL('../../create-saasicat-admin/templates/src/main.ts.tpl', import.meta.url),
);
const FIXTURE = fileURLToPath(new URL('./e2e/visual/main.ts', import.meta.url));

/** The `color:` of the `brand` option the scaffolder writes into a new app. */
function scaffolderBrandColour() {
    const source = readFileSync(SCAFFOLDER, 'utf8');
    const brand = source.indexOf('brand:');
    assert.notEqual(brand, -1, 'the scaffolder template no longer declares a `brand` option');
    const end = source.indexOf('}', brand);
    return /\bcolor:\s*'(#[0-9a-fA-F]+)'/.exec(source.slice(brand, end))?.[1];
}

/** The colour the fixture hands to the shipped brand bridge. */
function fixtureBrandColour() {
    const source = readFileSync(FIXTURE, 'utf8');
    const name = /applyBrandColour\(([A-Za-z0-9_$]+)\)/.exec(source)?.[1];
    if (!name) return undefined;
    // `indexOf` and not a regex built from `name`: the repository forbids
    // turning a value read from a file into a pattern, and hand-escaping it
    // would be the incomplete kind CodeQL flags.
    const declaration = source.indexOf(`const ${name} =`);
    if (declaration === -1) return undefined;
    return /'(#[0-9a-fA-F]+)'/.exec(
        source.slice(declaration, source.indexOf(';', declaration)),
    )?.[1];
}

describe('the visual fixture brands itself like a scaffolded app', () => {
    test('both declarations are found', () => {
        // Without this the comparison below passes vacuously on two undefineds
        // — a renamed option or a moved constant would read as agreement, which
        // is the failure mode this file exists to prevent.
        assert.match(
            String(scaffolderBrandColour()),
            /^#[0-9a-fA-F]{3,8}$/,
            'no brand colour found in the scaffolder template',
        );
        assert.match(
            String(fixtureBrandColour()),
            /^#[0-9a-fA-F]{3,8}$/,
            'no brand colour found in the visual fixture',
        );
    });

    test('they are the same colour', () => {
        assert.equal(
            fixtureBrandColour(),
            scaffolderBrandColour(),
            'the visual baselines would record a brand no scaffolded app ships',
        );
    });

    test('the fixture declares no palette of its own', () => {
        // The four status tones are the platform's own roles, handed to Quasar
        // by the theme stylesheet the fixture loads. Restating them is exactly
        // how the last two fixtures drifted.
        const source = readFileSync(FIXTURE, 'utf8');
        // Not "does it write --q-warning" but "can it write anything at all":
        // a fixture without `setCssVar` cannot restate a role however it is
        // formatted, and the check does not depend on Prettier's spacing.
        assert.doesNotMatch(
            source,
            /setCssVar/,
            'the fixture writes Quasar variables itself instead of going through the bridge',
        );
    });
});
