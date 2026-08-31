// Tests for @saasicat/nest/billing — version diff classification.
// Spec: ROADMAP_PLANS_AND_ENTITLEMENT.md §2 No. 2 (regression rule).

// @requirement SC-PLAN-009 — Publishing something that takes away has to be confirmed
// @requirement SC-PLAN-010 — One regressive change makes the whole version regressive

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlanDiff } from '../dist/billing/index.js';

// A plan version as the classifier sees it. `notesMax` is deliberately a key
// no shipped code knows: quotas come from an app's `@DefinesQuota`, and a
// classifier that only handled the ones the platform had heard of is the
// defect these tests exist for.
const base = {
    features: ['F1', 'F2'],
    quotas: { users: 5, notesMax: 100 },
    monthlyNet: '49.90',
    yearlyNet: '499.00',
};

// ──────────────────────────────────────────────────────────────────
// classifyPlanDiff
// ──────────────────────────────────────────────────────────────────

test('classifyPlanDiff — identical versions → no changes, nonRegressive=true', () => {
    const result = classifyPlanDiff(base, base);
    assert.equal(result.changes.length, 0);
    assert.equal(result.nonRegressive, true);
});

// @requirement SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered
describe('classifyPlanDiff — quotas', () => {
    test('a version with no quotas at all → no quota changes', () => {
        const v = { ...base, quotas: {} };
        const result = classifyPlanDiff(v, v);
        assert.equal(result.changes.length, 0);
        assert.equal(result.nonRegressive, true);
    });

    test('limit increase → IMPROVEMENT, nonRegressive=true', () => {
        const oldV = { ...base, quotas: { users: 3 } };
        const newV = { ...oldV, quotas: { users: 5 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, true);
        assert.equal(result.changes.length, 1);
        assert.equal(result.changes[0].field, 'quotas.users');
        assert.equal(result.changes[0].direction, 'IMPROVEMENT');
    });

    test('limit decrease → REGRESSION, nonRegressive=false', () => {
        const oldV = { ...base, quotas: { users: 5 } };
        const newV = { ...oldV, quotas: { users: 3 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, false);
        assert.equal(result.changes[0].field, 'quotas.users');
        assert.equal(result.changes[0].direction, 'REGRESSION');
    });

    test("an installation's own quota lowered → REGRESSION", () => {
        const oldV = { ...base, quotas: { users: 5, notesMax: 100 } };
        const newV = { ...oldV, quotas: { users: 5, notesMax: 50 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, false);
        const change = result.changes.find((c) => c.field === 'quotas.notesMax');
        assert.equal(change.direction, 'REGRESSION');
        assert.equal(change.oldValue, 100);
        assert.equal(change.newValue, 50);
    });

    test("an installation's own quota raised → IMPROVEMENT", () => {
        const oldV = { ...base, quotas: { notesMax: 100 } };
        const newV = { ...oldV, quotas: { notesMax: 200 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, true);
        assert.equal(result.changes[0].field, 'quotas.notesMax');
        assert.equal(result.changes[0].direction, 'IMPROVEMENT');
    });

    test('a quota the successor drops counts as 0 → REGRESSION', () => {
        const oldV = { ...base, quotas: { users: 5, notesMax: 100 } };
        const newV = { ...oldV, quotas: { users: 5 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, false);
        const change = result.changes.find((c) => c.field === 'quotas.notesMax');
        assert.equal(change.oldValue, 100);
        assert.equal(change.newValue, 0);
        assert.equal(change.direction, 'REGRESSION');
    });

    test('a quota the successor adds counts from 0 → IMPROVEMENT', () => {
        const oldV = { ...base, quotas: { users: 5 } };
        const newV = { ...oldV, quotas: { users: 5, notesMax: 100 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, true);
        const change = result.changes.find((c) => c.field === 'quotas.notesMax');
        assert.equal(change.oldValue, 0);
        assert.equal(change.newValue, 100);
        assert.equal(change.direction, 'IMPROVEMENT');
    });

    test('unlimited replaced by a finite number → REGRESSION', () => {
        const oldV = { ...base, quotas: { notesMax: -1 } };
        const newV = { ...oldV, quotas: { notesMax: 10_000 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, false);
        assert.equal(result.changes[0].direction, 'REGRESSION');
    });

    test('a key that names something on Object.prototype is still read as a quota', () => {
        // An installation names its own quotas. `constructor` is a legal key
        // and a plain index read answers it from the prototype, so the side
        // without it would compare a function against a number: every such
        // addition a regression, and a function in the persisted diff.
        const oldV = { ...base, quotas: {} };
        const newV = { ...oldV, quotas: { constructor: 50 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, true);
        assert.deepEqual(result.changes, [
            {
                field: 'quotas.constructor',
                oldValue: 0,
                newValue: 50,
                direction: 'IMPROVEMENT',
            },
        ]);
    });

    test('and dropping one is a regression like any other', () => {
        const oldV = { ...base, quotas: { toString: 10 } };
        const newV = { ...oldV, quotas: {} };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, false);
        assert.deepEqual(result.changes[0], {
            field: 'quotas.toString',
            oldValue: 10,
            newValue: 0,
            direction: 'REGRESSION',
        });
    });

    test('a finite number replaced by unlimited → IMPROVEMENT', () => {
        const oldV = { ...base, quotas: { notesMax: 10_000 } };
        const newV = { ...oldV, quotas: { notesMax: -1 } };
        const result = classifyPlanDiff(oldV, newV);
        assert.equal(result.nonRegressive, true);
        assert.equal(result.changes[0].direction, 'IMPROVEMENT');
    });
});

test('classifyPlanDiff — price increase → REGRESSION', () => {
    const newV = { ...base, monthlyNet: '54.90' };
    const result = classifyPlanDiff(base, newV);
    assert.equal(result.nonRegressive, false);
    const priceChange = result.changes.find((c) => c.field === 'monthlyNet');
    assert.ok(priceChange);
    assert.equal(priceChange.direction, 'REGRESSION');
    assert.equal(priceChange.oldValue, '49.90');
    assert.equal(priceChange.newValue, '54.90');
});

test('classifyPlanDiff — price decrease → IMPROVEMENT', () => {
    const newV = { ...base, monthlyNet: '44.90' };
    const result = classifyPlanDiff(base, newV);
    assert.equal(result.nonRegressive, true);
    const priceChange = result.changes.find((c) => c.field === 'monthlyNet');
    assert.equal(priceChange.direction, 'IMPROVEMENT');
});

test('classifyPlanDiff — feature removed → REGRESSION', () => {
    const oldV = { ...base, features: ['F1', 'F2', 'F3'] };
    const newV = { ...oldV, features: ['F1', 'F2'] };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, false);
    const removed = result.changes.find((c) => c.field === 'features.removed');
    assert.deepEqual(removed.oldValue, ['F3']);
    assert.equal(removed.direction, 'REGRESSION');
});

test('classifyPlanDiff — feature added → IMPROVEMENT', () => {
    const oldV = { ...base, features: ['F1'] };
    const newV = { ...oldV, features: ['F1', 'F2'] };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, true);
    const added = result.changes.find((c) => c.field === 'features.added');
    assert.deepEqual(added.newValue, ['F2']);
    assert.equal(added.direction, 'IMPROVEMENT');
});

test('classifyPlanDiff — mixed: 1 improvement + 1 regression → nonRegressive=false', () => {
    const oldV = { ...base, quotas: { users: 3 } };
    const newV = { ...oldV, quotas: { users: 5 }, monthlyNet: '54.90' };
    const result = classifyPlanDiff(oldV, newV);
    // ROADMAP §2 No. 2: "as soon as AT LEAST ONE individual change is a
    // REGRESSION, the entire version counts as regressive" — even when there
    // are positive parts.
    assert.equal(result.nonRegressive, false);
});

// ──────────────────────────────────────────────────────────────────
// Decimal-like inputs
// ──────────────────────────────────────────────────────────────────

test('classifyPlanDiff — Decimal-like object with toNumber() accepted', () => {
    const decimal = { toNumber: () => 49.9 };
    const oldV = { ...base, monthlyNet: decimal };
    const newV = { ...oldV, monthlyNet: { toNumber: () => 54.9 } };
    const result = classifyPlanDiff(oldV, newV);
    const change = result.changes.find((c) => c.field === 'monthlyNet');
    assert.equal(change.oldValue, '49.90');
    assert.equal(change.newValue, '54.90');
});
