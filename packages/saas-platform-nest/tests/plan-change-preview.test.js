// Smoke-Tests für PlanChangePreviewService — datengetriebene Limits-Map,
// Catalog-Reihenfolge als Plan-Rank, Self-Service-Blocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanChangePreviewService } from '../dist/billing/index.js';

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    plans: [
        {
            id: 'STARTER',
            name: 'Starter',
            tagline: '',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { users: 3, members: 250, storageGb: 2 },
            features: ['CORE_IDENTITY'],
        },
        {
            id: 'STANDARD',
            name: 'Standard',
            tagline: '',
            marketed: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8, members: 1000, storageGb: 10 },
            features: ['CORE_IDENTITY', 'WHATSAPP'],
        },
        {
            id: 'ENTERPRISE',
            name: 'Enterprise',
            tagline: '',
            marketed: false,
            monthlyNet: null,
            yearlyNet: null,
            quotas: { users: -1, members: -1, storageGb: 500 },
            features: ['CORE_IDENTITY', 'WHATSAPP'],
        },
    ],
};

function buildEntitlement(quotas, features) {
    return {
        computeLimits: async () => ({
            plan: 'STARTER',
            quotas,
            features: new Set(features),
        }),
        invalidateTenant: () => {},
    };
}

function buildSubPort(overrides = {}) {
    return {
        findForTenant: async () => ({
            plan: 'STARTER',
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
            isPilot: false,
            pilotEndsAt: null,
            trialEndsAt: null,
            startedAt: new Date('2025-01-01'),
            currentPeriodStart: new Date('2026-05-01'),
            currentPeriodEnd: new Date('2026-06-01'),
            pendingPlan: null,
            pendingBillingCycle: null,
            pendingEffectiveAt: null,
            planVersion: {
                id: 'pv1',
                planId: 'STARTER',
                version: 1,
                publishedAt: null,
                supersededAt: null,
                changeNote: null,
            },
            pendingPlanVersion: null,
            pendingPlanVersionEffectiveAt: null,
            pendingPlanVersionAccepted: false,
            pendingPlanVersionAcceptedAt: null,
            ...overrides,
        }),
    };
}

test('preview liefert UPGRADE STARTER→STANDARD mit Proration und Feature-Diff', async () => {
    const svc = new PlanChangePreviewService(
        CATALOG,
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 2, members: 100, storageGb: 0.5 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STANDARD', 'MONTHLY', new Date('2026-05-15'));
    assert.equal(dto.changeType, 'UPGRADE');
    assert.equal(dto.isImmediate, true);
    assert.deepEqual(dto.featuresGained, ['WHATSAPP']);
    assert.deepEqual(dto.featuresLost, []);
    assert.equal(dto.target.plan.id, 'STANDARD');
    assert.equal(dto.target.plan.monthlyNet, 49);
    assert.equal(dto.proration?.currentPriceNet, 19);
    assert.equal(dto.proration?.targetPriceNet, 49);
    assert.equal(dto.blockers.length, 0);
});

test('preview liefert DOWNGRADE STANDARD→STARTER mit users-Blocker wenn Verbrauch zu hoch', async () => {
    const svc = new PlanChangePreviewService(
        CATALOG,
        buildEntitlement({ users: 8, members: 1000, storageGb: 10 }, ['CORE_IDENTITY', 'WHATSAPP']),
        buildSubPort({ plan: 'STANDARD' }),
        { snapshot: async () => ({ users: 5, members: 100, storageGb: 1 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STARTER', 'MONTHLY', new Date('2026-05-15'));
    assert.equal(dto.changeType, 'DOWNGRADE');
    assert.equal(dto.isImmediate, false);
    assert.equal(dto.featuresLost.length, 1);
    assert.equal(dto.featuresLost[0], 'WHATSAPP');
    const usersBlocker = dto.blockers.find((b) => b.code === 'USERS_OVER_TARGET');
    assert.ok(usersBlocker);
    assert.ok(
        usersBlocker.message.includes('Verbrauch reduzieren'),
        'Blocker-Message fordert Verbrauchs-Reduktion',
    );
    assert.deepEqual(dto.featuresGained, []);
});

test('preview blockt ENTERPRISE als Self-Service-Target', async () => {
    const svc = new PlanChangePreviewService(
        CATALOG,
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        { asTarget: ['ENTERPRISE'], asSource: ['ENTERPRISE'] },
    );
    const dto = await svc.preview('t1', 'ENTERPRISE', 'MONTHLY', new Date('2026-05-15'));
    assert.ok(dto.blockers.some((b) => b.code === 'ENTERPRISE_NOT_SELF_SERVICE'));
});

test('preview NOOP wenn Plan und Cycle identisch sind', async () => {
    const svc = new PlanChangePreviewService(
        CATALOG,
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STARTER', 'MONTHLY', new Date('2026-05-15'));
    assert.equal(dto.changeType, 'NOOP');
    assert.ok(dto.warnings.some((w) => w.code === 'NO_CHANGE'));
});

test('preview liefert CYCLE_CHANGE bei MONTHLY→YEARLY am gleichen Plan', async () => {
    const svc = new PlanChangePreviewService(
        CATALOG,
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STARTER', 'YEARLY', new Date('2026-05-15'));
    assert.equal(dto.changeType, 'CYCLE_CHANGE');
    assert.equal(dto.isImmediate, false);
});

test('limitsCheck rendered die Union der Quota-Keys aus Limits, Ziel-Plan und Usage', async () => {
    const svc = new PlanChangePreviewService(
        CATALOG,
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.5 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STANDARD', 'MONTHLY', new Date('2026-05-15'));
    assert.deepEqual(Object.keys(dto.limitsCheck).sort(), ['members', 'storageGb', 'users']);
    assert.equal(dto.limitsCheck.users.targetMax, 8);
    assert.equal(dto.limitsCheck.members.targetMax, 1000);
});
