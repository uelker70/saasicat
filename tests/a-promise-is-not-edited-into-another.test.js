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
import { compare, editorialIn, fingerprint, judge } from '../scripts/requirements/guard.mjs';

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

    test('code formatting is not a change', () => {
        // A backtick is the one markup character that is never part of what it
        // wraps, so marking a word as a literal is typography and nothing else.
        assert.equal(fingerprint('the `name` stays'), fingerprint('the name stays'));
    });

    test('but emphasis is, because it cannot be told from a literal', () => {
        // Asterisks and underscores used to go with the backticks, which made
        // `*.json` and `.json`, and `tenant_id` and `tenantid`, the same
        // promise. Telling emphasis from a literal needs a Markdown parser; the
        // catalogue uses neither character for emphasis, so the cheap and safe
        // reading is that both belong to the words.
        assert.notEqual(fingerprint('the **name** stays'), fingerprint('the name stays'));
    });

    test('an identifier is read as where its chain ends', () => {
        // Following somebody else's supersession has to be free, or every entry
        // mentioning a retired one would have to be retired too and a single
        // edit would walk through the chapter. Blanking them all made that free
        // — and made swapping one dependency for an unrelated one free with it.
        const follow = (id) => (id === 'SC-A-002' ? 'SC-A-003' : id);
        assert.equal(
            fingerprint('as SC-A-002 says', follow),
            fingerprint('as SC-A-003 says', follow),
        );
    });

    test('and swapping in an unrelated one is a change', () => {
        // The counter-proof. Both targets stand, neither was superseded into
        // the other, and the promise now leans on a different contract.
        const follow = (id) => id;
        assert.notEqual(
            fingerprint('as SC-A-002 says', follow),
            fingerprint('as SC-A-003 says', follow),
        );
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
        assert.match(problem.message, /SC-A-001 promises something different/);
    });

    test('an underscore inside a name is not emphasis', () => {
        // Underscores were dropped with the other emphasis markers, so
        // `tenant_id` and `tenantid` were the same promise and a configuration
        // key could be renamed inside a requirement with nothing to say about
        // it. Asterisks and backticks are never part of a name; an underscore
        // is.
        assert.notEqual(fingerprint('the tenant_id key'), fingerprint('the tenantid key'));
    });

    test('an asterisk inside a pattern is not emphasis', () => {
        // Same reason as the underscore: `*.json` and `.json` are different
        // contracts, and dropping every asterisk made them one promise. The
        // catalogue uses neither character for emphasis, so keeping both costs
        // nothing.
        assert.notEqual(fingerprint('Accept `*.json` files'), fingerprint('Accept `.json` files'));
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
        assert.match(problem.message, /SC-A-001 promises something different/);
        assert.match(problem.message, /Superseded on YYYY-MM-DD/);
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
        assert.match(problem.message, /SC-A-001 is gone/);
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
        assert.match(problem.message, /changed its wording while being superseded/);
    });

    test('delivering a promise is not rewriting it', () => {
        // The edit that removes the marker when one of the ten is built. Left
        // in the fingerprint it read as a rewrite, and the author's only ways
        // past that were a false editorial claim or superseding something that
        // never changed.
        const pending = one(`${promise} 🟡 _(Decided, not yet delivered.)_`);
        assert.deepEqual(problems(pending, one(promise)), []);
    });

    test('filing a delivered promise as an intention is refused', () => {
        // The other direction takes a promise the product kept and files it as
        // something it means to do, and the entry stops being owed a proof.
        const pending = one(`${promise} 🟡 _(Decided, not yet delivered.)_`);
        const [problem] = problems(before, pending);
        assert.match(problem.message, /stood as delivered and now says it is not/);
    });

    test('correcting a record that was wrong is accepted when it is claimed', () => {
        const pending = one(`${promise} 🟡 _(Decided, not yet delivered.)_`);
        assert.deepEqual(problems(before, pending, new Set(['SC-A-001'])), []);
    });

    test('demoting a promise to a draft is refused', () => {
        // Prepending the marker leaves the wording untouched, so no comparison
        // of the prose would ever notice — and the promise would quietly stop
        // being one, and stop being owed a test. A promise that no longer
        // applies is withdrawn or superseded.
        const draft = one(`⚪ _(Draft since 2026-09-01.)_ ${promise}`);
        const [problem] = problems(before, draft);
        assert.match(problem.message, /stood as a promise and is now a draft/);
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
        assert.match(problem.message, /was withdrawn and is now current/);
    });
});

describe('a revision answers for what it did, not what it inherited', () => {
    // One rule for every revision: a commit and a merge differ only in how many
    // parents they have. A parent acquits an entry when it has that entry and
    // finds nothing wrong with it — whoever wrote that version answered for it
    // where they wrote it.
    const promise = 'The name stays the same across price changes.';
    const fromMain = 'The name stays the same across price changes, always.';
    const rewritten = 'The name may be changed at any time.';
    const merge = (parents, after) => ({ revision: 'merge', parents, after, editorial: new Set() });

    test('a rewrite in the resolution is reported', () => {
        const [problem] = judge([merge([one(promise), one(fromMain)], one(rewritten))]);
        assert.match(problem.message, /SC-A-001 promises something different/);
    });

    test('a deletion in the resolution is reported', () => {
        const [problem] = judge([
            merge([one(promise), one(fromMain)], entries(entry('SC-A-002', 'Something else.'))),
        ]);
        assert.match(problem.message, /SC-A-001 is gone/);
    });

    test('what came in from the other branch is not', () => {
        // It matches that parent, and that parent's own pull request judged it.
        assert.deepEqual(judge([merge([one(promise), one(fromMain)], one(fromMain))]), []);
    });

    test('what this branch had already done is not', () => {
        assert.deepEqual(judge([merge([one(promise), one(fromMain)], one(promise))]), []);
    });

    // A branch cut before `SC-A-001` existed carries only what came before it.
    const kept = entry('SC-A-002', 'An entry both sides have.');
    const older = entries(kept);
    const withBoth = (text) => entries(entry('SC-A-001', text), kept);

    test('a parent that never had the entry does not acquit it', () => {
        // Silence from a parent that never carried the identifier means
        // absence, not agreement. Merging a topic branch older than a
        // requirement and rewriting that requirement in the resolution passed,
        // because the old branch had nothing to say about it.
        const [problem] = judge([merge([withBoth(promise), older], withBoth(rewritten))]);
        assert.match(problem.message, /SC-A-001 promises something different/);
    });

    test('the parent that notices need not be the first', () => {
        // Reading only the first parent's findings loses a change that the
        // other parent is the only one able to see.
        const [problem] = judge([merge([older, withBoth(promise)], withBoth(rewritten))]);
        assert.match(problem.message, /SC-A-001 promises something different/);
    });

    test('an entry that only arrived with one parent is left alone', () => {
        // The counter-proof: an addition is not this revision's doing to answer
        // for, and the rule must not turn every merge into a complaint.
        assert.deepEqual(judge([merge([withBoth(promise), older], withBoth(promise))]), []);
    });
});

describe('a claim excuses the edit that made it, and no other', () => {
    // The branch is judged step by step rather than as one diff. Pooling every
    // trailer between the merge base and HEAD let a claim outlive its edit: a
    // commit legitimately excusing a typo would also excuse a later commit
    // rewriting the same entry into a different promise.
    const promise = 'The name stays the same across price changes.';
    const typo = 'The name stayes the same across price changes.';
    const rewritten = 'The name may be changed at any time.';

    test('a claim covers the step that carries it', () => {
        assert.deepEqual(
            judge([
                { parents: [one(promise)], after: one(typo), editorial: new Set(['SC-A-001']) },
            ]),
            [],
        );
    });

    test('and does not reach the step after it', () => {
        const [problem] = judge([
            { parents: [one(promise)], after: one(typo), editorial: new Set(['SC-A-001']) },
            { parents: [one(typo)], after: one(rewritten), editorial: new Set() },
        ]);
        assert.match(problem.message, /SC-A-001 promises something different/);
    });

    test('the same two edits pooled into one step would pass', () => {
        // The counter-proof, and the reason the walk exists: as one diff with
        // the claim pooled, this is exactly what used to be accepted.
        assert.deepEqual(
            judge([
                {
                    parents: [one(promise)],
                    after: one(rewritten),
                    editorial: new Set(['SC-A-001']),
                },
            ]),
            [],
        );
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
