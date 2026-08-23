import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveBundleAvailability,
    missingRequiresFor,
    coverageExcludingSelf,
    isBundleRedundant,
    selectChargeableBundles,
} from '../dist/index.js';

// Bookability derivation (#22/#35) — shared between the tenant bundle store
// and the public/onboarding configurator: a bundle is either "already included"
// (covered), "grayed out" (missing-requires) or bookable.

describe('missingRequiresFor', () => {
    test('returns uncovered requires sorted + deduplicated', () => {
        const bundle = { features: ['A'], requiresFeatures: ['Z', 'M', 'M'] };
        const covered = new Set(['M']);
        assert.deepEqual(missingRequiresFor(bundle, covered), ['Z']);
    });

    test('empty when all requires are covered', () => {
        const bundle = { features: ['A'], requiresFeatures: ['X', 'Y'] };
        const covered = new Set(['X', 'Y']);
        assert.deepEqual(missingRequiresFor(bundle, covered), []);
    });

    test('empty when the bundle has no requires', () => {
        assert.deepEqual(missingRequiresFor({ features: ['A'] }, new Set()), []);
    });
});

describe('resolveBundleAvailability', () => {
    test('bookable when requires covered and features are new', () => {
        const bundle = { features: ['TEAMS'], requiresFeatures: ['CORE'] };
        assert.equal(resolveBundleAvailability(bundle, new Set(['CORE'])), 'bookable');
    });

    test('missing-requires grays out bundle on uncovered prerequisite', () => {
        const bundle = { features: ['TRAINING'], requiresFeatures: ['TEAMS'] };
        assert.equal(resolveBundleAvailability(bundle, new Set()), 'missing-requires');
    });

    test('covered when all bundle features are already covered (already included)', () => {
        const bundle = { features: ['TEAMS', 'TOURNAMENT'] };
        const covered = new Set(['TEAMS', 'TOURNAMENT', 'CORE']);
        assert.equal(resolveBundleAvailability(bundle, covered), 'covered');
    });

    test('covered beats missing-requires (fully covered bundle never bookable)', () => {
        const bundle = { features: ['TEAMS'], requiresFeatures: ['MISSING'] };
        assert.equal(resolveBundleAvailability(bundle, new Set(['TEAMS'])), 'covered');
    });

    test('partial coverage stays bookable (not covered)', () => {
        const bundle = { features: ['TEAMS', 'NEW_FEATURE'] };
        assert.equal(resolveBundleAvailability(bundle, new Set(['TEAMS'])), 'bookable');
    });

    test('bundle without features is never covered', () => {
        assert.equal(resolveBundleAvailability({ features: [] }, new Set(['X'])), 'bookable');
    });
});

describe('coverageExcludingSelf', () => {
    const Y = { bundleVersionId: 'y', features: ['C'] };
    const Z = { bundleVersionId: 'z', features: ['C', 'D'] };

    test('plan ∪ features of the other selected bundles, without the bundle itself', () => {
        const covered = coverageExcludingSelf('y', ['A', 'B'], [Y, Z]);
        assert.deepEqual([...covered].sort(), ['A', 'B', 'C', 'D']);
    });

    test('excludes own features (otherwise every bundle would be trivially covered)', () => {
        const covered = coverageExcludingSelf('z', [], [Z]);
        assert.deepEqual([...covered], []);
    });
});

describe('isBundleRedundant', () => {
    const Y = { bundleVersionId: 'y', features: ['C'] };
    const Z = { bundleVersionId: 'z', features: ['C', 'D'] };

    test('Y is redundant when C is already covered by Z', () => {
        assert.equal(isBundleRedundant(Y, ['A'], [Y, Z]), true);
    });

    test('Z is not redundant — D is not covered elsewhere', () => {
        assert.equal(isBundleRedundant(Z, ['A'], [Y, Z]), false);
    });

    test('redundant when the plan already contains the features', () => {
        assert.equal(isBundleRedundant(Y, ['C'], [Y]), true);
    });

    test('single selected bundle is not redundant (self-exclusion)', () => {
        assert.equal(isBundleRedundant(Y, ['A'], [Y]), false);
    });
});

// selectChargeableBundles — minimal covering subset: keeps exactly the
// bundles that are charged/booked. Iterative instead of one-shot, so that
// mutual/cyclic coverage does not discard ALL participants (otherwise the
// shared feature would be lost — under-charging + lost entitlement).
describe('selectChargeableBundles', () => {
    const ids = (bundles) => bundles.map((b) => b.bundleVersionId);

    test('mutual coverage Y={C},Z={C} → exactly ONE bundle remains (deterministically Z)', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C'] };
        const kept = selectChargeableBundles([], [Y, Z]);
        assert.equal(kept.length, 1, 'must not discard both');
        // Order: bundleVersionId asc → y before z; the earlier redundant one
        // is removed first → z remains.
        assert.deepEqual(ids(kept), ['z']);
        // Feature C stays covered via the kept bundle.
        const coveredFeatures = new Set(kept.flatMap((b) => b.features));
        assert.equal(coveredFeatures.has('C'), true);
    });

    test('input order irrelevant — sorting determines the kept one (z remains)', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C'] };
        assert.deepEqual(ids(selectChargeableBundles([], [Z, Y])), ['z']);
    });

    test('sortOrder controls which bundle is kept', () => {
        // Lower sortOrder is checked first + (if redundant) removed.
        const A = { bundleVersionId: 'a', features: ['C'], sortOrder: 1 };
        const B = { bundleVersionId: 'b', features: ['C'], sortOrder: 2 };
        // a (sortOrder 1) first → redundant → removed → b remains.
        assert.deepEqual(ids(selectChargeableBundles([], [A, B])), ['b']);
    });

    test('3-cycle of identical bundles → exactly ONE remains', () => {
        const A = { bundleVersionId: 'a', features: ['C'] };
        const B = { bundleVersionId: 'b', features: ['C'] };
        const D = { bundleVersionId: 'd', features: ['C'] };
        const kept = selectChargeableBundles([], [A, B, D]);
        assert.equal(kept.length, 1);
        assert.deepEqual(ids(kept), ['d']);
        assert.equal(new Set(kept.flatMap((b) => b.features)).has('C'), true);
    });

    test('chain of proper subsets X⊂Y⊂Z → only the superset Z remains', () => {
        const X = { bundleVersionId: 'x', features: ['C'] };
        const Y = { bundleVersionId: 'y', features: ['C', 'D'] };
        const Z = { bundleVersionId: 'z', features: ['C', 'D', 'E'] };
        const kept = selectChargeableBundles([], [X, Y, Z]);
        assert.deepEqual(ids(kept), ['z']);
        const coveredFeatures = new Set(kept.flatMap((b) => b.features));
        assert.deepEqual([...coveredFeatures].sort(), ['C', 'D', 'E']);
    });

    test('asymmetric Y={C} ⊂ Z={C,D} → Y discarded, Z kept (regression)', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C', 'D'] };
        assert.deepEqual(ids(selectChargeableBundles(['A'], [Y, Z])), ['z']);
    });

    test('bundles covered by the plan are discarded', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        assert.deepEqual(ids(selectChargeableBundles(['C'], [Y])), []);
    });

    test('disjoint bundles are all kept', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['D'] };
        assert.deepEqual(ids(selectChargeableBundles([], [Y, Z])), ['y', 'z']);
    });

    test('empty selection → empty result', () => {
        assert.deepEqual(selectChargeableBundles(['A'], []), []);
    });

    test('does not mutate the input', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C'] };
        const input = [Y, Z];
        selectChargeableBundles([], input);
        assert.deepEqual(input, [Y, Z]);
    });
});
