import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    contractLineItemToInvoiceLineItem,
    subscriptionContractToInvoiceSnapshot,
    SubscriptionContractService,
} from '../dist/subscription-contract/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';

const EFFECTIVE_FROM = new Date('2026-06-01T00:00:00.000Z');
const BUNDLE_MINIMUM_TERM_UNTIL = new Date('2027-06-01T00:00:00.000Z');

const PRICE = {
    currency: 'EUR',
    billingCycle: 'yearly',
    subtotalNet: 708,
    discountNet: 70.8,
    totalNet: 637.2,
    vatRate: 0.19,
    totalGross: 758.27,
};

const PLAN_LINE = {
    kind: 'plan',
    sourceKey: 'STANDARD',
    sourceVersionId: 'pv-1',
    titleSnapshot: 'Standard',
    descriptionSnapshot: null,
    quantity: 1,
    unit: null,
    priceNet: 588,
    priceGross: 699.72,
    billingCycle: 'yearly',
    minimumTermUntil: null,
    featuresSnapshot: ['CRM'],
    quotaEffectsSnapshot: { users: 5 },
    metadata: null,
};

const BUNDLE_LINE = {
    kind: 'bundle',
    sourceKey: 'FINANCE_PLUS',
    sourceVersionId: 'bv-1',
    titleSnapshot: 'Finance Plus',
    descriptionSnapshot: null,
    quantity: 1,
    unit: null,
    priceNet: 120,
    priceGross: 142.8,
    billingCycle: 'yearly',
    minimumTermUntil: BUNDLE_MINIMUM_TERM_UNTIL,
    featuresSnapshot: ['FINANCE_EXPORT'],
    quotaEffectsSnapshot: { exports: 100 },
    metadata: null,
};

const DISCOUNT_LINE = {
    kind: 'discount',
    sourceKey: 'START10',
    sourceVersionId: null,
    titleSnapshot: 'Start-Rabatt',
    descriptionSnapshot: '10 % im ersten Jahr',
    quantity: 1,
    unit: null,
    priceNet: -70.8,
    priceGross: -84.25,
    billingCycle: 'yearly',
    minimumTermUntil: null,
    featuresSnapshot: [],
    quotaEffectsSnapshot: {},
    metadata: { promoCode: 'START10' },
};

function consumedOffer() {
    return {
        id: 'offer-1',
        projectKey: 'clubapp',
        planKey: 'STANDARD',
        planVersionId: 'pv-1',
        billingCycle: 'yearly',
        promotionId: 'promo-1',
        promoCode: 'START10',
        bundles: ['FINANCE_PLUS'],
        bundleVersionIds: ['bv-1'],
        quotas: {},
        priceBreakdown: {
            currency: 'EUR',
            billingCycle: 'yearly',
            planNet: 588,
            bundlesNet: 120,
            regularNet: 708,
            effectiveNet: 637.2,
            vatRate: 0.19,
            effectiveGross: 758.27,
        },
        lineItems: [PLAN_LINE, BUNDLE_LINE],
        promotionSnapshots: [{ id: 'promo-1', label: 'Start', resolvedAmountNet: 70.8 }],
        promoCodeSnapshot: {
            code: 'START10',
            label: 'Start',
            valueType: 'PERCENT',
            value: 10,
            resolvedAmountNet: 70.8,
        },
        locale: 'de',
        validUntil: null,
        status: 'consumed',
        consumedAt: '2026-05-24T12:00:00.000Z',
        createdAt: '2026-05-24T11:00:00.000Z',
        updatedAt: '2026-05-24T12:00:00.000Z',
    };
}

describe('SubscriptionContractService', () => {
    let repo;
    let service;

    beforeEach(() => {
        repo = new FakeSubscriptionContractRepository();
        service = new SubscriptionContractService(repo);
    });

    test('createFromOffer creates immutable contract line items from a consumed offer', async () => {
        const offer = consumedOffer();
        const contract = await service.createFromOffer(offer, {
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 5, exports: 100 },
                features: ['CRM', 'FINANCE_EXPORT'],
            },
        });

        assert.equal(contract.originalOfferId, 'offer-1');
        assert.equal(contract.originalPlanVersionId, 'pv-1');
        assert.deepEqual(contract.originalBundleVersionIds, ['bv-1']);
        assert.equal(contract.lineItems.length, 3);
        assert.equal(contract.priceSnapshot.totalNet, 637.2);
        const discountLine = contract.lineItems.find((item) => item.kind === 'discount');
        assert.ok(discountLine);
        assert.equal(discountLine.sourceKey, 'START10');
        assert.equal(discountLine.priceNet, -70.8);
        assert.equal(discountLine.priceGross, -84.25);
        assert.equal(discountLine.metadata.source, 'promo_code');
        const bundleLine = contract.lineItems.find((item) => item.kind === 'bundle');
        assert.ok(bundleLine);
        assert.equal(
            bundleLine.minimumTermUntil.toISOString(),
            BUNDLE_MINIMUM_TERM_UNTIL.toISOString(),
        );

        offer.lineItems[1].featuresSnapshot.push('MUTATED_AFTER_CONTRACT');
        const persisted = await service.getById(contract.id);
        assert.deepEqual(persisted.lineItems[1].featuresSnapshot, ['FINANCE_EXPORT']);
    });

    test('createFromOffer blocks open offers', async () => {
        const offer = consumedOffer();
        offer.status = 'open';
        await assert.rejects(
            () =>
                service.createFromOffer(offer, {
                    tenantId: 'tenant-1',
                    effectiveFrom: EFFECTIVE_FROM,
                }),
            /consumed/,
        );
    });

    test('replaceActiveContract closes the old contract and creates a new one', async () => {
        const first = await service.create({
            projectKey: 'clubapp',
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            priceSnapshot: PRICE,
            lineItems: [PLAN_LINE],
        });
        const secondData = {
            projectKey: 'clubapp',
            tenantId: 'tenant-1',
            effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
            priceSnapshot: PRICE,
            lineItems: [{ ...PLAN_LINE, sourceKey: 'PRO', titleSnapshot: 'Pro' }],
        };

        const result = await service.replaceActiveContract(
            'tenant-1',
            secondData,
            new Date('2026-07-01T00:00:00.000Z'),
        );

        assert.equal(result.previous.id, first.id);
        const closed = await service.getById(first.id);
        assert.equal(closed.status, 'superseded');
        assert.equal(closed.effectiveUntil.toISOString(), '2026-07-01T00:00:00.000Z');
        assert.equal(result.next.lineItems[0].sourceKey, 'PRO');
    });

    test('create requires a plan line item', async () => {
        await assert.rejects(
            () =>
                service.create({
                    projectKey: 'clubapp',
                    tenantId: 'tenant-1',
                    effectiveFrom: EFFECTIVE_FROM,
                    priceSnapshot: PRICE,
                    lineItems: [BUNDLE_LINE],
                }),
            /Plan-Grundposition/,
        );
    });

    test('contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice', () => {
        const invoiceLine = contractLineItemToInvoiceLineItem({
            id: 'cli-discount-1',
            contractId: 'contract-1',
            createdAt: new Date('2026-06-01T00:00:00.000Z'),
            ...DISCOUNT_LINE,
        });

        assert.deepEqual(invoiceLine, {
            sourceContractLineItemId: 'cli-discount-1',
            sourceKey: 'START10',
            sourceVersionId: null,
            kind: 'discount',
            title: 'Start-Rabatt',
            description: '10 % im ersten Jahr',
            quantity: 1,
            unit: null,
            priceNet: -70.8,
            priceGross: -84.25,
            billingCycle: 'yearly',
            minimumTermUntil: null,
            metadata: { promoCode: 'START10' },
        });
    });

    test('subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the contract', async () => {
        const contract = await service.create({
            projectKey: 'clubapp',
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            originalOfferId: 'offer-1',
            priceSnapshot: PRICE,
            lineItems: [DISCOUNT_LINE, BUNDLE_LINE, PLAN_LINE],
        });

        const snapshot = subscriptionContractToInvoiceSnapshot(contract);

        assert.equal(snapshot.contractId, contract.id);
        assert.equal(snapshot.projectKey, 'clubapp');
        assert.equal(snapshot.tenantId, 'tenant-1');
        assert.equal(snapshot.originalOfferId, 'offer-1');
        assert.equal(snapshot.currency, 'EUR');
        assert.equal(snapshot.billingCycle, 'yearly');
        assert.equal(snapshot.subtotalNet, 708);
        assert.equal(snapshot.discountNet, 70.8);
        assert.equal(snapshot.totalNet, 637.2);
        assert.equal(snapshot.totalGross, 758.27);
        assert.deepEqual(
            snapshot.lineItems.map((item) => item.kind),
            ['plan', 'bundle', 'discount'],
        );
        assert.deepEqual(
            snapshot.lineItems.map((item) => item.sourceKey),
            ['STANDARD', 'FINANCE_PLUS', 'START10'],
        );
        assert.equal(
            snapshot.lineItems[1].minimumTermUntil.toISOString(),
            BUNDLE_MINIMUM_TERM_UNTIL.toISOString(),
        );
        assert.equal(snapshot.lineItems[2].priceNet, -70.8);
    });

    test('getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract', async () => {
        await service.create({
            projectKey: 'clubapp',
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            priceSnapshot: PRICE,
            lineItems: [PLAN_LINE, BUNDLE_LINE, DISCOUNT_LINE],
        });

        const snapshot = await service.getActiveInvoiceSnapshotForTenant(
            'tenant-1',
            new Date('2026-06-15T00:00:00.000Z'),
        );

        assert.equal(snapshot.tenantId, 'tenant-1');
        assert.equal(snapshot.totalNet, 637.2);
        assert.deepEqual(
            snapshot.lineItems.map((item) => item.sourceKey),
            ['STANDARD', 'FINANCE_PLUS', 'START10'],
        );
    });

    test('getActiveInvoiceSnapshotForTenant throws without an active contract', async () => {
        await assert.rejects(
            () => service.getActiveInvoiceSnapshotForTenant('tenant-missing', EFFECTIVE_FROM),
            /Kein aktiver SubscriptionContract/,
        );
    });
});
