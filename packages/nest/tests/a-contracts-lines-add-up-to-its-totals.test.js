// A contract's lines and its totals are one statement, not two.
//
// The total is what is charged; the lines are what an invoice itemises. Tax is
// computed once on the net of the charges billed together, and each line
// carries its share of it, so the lines come to the total in net, gross and
// tax to the cent — whichever way the contract arises, and whatever a caller
// hands the door.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTRACT_ERROR_CODES } from '@saasicat/core';
import {
    contractTotalsOf,
    recordContractLinesMoney,
    SubscriptionContractService,
} from '../dist/subscription-contract/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';
import {
    BUNDLE_VERSION,
    PLAN_VERSION,
    buildOfferService,
    fakeBundleRepo,
    fakePlanRepo,
    fakePromoCodes,
    fakePromotionRepo,
} from './helpers/checkout-catalogue.js';
import { subscribersFor } from './helpers/subscribers.js';

const EUR_19 = { currency: 'EUR', taxRate: 19 };
const EFFECTIVE_FROM = new Date('2026-06-01T00:00:00.000Z');

const cents = (amount) => Math.round(amount * 100);
const sum = (values) => values.reduce((total, value) => total + cents(value), 0) / 100;
/** The gross of one amount on its own, the way every figure here is converted. */
const ownGross = (net, rate = 19) => Math.round(net * (1 + rate / 100) * 100) / 100;

function line(kind, priceNet, billingCycle = 'monthly', sourceKey = kind) {
    return {
        kind,
        sourceKey,
        sourceVersionId: kind === 'discount' ? null : `${sourceKey}-v1`,
        titleSnapshot: sourceKey,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet,
        billingCycle,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
    };
}

/** A contract a caller builds with the exported functions, as an application would. */
function contractOf(lines, billingCycle = 'monthly', money = EUR_19) {
    const lineItems = recordContractLinesMoney(lines, money);
    return {
        tenantId: 'tenant-1',
        effectiveFrom: EFFECTIVE_FROM,
        priceSnapshot: {
            currency: money.currency,
            billingCycle,
            vatRate: money.taxRate,
            ...contractTotalsOf(lineItems, billingCycle),
        },
        lineItems,
    };
}

async function contractService() {
    const repo = new FakeSubscriptionContractRepository();
    const service = new SubscriptionContractService(
        repo,
        (await subscribersFor(['tenant-1'])).service,
    );
    return { repo, service };
}

function refusedWith(code, params = {}) {
    return (error) => {
        assert.equal(error.getResponse().code, code, error.message);
        for (const [key, value] of Object.entries(params)) {
            assert.equal(error.getResponse().params[key], value, key);
        }
        return true;
    };
}

// @requirement SC-PRIC-050 — A contract's lines add up to its totals in net, gross and tax
describe('each line carries its share of one tax computation', () => {
    test('two lines that round the same way: the total is converted once, and the second line carries the cent', () => {
        // Converted on their own, 10.02 + 10.02 at 19 % are 11.92 + 11.92 = 23.84,
        // while the total of 20.04 is 23.85.
        const lineItems = recordContractLinesMoney(
            [line('plan', 10.02), line('bundle', 10.02)],
            EUR_19,
        );
        assert.deepEqual(
            lineItems.map((item) => [item.priceNet, item.priceGross, item.taxAmount]),
            [
                [10.02, 11.92, 1.9],
                [10.02, 11.93, 1.91],
            ],
        );
        assert.deepEqual(contractTotalsOf(lineItems, 'monthly'), {
            subtotalNet: 20.04,
            discountNet: 0,
            totalNet: 20.04,
            totalGross: 23.85,
        });
    });

    test('over price pairs and triples, with and without a discount, the lines add up and none is more than a cent from its own conversion', () => {
        const prices = [0.01, 1.99, 4.99, 10.02, 12.5, 29.9, 49, 99.99, 149.95];
        let contracts = 0;
        for (const rate of [19, 7, 0]) {
            for (const plan of prices) {
                for (const addOn of prices) {
                    for (const discount of [0, 0.01, Math.min(plan, 3.33), plan + addOn]) {
                        const lines = [line('plan', plan), line('bundle', addOn)];
                        if (discount > 0) lines.push(line('discount', -discount));
                        const lineItems = recordContractLinesMoney(lines, {
                            currency: 'EUR',
                            taxRate: rate,
                        });
                        const totals = contractTotalsOf(lineItems, 'monthly');
                        const what = `${plan} + ${addOn} − ${discount} at ${rate} %`;
                        assert.equal(
                            cents(totals.totalGross),
                            cents(ownGross(totals.totalNet, rate)),
                            what,
                        );
                        assert.equal(
                            sum(lineItems.map((item) => item.taxAmount)),
                            sum([totals.totalGross, -totals.totalNet]),
                            `tax of ${what}`,
                        );
                        for (const item of lineItems) {
                            const off = Math.abs(
                                cents(item.priceGross) - cents(ownGross(item.priceNet, rate)),
                            );
                            assert.ok(off <= 1, `${item.kind} of ${what} is ${off} cents off`);
                        }
                        contracts += 1;
                    }
                }
            }
        }
        assert.equal(contracts, 3 * 9 * 9 * 4);
    });

    test('a rate of zero carries no tax on any line', () => {
        const lineItems = recordContractLinesMoney(
            [line('plan', 10.02), line('bundle', 10.02), line('discount', -5)],
            { currency: 'EUR', taxRate: 0 },
        );
        for (const item of lineItems) {
            assert.equal(item.priceGross, item.priceNet);
            assert.equal(item.taxAmount, 0);
        }
    });
});

// @requirement SC-PRIC-050 — A contract's lines add up to its totals in net, gross and tax
// @requirement SC-PRIC-012 — A contract mixing rhythms totals one period of its own rhythm
describe('a contract mixing rhythms', () => {
    test('each rhythm pays its tax on its own net, and the total is what the charges come to', () => {
        // A yearly plan at 100 and a monthly add-on at 10.02: one charge of 119.00
        // and twelve of 11.92 are 262.04, not the 262.09 a single conversion of
        // the year's 220.24 would state.
        const lineItems = recordContractLinesMoney(
            [line('plan', 100, 'yearly'), line('bundle', 10.02, 'monthly')],
            EUR_19,
        );
        assert.deepEqual(
            lineItems.map((item) => [item.priceGross, item.taxAmount]),
            [
                [119, 19],
                [11.92, 1.9],
            ],
        );
        assert.deepEqual(contractTotalsOf(lineItems, 'yearly'), {
            subtotalNet: 220.24,
            discountNet: 0,
            totalNet: 220.24,
            totalGross: 262.04,
        });
    });

    test('a monthly line does not take a share of the yearly line before it', () => {
        // One running total over both rhythms would hand the add-on the cent the
        // yearly plan's rounding left over: 11.93 where it is charged 11.92 each
        // month, twelve times over.
        const lineItems = recordContractLinesMoney(
            [line('plan', 10.02, 'yearly'), line('bundle', 10.02, 'monthly')],
            EUR_19,
        );
        assert.deepEqual(
            lineItems.map((item) => item.priceGross),
            [11.92, 11.92],
        );
        assert.equal(contractTotalsOf(lineItems, 'yearly').totalGross, 154.96);
    });

    test('the door holds such a contract to the weighted total, not to the lines counted once', async () => {
        const { service } = await contractService();
        const contract = contractOf(
            [line('plan', 100, 'yearly'), line('bundle', 10.02, 'monthly')],
            'yearly',
        );
        const counted = await service.create(contract);
        assert.equal(counted.priceSnapshot.totalGross, 262.04);

        const onceEach = {
            ...contract,
            priceSnapshot: {
                ...contract.priceSnapshot,
                subtotalNet: 110.02,
                totalNet: 110.02,
                totalGross: 130.92,
            },
        };
        await assert.rejects(
            () => service.create(onceEach),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP, {
                field: 'priceSnapshot.subtotalNet',
                lines: 220.24,
                stated: 110.02,
            }),
        );
    });
});

// The catalogue of the reproduction in #311: a plan and an add-on at 10.02,
// a code that takes the whole plan, and a free month on the add-on.
const TEN_O_TWO_PLAN = { ...PLAN_VERSION, monthlyNet: '10.02', yearlyNet: '100.20' };
const TEN_O_TWO_ADD_ON = { ...BUNDLE_VERSION, monthlyNet: '10.02', yearlyNet: '100.20' };
const WHOLE_PLAN = {
    valid: true,
    code: 'WHOLEPLAN',
    label: '100 %',
    discount: { valueType: 'PERCENT', value: '100.00', durationType: 'ONCE', durationValue: null },
};
const TEN_PER_CENT = {
    ...WHOLE_PLAN,
    code: 'TENPERCENT',
    discount: { ...WHOLE_PLAN.discount, value: '10.00' },
};

function promotion(fields) {
    return {
        id: 'promo',
        internalLabel: 'internal',
        type: 'percent',
        value: 20,
        appliesTo: ['STANDARD'],
        targetType: 'PLAN',
        billingCycle: 'both',
        validFrom: '2026-01-01',
        validTo: '2099-12-31',
        priority: 1,
        onlyLocales: null,
        requiresCoupon: false,
        codes: [],
        color: '#000',
        i18n: {},
        ...fields,
    };
}

/** An offer priced from the catalogue, consumed, and concluded into its contract. */
async function concluded(overrides, selection) {
    const built = buildOfferService(overrides);
    const offer = await built.service.create({
        planKey: 'STANDARD',
        billingCycle: 'monthly',
        bundleVersionIds: [TEN_O_TWO_ADD_ON.id],
        ...selection,
    });
    const consumed = await built.service.consume(offer.id);
    const { service } = await contractService();
    const contract = await service.createFromOffer(consumed, {
        tenantId: 'tenant-1',
        effectiveFrom: EFFECTIVE_FROM,
    });
    return { ...built, offer, contract };
}

function assertLinesAddUp(lineItems, totalNet, totalGross, what) {
    assert.equal(sum(lineItems.map((item) => item.priceNet)), totalNet, `net of ${what}`);
    assert.equal(sum(lineItems.map((item) => item.priceGross)), totalGross, `gross of ${what}`);
}

// @requirement SC-PRIC-050 — A contract's lines add up to its totals in net, gross and tax
describe('an offer and the contract concluded from it', () => {
    test('the reproduction: lines that came to −0.01 under totals of 0 come to 0', async () => {
        const { offer, contract } = await concluded(
            {
                plans: fakePlanRepo({ versions: [TEN_O_TWO_PLAN] }),
                bundles: fakeBundleRepo([TEN_O_TWO_ADD_ON]),
                promoCodes: fakePromoCodes([WHOLE_PLAN]),
                promotions: fakePromotionRepo([
                    promotion({
                        id: 'free-month',
                        type: 'freeMonths',
                        value: 1,
                        appliesTo: [TEN_O_TWO_ADD_ON.bundleKey],
                        targetType: 'BUNDLE',
                    }),
                ]),
            },
            { promoCode: WHOLE_PLAN.code },
        );
        assert.equal(offer.priceBreakdown.effectiveNet, 0);
        assert.equal(offer.priceBreakdown.effectiveGross, 0);
        assertLinesAddUp(offer.lineItems, 0, 0, 'the offer');
        assertLinesAddUp(contract.lineItems, 0, 0, 'the contract');
        assert.equal(sum(contract.lineItems.map((item) => item.taxAmount)), 0);
        const discount = contract.lineItems.find((item) => item.kind === 'discount');
        assert.equal(discount.metadata.discountGross, -discount.priceGross);
    });

    test('over price pairs, with and without a code, the offer and its contract add up', async () => {
        const prices = ['0.99', '4.99', '10.02', '12.34', '29.90', '99.99'];
        for (const plan of prices) {
            for (const addOn of prices) {
                for (const promoCode of [null, TEN_PER_CENT.code]) {
                    const what = `${plan} + ${addOn} with ${promoCode ?? 'no code'}`;
                    const { offer, contract } = await concluded(
                        {
                            plans: fakePlanRepo({
                                versions: [{ ...PLAN_VERSION, monthlyNet: plan }],
                            }),
                            bundles: fakeBundleRepo([{ ...BUNDLE_VERSION, monthlyNet: addOn }]),
                            promoCodes: fakePromoCodes([TEN_PER_CENT]),
                        },
                        { bundleVersionIds: [BUNDLE_VERSION.id], promoCode },
                    );
                    const { effectiveNet, effectiveGross } = offer.priceBreakdown;
                    assertLinesAddUp(
                        offer.lineItems,
                        effectiveNet,
                        effectiveGross,
                        `the offer of ${what}`,
                    );
                    assertLinesAddUp(
                        contract.lineItems,
                        contract.priceSnapshot.totalNet,
                        contract.priceSnapshot.totalGross,
                        `the contract of ${what}`,
                    );
                }
            }
        }
    });

    test('an offer whose stored lines were each converted on their own still concludes, and its contract adds up', async () => {
        const built = buildOfferService({
            plans: fakePlanRepo({ versions: [TEN_O_TWO_PLAN] }),
            bundles: fakeBundleRepo([TEN_O_TWO_ADD_ON]),
        });
        const offer = await built.service.create({
            planKey: 'STANDARD',
            billingCycle: 'monthly',
            bundleVersionIds: [TEN_O_TWO_ADD_ON.id],
        });
        const row = built.repo.rows.get(offer.id);
        row.lineItems[1].priceGross = ownGross(10.02);
        assert.equal(
            sum(row.lineItems.map((item) => item.priceGross)),
            23.84,
            'the row as a line-by-line rounding left it',
        );

        const consumed = await built.service.consume(offer.id);
        const { service } = await contractService();
        const contract = await service.createFromOffer(consumed, {
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
        });
        assertLinesAddUp(contract.lineItems, 20.04, 23.85, 'the contract');
    });

    test('an offer stating a gross its lines do not come to is refused at the door, and nothing is stored', async () => {
        const built = buildOfferService({
            plans: fakePlanRepo({ versions: [TEN_O_TWO_PLAN] }),
            bundles: fakeBundleRepo([TEN_O_TWO_ADD_ON]),
        });
        const offer = await built.service.create({
            planKey: 'STANDARD',
            billingCycle: 'monthly',
            bundleVersionIds: [TEN_O_TWO_ADD_ON.id],
        });
        const consumed = { ...(await built.service.consume(offer.id)) };
        consumed.priceBreakdown = { ...consumed.priceBreakdown, effectiveGross: 23.84 };
        const { repo, service } = await contractService();
        await assert.rejects(
            () =>
                service.createFromOffer(consumed, {
                    tenantId: 'tenant-1',
                    effectiveFrom: EFFECTIVE_FROM,
                }),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP, {
                field: 'priceSnapshot.totalGross',
                lines: 23.85,
                stated: 23.84,
            }),
        );
        assert.equal(await repo.findActiveByTenantId('tenant-1', EFFECTIVE_FROM), null);
    });
});

// @requirement SC-PRIC-050 — A contract's lines add up to its totals in net, gross and tax
describe('the door, approached with lines that do not add up', () => {
    const LINES = [line('plan', 10.02), line('bundle', 10.02), line('discount', -5)];

    test('the lines a caller builds with the exported functions go through', async () => {
        const { service } = await contractService();
        const stored = await service.create(contractOf(LINES));
        assert.deepEqual(stored.priceSnapshot, {
            currency: 'EUR',
            billingCycle: 'monthly',
            vatRate: 19,
            subtotalNet: 20.04,
            discountNet: 5,
            totalNet: 15.04,
            totalGross: 17.9,
        });
    });

    for (const field of ['subtotalNet', 'discountNet', 'totalNet', 'totalGross']) {
        test(`a ${field} a cent off its lines, either way, is refused, and nothing is stored`, async () => {
            for (const off of [0.01, -0.01]) {
                const { repo, service } = await contractService();
                const contract = contractOf(LINES);
                const stated = Math.round((contract.priceSnapshot[field] + off) * 100) / 100;
                contract.priceSnapshot = { ...contract.priceSnapshot, [field]: stated };
                await assert.rejects(
                    () => service.create(contract),
                    refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP, {
                        field: `priceSnapshot.${field}`,
                        stated,
                    }),
                );
                assert.equal(await repo.findActiveByTenantId('tenant-1', EFFECTIVE_FROM), null);
            }
        });
    }

    test('lines each converted on their own, under a total converted once, are refused', async () => {
        const { service } = await contractService();
        const contract = contractOf([line('plan', 10.02), line('bundle', 10.02)]);
        contract.lineItems[1] = { ...contract.lineItems[1], priceGross: 11.92, taxAmount: 1.9 };
        await assert.rejects(
            () => service.create(contract),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP, {
                field: 'priceSnapshot.totalGross',
                lines: 23.84,
                stated: 23.85,
            }),
        );
    });

    test('a replacement whose lines do not add up leaves the contract in force', async () => {
        const { service } = await contractService();
        const first = await service.create(contractOf(LINES));
        const next = contractOf(LINES);
        next.priceSnapshot = { ...next.priceSnapshot, totalGross: 18 };
        const switchAt = new Date('2026-07-01T00:00:00.000Z');
        await assert.rejects(
            () =>
                service.replaceActiveContract(
                    'tenant-1',
                    { ...next, effectiveFrom: switchAt },
                    switchAt,
                ),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP),
        );
        const still = await service.getById(first.id);
        assert.equal(still.status, 'active');
        assert.equal(still.effectiveUntil, null);
    });
});

// @requirement SC-PRIC-051 — Nothing a contract takes off is negative
describe('nothing a contract takes off is negative', () => {
    const LINES = [line('plan', 30), line('bundle', 20)];

    for (const [what, negative, field] of [
        [
            'a promotion snapshot',
            { promotionSnapshots: [{ id: 'p', resolvedAmountNet: -0.01 }] },
            'promotionSnapshots[0].resolvedAmountNet',
        ],
        [
            'a promo code snapshot',
            { promoCodeSnapshots: [{ code: 'X', resolvedAmountNet: -0.01 }] },
            'promoCodeSnapshots[0].resolvedAmountNet',
        ],
    ]) {
        test(`${what} resolved below zero is refused, and nothing is stored`, async () => {
            const { repo, service } = await contractService();
            await assert.rejects(
                () => service.create({ ...contractOf(LINES), ...negative }),
                refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE, {
                    field,
                    amount: -0.01,
                }),
            );
            assert.equal(await repo.findActiveByTenantId('tenant-1', EFFECTIVE_FROM), null);
        });
    }

    test('a discount line that adds money is refused, even where the totals follow it', async () => {
        const { service } = await contractService();
        await assert.rejects(
            () => service.create(contractOf([...LINES, line('discount', 0.01)])),
            refusedWith(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE, {
                field: 'priceSnapshot.discountNet',
                amount: -0.01,
            }),
        );
    });

    test('a discount of exactly zero goes through', async () => {
        const { service } = await contractService();
        const stored = await service.create({
            ...contractOf(LINES),
            promotionSnapshots: [{ id: 'p', resolvedAmountNet: 0 }],
            promoCodeSnapshots: [{ code: 'X', resolvedAmountNet: 0 }],
        });
        assert.equal(stored.priceSnapshot.discountNet, 0);
    });

    test('a promotion stated above 100 % takes the plan and nothing of the add-on, and a code after it takes nothing', async () => {
        // The second reproduction in #311: 150 % on a plan at 30 beside an add-on
        // at 20 took 45 — fifteen of them off the add-on — and a 5.00 code after
        // it resolved to −15.00 in the contract's snapshot.
        const FIVE_OFF = {
            valid: true,
            code: 'FIVEOFF',
            label: '5 EUR',
            discount: {
                valueType: 'ABSOLUTE',
                value: '5.00',
                durationType: 'ONCE',
                durationValue: null,
            },
        };
        const { offer, contract } = await concluded(
            {
                plans: fakePlanRepo({ versions: [{ ...PLAN_VERSION, monthlyNet: '30.00' }] }),
                bundles: fakeBundleRepo([{ ...BUNDLE_VERSION, monthlyNet: '20.00' }]),
                promoCodes: fakePromoCodes([FIVE_OFF]),
                promotions: fakePromotionRepo([promotion({ id: 'too-much', value: 150 })]),
            },
            { bundleVersionIds: [BUNDLE_VERSION.id], promoCode: FIVE_OFF.code },
        );
        assert.equal(offer.promotionSnapshots[0].resolvedAmountNet, 30);
        assert.equal(offer.promoCodeSnapshot.resolvedAmountNet, 0);
        assert.equal(offer.priceBreakdown.effectiveNet, 20);
        for (const snapshot of [...contract.promotionSnapshots, ...contract.promoCodeSnapshots]) {
            assert.ok(snapshot.resolvedAmountNet >= 0, JSON.stringify(snapshot));
        }
    });
});
