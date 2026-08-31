// @requirement SC-READ-003 — A statement about the software is part of it

// An absolute nobody measured and nobody bounded is the one that breaks.
//
// "Never", "every", "only" was the most common defect across the requirement
// documents this catalogue came out of: the sentence reads well, nobody argues
// with it in review, and the case it does not cover is found by a customer.
// `scripts/requirements/absolutes.mjs` freezes how many stand with neither a
// test nor a stated boundary, and the count may not go up.
//
// What is worth testing here is the counting, for the reason the proof debt is
// tested: a ratchet that counts the wrong population reads as a measurement,
// appears in CI, and asks for work that is not owed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { catalogueOf } from '../scripts/requirements/parse.mjs';
import {
    ABSOLUTES,
    EXCEPTIONS,
    absoluteRatchet,
    claimsEveryCase,
    namesAnException,
    unqualified,
} from '../scripts/requirements/absolutes.mjs';

const head = () => '---\ntitle: Title\n---\n\nIntro.\n';
const opened = (text) => (/^[🟢🟡⚪🔵🔴]/u.test(text) ? text : `🟢 ${text}`);
const entry = (id, title, text) => `### ${id} — ${title}\n\n${opened(text)}\n\n_Source:_ #1`;
const entries = (...written) =>
    catalogueOf([['01_a', `${head()}\n${written.join('\n\n')}`]]).entries;

const NONE = new Set();

describe('an absolute is recognised wherever it stands', () => {
    test('in the promise under the heading', () => {
        const [only] = entries(entry('SC-A-001', 'A title', 'A refusal is never translated.'));
        assert.equal(claimsEveryCase(only), true);
    });

    test('and in the heading itself, where nineteen entries keep their whole promise', () => {
        const [only] = entries(entry('SC-A-001', 'Every quota counts as a limit', ''));
        assert.equal(claimsEveryCase(only), true);
    });

    test('a word that merely contains one does not count', () => {
        const [only] = entries(
            entry('SC-A-001', 'A title', 'Allocation is nonetheless anyones business.'),
        );
        assert.equal(claimsEveryCase(only), false);
    });

    test('an ordinary promise claims nothing of the kind', () => {
        const [only] = entries(entry('SC-A-001', 'A title', 'A draft can be discarded.'));
        assert.equal(claimsEveryCase(only), false);
    });
});

describe('an exception is recognised the same way', () => {
    test('the words an entry says it with', () => {
        for (const word of ['except', 'unless', 'other than', 'apart from']) {
            const [only] = entries(entry('SC-A-001', 'A title', `Never, ${word} on Sundays.`));
            assert.equal(namesAnException(only), true, word);
        }
    });

    test('and nothing else', () => {
        const [only] = entries(entry('SC-A-001', 'A title', 'Never, but sometimes.'));
        assert.equal(namesAnException(only), false);
    });

    test('a denial of the noun is not a boundary', () => {
        for (const text of [
            'Every request is rejected; there are no exceptions.',
            'This holds without exception.',
        ]) {
            const [only] = entries(entry('SC-A-001', 'A title', text));
            assert.equal(namesAnException(only), false, text);
        }
    });

    test('and the word that denies it has to stand directly in front of it', () => {
        // In "never, except …" the absolute stands before the boundary; that
        // is the form the entry is supposed to take, not a denial of it.
        for (const text of [
            'Never, except on Sundays.',
            'Nothing is written, other than the identifier.',
            'No exceptions, unless the operator says so.',
            'Never, with one exception: the operator.',
        ]) {
            const [only] = entries(entry('SC-A-001', 'A title', text));
            assert.equal(namesAnException(only), true, text);
        }
    });
});

describe('what the debt counts', () => {
    const bare = entry('SC-A-001', 'A title', 'A refusal is never translated.');
    const bounded = entry(
        'SC-A-002',
        'A title',
        'A refusal is never translated, except the one the operator wrote.',
    );
    const ordinary = entry('SC-A-003', 'A title', 'A draft can be discarded.');

    test('an absolute with neither a test nor an exception', () => {
        assert.deepEqual(unqualified(entries(bare, bounded, ordinary), NONE), ['SC-A-001']);
    });

    test('a test settles it', () => {
        assert.deepEqual(unqualified(entries(bare), new Set(['SC-A-001'])), []);
    });

    test('a named exception settles it', () => {
        assert.deepEqual(unqualified(entries(bounded), NONE), []);
    });

    test('a draft owes nothing — it is a proposal, not a promise', () => {
        const draft = entry(
            'SC-A-004',
            'A title',
            '⚪ _(Draft since 2026-01-01.)_ A refusal is never translated.',
        );
        assert.deepEqual(unqualified(entries(draft), NONE), []);
    });

    test('one decided but not delivered owes nothing until it is built', () => {
        const pending = entry(
            'SC-A-005',
            'A title',
            '🟡 _(Decided, not yet delivered.)_ A refusal is never translated.',
        );
        assert.deepEqual(unqualified(entries(pending), NONE), []);
    });

    test('a retired one owes nothing either', () => {
        const gone = entry(
            'SC-A-006',
            'A title',
            '🔴 _(Withdrawn on 2026-01-01.)_ A refusal is never translated.',
        );
        assert.deepEqual(unqualified(entries(gone), NONE), []);
    });
});

describe('the ratchet moves one way', () => {
    const at = (debt, standing) => ({ debt, standing: standing ?? debt });

    test('an unqualified absolute arriving with nothing to pay for it is refused', () => {
        const problems = absoluteRatchet(
            at([], ['SC-A-001']),
            at(['SC-A-002'], ['SC-A-001', 'SC-A-002']),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /SC-A-002/);
    });

    test('one arriving while another gains its boundary is allowed', () => {
        const problems = absoluteRatchet(
            at(['SC-A-001'], ['SC-A-001']),
            at(['SC-A-002'], ['SC-A-001', 'SC-A-002']),
        );
        assert.deepEqual(problems, []);
    });

    test('nothing arriving is always allowed', () => {
        assert.deepEqual(absoluteRatchet(at(['SC-A-001']), at(['SC-A-001'])), []);
    });

    test('retiring an old absolute does not pay for a new one', () => {
        // SC-A-001 leaves the debt by ceasing to stand, not by being answered.
        const problems = absoluteRatchet(at(['SC-A-001'], ['SC-A-001']), {
            debt: ['SC-A-002'],
            standing: ['SC-A-002'],
        });
        assert.equal(problems.length, 1);
    });
});

describe('the two lists say what they are for', () => {
    test('every absolute is a word about all cases, not an emphatic one', () => {
        for (const word of ['clearly', 'obviously', 'strictly', 'fully']) {
            assert.ok(!ABSOLUTES.includes(word), `'${word}' is emphasis, not a claim`);
        }
    });

    test('every exception is a word that opens a boundary', () => {
        for (const word of ['but', 'however', 'although']) {
            assert.ok(!EXCEPTIONS.includes(word), `'${word}' concedes without naming anything`);
        }
    });
});
