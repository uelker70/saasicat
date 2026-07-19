// Tests für computeCarriedTrialEndsAt (#17) — driftfreie Trial-Carry-over-Formel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCarriedTrialEndsAt } from '../dist/billing/index.js';

const DAY = 86_400_000;

test('carries remaining trial time to a target plan with a longer trial', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    // Aktuell 14 Tage Trial, 10 Tage übrig (4 verbraucht). Ziel 30 Tage.
    const currentTrialEndsAt = new Date(now.getTime() + 10 * DAY);
    const result = computeCarriedTrialEndsAt(14, 30, currentTrialEndsAt, now);
    // neu = 30 − 4 = 26 Tage ab now.
    assert.equal(result.getTime(), now.getTime() + 26 * DAY);
});

test('clamps to 0 when more trial is used than the target offers', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    // 30 Tage Trial, 5 übrig (25 verbraucht). Ziel nur 14 Tage → 14 − 25 < 0.
    const currentTrialEndsAt = new Date(now.getTime() + 5 * DAY);
    const result = computeCarriedTrialEndsAt(30, 14, currentTrialEndsAt, now);
    assert.equal(result.getTime(), now.getTime()); // 0 Tage → endet jetzt
});

test('is drift-free across repeated switches (reconstructs trial start)', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    // Trial-Start war vor 4 Tagen (14-Tage-Trial → 10 übrig). Wechsel auf 14er
    // Ziel: neu = 14 − 4 = 10 Tage — identisch zum Reststand, kein Drift.
    const currentTrialEndsAt = new Date(now.getTime() + 10 * DAY);
    const result = computeCarriedTrialEndsAt(14, 14, currentTrialEndsAt, now);
    assert.equal(result.getTime(), now.getTime() + 10 * DAY);
});

test('treats an already-expired current trial as 0 days remaining', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    const currentTrialEndsAt = new Date(now.getTime() - 3 * DAY); // schon vorbei
    // 14 verbraucht (alle), Ziel 30 → 30 − 14 = 16 Tage.
    const result = computeCarriedTrialEndsAt(14, 30, currentTrialEndsAt, now);
    assert.equal(result.getTime(), now.getTime() + 16 * DAY);
});
