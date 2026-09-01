import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    contractLineItemToInvoiceLineItem,
    subscriptionContractToInvoiceSnapshot,
    SubscriptionContractService,
    vatPercentFromOfferRate,
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
    currency: 'EUR',
    taxRate: 19,
    taxAmount: 111.72,
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
    currency: 'EUR',
    taxRate: 19,
    taxAmount: 22.8,
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
    currency: 'EUR',
    taxRate: 19,
    taxAmount: -13.45,
    minimumTermUntil: null,
    featuresSnapshot: [],
    quotaEffectsSnapshot: {},
    metadata: { promoCode: 'START10' },
};

function consumedOffer() {
    return {
        id: 'offer-1',
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

// @requirement SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen
// @requirement SC-MKT-018 — A contract has exactly one plan line and at least one line in total
// @requirement SC-MKT-019 — A contract that is already closed is not closed again
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
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            priceSnapshot: PRICE,
            lineItems: [PLAN_LINE],
        });
        const secondData = {
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
                    tenantId: 'tenant-1',
                    effectiveFrom: EFFECTIVE_FROM,
                    priceSnapshot: PRICE,
                    lineItems: [BUNDLE_LINE],
                }),
            /plan base item/,
        );
    });

    test('a line whose tax does not close its own gap is refused', () => {
        // A contract is append-only, so a line that disagrees with itself is a
        // wrong number nobody can correct afterwards. Both platform paths
        // compute the tax from the line's own net and gross; this is the caller
        // that supplies its own.
        return assert.rejects(
            () =>
                service.create({
                    tenantId: 'tenant-1',
                    effectiveFrom: EFFECTIVE_FROM,
                    priceSnapshot: PRICE,
                    lineItems: [{ ...PLAN_LINE, taxAmount: 999 }],
                }),
            (error) => {
                assert.equal(
                    error.getResponse().code,
                    'SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH',
                );
                assert.equal(error.getResponse().params.expected, 111.72);
                return true;
            },
        );
    });

    test('a line booked in another currency than its contract is refused', () => {
        // An installation sells in one currency, so this is not a
        // mixed-currency contract — it is a header and a line that disagree,
        // and the invoice projection would state one in its total and the other
        // on every line.
        return assert.rejects(
            () =>
                service.create({
                    tenantId: 'tenant-1',
                    effectiveFrom: EFFECTIVE_FROM,
                    priceSnapshot: PRICE,
                    lineItems: [{ ...PLAN_LINE, currency: 'USD' }],
                }),
            (error) => {
                assert.equal(
                    error.getResponse().code,
                    'SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH',
                );
                assert.equal(error.getResponse().params.expected, 'EUR');
                assert.equal(error.getResponse().params.currency, 'USD');
                return true;
            },
        );
    });

    test('and a line whose tax does close it goes through', async () => {
        // The counter-check: a rule that refused every line would pass the case
        // above and stop every contract from ever being written.
        const contract = await service.create({
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            priceSnapshot: PRICE,
            lineItems: [PLAN_LINE],
        });
        assert.equal(contract.lineItems[0].taxAmount, 111.72);
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
            currency: 'EUR',
            taxRate: 19,
            taxAmount: -13.45,
            minimumTermUntil: null,
            metadata: { promoCode: 'START10' },
        });
    });

    test('subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the contract', async () => {
        const contract = await service.create({
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
            originalOfferId: 'offer-1',
            priceSnapshot: PRICE,
            lineItems: [DISCOUNT_LINE, BUNDLE_LINE, PLAN_LINE],
        });

        const snapshot = subscriptionContractToInvoiceSnapshot(contract);

        assert.equal(snapshot.contractId, contract.id);
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
            /No active subscription contract/,
        );
    });
});

// What a contract concluded from an offer records about its money.
//
// The offer froze the currency and the rate at the moment it was made, and a
// contract concluded at that rate is charged at it for its term — so the values
// come from the offer's own breakdown rather than from whatever the
// installation is configured with today.
//
// The rate needs its unit read rather than assumed: an offer prices its lines
// as `net * (1 + vatRate)` and so states a fraction, while the catalogue states
// per cent, and `taxRate` is one column. The assertion that catches a unit
// error is the one that ties the rate to the tax — `priceNet + taxAmount ===
// priceGross` cannot, because `recordLineItemMoney` makes it true whatever the
// rate says.

// @requirement SC-PRIC-015 — An amount records the currency it was booked in
// @requirement SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived
// @requirement SC-PRIC-016 — A tax rate has a validity window
describe('the money facts a contract inherits from its offer', () => {
    async function conclude(offer) {
        const service = new SubscriptionContractService(new FakeSubscriptionContractRepository());
        return service.createFromOffer(offer, {
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
        });
    }

    /** Within a cent, because a gross is rounded once and a rate is exact. */
    function rateExplainsTax(line) {
        const fromRate = (line.priceNet * line.taxRate) / 100;
        return Math.abs(fromRate - line.taxAmount) <= 0.01;
    }

    test('a rate the offer states as a fraction is recorded in per cent', async () => {
        // The fixture is the shape this platform produces: `vatRate: 0.19`
        // with lines priced at 19 %. Recorded as it stands, the column would
        // say 0.19 next to a tax that is 19 % of net.
        const contract = await conclude(consumedOffer());
        for (const line of contract.lineItems) {
            assert.equal(line.taxRate, 19, `${line.sourceKey} recorded the rate in the wrong unit`);
        }
    });

    test('and the rate it records explains the tax it records', async () => {
        // The check a unit error cannot pass. `priceNet + taxAmount ===
        // priceGross` cannot: `recordLineItemMoney` makes that true whatever
        // the rate says, which is why the first version of this missed it.
        const contract = await conclude(consumedOffer());
        for (const line of contract.lineItems) {
            assert.ok(
                rateExplainsTax(line),
                `${line.sourceKey} recorded ${line.taxRate} % beside a tax of ` +
                    `${line.taxAmount} on a net of ${line.priceNet}`,
            );
        }
    });

    test('every line names the currency the offer froze', async () => {
        const offer = consumedOffer();
        offer.priceBreakdown = { ...offer.priceBreakdown, currency: 'CHF' };
        const contract = await conclude(offer);
        assert.ok(contract.lineItems.length >= 2);
        for (const line of contract.lineItems) {
            assert.equal(line.currency, 'CHF', `${line.sourceKey} lost the offer's currency`);
        }
    });

    test('and the tax on each closes the gap between its own net and gross', async () => {
        const contract = await conclude(consumedOffer());
        for (const line of contract.lineItems) {
            assert.equal(
                Math.round((line.priceNet + line.taxAmount) * 100) / 100,
                line.priceGross,
                `${line.sourceKey} does not add up`,
            );
        }
    });

    test('the discount the offer implies carries a negative tax, not a positive one', async () => {
        // The discount line is appended by the platform rather than supplied,
        // so it is the one a stamping applied only to the offer's own lines
        // would miss — and a discount taxed the wrong way round overstates what
        // is owed.
        const contract = await conclude(consumedOffer());
        const discount = contract.lineItems.find((line) => line.kind === 'discount');
        assert.ok(discount, 'the offer carries a promotion, so a discount line is expected');
        assert.ok(discount.priceNet < 0);
        assert.ok(discount.taxAmount < 0, 'a discount reduces the tax as well as the price');
        assert.ok(rateExplainsTax(discount));
    });
});

// The unit itself, asked of the function rather than through a contract.
//
// Only one of the two readings is reachable end to end: `discount-line-items`
// prices the discount it appends as `net * (1 + vatRate)`, so an offer stating
// a percentage gets a discount line 20 times its size long before this is
// consulted. That is a pre-existing defect of the offer arithmetic and not
// this function's to fix — but the function still has to answer for a
// breakdown whose own totals say per cent, because a consumer supplies the
// breakdown and only the platform's line pricing assumes otherwise.

// @requirement SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived
describe('reading the unit an offer states its VAT rate in', () => {
    test('a fraction beside totals that agree with it becomes a percentage', () => {
        assert.equal(vatPercentFromOfferRate(0.19, 637.2, 758.27), 19);
        assert.equal(vatPercentFromOfferRate(0.081, 100, 108.1), 8.1);
    });

    test('a percentage beside totals that agree with it is left as it is', () => {
        assert.equal(vatPercentFromOfferRate(19, 637.2, 758.27), 19);
        assert.equal(vatPercentFromOfferRate(8.1, 100, 108.1), 8.1);
    });

    test('zero is zero under either reading', () => {
        assert.equal(vatPercentFromOfferRate(0, 100, 100), 0);
    });

    test('totals that prove nothing fall to the unit this platform produces', () => {
        // A breakdown nobody here priced. The fraction is what
        // `checkout-offer.service.ts` and `discount-line-items.ts` both assume,
        // so it is what an unrecognised one is taken to be — the alternative is
        // reading 0.19 as a fifth of a per cent.
        assert.equal(vatPercentFromOfferRate(0.19, 100, 500), 19);
    });

    test('a total of nothing is still read as the fraction it is', () => {
        // Both readings produce a gross of zero, so the totals cannot separate
        // them. A fully discounted contract is the case, and it still has a
        // rate.
        assert.equal(vatPercentFromOfferRate(0.19, 0, 0), 19);
    });
});
