import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntitlementPlan } from '../dist/entitlement/index.js';

const NOW = new Date('2026-05-08T12:00:00Z');

describe('resolveEntitlementPlan — Trial / Pilot / Pending', () => {
    test('Default: no override → subscription.plan', () => {
        const plan = resolveEntitlementPlan({ plan: 'STANDARD', status: 'ACTIVE' }, {}, NOW);
        assert.equal(plan, 'STANDARD');
    });

    test('Pilot: pilotEntitlementPlan overrides', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'STANDARD', status: 'ACTIVE', isPilot: true },
            { pilotEntitlementPlan: 'BUSINESS' },
            NOW,
        );
        assert.equal(plan, 'BUSINESS');
    });

    test('Pilot without config: falls back to subscription.plan', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'STANDARD', status: 'ACTIVE', isPilot: true },
            {},
            NOW,
        );
        assert.equal(plan, 'STANDARD');
    });

    test('TRIAL: subscription.trialEntitlementPlan wins', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'BASIC', status: 'TRIAL', trialEntitlementPlan: 'PROFESSIONAL' },
            { defaultTrialEntitlementPlan: 'STANDARD' },
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'BASIC', status: 'TRIAL', trialEntitlementPlan: null },
            { defaultTrialEntitlementPlan: 'PROFESSIONAL' },
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('TRIAL with no config at all: falls back to subscription.plan', () => {
        const plan = resolveEntitlementPlan({ plan: 'BASIC', status: 'TRIAL' }, {}, NOW);
        assert.equal(plan, 'BASIC');
    });

    test('PENDING_SALES: pendingSalesEntitlementPlan overrides', () => {
        const plan = resolveEntitlementPlan(
            { plan: 'ENTERPRISE', status: 'PENDING_SALES' },
            { pendingSalesEntitlementPlan: 'PROFESSIONAL' },
            NOW,
        );
        assert.equal(plan, 'PROFESSIONAL');
    });

    test('Pending plan change: takes effect once pendingEffectiveAt is in the past', () => {
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

    test('Pending plan change: does NOT take effect while pendingEffectiveAt is in the future', () => {
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

    test('Pilot beats pending plan change: Pilot dominates', () => {
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

    test('TRIAL beats pending plan change: Trial dominates', () => {
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
