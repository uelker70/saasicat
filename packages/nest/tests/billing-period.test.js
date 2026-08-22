// Tests for @saasicat/nest/billing — period boundary calculation.
// UTC-stable, DST-immune.

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

test('initialPeriodWindow MONTHLY — exactly 1 month', () => {
    const start = new Date('2026-01-15T12:00:00Z');
    const w = initialPeriodWindow(start, 'MONTHLY');
    assert.equal(w.start.toISOString(), '2026-01-15T12:00:00.000Z');
    assert.equal(w.end.toISOString(), '2026-02-15T12:00:00.000Z');
});

test('initialPeriodWindow YEARLY — exactly 1 year', () => {
    const start = new Date('2026-01-15T12:00:00Z');
    const w = initialPeriodWindow(start, 'YEARLY');
    assert.equal(w.end.toISOString(), '2027-01-15T12:00:00.000Z');
});

test('initialPeriodWindow DST transition — UTC-stable', () => {
    // 2026-10-27 is the DST switch in Europe. UTC methods must keep the day
    // unchanged and set it to 11-27.
    const start = new Date('2026-10-27T00:00:00Z');
    const w = initialPeriodWindow(start, 'MONTHLY');
    assert.equal(w.end.toISOString(), '2026-11-27T00:00:00.000Z');
});

// ──────────────────────────────────────────────────────────────────
// periodEndAfter
// ──────────────────────────────────────────────────────────────────

test('periodEndAfter MONTHLY — next period after now', () => {
    const startedAt = new Date('2026-01-15T00:00:00Z');
    const now = new Date('2026-03-20T00:00:00Z');
    const end = periodEndAfter(startedAt, 'MONTHLY', now);
    // After iteration: 01-15 → 02-15 → 03-15 (≤ now) → 04-15 (> now) ✓
    assert.equal(end.toISOString(), '2026-04-15T00:00:00.000Z');
});

test('periodEndAfter YEARLY — skips multiple years', () => {
    const startedAt = new Date('2020-06-01T00:00:00Z');
    const now = new Date('2026-05-15T00:00:00Z');
    const end = periodEndAfter(startedAt, 'YEARLY', now);
    assert.equal(end.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('periodEndAfter with null startedAt — iterate from now', () => {
    const now = new Date('2026-05-15T00:00:00Z');
    const end = periodEndAfter(null, 'MONTHLY', now);
    assert.equal(end.toISOString(), '2026-06-15T00:00:00.000Z');
});

// ──────────────────────────────────────────────────────────────────
// periodEndWithMinLead — 6-week lead time for notification cron
// ──────────────────────────────────────────────────────────────────

test('periodEndWithMinLead YEARLY with ≥42d lead — directly currentPeriodEnd', () => {
    const startedAt = new Date('2020-06-01T00:00:00Z');
    const now = new Date('2026-04-01T00:00:00Z'); // 61 days lead until 06-01
    const end = periodEndWithMinLead(startedAt, 'YEARLY', now);
    assert.equal(end.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('periodEndWithMinLead MONTHLY with <42d lead — skips period', () => {
    const startedAt = new Date('2020-01-15T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    // 05-15 is only 14 days away — 42d lead not met → jumps to 06-15
    const end = periodEndWithMinLead(startedAt, 'MONTHLY', now);
    assert.equal(end.toISOString(), '2026-06-15T00:00:00.000Z');
});

test('periodEndWithMinLead — minLeadDays configurable (14d, accepts exactly 14d)', () => {
    const startedAt = new Date('2020-01-15T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    // 05-15 is exactly 14d away; the implementation iterates while the delta
    // is < minLeadMs (strict-less). At exactly 14d the loop is satisfied,
    // so it stays at 05-15.
    const end = periodEndWithMinLead(startedAt, 'MONTHLY', now, 14);
    assert.equal(end.toISOString(), '2026-05-15T00:00:00.000Z');
});

test('periodEndWithMinLead — minLeadDays 15d on same date jumps to next period', () => {
    const startedAt = new Date('2020-01-15T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    // 05-15 is 14d away — 14 < 15 → jumps to 06-15.
    const end = periodEndWithMinLead(startedAt, 'MONTHLY', now, 15);
    assert.equal(end.toISOString(), '2026-06-15T00:00:00.000Z');
});
