// The codemod that moved 949 declarations, and the rule it applied.
//
// A one-shot script is exactly the kind of thing nobody tests, and exactly the
// kind of thing whose mistakes are invisible afterwards: a wrong rung looks
// like a design decision six months later. The rule is small enough to state,
// so it is stated here — and the file stays after the migration, because the
// same mapping is what a consumer reaches for when they move their own CSS.

// @requirement SC-UI-012 — The interface works on desktop, tablet and phone
// @requirement SC-A11Y-010 — Wide content scrolls rather than being cut off

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { rewriteDeclaration, rewriteFile, tokenFor } from '../scripts/codemods/px-to-scale.mjs';

describe('pixels snap to the nearest rung', () => {
    test('an exact value takes its own token', () => {
        assert.equal(tokenFor('padding', 8), 'var(--sa-space-3)');
        assert.equal(tokenFor('gap', 24), 'var(--sa-space-7)');
        assert.equal(tokenFor('border-radius', 12), 'var(--sa-radius-card)');
    });

    test('a midpoint rounds down', () => {
        // The decision this whole migration turns on: 6px is two from 4 and two
        // from 8, and 137 declarations used it. Rounding up would have added
        // 2px to every dense row in the product.
        assert.equal(tokenFor('padding', 6), 'var(--sa-space-2)');
        assert.equal(tokenFor('gap', 10), 'var(--sa-space-3)');
        assert.equal(tokenFor('margin-top', 14), 'var(--sa-space-4)');
    });

    test('a value nearer one rung takes it, up or down', () => {
        assert.equal(tokenFor('padding', 7), 'var(--sa-space-3)');
        assert.equal(tokenFor('padding', 9), 'var(--sa-space-3)');
        assert.equal(tokenFor('padding', 26), 'var(--sa-space-7)');
    });

    test('radii use their names, not their numbers', () => {
        assert.equal(tokenFor('border-radius', 999), 'var(--sa-radius-pill)');
        assert.equal(tokenFor('border-radius', 5), 'var(--sa-radius-badge)');
        assert.equal(tokenFor('border-radius', 4), 'var(--sa-radius-badge)');
        assert.equal(tokenFor('border-top-left-radius', 16), 'var(--sa-radius-hero)');
    });

    test('a negative keeps its sign in a calc', () => {
        // A custom property cannot carry the minus without a second token per
        // rung, and a scale with a negative half of itself is two scales.
        assert.equal(tokenFor('margin-top', -6), 'calc(-1 * var(--sa-space-2))');
        assert.equal(tokenFor('margin-left', -2), 'calc(-1 * var(--sa-space-1))');
    });

    test('tracking is converted rather than snapped', () => {
        // The tracking scale is declared in `em`, so there is no pixel rung to
        // snap to — `0.5px` at the sizes this surface uses is the wide step.
        assert.equal(tokenFor('letter-spacing', 0.5), 'var(--sa-tracking-wide)');
    });
});

describe('what the codemod leaves alone', () => {
    test('a property no scale answers for', () => {
        assert.equal(rewriteDeclaration('width', '280px'), null);
        assert.equal(rewriteDeclaration('max-width', '1100px'), null);
        assert.equal(rewriteDeclaration('border', '1px solid red'), null);
    });

    test('a declaration that already reads a token', () => {
        assert.equal(rewriteDeclaration('padding', 'var(--sa-space-3)'), null);
    });

    test('a token definition', () => {
        assert.equal(rewriteDeclaration('--sa-space-3', '8px'), null);
    });

    test('every value in a shorthand moves together', () => {
        assert.equal(
            rewriteDeclaration('padding', '18px 22px 12px'),
            'var(--sa-space-5) var(--sa-space-6) var(--sa-space-4)',
        );
    });

    test('a zero stays a zero', () => {
        assert.equal(rewriteDeclaration('margin', '0 2px'), '0 var(--sa-space-1)');
    });
});

describe('rewriting a file', () => {
    test('touches declarations and nothing else', () => {
        const before = [
            '<style scoped>',
            '.thing {',
            '    gap: 6px;',
            '    width: 280px; /* a drawer, not a rung */',
            '    border-radius: 999px;',
            '}',
            '</style>',
        ].join('\n');

        const { text, touched } = rewriteFile(before);
        assert.equal(touched, 2);
        assert.ok(text.includes('gap: var(--sa-space-2);'));
        assert.ok(text.includes('width: 280px; /* a drawer, not a rung */'));
        assert.ok(text.includes('border-radius: var(--sa-radius-pill);'));
    });
});
