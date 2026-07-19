// Tests für @saasicat/nest/billing — Periodengrenz-Berechnung.
// UTC-stabil, DST-immun.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialPeriodWindow,
    periodEndAfter,
    periodEndWithMinLead,
} from '../dist/billing/index.js';

// ──────────────────────────────────────────────────────────────────
// initialPeriodWindow
// ──────────────────────────────────────────────────────────────────

test('initialPeriodWindow MONTHLY — exakt 1 Monat', () => {
    const start = new Date('2026-01-15T12:00:00Z');
    const w = initialPeriodWindow(start, 'MONTHLY');
    assert.equal(w.start.toISOString(), '2026-01-15T12:00:00.000Z');
    assert.equal(w.end.toISOString(), '2026-02-15T12:00:00.000Z');
});

test('initialPeriodWindow YEARLY — exakt 1 Jahr', () => {
    const start = new Date('2026-01-15T12:00:00Z');
    const w = initialPeriodWindow(start, 'YEARLY');
    assert.equal(w.end.toISOString(), '2027-01-15T12:00:00.000Z');
});

test('initialPeriodWindow DST-Übergang — UTC-stabil', () => {
    // 27.10.2026 ist DST-Wechsel in Europa. UTC-Methoden müssen den Tag
    // unverändert auf 27.11. setzen.
    const start = new Date('2026-10-27T00:00:00Z');
    const w = initialPeriodWindow(start, 'MONTHLY');
    assert.equal(w.end.toISOString(), '2026-11-27T00:00:00.000Z');
});

// ──────────────────────────────────────────────────────────────────
// periodEndAfter
// ──────────────────────────────────────────────────────────────────

test('periodEndAfter MONTHLY — nächste Periode nach now', () => {
    const startedAt = new Date('2026-01-15T00:00:00Z');
    const now = new Date('2026-03-20T00:00:00Z');
    const end = periodEndAfter(startedAt, 'MONTHLY', now);
    // Nach Iteration: 15.01 → 15.02 → 15.03 (≤ now) → 15.04 (> now) ✓
    assert.equal(end.toISOString(), '2026-04-15T00:00:00.000Z');
});

test('periodEndAfter YEARLY — überspringt mehrere Jahre', () => {
    const startedAt = new Date('2020-06-01T00:00:00Z');
    const now = new Date('2026-05-15T00:00:00Z');
    const end = periodEndAfter(startedAt, 'YEARLY', now);
    assert.equal(end.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('periodEndAfter mit null startedAt — ab now iterieren', () => {
    const now = new Date('2026-05-15T00:00:00Z');
    const end = periodEndAfter(null, 'MONTHLY', now);
    assert.equal(end.toISOString(), '2026-06-15T00:00:00.000Z');
});

// ──────────────────────────────────────────────────────────────────
// periodEndWithMinLead — 6-Wochen-Vorlauf für Notification-Cron
// ──────────────────────────────────────────────────────────────────

test('periodEndWithMinLead YEARLY mit ≥42d Vorlauf — direkt currentPeriodEnd', () => {
    const startedAt = new Date('2020-06-01T00:00:00Z');
    const now = new Date('2026-04-01T00:00:00Z'); // 61 Tage Vorlauf bis 01.06
    const end = periodEndWithMinLead(startedAt, 'YEARLY', now);
    assert.equal(end.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('periodEndWithMinLead MONTHLY mit <42d Vorlauf — überspringt Periode', () => {
    const startedAt = new Date('2020-01-15T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    // 15.05 ist nur 14 Tage entfernt — 42d-Lead nicht erfüllt → springt auf 15.06
    const end = periodEndWithMinLead(startedAt, 'MONTHLY', now);
    assert.equal(end.toISOString(), '2026-06-15T00:00:00.000Z');
});

test('periodEndWithMinLead — minLeadDays konfigurierbar (14d, akzeptiert exakt 14d)', () => {
    const startedAt = new Date('2020-01-15T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    // 15.05 ist genau 14d entfernt; Implementation iteriert solange das Delta
    // < minLeadMs ist (strict-less). Bei exakt 14d ist der Loop zufrieden,
    // bleibt also bei 15.05.
    const end = periodEndWithMinLead(startedAt, 'MONTHLY', now, 14);
    assert.equal(end.toISOString(), '2026-05-15T00:00:00.000Z');
});

test('periodEndWithMinLead — minLeadDays 15d auf gleiches Datum springt auf nächste Periode', () => {
    const startedAt = new Date('2020-01-15T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    // 15.05 ist 14d entfernt — 14 < 15 → springt auf 15.06.
    const end = periodEndWithMinLead(startedAt, 'MONTHLY', now, 15);
    assert.equal(end.toISOString(), '2026-06-15T00:00:00.000Z');
});
