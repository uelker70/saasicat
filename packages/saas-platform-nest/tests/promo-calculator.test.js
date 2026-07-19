// Tests für @saasicat/nest/promo — Calculator + Math.
// Pure-Function-Tests; keine DB, keine NestJS-DI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addCycles,
    buildLabel,
    computeDiscountGross,
    computeDiscountedGross,
    computeIncludedVat,
    computeRegularStartsAt,
    grossFromNet,
    round2,
} from '../dist/promo/index.js';

// ──────────────────────────────────────────────────────────────────
// Math
// ──────────────────────────────────────────────────────────────────

test('round2 rundet auf zwei Dezimalstellen', () => {
    assert.equal(round2(1.234), 1.23);
    assert.equal(round2(1.235), 1.24);
    assert.equal(round2(0.1 + 0.2), 0.3);
    // round2 nutzt Math.round(n*100)/100 — FP-Edge-Cases wie 1.005 (entspricht
    // intern 1.00499…) runden ab. Das ist identisch zu AutohausPro/shared-utils.
    assert.equal(round2(1.005), 1);
});

test('grossFromNet addiert MwSt', () => {
    assert.equal(grossFromNet(100, 19), 119);
    assert.equal(grossFromNet(24.9, 19), 29.63);
});

test('computeIncludedVat extrahiert MwSt aus Brutto', () => {
    assert.equal(computeIncludedVat(119, 19), 19);
    assert.equal(computeIncludedVat(29.63, 19), 4.73);
});

// ──────────────────────────────────────────────────────────────────
// Calculator: Rabatte
// ──────────────────────────────────────────────────────────────────

test('computeDiscountGross PERCENT 25%', () => {
    const result = computeDiscountGross({ gross: 100 }, { valueType: 'PERCENT', value: 25 });
    assert.equal(result, 25);
});

test('computeDiscountGross ABSOLUTE 30 EUR', () => {
    const result = computeDiscountGross({ gross: 100 }, { valueType: 'ABSOLUTE', value: 30 });
    assert.equal(result, 30);
});

test('computeDiscountGross akzeptiert Prisma-Decimal-String', () => {
    // Prisma liefert Decimal als String — Number(string) muss funktionieren.
    const result = computeDiscountGross({ gross: 100 }, { valueType: 'PERCENT', value: '25' });
    assert.equal(result, 25);
});

test('computeDiscountedGross subtrahiert', () => {
    assert.equal(computeDiscountedGross(100, 25), 75);
    assert.equal(computeDiscountedGross(50, 12.5), 37.5);
    // FP-Edge-Case: 29.9 - 7.475 wäre mathematisch 22.425, FP liefert ~22.4249…,
    // round2 → 22.42. Wir akzeptieren das, weil die Original-AutohausPro-Logik
    // identisch arbeitet.
    assert.equal(computeDiscountedGross(29.9, 7.475), 22.42);
});

// ──────────────────────────────────────────────────────────────────
// Calculator: Datums-Mathematik
// ──────────────────────────────────────────────────────────────────

// Date-Komponenten in lokaler Zeit prüfen — die Calculator-Funktionen nutzen
// setMonth/setFullYear (lokale Zeit), wie in der AutohausPro-Vorlage. Tests sind
// damit Timezone-/DST-stabil.
function expectLocalDate(actual, year, monthIndex, day) {
    assert.equal(actual.getFullYear(), year);
    assert.equal(actual.getMonth(), monthIndex);
    assert.equal(actual.getDate(), day);
}

test('addCycles MONTHLY +3', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0); // 15.01.2026 lokal
    const result = addCycles(start, 'MONTHLY', 3);
    expectLocalDate(result, 2026, 3, 15);
});

test('addCycles YEARLY +2', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = addCycles(start, 'YEARLY', 2);
    expectLocalDate(result, 2028, 0, 15);
});

test('computeRegularStartsAt ONCE → eine Periode', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = computeRegularStartsAt(start, 'MONTHLY', 'ONCE', null);
    expectLocalDate(result, 2026, 1, 15);
});

test('computeRegularStartsAt MONTHS 6', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = computeRegularStartsAt(start, 'YEARLY', 'MONTHS', 6);
    expectLocalDate(result, 2026, 6, 15);
});

test('computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = computeRegularStartsAt(start, 'YEARLY', 'BILLING_CYCLES', 2);
    expectLocalDate(result, 2028, 0, 15);
});

// ──────────────────────────────────────────────────────────────────
// Calculator: Labels
// ──────────────────────────────────────────────────────────────────

test('buildLabel ONCE PERCENT', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 25, durationType: 'ONCE', durationValue: null },
        'MONTHLY',
    );
    assert.equal(label, '25 % einmalig');
});

test('buildLabel MONTHS 6 ABSOLUTE', () => {
    const label = buildLabel(
        { valueType: 'ABSOLUTE', value: 5, durationType: 'MONTHS', durationValue: 6 },
        'MONTHLY',
    );
    assert.equal(label, '5,00 € für 6 Monate');
});

test('buildLabel BILLING_CYCLES 1 YEARLY → "im ersten Jahr"', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 10, durationType: 'BILLING_CYCLES', durationValue: 1 },
        'YEARLY',
    );
    assert.equal(label, '10 % im ersten Jahr');
});

test('buildLabel MONTHS 1 → Singular', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 25, durationType: 'MONTHS', durationValue: 1 },
        'MONTHLY',
    );
    assert.equal(label, '25 % im ersten Monat');
});
