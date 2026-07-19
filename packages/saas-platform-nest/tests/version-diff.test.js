// Tests für @saasicat/nest/billing — Version-Diff-Klassifikation.
// Spec: ROADMAP_PLANS_AND_ENTITLEMENT.md §2 Nr. 2 (Regression-Regel).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlanDiff } from '../dist/billing/index.js';

// ──────────────────────────────────────────────────────────────────
// classifyPlanDiff
// ──────────────────────────────────────────────────────────────────

test('classifyPlanDiff — identische Versionen → keine Changes, nonRegressive=true', () => {
    const v = {
        features: ['F1', 'F2'],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const result = classifyPlanDiff(v, v);
    assert.equal(result.changes.length, 0);
    assert.equal(result.nonRegressive, true);
});

test('classifyPlanDiff — Limit-Erhöhung → IMPROVEMENT, nonRegressive=true', () => {
    const oldV = {
        features: [],
        maxUsers: 3,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, maxUsers: 5 };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, true);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].field, 'maxUsers');
    assert.equal(result.changes[0].direction, 'IMPROVEMENT');
});

test('classifyPlanDiff — Limit-Senkung → REGRESSION, nonRegressive=false', () => {
    const oldV = {
        features: [],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, maxUsers: 3 };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, false);
    assert.equal(result.changes[0].direction, 'REGRESSION');
});

test('classifyPlanDiff — Preis-Erhöhung → REGRESSION', () => {
    const oldV = {
        features: [],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, monthlyNet: '54.90' };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, false);
    const priceChange = result.changes.find((c) => c.field === 'monthlyNet');
    assert.ok(priceChange);
    assert.equal(priceChange.direction, 'REGRESSION');
    assert.equal(priceChange.oldValue, '49.90');
    assert.equal(priceChange.newValue, '54.90');
});

test('classifyPlanDiff — Preis-Senkung → IMPROVEMENT', () => {
    const oldV = {
        features: [],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, monthlyNet: '44.90' };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, true);
    const priceChange = result.changes.find((c) => c.field === 'monthlyNet');
    assert.equal(priceChange.direction, 'IMPROVEMENT');
});

test('classifyPlanDiff — Feature entfernt → REGRESSION', () => {
    const oldV = {
        features: ['F1', 'F2', 'F3'],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, features: ['F1', 'F2'] };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, false);
    const removed = result.changes.find((c) => c.field === 'features.removed');
    assert.deepEqual(removed.oldValue, ['F3']);
    assert.equal(removed.direction, 'REGRESSION');
});

test('classifyPlanDiff — Feature hinzu → IMPROVEMENT', () => {
    const oldV = {
        features: ['F1'],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, features: ['F1', 'F2'] };
    const result = classifyPlanDiff(oldV, newV);
    assert.equal(result.nonRegressive, true);
    const added = result.changes.find((c) => c.field === 'features.added');
    assert.deepEqual(added.newValue, ['F2']);
    assert.equal(added.direction, 'IMPROVEMENT');
});

test('classifyPlanDiff — gemischt: 1 Verbesserung + 1 Regression → nonRegressive=false', () => {
    const oldV = {
        features: ['F1', 'F2'],
        maxUsers: 3,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: '49.90',
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, maxUsers: 5, monthlyNet: '54.90' };
    const result = classifyPlanDiff(oldV, newV);
    // ROADMAP §2 Nr. 2: "sobald MINDESTENS EINE einzelne Änderung REGRESSION
    // hat, gilt die gesamte Version als regressiv" — auch bei positiven
    // Anteilen.
    assert.equal(result.nonRegressive, false);
});

// ──────────────────────────────────────────────────────────────────
// Decimal-like inputs
// ──────────────────────────────────────────────────────────────────

test('classifyPlanDiff — Decimal-like-Objekt mit toNumber() akzeptiert', () => {
    const decimal = { toNumber: () => 49.9 };
    const oldV = {
        features: [],
        maxUsers: 5,
        maxVehicles: 50,
        maxStorageGb: 25,
        monthlyNet: decimal,
        yearlyNet: '499.00',
    };
    const newV = { ...oldV, monthlyNet: { toNumber: () => 54.9 } };
    const result = classifyPlanDiff(oldV, newV);
    const change = result.changes.find((c) => c.field === 'monthlyNet');
    assert.equal(change.oldValue, '49.90');
    assert.equal(change.newValue, '54.90');
});
