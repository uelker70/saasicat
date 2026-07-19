import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntitlementPlan } from '../dist/entitlement/index.js';

const NOW = new Date('2026-05-08T12:00:00Z');

describe('resolveEntitlementPlan — Trial / Pilot / Pending', () => {
    test('Default: kein Override → subscription.plan', () => {
        const plan = resolveEntitlementPlan({ plan: 'STANDARD', status: 'ACTIVE' }, {}, NOW);
        assert.equal(plan, 'STANDARD');
    });

    test('Pilot: pilotEntitlementPlan überschreibt', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'STANDARD', status: 'ACTIVE', isPilot: true },
            { pilotEntitlementPlan: 'BUSINESS' },
            NOW,
        );
        assert.equal(plan, 'BUSINESS');
    });

    test('Pilot ohne Config: fällt auf subscription.plan zurück', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'STANDARD', status: 'ACTIVE', isPilot: true },
            {},
            NOW,
        );
        assert.equal(plan, 'STANDARD');
    });

    test('TRIAL: subscription.trialEntitlementPlan gewinnt', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'BASIC', status: 'TRIAL', trialEntitlementPlan: 'PROFESSIONAL' },
            { defaultTrialEntitlementPlan: 'STANDARD' },
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('TRIAL ohne trialEntitlementPlan: fällt auf defaultTrialEntitlementPlan', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'BASIC', status: 'TRIAL', trialEntitlementPlan: null },
            { defaultTrialEntitlementPlan: 'PROFESSIONAL' },
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('TRIAL ganz ohne Config: fällt auf subscription.plan zurück', () => {
        const plan = resolveEntitlementPlan({ plan: 'BASIC', status: 'TRIAL' }, {}, NOW);
        assert.equal(plan, 'BASIC');
    });

    test('PENDING_SALES: pendingSalesEntitlementPlan überschreibt', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'ENTERPRISE', status: 'PENDING_SALES' },
            { pendingSalesEntitlementPlan: 'PROFESSIONAL' },
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('Pending-Plan-Wechsel: greift, sobald pendingEffectiveAt in der Vergangenheit', () => {
        const plan = resolveEntitlementPlan(
            {
                plan: 'PROFESSIONAL',
                status: 'ACTIVE',
                pendingPlan: 'STANDARD',
                pendingEffectiveAt: new Date('2026-05-07T00:00:00Z'),
            },
            {},
            NOW,
        );
        assert.equal(plan, 'STANDARD');
    });

    test('Pending-Plan-Wechsel: greift NICHT, solange pendingEffectiveAt in der Zukunft', () => {
        const plan = resolveEntitlementPlan(
            {
                plan: 'PROFESSIONAL',
                status: 'ACTIVE',
                pendingPlan: 'STANDARD',
                pendingEffectiveAt: new Date('2026-06-01T00:00:00Z'),
            },
            {},
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('Pilot schlägt Pending-Plan-Wechsel: Pilot dominiert', () => {
        const plan = resolveEntitlementPlan(
            {
                plan: 'STANDARD',
                status: 'ACTIVE',
                isPilot: true,
                pendingPlan: 'BASIC',
                pendingEffectiveAt: new Date('2026-05-07T00:00:00Z'),
            },
            { pilotEntitlementPlan: 'BUSINESS' },
            NOW,
        );
        assert.equal(plan, 'BUSINESS');
    });

    test('TRIAL schlägt Pending-Plan-Wechsel: Trial dominiert', () => {
        const plan = resolveEntitlementPlan(
            {
                plan: 'BASIC',
                status: 'TRIAL',
                trialEntitlementPlan: 'PROFESSIONAL',
                pendingPlan: 'STANDARD',
                pendingEffectiveAt: new Date('2026-05-07T00:00:00Z'),
            },
            {},
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });
});
