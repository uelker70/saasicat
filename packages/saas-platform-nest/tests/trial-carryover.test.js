// Tests for computeCarriedTrialEndsAt (#17) — drift-free trial carry-over formula.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCarriedTrialEndsAt } from '../dist/billing/index.js';

const DAY = 86_400_000;

test('carries remaining trial time to a target plan with a longer trial', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    // Currently a 14-day trial, 10 days left (4 used). Target 30 days.
    const currentTrialEndsAt = new Date(now.getTime() + 10 * DAY);
    const result = computeCarriedTrialEndsAt(14, 30, currentTrialEndsAt, now);
    // new = 30 − 4 = 26 days from now.
    assert.equal(result.getTime(), now.getTime() + 26 * DAY);
});

test('clamps to 0 when more trial is used than the target offers', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    // 30-day trial, 5 left (25 used). Target only 14 days → 14 − 25 < 0.
    const currentTrialEndsAt = new Date(now.getTime() + 5 * DAY);
    const result = computeCarriedTrialEndsAt(30, 14, currentTrialEndsAt, now);
    assert.equal(result.getTime(), now.getTime()); // 0 days → ends now
});

test('is drift-free across repeated switches (reconstructs trial start)', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    // Trial started 4 days ago (14-day trial → 10 left). Switching to a 14-day
    // target: new = 14 − 4 = 10 days — identical to the remaining balance, no drift.
    const currentTrialEndsAt = new Date(now.getTime() + 10 * DAY);
    const result = computeCarriedTrialEndsAt(14, 14, currentTrialEndsAt, now);
    assert.equal(result.getTime(), now.getTime() + 10 * DAY);
});

test('treats an already-expired current trial as 0 days remaining', () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    const currentTrialEndsAt = new Date(now.getTime() - 3 * DAY); // already past
    // 14 used (all), target 30 → 30 − 14 = 16 days.
    const result = computeCarriedTrialEndsAt(14, 30, currentTrialEndsAt, now);
    assert.equal(result.getTime(), now.getTime() + 16 * DAY);
});
