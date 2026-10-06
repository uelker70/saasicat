import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    FeatureWithdrawalContractService,
    SubscriptionContractFreezeService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';
import { boundPlanVersion } from './helpers/subscription-fixtures.js';
import { SUBSCRIBER_CATALOG, subscribersFor } from './helpers/subscribers.js';
import { noticeRecord } from './helpers/version-notices.js';

// A withdrawal's reductions are part of the agreement: the announcement writes
// them into a successor of the contract in force — the same contract, line for
// line, between the same parties, with the reduction lines added — and a
// contract written later for another reason carries those no contract records
// yet. Each reduces the line the subscription was told of, at most to nothing.

const NOW = new Date('2026-06-15T10:00:00.000Z');

/** A line of the contract in force, with the installation's money on it. */
function line(kind, sourceKey, priceNet, overrides = {}) {
    return {
        kind,
        sourceKey,
        sourceVersionId: null,
        titleSnapshot: sourceKey,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet,
        priceGross: Math.round(priceNet * 119) / 100,
        billingCycle: 'monthly',
        currency: 'EUR',
        taxRate: 19,
        taxAmount: Math.round(priceNet * 19) / 100,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
        ...overrides,
    };
}

const PLAN = line('plan', 'PRO', 49, { sourceVersionId: 'pv-pro-1' });
const ADD_ON = line('bundle', 'EXPORT_PLUS', 10, { sourceVersionId: 'bv-export-1' });

/** What the subscription of t1 was told: its plan reduced by `plan`, its booking by `addOn`. */
function toldOf({ plan = 5, addOn = 2, planCycle = 'MONTHLY' } = {}) {
    return {
        kind: 'feature-withdrawn',
        tenantId: 't1',
        subscriptionId: 'sub-t1',
        withdrawalId: 'fw-1',
        featureKey: 'EXPORT',
        featureLabel: 'Data export',
        reason: 'The export service has been switched off.',
        effectiveFrom: '2026-07-01T00:00:00.000Z',
        lines: [
            {
                line: 'plan',
                key: 'PRO',
                label: 'Pro',
                subscriptionBundleId: null,
                billingCycle: planCycle,
                reductionNet: plan,
            },
            {
                line: 'bundle',
                key: 'EXPORT_PLUS',
                label: 'Export plus',
                subscriptionBundleId: 'sb-t1',
                billingCycle: 'MONTHLY',
                reductionNet: addOn,
            },
        ],
        specialTerms: false,
    };
}

const MONTHLY_TOTALS = {
    currency: 'EUR',
    billingCycle: 'monthly',
    subtotalNet: 59,
    discountNet: 0,
    totalNet: 59,
    vatRate: 19,
    totalGross: 70.21,
};

async function aContractInForce({
    lineItems = [PLAN, ADD_ON],
    priceSnapshot = MONTHLY_TOTALS,
    told = toldOf(),
    withdrawal = {},
} = {}) {
    const repo = new FakeSubscriptionContractRepository();
    const contracts = new SubscriptionContractService(repo, (await subscribersFor(['t1'])).service);
    const inForce = await contracts.create({
        tenantId: 't1',
        status: 'active',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveUntil: null,
        priceSnapshot,
        lineItems,
    });
    const notices = noticeRecord();
    await notices.record(
        [
            {
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                kind: 'feature-withdrawn',
                subject: 'fw-1',
                content: told,
            },
        ],
        NOW,
    );
    let invalidated = 0;
    const service = new FeatureWithdrawalContractService(
        {
            list: async () => [
                {
                    id: 'fw-1',
                    featureKey: 'EXPORT',
                    effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
                    liftedFrom: null,
                    ...withdrawal,
                },
            ],
        },
        notices,
        { findForTenant: async () => ({ id: 'sub-t1' }) },
        contracts,
        {
            invalidateTenant() {
                invalidated += 1;
            },
        },
        { listBySubscription: async () => [{ id: 'sb-t1', bundleVersionId: 'bv-export-1' }] },
    );
    return { repo, contracts, inForce, service, invalidations: () => invalidated };
}

const reductionsOf = (contract) =>
    contract.lineItems
        .filter((item) => item.kind === 'discount')
        .map((item) => [item.sourceKey, item.priceNet, item.billingCycle]);

// @requirement SC-PRIC-072 — A line that loses a withdrawn feature is charged less for the time without it
describe('the reductions of a withdrawal', () => {
    test('are written into a successor of the contract in force, which keeps everything else', async () => {
        const { repo, contracts, inForce, service, invalidations } = await aContractInForce();

        assert.equal(await service.recordReductions('t1', NOW), 'written');

        const successor = await contracts.findActiveByTenantId('t1', NOW);
        assert.notEqual(successor.id, inForce.id);
        assert.equal(successor.effectiveFrom.toISOString(), NOW.toISOString());
        assert.deepEqual(reductionsOf(successor), [
            ['feature-withdrawal:fw-1', -5, 'monthly'],
            ['feature-withdrawal:fw-1:sb-t1', -2, 'monthly'],
        ]);
        assert.deepEqual(
            successor.lineItems
                .filter((item) => item.kind !== 'discount')
                .map((item) => [item.kind, item.sourceKey, item.priceNet]),
            [
                ['plan', 'PRO', 49],
                ['bundle', 'EXPORT_PLUS', 10],
            ],
            'every line of the contract replaced, as it was',
        );
        assert.equal(successor.subscriberId, inForce.subscriberId, 'between the same parties');
        assert.deepEqual(
            {
                subtotalNet: successor.priceSnapshot.subtotalNet,
                discountNet: successor.priceSnapshot.discountNet,
                totalNet: successor.priceSnapshot.totalNet,
            },
            { subtotalNet: 59, discountNet: 7, totalNet: 52 },
        );
        const [planReduction] = successor.lineItems.filter((item) => item.kind === 'discount');
        assert.deepEqual(planReduction.metadata, {
            generated: true,
            source: 'feature-withdrawal',
            reduction: {
                withdrawalId: 'fw-1',
                line: 'plan',
                key: 'PRO',
                subscriptionBundleId: null,
                amountNet: 5,
            },
        });
        assert.equal((await repo.findById(inForce.id)).status, 'superseded');
        assert.equal(invalidations(), 1);
    });

    test('are written once', async () => {
        const { service } = await aContractInForce();
        await service.recordReductions('t1', NOW);
        assert.equal(
            await service.recordReductions('t1', new Date(NOW.getTime() + 1000)),
            'nothing',
        );
    });

    test('reduce a line no further than its price', async () => {
        const { contracts, service } = await aContractInForce({
            told: toldOf({ plan: 60, addOn: null }),
        });
        await service.recordReductions('t1', NOW);
        assert.deepEqual(reductionsOf(await contracts.findActiveByTenantId('t1', NOW)), [
            ['feature-withdrawal:fw-1', -49, 'monthly'],
        ]);
    });

    test('reduce only the lines the subscription was told of, as it was told of them', async () => {
        // The plan was reached in the monthly rhythm; the contract now bills it yearly.
        const { contracts, service } = await aContractInForce({
            lineItems: [
                line('plan', 'PRO', 490, { sourceVersionId: 'pv-pro-1', billingCycle: 'yearly' }),
                ADD_ON,
            ],
            // A year of the plan and twelve months of the add-on.
            priceSnapshot: {
                ...MONTHLY_TOTALS,
                billingCycle: 'yearly',
                subtotalNet: 610,
                totalNet: 610,
                totalGross: 725.9,
            },
        });
        await service.recordReductions('t1', NOW);
        assert.deepEqual(reductionsOf(await contracts.findActiveByTenantId('t1', NOW)), [
            ['feature-withdrawal:fw-1:sb-t1', -2, 'monthly'],
        ]);
    });

    test('write nothing for a withdrawal lifted before its date', async () => {
        const { service, contracts, inForce } = await aContractInForce({
            withdrawal: { liftedFrom: new Date('2026-06-20T00:00:00.000Z') },
        });
        assert.equal(await service.recordReductions('t1', NOW), 'nothing');
        assert.equal((await contracts.findActiveByTenantId('t1', NOW)).id, inForce.id);
    });

    test('wait for a contract where none is in force', async () => {
        const { service } = await aContractInForce();
        assert.equal(
            await service.recordReductions('t1', new Date('2025-01-01T00:00:00.000Z')),
            'nothing',
        );
    });

    test('go into a contract a later change writes, where none records them yet', async () => {
        const STANDARD = {
            id: 'PRO',
            name: 'Pro',
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: {},
            features: [],
        };
        const { contracts } = await aContractInForce();
        const asked = [];
        const freeze = new SubscriptionContractFreezeService(
            givenPlanCatalogSource({ ...SUBSCRIBER_CATALOG, plans: [STANDARD] }),
            {
                invalidateTenant() {},
                computeContractLimits: async () => ({
                    limits: { plan: 'PRO', quotas: {}, features: new Set() },
                    leftOutBundleVersionIds: [],
                }),
            },
            contracts,
            {
                findBoundPlanVersion: async () => boundPlanVersion(STANDARD, 'pv-pro-1'),
                loadBookedBundles: async () => ({ lineItems: [], bundleVersionIds: [] }),
            },
            null,
            null,
            null,
            {
                linesFor: async (tenantId, lines) => {
                    asked.push([tenantId, lines.map((item) => item.kind)]);
                    return [
                        {
                            ...line('discount', 'feature-withdrawal:fw-1', -5),
                            metadata: { generated: true, source: 'feature-withdrawal' },
                        },
                    ];
                },
            },
        );
        const composed = await freeze.composeOnPlanChange('t1', 'PRO', 'MONTHLY', NOW, null);
        assert.deepEqual(
            asked,
            [['t1', ['plan']]],
            'asked with the lines the contract is written with',
        );
        assert.deepEqual(
            composed.lineItems.map((item) => [item.kind, item.sourceKey, item.priceNet]),
            [
                ['plan', 'PRO', 49],
                ['discount', 'feature-withdrawal:fw-1', -5],
            ],
        );
        assert.equal(composed.priceSnapshot.totalNet, 44);
    });
});
