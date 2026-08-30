// An identifier is permanent, and this is what makes that true.
//
// The rule reads well and costs twenty minutes to follow: an entry whose
// promise changed stays where it is, says it was superseded, and the new
// wording becomes a new entry. Written down, it survives until the evening
// somebody fixes a promise in place instead — and then the catalogue carries
// two regimes and neither is worth believing. Nothing else would notice: the
// document still renders, every check in `check.mjs` still passes, and the
// identifier somebody wrote down last year now means something else.
//
// What is compared is the promise, not the file. The cases below are mostly
// about the difference: rewrapping a paragraph, bolding a phrase and following
// somebody else's supersession all change the text and none of them change what
// was promised. Without that, one retired entry would force every entry
// mentioning it to be retired too, and the rule would eat the chapter.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { catalogueOf } from '../scripts/requirements/parse.mjs';
import { compare, editorialIn, fingerprint } from '../scripts/requirements/guard.mjs';

const head = () => '---\ntitle: Title\n---\n\nIntro.\n';
const entry = (id, text) => `### ${id} — Title\n\n${text}\n\n_Source:_ #1`;
const entries = (...written) =>
    catalogueOf([['01_a', `${head()}\n${written.join('\n\n')}`]]).entries;

const one = (text) => entries(entry('SC-A-001', text));
const problems = (before, after, editorial) => compare(before, after, editorial);

describe('the fingerprint is the promise, not the prose around it', () => {
    test('a line break is not a change', () => {
        // These files are wrapped by hand at a hundred columns, so one added
        // word reflows the paragraph and every line after it differs.
        assert.equal(
            fingerprint('a promise\nacross two lines'),
            fingerprint('a promise across two lines'),
        );
    });

    test('emphasis is not a change', () => {
        assert.equal(fingerprint('the **name** stays'), fingerprint('the name stays'));
    });

    test('a different identifier is not a change', () => {
        // The whole rule turns on this. Following somebody else's supersession
        // has to be free, or every entry mentioning a retired one would have to
        // be retired too and a single edit would walk through the chapter.
        assert.equal(fingerprint('as SC-A-002 says'), fingerprint('as SC-A-099 says'));
    });

    test('the heading is part of the promise', () => {
        // Nineteen entries state their whole promise in the heading and carry
        // no prose. Comparing the prose alone compared two empty strings, so
        // rewriting what such an entry says was accepted without a word.
        const before = entries(
            '### SC-A-001 — A key is named in exactly one place\n\n_Source:_ #1',
        );
        const after = entries('### SC-A-001 — A key may be named anywhere\n\n_Source:_ #1');
        const [problem] = problems(before, after);
        assert.match(problem, /SC-A-001 promises something different/);
    });

    test('a different word is a change', () => {
        // The counter-proof: without it, every case above would hold against a
        // fingerprint that returns the empty string.
        assert.notEqual(fingerprint('the name stays'), fingerprint('the name may change'));
    });
});

describe('an entry that already exists may not quietly become another', () => {
    const before = one('The name stays the same across price changes.');

    test('an untouched entry is accepted', () => {
        assert.deepEqual(
            problems(before, one('The name stays the same across price changes.')),
            [],
        );
    });

    test('a rewritten promise is refused', () => {
        const [problem] = problems(before, one('The name may be changed at any time.'));
        assert.match(problem, /SC-A-001 promises something different/);
        assert.match(problem, /Superseded on YYYY-MM-DD/);
    });

    test('a rewritten promise the commit calls editorial is accepted', () => {
        assert.deepEqual(
            problems(before, one('The name may be changed at any time.'), new Set(['SC-A-001'])),
            [],
        );
    });

    test('an editorial claim for one entry does not cover another', () => {
        // A blanket escape would be no escape at all — it would be the rule
        // switched off by anyone who wrote the word once.
        assert.equal(
            problems(before, one('The name may be changed.'), new Set(['SC-A-999'])).length,
            1,
        );
    });

    test('a deleted entry is refused', () => {
        // The failure the whole scheme exists to prevent: deleting an entry
        // frees its number, and the next requirement written in that chapter
        // inherits a meaning somebody else wrote down.
        const [problem] = problems(before, entries(entry('SC-A-002', 'Something else.')));
        assert.match(problem, /SC-A-001 is gone/);
    });

    test('a new entry beside the old one is accepted', () => {
        assert.deepEqual(
            problems(
                before,
                entries(
                    entry('SC-A-001', 'The name stays the same across price changes.'),
                    entry('SC-A-002', 'Something new.'),
                ),
            ),
            [],
        );
    });
});

describe('retiring an entry preserves what it said', () => {
    const promise = 'The name stays the same across price changes.';
    const before = one(promise);

    test('superseding without touching the wording is accepted', () => {
        const after = entries(
            entry('SC-A-001', `🔵 _(Superseded on 2026-09-01 by \`SC-A-002\`.)_ ${promise}`),
            entry('SC-A-002', 'The new wording.'),
        );
        assert.deepEqual(problems(before, after), []);
    });

    test('rewriting the wording while superseding is refused', () => {
        // Otherwise the entry a reader arrives at from an old reference shows
        // them something nobody was ever told.
        const after = entries(
            entry(
                'SC-A-001',
                '🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ Something nobody promised.',
            ),
            entry('SC-A-002', 'The new wording.'),
        );
        const [problem] = problems(before, after);
        assert.match(problem, /changed its wording while being superseded/);
    });

    test('demoting a promise to a draft is refused', () => {
        // Prepending the marker leaves the wording untouched, so no comparison
        // of the prose would ever notice — and the promise would quietly stop
        // being one, and stop being owed a test. A promise that no longer
        // applies is withdrawn or superseded.
        const draft = one(`⚪ _(Draft since 2026-09-01.)_ ${promise}`);
        const [problem] = problems(before, draft);
        assert.match(problem, /stood as a promise and is now a draft/);
    });

    test('deciding a draft is accepted', () => {
        // The move in the other direction is what a draft is for.
        const draft = one(`⚪ _(Draft since 2026-09-01.)_ ${promise}`);
        assert.deepEqual(problems(draft, one(promise)), []);
    });

    test('dropping a draft is accepted', () => {
        const draft = one(`⚪ _(Draft since 2026-09-01.)_ ${promise}`);
        assert.deepEqual(problems(draft, one(`🔴 _(Withdrawn on 2026-09-01.)_ ${promise}`)), []);
    });

    test('a withdrawn promise coming back is refused', () => {
        const withdrawn = one(`🔴 _(Withdrawn on 2026-09-01.)_ ${promise}`);
        const [problem] = problems(withdrawn, one(promise));
        assert.match(problem, /was withdrawn and is now current/);
    });
});

describe('the editorial claim is read from the commits, not from the entry', () => {
    test('a trailer names one identifier', () => {
        assert.deepEqual([...editorialIn('Fix a typo\n\nEditorial: SC-A-001\n')], ['SC-A-001']);
    });

    test('a trailer names several, however they are separated', () => {
        assert.deepEqual(
            [...editorialIn('Subject\n\nEditorial: SC-A-001, SC-A-002 SC-A-003\n')],
            ['SC-A-001', 'SC-A-002', 'SC-A-003'],
        );
    });

    test('several commits each contribute their own', () => {
        assert.deepEqual(
            [...editorialIn('One\n\nEditorial: SC-A-001\n\nTwo\n\nEditorial: SC-A-002\n')],
            ['SC-A-001', 'SC-A-002'],
        );
    });

    test('the word inside a sentence is not a trailer', () => {
        // A claim has to be made deliberately. Prose mentioning the mechanism —
        // this comment, a commit explaining why something was not editorial —
        // must not switch the check off.
        assert.deepEqual([...editorialIn('This was not an Editorial: change at all\n')], []);
    });
});
