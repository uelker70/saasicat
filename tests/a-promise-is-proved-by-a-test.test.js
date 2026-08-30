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
import { annotationsIn, isTestPath, unproven } from '../scripts/requirements/proof.mjs';
import { ratchet } from '../scripts/requirements/guard.mjs';

const head = () => '---\ntitle: Title\n---\n\nIntro.\n';
const entry = (id, text) => `### ${id} — Title\n\n${text}\n\n_Source:_ #1`;
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

    test('the tag inside a sentence is not a claim either', () => {
        // The case that was wrong, and the file that documents the mechanism is
        // the one most likely to contain it. This sentence used to prove
        // SC-PLAN-004.
        assert.deepEqual(annotationsIn('// the `@requirement SC-A-001` tag names it'), []);
        assert.deepEqual(annotationsIn('// as @requirement SC-A-001 shows'), []);
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

describe('the debt may shrink and may not grow', () => {
    test('an unchanged debt passes', () => {
        assert.deepEqual(ratchet(['SC-A-001'], ['SC-A-001']), []);
    });

    test('a smaller debt passes', () => {
        assert.deepEqual(ratchet(['SC-A-001', 'SC-A-002'], ['SC-A-001']), []);
    });

    test('a new promise with nothing proving it is refused', () => {
        const [problem] = ratchet(['SC-A-001'], ['SC-A-001', 'SC-A-002']);
        assert.match(problem, /up from 1/);
        assert.match(problem, /SC-A-002/);
        assert.match(problem, /@requirement SC-A-002/);
    });

    test('a new promise paid for by proving an old one passes', () => {
        // The property that makes this liveable. A promise that genuinely has
        // no test worth writing can still be added — by settling a debt that
        // was already owed, rather than by an exemption somebody has to judge.
        assert.deepEqual(ratchet(['SC-A-001'], ['SC-A-002']), []);
    });
});
