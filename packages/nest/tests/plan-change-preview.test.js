// Smoke tests for PlanChangePreviewService — data-driven limits map,
// catalog order as plan rank, self-service blocks.

// @requirement SC-PRIC-006 — The preview and the booking describe the same contract
// @requirement SC-CHG-010 — Every refusal the preview shows is also enforced where the change is made
// @requirement SC-CHG-012 — A tenant cannot move to a plan whose limits their usage already exceeds

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanChangePreviewService, givenPlanCatalogSource } from '../dist/billing/index.js';
import { ERROR_MESSAGES_DE, ERROR_MESSAGES_EN, resolveErrorMessage } from '@saasicat/core';
import { publishingCatalogue } from './helpers/publishing-catalogue.js';

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
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

test('preview returns UPGRADE STARTER→STANDARD with proration and feature diff', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
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

// @requirement SC-PLAN-026 — A version is sold from the moment it is published, not from the next start
describe('a plan the operator publishes after the service was built', () => {
    const now = new Date('2026-05-15');

    /** The service, after one preview has read the plans as they stood. */
    async function running() {
        const operator = publishingCatalogue(CATALOG);
        const svc = new PlanChangePreviewService(
            operator.source,
            buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
            buildSubPort(),
            { snapshot: async () => ({ users: 2, members: 100, storageGb: 0.5 }) },
            null,
        );
        const first = await svc.preview('t1', 'STANDARD', 'MONTHLY', now);
        return { operator, svc, first };
    }

    test('is found, ranked and priced by the plans as they stand now', async () => {
        const { operator, svc } = await running();
        operator.publish({
            id: 'PREMIUM',
            name: 'Premium',
            tagline: '',
            marketed: true,
            monthlyNet: 99,
            yearlyNet: 990,
            quotas: { users: 20, members: 5000, storageGb: 50 },
            features: ['CORE_IDENTITY', 'WHATSAPP'],
        });

        const dto = await svc.preview('t1', 'PREMIUM', 'MONTHLY', now);
        assert.equal(dto.changeType, 'UPGRADE');
        assert.equal(dto.target.plan.monthlyNet, 99);
        assert.equal(dto.proration?.targetPriceNet, 99);
    });

    test('a changed price is the one the proration charges', async () => {
        const { operator, svc, first } = await running();
        assert.equal(first.proration?.targetPriceNet, 49);
        operator.publish({ ...CATALOG.plans[1], monthlyNet: 59 });

        const dto = await svc.preview('t1', 'STANDARD', 'MONTHLY', now);
        assert.equal(dto.proration?.targetPriceNet, 59);
    });

    test('a retired plan is refused as not in the catalogue', async () => {
        const { operator, svc } = await running();
        operator.retire('STANDARD');

        await assert.rejects(
            () => svc.preview('t1', 'STANDARD', 'MONTHLY', now),
            (error) => error.response?.code === 'PLAN_NOT_IN_CATALOG',
        );
    });
});

test('preview returns DOWNGRADE STANDARD→STARTER with users blocker when usage too high', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
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
    // The code is fixed now and the quota travels in `params`. It used to be
    // built from the key — `USERS_OVER_TARGET` — which made the set grow with
    // every quota an installation defines, so no catalogue could be complete
    // against it and no guard could check one.
    const usersBlocker = dto.blockers.find(
        (b) => b.code === 'QUOTA_OVER_TARGET' && b.params?.quotaKey === 'users',
    );
    assert.ok(usersBlocker);
    assert.ok(
        usersBlocker.message.includes('reduce usage'),
        'blocker message asks for usage reduction',
    );
    // Every value the sentence names is beside it, so a client can rebuild it
    // in another language without parsing the English.
    assert.deepEqual(Object.keys(usersBlocker.params).sort(), [
        'planName',
        'quotaKey',
        'targetMax',
        'used',
    ]);
    assert.deepEqual(dto.featuresGained, []);
});

test('preview blocks ENTERPRISE as a self-service target', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        { asTarget: ['ENTERPRISE'], asSource: ['ENTERPRISE'] },
    );
    const dto = await svc.preview('t1', 'ENTERPRISE', 'MONTHLY', new Date('2026-05-15'));
    assert.ok(
        dto.blockers.some(
            (b) => b.code === 'PLAN_NOT_SELF_SERVICE' && b.params?.planKey === 'ENTERPRISE',
        ),
    );
});

// A blocker is read by a tenant, and `ENTERPRISE` is a key an installation
// chose — it names nothing the reader has ever seen. The catalogue plan does
// have a name, and the template asks for it.
//
// Asserted as whole sentences, in both shipped languages: a substring check
// would hold just as well if the rest of the sentence disappeared, and this
// blocker lost the reason and the instruction once already, when the code it
// shares with the booking route began to displace its `message`.
test('the self-service refusal names the plan and says what to do about it', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        { asTarget: ['ENTERPRISE'], asSource: [] },
    );
    const dto = await svc.preview('t1', 'ENTERPRISE', 'MONTHLY', new Date('2026-05-15'));
    const blocker = dto.blockers.find((b) => b.code === 'PLAN_NOT_SELF_SERVICE');

    assert.equal(
        resolveErrorMessage(blocker, {}, ERROR_MESSAGES_EN),
        'Enterprise is only activated via a special contract. Please contact the contract manager.',
    );
    assert.equal(
        resolveErrorMessage(blocker, {}, ERROR_MESSAGES_DE),
        'Enterprise wird nur über einen Sondervertrag freigeschaltet. Bitte wenden Sie sich an die Vertragsverwaltung.',
    );
    // The catalogue name, not the key it is spelled from.
    assert.equal(blocker.params.planName, 'Enterprise');
});

test('preview NOOP when plan and cycle are identical', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STARTER', 'MONTHLY', new Date('2026-05-15'));
    assert.equal(dto.changeType, 'NOOP');
    assert.ok(dto.warnings.some((w) => w.code === 'NO_CHANGE'));
});

test('preview returns CYCLE_CHANGE on MONTHLY→YEARLY at the same plan', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
        buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
        buildSubPort(),
        { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
        null,
    );
    const dto = await svc.preview('t1', 'STARTER', 'YEARLY', new Date('2026-05-15'));
    assert.equal(dto.changeType, 'CYCLE_CHANGE');
    assert.equal(dto.isImmediate, false);
});

test('limitsCheck renders the union of quota keys from limits, target plan and usage', async () => {
    const svc = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
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

// @requirement SC-CHG-019 — A plan is booked only in a rhythm it carries a price for
describe('a plan without a price for the rhythm asked for', () => {
    const MONTHLY_ONLY = {
        id: 'BASIC',
        name: 'Basic',
        tagline: '',
        marketed: true,
        monthlyNet: 9,
        yearlyNet: null,
        quotas: { users: 3, members: 250, storageGb: 2 },
        features: ['CORE_IDENTITY'],
    };
    const ON_REQUEST = { ...MONTHLY_ONLY, id: 'CUSTOM', name: 'Custom', monthlyNet: null };
    const PRICED_ELSEWHERE = { ...CATALOG, plans: [...CATALOG.plans, MONTHLY_ONLY, ON_REQUEST] };

    function previewService() {
        return new PlanChangePreviewService(
            givenPlanCatalogSource(PRICED_ELSEWHERE),
            buildEntitlement({ users: 3, members: 250, storageGb: 2 }, ['CORE_IDENTITY']),
            buildSubPort(),
            { snapshot: async () => ({ users: 1, members: 50, storageGb: 0.1 }) },
            null,
        );
    }
    const notSold = (blockers) => blockers.filter((b) => b.code === 'PLAN_NOT_SOLD_IN_CYCLE');

    test('is blocked, naming the plan and the rhythm, in words both languages can build', async () => {
        const dto = await previewService().preview('t1', 'BASIC', 'YEARLY', new Date('2026-05-15'));
        const [blocker] = notSold(dto.blockers);

        assert.deepEqual(blocker.params, {
            planName: 'Basic',
            planKey: 'BASIC',
            billingCycle: 'YEARLY',
        });
        assert.equal(
            resolveErrorMessage(blocker, {}, ERROR_MESSAGES_EN),
            'Basic has no price for this billing rhythm and cannot be booked in it.',
        );
        assert.equal(
            resolveErrorMessage(blocker, {}, ERROR_MESSAGES_DE),
            'Basic hat für diesen Abrechnungsrhythmus keinen Preis und kann darin nicht gebucht werden.',
        );
    });

    test('is the refusal the change routes enforce', async () => {
        const blockers = await previewService().assertChangeAllowed(
            't1',
            'BASIC',
            'YEARLY',
            new Date('2026-05-15'),
        );
        assert.equal(notSold(blockers).length, 1);
    });

    test('is not blocked in the rhythm it does carry a price for', async () => {
        const dto = await previewService().preview(
            't1',
            'BASIC',
            'MONTHLY',
            new Date('2026-05-15'),
        );
        assert.deepEqual(notSold(dto.blockers), []);
    });

    test('a plan on request is blocked in either rhythm', async () => {
        for (const cycle of ['MONTHLY', 'YEARLY']) {
            const dto = await previewService().preview(
                't1',
                'CUSTOM',
                cycle,
                new Date('2026-05-15'),
            );
            assert.equal(notSold(dto.blockers).length, 1, cycle);
        }
    });

    test('a plan that is not marketed is left to the special contract that prices it', async () => {
        const dto = await previewService().preview(
            't1',
            'ENTERPRISE',
            'YEARLY',
            new Date('2026-05-15'),
        );
        assert.deepEqual(notSold(dto.blockers), []);
    });
});
