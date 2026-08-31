// @requirement SC-UI-015 — One colour makes the administration look like the integrator's product
// @requirement SC-UI-016 — Light and dark are both shipped, and a person can pick

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    IDENTITY_ACCENTS,
    IDENTITY_ACCENT_VALUES,
    IDENTITY_NEUTRAL,
    IDENTITY_NEUTRAL_VALUE,
} from '../dist/client/index.js';

// The identity ramp exists twice, and the two copies have to stay one ramp.
//
// `IDENTITY_ACCENTS` are `var()` references — paint, and they follow the theme.
// `IDENTITY_ACCENT_VALUES` are concrete colours, for the places where a colour
// is DATA: a promotion's accent is picked by an operator, sent over the wire and
// stored, and `CreatePromotionDto` caps it at 16 characters.
//
// Pointing the promotion swatches at the token form broke every create and every
// colour edit — `var(--sa-color-identity-1)` is 28 characters and fails
// validation. It looked right, it type-checked, and nothing rendered wrong,
// because the damage is at a system boundary rather than on screen.
//
// So there are two assertions here and they guard different things: the values
// must match the theme (or the same ramp means two things), and they must satisfy
// the constraint the API actually enforces.

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const LIGHT = join(SRC, 'ui', 'theme', 'tokens.semantic.light.css');
const PRIMITIVE = join(SRC, 'ui', 'theme', 'tokens.primitive.css');

/** `--name: value;` pairs from a theme file, comments removed. */
function declarationsOf(path) {
    const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return new Map([...css.matchAll(/(--sa-[\w-]+)\s*:([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** Resolves a role through `var()` indirection to the hex it ends at. */
function resolve(expression, table, depth = 0) {
    if (depth > 8) return null;
    const value = expression.trim();
    if (value.startsWith('#')) return value.toLowerCase();
    const asVar = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    if (!asVar) return null;
    const declared = table.get(asVar[1]);
    return declared === undefined ? null : resolve(declared, table, depth + 1);
}

describe('the identity ramp is one ramp', () => {
    const table = new Map([...declarationsOf(PRIMITIVE), ...declarationsOf(LIGHT)]);

    test('the resolver reaches a hex at all', () => {
        // Without this every comparison below could pass on two nulls.
        assert.match(resolve(IDENTITY_ACCENTS[0], table) ?? '', /^#[0-9a-f]{6}$/);
    });

    test('both halves are the same length', () => {
        assert.equal(IDENTITY_ACCENT_VALUES.length, IDENTITY_ACCENTS.length);
    });

    test('every stored value is what its role resolves to in the light theme', () => {
        const drift = [];
        for (const [index, token] of IDENTITY_ACCENTS.entries()) {
            const fromTheme = resolve(token, table);
            const stored = IDENTITY_ACCENT_VALUES[index].toLowerCase();
            if (fromTheme !== stored) drift.push(`${token}: theme ${fromTheme}, stored ${stored}`);
        }
        assert.deepEqual(
            drift,
            [],
            'the stored half of the identity ramp no longer matches the theme — the same ' +
                'accent would mean one colour on a rendered chip and another in the database',
        );
    });

    test('the neutral matches too', () => {
        assert.equal(resolve(IDENTITY_NEUTRAL, table), IDENTITY_NEUTRAL_VALUE.toLowerCase());
    });
});

describe('the exemption cannot become a dumping ground', () => {
    // `token-audit.mjs` stops counting colour literals in this one file, because
    // literals are what it is for. That exemption is only safe while the file
    // holds the ramp and nothing else — otherwise it is a place to hide a colour
    // that has no role, which is exactly the debt the audit exists to find.
    //
    // Comments removed first, and for the third time today that turns out to
    // matter: the file's own header explains the `#7c3aed + '15'` trick it
    // exists to replace, so a raw scan reports the documentation. The audit
    // strips comments before counting hexes for the same reason, so a literal
    // in prose was never counted there either — this has to agree with it or
    // the two disagree about what a colour in this file is.
    const source = readFileSync(join(SRC, 'client', 'identity-accents.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/gm, '$1');

    test('every hex in the file is one of the ramp values', () => {
        const known = new Set(
            [...IDENTITY_ACCENT_VALUES, IDENTITY_NEUTRAL_VALUE].map((v) => v.toLowerCase()),
        );
        const found = [...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());

        assert.ok(
            found.length >= known.size,
            `only ${found.length} literals found — did the file move?`,
        );
        assert.deepEqual(
            found.filter((hex) => !known.has(hex)),
            [],
            'a colour literal in the exempt file that is not part of the identity ramp',
        );
    });
});

describe('a stored colour fits what the API accepts', () => {
    // `CreatePromotionDto.color` / `UpdatePromotionDto.color` are
    // `@IsString() @MaxLength(16)`. This is the check that was missing when the
    // swatches were pointed at 28-character token references.
    const PROMOTION_COLOR_MAX_LENGTH = 16;

    for (const [label, values] of [
        ['the ramp', IDENTITY_ACCENT_VALUES],
        ['the neutral', [IDENTITY_NEUTRAL_VALUE]],
    ]) {
        test(`${label} is concrete, not a token reference`, () => {
            for (const value of values) {
                assert.match(
                    value,
                    /^#[0-9a-fA-F]{6}$/,
                    `${value} is not a concrete colour — a value that gets stored cannot be a var()`,
                );
            }
        });

        test(`${label} fits the promotion column`, () => {
            for (const value of values) {
                assert.ok(
                    value.length <= PROMOTION_COLOR_MAX_LENGTH,
                    `${value} is ${value.length} characters; the DTO allows ${PROMOTION_COLOR_MAX_LENGTH}`,
                );
            }
        });
    }
});
