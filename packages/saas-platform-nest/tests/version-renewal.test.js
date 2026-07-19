import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clearPendingPlanVersionFields,
    computeNextPeriod,
    decideRenewal,
} from '../dist/billing/index.js';

const NOW = new Date('2026-05-08T12:00:00Z');

describe('decideRenewal', () => {
    test('SKIP wenn keine pending-Version', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: null,
                    pendingPlanVersionEffectiveAt: null,
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: true,
                },
                NOW,
            ),
            'SKIP',
        );
    });

    test('SKIP wenn EffectiveAt in der Zukunft', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-06-01'),
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: true,
                },
                NOW,
            ),
            'SKIP',
        );
    });

    test('ROLL_FORWARD bei nonRegressive=true', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-04-01'),
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: true,
                },
                NOW,
            ),
            'ROLL_FORWARD',
        );
    });

    test('ROLL_FORWARD bei accepted=true (auch wenn regressiv)', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-04-01'),
                    pendingPlanVersionAccepted: true,
                    pendingPlanVersionNonRegressive: false,
                },
                NOW,
            ),
            'ROLL_FORWARD',
        );
    });

    test('CLEAR_PENDING bei regressiv + nicht akzeptiert (Variante B)', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-04-01'),
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: false,
                },
                NOW,
            ),
            'CLEAR_PENDING',
        );
    });
});

describe('clearPendingPlanVersionFields', () => {
    test('liefert alle pending-Felder als null/false', () => {
        const fields = clearPendingPlanVersionFields();
        assert.equal(fields.pendingPlanVersionId, null);
        assert.equal(fields.pendingPlanVersionEffectiveAt, null);
        assert.equal(fields.pendingPlanVersionAccepted, false);
        assert.equal(fields.pendingPlanVersionAcceptedAt, null);
        assert.equal(fields.pendingPlanVersionAcceptedByUserId, null);
        assert.equal(fields.pendingPlanVersionNotifiedAt, null);
        assert.equal(fields.pendingPlanVersionReminderSentAt, null);
    });
});

describe('computeNextPeriod', () => {
    test('null wenn canceledAt gesetzt', () => {
        assert.equal(
            computeNextPeriod(
                {
                    currentPeriodEnd: new Date('2026-04-01'),
                    billingCycle: 'MONTHLY',
                    canceledAt: new Date('2026-04-15'),
                },
                NOW,
            ),
            null,
        );
    });

    test('null wenn currentPeriodEnd null (Trial)', () => {
        assert.equal(
            computeNextPeriod(
                { currentPeriodEnd: null, billingCycle: 'YEARLY', canceledAt: null },
                NOW,
            ),
            null,
        );
    });

    test('null wenn currentPeriodEnd in der Zukunft', () => {
        assert.equal(
            computeNextPeriod(
                {
                    currentPeriodEnd: new Date('2026-06-01'),
                    billingCycle: 'MONTHLY',
                    canceledAt: null,
                },
                NOW,
            ),
            null,
        );
    });

    test('rollt MONTHLY-Periode +1 Monat (Cron-täglich, periodEnd 1 Tag vor now)', () => {
        // periodEndAfter iteriert, bis das Ergebnis > `now` ist. Bei einem
        // täglichen Cron ist periodEnd typischerweise 1 Tag vor now → nächste
        // Periode = oldEnd + 1 Cycle.
        const result = computeNextPeriod(
            {
                currentPeriodEnd: new Date('2026-05-07T12:00:00Z'),
                billingCycle: 'MONTHLY',
                canceledAt: null,
            },
            NOW,
        );
        assert.notEqual(result, null);
        assert.equal(result.currentPeriodStart.toISOString(), '2026-05-07T12:00:00.000Z');
        assert.equal(result.currentPeriodEnd.toISOString(), '2026-06-07T12:00:00.000Z');
    });

    test('rollt YEARLY-Periode +1 Jahr', () => {
        const result = computeNextPeriod(
            {
                currentPeriodEnd: new Date('2026-05-07T12:00:00Z'),
                billingCycle: 'YEARLY',
                canceledAt: null,
            },
            NOW,
        );
        assert.notEqual(result, null);
        assert.equal(result.currentPeriodEnd.toISOString(), '2027-05-07T12:00:00.000Z');
    });

    test('Cron-Lag: bei mehreren versäumten Perioden springt auf die nächste Zukunft', () => {
        // Wenn der Cron eine Weile ausgefallen war und periodEnd schon 2
        // Monate alt ist, soll die Funktion direkt auf die übernächste
        // Periode springen (>= now). Sonst würde der nächste Cron-Lauf am
        // Folgetag wieder rollen.
        const result = computeNextPeriod(
            {
                currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
                billingCycle: 'MONTHLY',
                canceledAt: null,
            },
            NOW,
        );
        assert.notEqual(result, null);
        assert.ok(result.currentPeriodEnd > NOW);
    });
});
