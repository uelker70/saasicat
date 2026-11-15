// The identifier an installation marks its database with, and the comparison a
// deletion asks before it erases anything.
//
// The identifier arrives from the environment as it is, so the check reads
// `unknown` and names what is wrong with it rather than repairing it: a space
// trimmed away, or a case folded, would make two identifiers the operator
// typed differently count as one, and the brake would let through the very
// process it exists to stop.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    INSTALLATION_IDENTIFIER_MAX_LENGTH,
    installationIdentifierProblem,
    installationMarkVerdict,
} from '../dist/index.js';

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('an installation identifier is checked as it was given', () => {
    test('nothing given is missing', () => {
        assert.equal(installationIdentifierProblem(undefined), 'missing');
        assert.equal(installationIdentifierProblem(null), 'missing');
    });

    test('a value that is not text is named as such', () => {
        assert.equal(installationIdentifierProblem(42), 'not-a-string');
    });

    test('empty text and spaces alone are blank', () => {
        assert.equal(installationIdentifierProblem(''), 'blank');
        assert.equal(installationIdentifierProblem('   '), 'blank');
    });

    test('a space before or after is refused, not trimmed', () => {
        assert.equal(installationIdentifierProblem(' prod'), 'characters');
        assert.equal(installationIdentifierProblem('prod '), 'characters');
    });

    test('the longest identifier is allowed, one character more is not', () => {
        assert.equal(INSTALLATION_IDENTIFIER_MAX_LENGTH, 64);
        assert.equal(installationIdentifierProblem('a'.repeat(64)), null);
        assert.equal(installationIdentifierProblem('a'.repeat(65)), 'too-long');
    });

    test('letters, digits, dots, dashes and underscores make an identifier', () => {
        assert.equal(installationIdentifierProblem('prod-eu.1_a'), null);
        assert.equal(installationIdentifierProblem('p'), null);
    });

    test('it begins with a letter or a digit', () => {
        assert.equal(installationIdentifierProblem('-prod'), 'characters');
        assert.equal(installationIdentifierProblem('.prod'), 'characters');
        assert.equal(installationIdentifierProblem('_prod'), 'characters');
    });

    test('a path separator is no part of one', () => {
        assert.equal(installationIdentifierProblem('prod/eu'), 'characters');
    });

    test('a long run of text ending in a bad character is answered at once', () => {
        // Within the length the pattern is asked; beyond it, the length
        // answers first. Both must be quick on text nobody controls.
        const withinLength = `${'a'.repeat(63)}!`;
        const beyondLength = `${'a'.repeat(50_000)}!`;
        const started = performance.now();
        assert.equal(installationIdentifierProblem(withinLength), 'characters');
        assert.equal(installationIdentifierProblem(beyondLength), 'too-long');
        assert.ok(performance.now() - started < 100);
    });
});

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('a deletion compares the environment with the mark', () => {
    test('a database nobody marked is unmarked, and names what this environment expects', () => {
        assert.deepEqual(installationMarkVerdict('prod', null), {
            kind: 'unmarked',
            expected: 'prod',
        });
    });

    test('the same identifier matches', () => {
        assert.deepEqual(installationMarkVerdict('prod', { identifier: 'prod' }), {
            kind: 'matches',
            identifier: 'prod',
        });
    });

    test('another case is another identifier, never the same one', () => {
        assert.deepEqual(installationMarkVerdict('prod', { identifier: 'PROD' }), {
            kind: 'differs',
            expected: 'prod',
            marked: 'PROD',
        });
    });

    test('a backup of production restored into staging differs', () => {
        assert.deepEqual(installationMarkVerdict('staging', { identifier: 'prod' }), {
            kind: 'differs',
            expected: 'staging',
            marked: 'prod',
        });
    });
});
