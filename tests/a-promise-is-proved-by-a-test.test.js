// A promise nothing names is a claim, not a guarantee.
//
// The catalogue said 399 things and, when it was written, no test anywhere
// named one of them. Backfilling that would be a week of work for a number
// nobody would trust afterwards, so nothing is backfilled: the debt is frozen
// and may only shrink. A new promise brings its test, or pays for itself by
// proving one that was already owed.
//
// The counting is where this could quietly stop working. A ratchet that counts
// the wrong population is worse than none — it reads as a measurement, it
// appears in CI, and it asks for tests of things that are not true.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { catalogueOf } from '../scripts/requirements/parse.mjs';
import { annotationsIn, casesIn, isTestPath, unproven } from '../scripts/requirements/proof.mjs';
import { ROOT, coverage, listing } from '../scripts/requirements/index.mjs';
import { readCatalogue } from '../scripts/requirements/parse.mjs';
import { scanTests } from '../scripts/requirements/proof.mjs';
import { ratchet } from '../scripts/requirements/guard.mjs';

const head = () => '---\ntitle: Title\n---\n\nIntro.\n';
// Every entry opens with its state, so a fixture that does not name one is
// given the ordinary one — the same rule the catalogue is held to.
const opened = (text) => (/^[🟢🟡⚪🔵🔴]/u.test(text) ? text : `🟢 ${text}`);
const entry = (id, text) => `### ${id} — Title\n\n${opened(text)}\n\n_Source:_ #1`;
const entries = (...written) =>
    catalogueOf([['01_a', `${head()}\n${written.join('\n\n')}`]]).entries;

describe('a test says which promise it proves', () => {
    test('the tag is found wherever it sits', () => {
        assert.deepEqual(annotationsIn('/** @requirement SC-A-001 */'), ['SC-A-001']);
        assert.deepEqual(annotationsIn('// @requirement  SC-A-002\n'), ['SC-A-002']);
    });

    test('several in one file each count', () => {
        assert.deepEqual(annotationsIn('// @requirement SC-A-001\n// @requirement SC-A-002'), [
            'SC-A-001',
            'SC-A-002',
        ]);
    });

    test('an identifier mentioned in passing is not a claim', () => {
        // Fixtures and comments name identifiers constantly — this repository's
        // own guard tests are full of them. Counting those would report a
        // coverage that no test performs.
        assert.deepEqual(annotationsIn('see SC-A-001, and the SC-A-002 case'), []);
    });

    test('an identifier ends where it ends', () => {
        // `SC-PLAN-0049` and `SC-PLAN-004-extra` both used to read as
        // `SC-PLAN-004`, so a mistyped identifier settled a debt owed by a
        // promise nobody had named — and the ratchet reported progress that had
        // not happened.
        assert.deepEqual(annotationsIn('// @requirement SC-A-0019'), []);
        assert.deepEqual(annotationsIn('// @requirement SC-A-001-extra'), []);
        assert.deepEqual(annotationsIn('// @requirement SC-A-001x'), []);
        assert.deepEqual(annotationsIn('// @requirement SC-A-001_extra'), []);
    });

    test('punctuation after an identifier still ends it', () => {
        // The counter-proof: the rule must not reject the ordinary forms.
        assert.deepEqual(annotationsIn('/** @requirement SC-A-001 */'), ['SC-A-001']);
        assert.deepEqual(annotationsIn('// @requirement SC-A-001.'), ['SC-A-001']);
    });

    test('the tag inside a sentence is not a claim either', () => {
        // The case that was wrong, and the file that documents the mechanism is
        // the one most likely to contain it. This sentence used to prove
        // SC-PLAN-004.
        assert.deepEqual(annotationsIn('// the `@requirement SC-A-001` tag names it'), []);
        assert.deepEqual(annotationsIn('// as @requirement SC-A-001 shows'), []);
    });
});

describe('an annotation covers what it opens', () => {
    // Naming the file answered "is this proved" and not "by what", and "by
    // what" is the question somebody asks when a requirement changes and they
    // have to find the cases that go with it.
    const file = [
        '// @requirement SC-A-001',
        '',
        "import { describe, test } from 'node:test';",
        '',
        "describe('a block nobody annotated', () => {",
        "    test('one', () => {});",
        '});',
        '',
        '// @requirement SC-A-002',
        "describe('an annotated block', () => {",
        "    test('two', () => {});",
        "    test('three', () => {});",
        '});',
        '',
        '// @requirement SC-A-003',
        "test('a case of its own', () => {});",
    ].join('\n');

    test('above the imports it speaks for every case in the file', () => {
        const named = casesIn(file).filter((c) => c.id === 'SC-A-001');
        assert.deepEqual(
            named.map((c) => c.case),
            ['one', 'two', 'three', 'a case of its own'],
        );
    });

    test('above a block it speaks for that block, with the block in the name', () => {
        assert.deepEqual(
            casesIn(file)
                .filter((c) => c.id === 'SC-A-002')
                .map((c) => c.case),
            ['an annotated block › two', 'an annotated block › three'],
        );
    });

    test('above one case it speaks for that one', () => {
        assert.deepEqual(
            casesIn(file)
                .filter((c) => c.id === 'SC-A-003')
                .map((c) => c.case),
            ['a case of its own'],
        );
    });

    test('code between an annotation and a block ends the claim', () => {
        // Otherwise an annotation drifts onto a block it was never written for,
        // and the listing names cases that answer for something else.
        const drifted = [
            "import { describe, test } from 'node:test';",
            '// @requirement SC-A-004',
            'const fixture = 1;',
            "describe('a block further down', () => {",
            "    test('one', () => {});",
            '});',
        ].join('\n');
        assert.deepEqual(casesIn(drifted), []);
    });
});

describe('coverage counts what is owed a proof', () => {
    // A measurement, not a target. What keeps it from falling is the ratchet;
    // a percentage nobody can fail is a percentage nobody reads.
    const rows = (...proofs) => proofs.map((proof, i) => ({ id: `SC-A-00${i}`, proof }));

    test('only promises owed a proof are counted', () => {
        // Counting drafts, retired entries and things not built yet would move
        // the number when nothing had been proved.
        const seen = coverage(rows('proved', 'owed', 'not owed', 'not owed'));
        assert.deepEqual(
            { proved: seen.proved, owed: seen.owed, exempt: seen.exempt, percent: seen.percent },
            { proved: 1, owed: 2, exempt: 2, percent: 50 },
        );
    });

    test('nothing owed is not nothing proved', () => {
        // A catalogue of drafts would otherwise read as zero per cent covered,
        // which says something false about work nobody owes.
        assert.equal(coverage(rows('not owed', 'not owed')).owed, 0);
        assert.equal(coverage(rows('not owed', 'not owed')).percent, 0);
    });

    test('the real catalogue reports a number that moves', () => {
        const seen = coverage(listing(ROOT));
        assert.ok(seen.owed > 300, `only ${seen.owed} promises owed a proof`);
        assert.ok(seen.proved > 0, 'nothing is proved, so the number cannot be read');
    });
});

describe('an annotation names a promise that is there to prove', () => {
    // The link runs both ways, so it can rot from either end. A test naming an
    // identifier that never existed proves nothing and says it does; one naming
    // an identifier that has since been retired proves something nobody is owed
    // any more, and quietly stops counting where the debt is measured.
    //
    // A typo is the ordinary case rather than the exotic one — the whole point
    // of annotating is that somebody types an identifier by hand — which is why
    // this runs over the tree rather than over a diff.
    const catalogue = readCatalogue(ROOT);
    const byId = new Map(catalogue.entries.map((entry) => [entry.id, entry]));
    const named = scanTests(ROOT);

    test('every annotated identifier exists', () => {
        const missing = [...named].filter(([id]) => !byId.has(id));
        assert.deepEqual(
            missing.map(([id, files]) => `${id} (${files.join(', ')})`),
            [],
        );
    });

    test('every annotated requirement still stands', () => {
        const retired = [...named]
            .filter(([id]) => byId.get(id) && byId.get(id).status !== 'current')
            .map(([id, files]) => `${id} is ${byId.get(id).status} (${files.join(', ')})`);
        assert.deepEqual(retired, []);
    });

    test('the scan is looking at the annotations, not at nothing', () => {
        // Vacuously true on an empty map, which is what a moved directory or a
        // broken pattern produces — and both assertions above would hold.
        assert.ok(
            named.size > 0,
            'no test names a requirement; the two assertions above prove nothing',
        );
    });
});

describe('every requirement can be seen with its state', () => {
    // An ordinary entry carries no marker, which is right for a document and
    // wrong for the question "show me all of them" — that then has to be
    // answered by reading absence, and reading absence is how a marker wrapped
    // across a line went unnoticed for a day.
    const rows = listing(ROOT);

    test('every requirement is listed, not only the exceptions', () => {
        assert.ok(rows.length >= 300, `only ${rows.length} rows`);
        assert.ok(rows.every((row) => row.id && row.state && row.proof));
    });

    test('proof has three answers, not two', () => {
        // A promise nothing names is owed one. A draft, a retired entry and one
        // not yet delivered are owed nothing, which is a different thing from
        // having been proved — and collapsing the two would report coverage
        // that nobody has.
        const owed = rows.filter((row) => row.proof === 'owed');
        const exempt = rows.filter((row) => row.proof === 'not owed');
        assert.ok(owed.length > 0, 'nothing is owed a proof, which cannot be right yet');
        assert.ok(exempt.every((row) => row.state !== 'current' || row.proof === 'not owed'));
        assert.ok(rows.every((row) => (row.proof === 'proved') === row.tests.length > 0));
    });
});

describe('both revisions count the same places', () => {
    // The ratchet measures two revisions, and they cannot walk the same way:
    // one has a working tree, the other has a revision and is read with
    // `git grep`. When they did not share this predicate, the older side
    // searched every file in the repository and found the example
    // `@requirement SC-PLAN-004` in a comment, while the newer side searched
    // the tests and did not. The debt read one lower on the side it was
    // compared against, and the ratchet reported a rise nobody had caused.

    test('a test file counts, wherever it sits', () => {
        assert.ok(isTestPath('tests/a-thing.test.js'));
        assert.ok(isTestPath('packages/nest/src/thing.spec.ts'));
    });

    test('a helper beside the tests counts', () => {
        // A helper asserting a rule proves it as much as the case calling it.
        assert.ok(isTestPath('packages/nest/tests/fixtures/tenant.ts'));
    });

    test('a comment in the tooling does not', () => {
        // The file that documents the annotation names one, and it is not a
        // proof of anything. This is the case that was wrong.
        assert.ok(!isTestPath('scripts/requirements/proof.mjs'));
        assert.ok(!isTestPath('docs/explanation/requirements-as-sources.md'));
        assert.ok(!isTestPath('CONTRIBUTING.md'));
    });

    test('production source does not', () => {
        assert.ok(!isTestPath('packages/nest/src/thing.ts'));
    });

    test('an installed dependency does not', () => {
        assert.ok(!isTestPath('packages/nest/node_modules/x/tests/y.test.js'));
    });
});

describe('only a promise that stands is owed a proof', () => {
    const named = new Set(['SC-A-002']);

    test('a standing promise nothing names is owed', () => {
        assert.deepEqual(unproven(entries(entry('SC-A-001', 'Prose.')), named), ['SC-A-001']);
    });

    test('a standing promise a test names is not', () => {
        assert.deepEqual(unproven(entries(entry('SC-A-002', 'Prose.')), named), []);
    });

    test('a draft is not owed a proof', () => {
        // It is not a promise yet. Asking for a test would ask for a test of
        // something nobody has decided to do.
        const draft = entries(entry('SC-A-001', '⚪ _(Draft since 2026-09-01.)_ Proposed.'));
        assert.deepEqual(unproven(draft, named), []);
    });

    test('a promise decided but not delivered is not owed one', () => {
        const later = entries(entry('SC-A-001', 'Prose. 🟡 _(Decided, not yet delivered.)_'));
        assert.deepEqual(unproven(later, named), []);
    });

    test('a retired promise is not owed one', () => {
        const retired = entries(entry('SC-A-001', '🔴 _(Withdrawn on 2026-09-01.)_ Prose.'));
        assert.deepEqual(unproven(retired, named), []);
    });
});

describe('coverage moves one way', () => {
    const at = (debt, standing = debt) => ({ debt, standing });

    test('an unchanged debt passes', () => {
        assert.deepEqual(ratchet(at(['SC-A-001']), at(['SC-A-001'])), []);
    });

    test('a debt settled by a test passes', () => {
        // SC-A-002 is still a promise and is no longer owed: something named it.
        const before = at(['SC-A-001', 'SC-A-002']);
        const after = { debt: ['SC-A-001'], standing: ['SC-A-001', 'SC-A-002'] };
        assert.deepEqual(ratchet(before, after), []);
    });

    test('a new promise with nothing proving it is refused', () => {
        const after = at(['SC-A-001', 'SC-A-002']);
        const [problem] = ratchet(at(['SC-A-001']), after);
        assert.match(problem, /1 promise\(s\) arrived with nothing proving them/);
        assert.match(problem, /@requirement SC-A-002/);
    });

    test('a new promise paid for by proving one already owed passes', () => {
        // What makes the rule liveable: a promise with no test worth writing
        // can still be added by settling a debt, rather than through an
        // exemption somebody has to judge.
        const before = at(['SC-A-001', 'SC-A-002']);
        const after = {
            debt: ['SC-A-001', 'SC-A-003'],
            standing: ['SC-A-001', 'SC-A-002', 'SC-A-003'],
        };
        assert.deepEqual(ratchet(before, after), []);
    });

    test('retiring an unproven promise does not pay for a new one', () => {
        // A hole this file once recorded as intended behaviour. Superseding an
        // unproven promise drops it out of the count while its untested
        // successor arrives; both sides totalled the same, and a new promise
        // passed having proved nothing. Retiring proves nothing about it.
        const [problem] = ratchet(at(['SC-A-001']), at(['SC-A-002']));
        assert.match(problem, /0 already owed a proof gained one/);
    });

    test('retiring an unproven promise on its own passes', () => {
        // Nothing arrived, so nothing is owed. Withdrawing makes the debt
        // smaller; it just does not buy anything.
        assert.deepEqual(ratchet(at(['SC-A-001']), at([])), []);
    });

    test('a promise that had a proof and lost it is refused', () => {
        // Net-zero bookkeeping would accept this: one debt settled, one added.
        // But nothing arrived to pay for — a proof was moved from one standing
        // promise to another, and coverage did not improve.
        const before = { debt: ['SC-A-001'], standing: ['SC-A-001', 'SC-A-002'] };
        const after = { debt: ['SC-A-002'], standing: ['SC-A-001', 'SC-A-002'] };
        const [problem] = ratchet(before, after);
        assert.match(problem, /had a proof and no longer do: SC-A-002/);
    });

    test('a proof lost by retiring the promise is not a loss', () => {
        // The counter-proof: a promise that leaves the catalogue cannot be
        // owed anything, so retiring a proved one must stay silent.
        const before = { debt: [], standing: ['SC-A-001'] };
        assert.deepEqual(ratchet(before, { debt: [], standing: [] }), []);
    });
});
