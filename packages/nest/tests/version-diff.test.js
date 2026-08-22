// Tests for @saasicat/nest/billing — version diff classification.
// Spec: ROADMAP_PLANS_AND_ENTITLEMENT.md §2 No. 2 (regression rule).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlanDiff } from '../dist/billing/index.js';

// ──────────────────────────────────────────────────────────────────
// classifyPlanDiff
// ──────────────────────────────────────────────────────────────────

test('classifyPlanDiff — identical versions → no changes, nonRegressive=true', () => {
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

test('classifyPlanDiff — limit increase → IMPROVEMENT, nonRegressive=true', () => {
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

test('classifyPlanDiff — limit decrease → REGRESSION, nonRegressive=false', () => {
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

test('classifyPlanDiff — price increase → REGRESSION', () => {
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

test('classifyPlanDiff — price decrease → IMPROVEMENT', () => {
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

test('classifyPlanDiff — feature removed → REGRESSION', () => {
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

test('classifyPlanDiff — feature added → IMPROVEMENT', () => {
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

test('classifyPlanDiff — mixed: 1 improvement + 1 regression → nonRegressive=false', () => {
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
