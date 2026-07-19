import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveBundleAvailability,
    missingRequiresFor,
    coverageExcludingSelf,
    isBundleRedundant,
    selectChargeableBundles,
} from '../dist/index.js';

// Buchbarkeits-Ableitung (#22/#35) — geteilt zwischen Tenant-Bundle-Store
// und Public/Onboarding-Konfigurator: ein Bundle ist „bereits enthalten"
// (covered), „ausgegraut" (missing-requires) oder buchbar.

describe('missingRequiresFor', () => {
    test('liefert ungedeckte requires sortiert + dedupliziert', () => {
        const bundle = { features: ['A'], requiresFeatures: ['Z', 'M', 'M'] };
        const covered = new Set(['M']);
        assert.deepEqual(missingRequiresFor(bundle, covered), ['Z']);
    });

    test('leer, wenn alle requires gedeckt sind', () => {
        const bundle = { features: ['A'], requiresFeatures: ['X', 'Y'] };
        const covered = new Set(['X', 'Y']);
        assert.deepEqual(missingRequiresFor(bundle, covered), []);
    });

    test('leer, wenn das Bundle keine requires hat', () => {
        assert.deepEqual(missingRequiresFor({ features: ['A'] }, new Set()), []);
    });
});

describe('resolveBundleAvailability', () => {
    test('bookable, wenn requires gedeckt und Features neu sind', () => {
        const bundle = { features: ['TEAMS'], requiresFeatures: ['CORE'] };
        assert.equal(resolveBundleAvailability(bundle, new Set(['CORE'])), 'bookable');
    });

    test('missing-requires graut Bundle bei ungedeckter Voraussetzung aus', () => {
        const bundle = { features: ['TRAINING'], requiresFeatures: ['TEAMS'] };
        assert.equal(resolveBundleAvailability(bundle, new Set()), 'missing-requires');
    });

    test('covered, wenn alle Bundle-Features bereits gedeckt sind (bereits enthalten)', () => {
        const bundle = { features: ['TEAMS', 'TOURNAMENT'] };
        const covered = new Set(['TEAMS', 'TOURNAMENT', 'CORE']);
        assert.equal(resolveBundleAvailability(bundle, covered), 'covered');
    });

    test('covered schlägt missing-requires (vollständig gedecktes Bundle nie buchbar)', () => {
        const bundle = { features: ['TEAMS'], requiresFeatures: ['MISSING'] };
        assert.equal(resolveBundleAvailability(bundle, new Set(['TEAMS'])), 'covered');
    });

    test('teilweise Deckung bleibt buchbar (nicht covered)', () => {
        const bundle = { features: ['TEAMS', 'NEW_FEATURE'] };
        assert.equal(resolveBundleAvailability(bundle, new Set(['TEAMS'])), 'bookable');
    });

    test('Bundle ohne Features ist nie covered', () => {
        assert.equal(resolveBundleAvailability({ features: [] }, new Set(['X'])), 'bookable');
    });
});

describe('coverageExcludingSelf', () => {
    const Y = { bundleVersionId: 'y', features: ['C'] };
    const Z = { bundleVersionId: 'z', features: ['C', 'D'] };

    test('Plan ∪ Features der übrigen gewählten Bundles, ohne das Bundle selbst', () => {
        const covered = coverageExcludingSelf('y', ['A', 'B'], [Y, Z]);
        assert.deepEqual([...covered].sort(), ['A', 'B', 'C', 'D']);
    });

    test('schließt eigene Features aus (sonst wäre jedes Bundle trivial gedeckt)', () => {
        const covered = coverageExcludingSelf('z', [], [Z]);
        assert.deepEqual([...covered], []);
    });
});

describe('isBundleRedundant', () => {
    const Y = { bundleVersionId: 'y', features: ['C'] };
    const Z = { bundleVersionId: 'z', features: ['C', 'D'] };

    test('Y ist redundant, wenn C bereits durch Z gedeckt ist', () => {
        assert.equal(isBundleRedundant(Y, ['A'], [Y, Z]), true);
    });

    test('Z ist nicht redundant — D ist nicht anderweitig gedeckt', () => {
        assert.equal(isBundleRedundant(Z, ['A'], [Y, Z]), false);
    });

    test('redundant, wenn der Plan die Features schon enthält', () => {
        assert.equal(isBundleRedundant(Y, ['C'], [Y]), true);
    });

    test('einzeln gewähltes Bundle ist nicht redundant (Self-Exclusion)', () => {
        assert.equal(isBundleRedundant(Y, ['A'], [Y]), false);
    });
});

// selectChargeableBundles — minimal-deckende Teilmenge: behält genau die
// Bundles, die berechnet/gebucht werden. Iterativ statt einmalig, damit
// gegenseitige/zyklische Deckung nicht ALLE Beteiligten verwirft (sonst ginge
// das gemeinsame Feature verloren — Unter-Berechnung + verlorenes Entitlement).
describe('selectChargeableBundles', () => {
    const ids = (bundles) => bundles.map((b) => b.bundleVersionId);

    test('gegenseitige Deckung Y={C},Z={C} → genau EIN Bundle bleibt (deterministisch Z)', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C'] };
        const kept = selectChargeableBundles([], [Y, Z]);
        assert.equal(kept.length, 1, 'darf nicht beide verwerfen');
        // Reihenfolge: bundleVersionId asc → y vor z; das frühere redundante
        // wird zuerst entfernt → z bleibt.
        assert.deepEqual(ids(kept), ['z']);
        // Feature C ist über das behaltene Bundle weiter gedeckt.
        const coveredFeatures = new Set(kept.flatMap((b) => b.features));
        assert.equal(coveredFeatures.has('C'), true);
    });

    test('Eingabe-Reihenfolge egal — Sortierung bestimmt den behaltenen (z bleibt)', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C'] };
        assert.deepEqual(ids(selectChargeableBundles([], [Z, Y])), ['z']);
    });

    test('sortOrder steuert, welches Bundle behalten wird', () => {
        // Niedrigere sortOrder wird zuerst geprüft + (wenn redundant) entfernt.
        const A = { bundleVersionId: 'a', features: ['C'], sortOrder: 1 };
        const B = { bundleVersionId: 'b', features: ['C'], sortOrder: 2 };
        // a (sortOrder 1) zuerst → redundant → entfernt → b bleibt.
        assert.deepEqual(ids(selectChargeableBundles([], [A, B])), ['b']);
    });

    test('3er-Zyklus identischer Bundles → genau EINES bleibt', () => {
        const A = { bundleVersionId: 'a', features: ['C'] };
        const B = { bundleVersionId: 'b', features: ['C'] };
        const D = { bundleVersionId: 'd', features: ['C'] };
        const kept = selectChargeableBundles([], [A, B, D]);
        assert.equal(kept.length, 1);
        assert.deepEqual(ids(kept), ['d']);
        assert.equal(new Set(kept.flatMap((b) => b.features)).has('C'), true);
    });

    test('Kette echter Teilmengen X⊂Y⊂Z → nur der Superset Z bleibt', () => {
        const X = { bundleVersionId: 'x', features: ['C'] };
        const Y = { bundleVersionId: 'y', features: ['C', 'D'] };
        const Z = { bundleVersionId: 'z', features: ['C', 'D', 'E'] };
        const kept = selectChargeableBundles([], [X, Y, Z]);
        assert.deepEqual(ids(kept), ['z']);
        const coveredFeatures = new Set(kept.flatMap((b) => b.features));
        assert.deepEqual([...coveredFeatures].sort(), ['C', 'D', 'E']);
    });

    test('asymmetrisch Y={C} ⊂ Z={C,D} → Y verworfen, Z behalten (Regression)', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C', 'D'] };
        assert.deepEqual(ids(selectChargeableBundles(['A'], [Y, Z])), ['z']);
    });

    test('vom Plan gedeckte Bundles werden verworfen', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        assert.deepEqual(ids(selectChargeableBundles(['C'], [Y])), []);
    });

    test('disjunkte Bundles bleiben alle erhalten', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['D'] };
        assert.deepEqual(ids(selectChargeableBundles([], [Y, Z])), ['y', 'z']);
    });

    test('leere Auswahl → leeres Ergebnis', () => {
        assert.deepEqual(selectChargeableBundles(['A'], []), []);
    });

    test('mutiert die Eingabe nicht', () => {
        const Y = { bundleVersionId: 'y', features: ['C'] };
        const Z = { bundleVersionId: 'z', features: ['C'] };
        const input = [Y, Z];
        selectChargeableBundles([], input);
        assert.deepEqual(input, [Y, Z]);
    });
});
