// Where config/saas.yaml names a tax adapter, a contract is concluded at the
// rate the adapter decides for its subscriber, records the treatment, and a
// promo code with a fixed amount takes that amount off what the subscriber
// pays. A case the adapter does not support gets no contract. Without an
// adapter everything is as it was. The adapter here charges the German rate in
// Germany, the reverse charge to a business elsewhere in the Union with a
// validated number, nothing to a business outside it, and supports nothing
// else — the shape of `@saasicat/tax-de`, without depending on it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FakeSubscriberRepository,
    FakeSubscriptionContractRepository,
} from '../dist/testing/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import { TaxTreatments } from '../dist/billing/index.js';

const EU = new Set(['AT', 'FR', 'IT', 'NL']);
const ADAPTER = { name: 'test-tax', version: '3.0.0' };

const treated = (kind, rate) => ({
    supported: true,
    treatment: { kind, rate, note: null, adapter: ADAPTER },
});

const testAdapter = {
    ...ADAPTER,
    decide: ({ origin }) => {
        if (origin.country === 'DE') return treated('standard', 19);
        if (origin.business !== true)
            return { supported: false, reason: 'A consumer outside Germany is not supported.' };
        if (EU.has(origin.country)) {
            return origin.validatedVatId
                ? treated('reverse-charge', 0)
                : { supported: false, reason: 'No validated VAT number.' };
        }
        return treated('not-taxable', 0);
    },
    checkVatId: async () => ({ completed: false, reason: 'not asked' }),
};

const SETTINGS = {
    app: { name: 'Test App' },
    currency: 'EUR',
    timeZone: 'Europe/Berlin',
    tax: { adapter: 'test-tax' },
    issuer: { legalName: 'Issuer GmbH', country: 'DE', vatId: 'DE123456789' },
    tenantBilling: {},
};
const FILE_SETTINGS = { ...SETTINGS, tax: undefined, timeZone: undefined, vatRate: 19 };

const EFFECTIVE_FROM = new Date('2026-06-01T00:00:00.000Z');

/** A monthly offer for a plan at 100 € net, priced at 19 %, with a code "10 € off". */
function consumedOffer() {
    return {
        id: 'offer-1',
        planKey: 'STANDARD',
        planVersionId: 'pv-1',
        billingCycle: 'monthly',
        bundleVersionIds: [],
        priceBreakdown: {
            currency: 'EUR',
            billingCycle: 'monthly',
            planNet: 100,
            bundlesNet: 0,
            regularNet: 100,
            effectiveNet: 91.6,
            vatRate: 19,
            effectiveGross: 109,
        },
        lineItems: [
            {
                kind: 'plan',
                sourceKey: 'STANDARD',
                sourceVersionId: 'pv-1',
                titleSnapshot: 'Standard',
                descriptionSnapshot: null,
                quantity: 1,
                unit: null,
                priceNet: 100,
                priceGross: 119,
                billingCycle: 'monthly',
                featuresSnapshot: [],
                quotaEffectsSnapshot: {},
                metadata: null,
            },
        ],
        promotionSnapshots: [],
        promoCodeSnapshot: {
            code: 'TEN',
            label: '10 € off',
            valueType: 'ABSOLUTE',
            value: 10,
            resolvedAmountNet: 8.4,
        },
        status: 'consumed',
    };
}

/** A contract service over fakes, with one subscriber for `tenant-1` of these details. */
async function serviceWith(
    details,
    { settings = SETTINGS, adapter = testAdapter, validated = null } = {},
) {
    const subscriberRepo = new FakeSubscriberRepository();
    const subscribers = new SubscriberService(subscriberRepo, settings);
    const subscriber = await subscribers.createForTenant('tenant-1', {
        legalName: 'Customer GmbH',
        ...details,
    });
    if (validated) {
        await subscriberRepo.recordVatIdCheck(subscriber.id, {
            vatId: validated,
            checkedAt: new Date('2026-05-30T10:00:00.000Z'),
            valid: true,
            service: 'VIES',
            confirmation: { requestIdentifier: 'R1' },
        });
    }
    const repo = new FakeSubscriptionContractRepository();
    const taxes = new TaxTreatments(settings, adapter && settings.tax ? adapter : null);
    return {
        repo,
        subscribers,
        service: new SubscriptionContractService(repo, subscribers, null, taxes),
    };
}

const conclude = (service) =>
    service.createFromOffer(consumedOffer(), {
        tenantId: 'tenant-1',
        effectiveFrom: EFFECTIVE_FROM,
        entitlementSnapshot: { plan: 'STANDARD', quotas: {}, features: [] },
    });

/** What a contract charges, as the parts a reader checks. */
function money(contract) {
    return {
        vatRate: contract.priceSnapshot.vatRate,
        totalNet: contract.priceSnapshot.totalNet,
        totalGross: contract.priceSnapshot.totalGross,
        codeNet: contract.promoCodeSnapshots[0]?.resolvedAmountNet,
        lineRates: [...new Set(contract.lineItems.map((line) => line.taxRate))],
    };
}

function refusedWith(code) {
    return (error) => error.getStatus() === 422 && error.getResponse().code === code;
}

describe('a contract takes the rate the tax adapter decides for its subscriber', () => {
    test('a subscriber in Germany: 19 %, the code is 8.40 € net, the treatment recorded', async () => {
        const { service } = await serviceWith({ country: 'DE', business: false });
        const contract = await conclude(service);
        assert.deepEqual(money(contract), {
            vatRate: 19,
            totalNet: 91.6,
            totalGross: 109,
            codeNet: 8.4,
            lineRates: [19],
        });
        assert.deepEqual(contract.taxTreatment, {
            kind: 'standard',
            rate: 19,
            note: null,
            adapter: ADAPTER,
        });
    });

    test('a business in Austria with a validated number: reverse charge at 0 %, and the code takes 10 € off', async () => {
        const { service } = await serviceWith(
            { country: 'AT', business: true, vatId: 'ATU12345678' },
            { validated: 'ATU12345678' },
        );
        const contract = await conclude(service);
        assert.deepEqual(money(contract), {
            vatRate: 0,
            totalNet: 90,
            totalGross: 90,
            codeNet: 10,
            lineRates: [0],
        });
        assert.equal(contract.taxTreatment.kind, 'reverse-charge');
    });

    test('a business in Switzerland: not taxable, at 0 %', async () => {
        const { service } = await serviceWith({ country: 'CH', business: true });
        const contract = await conclude(service);
        assert.equal(contract.taxTreatment.kind, 'not-taxable');
        assert.equal(money(contract).totalGross, 90);
    });

    test('a consumer in France is refused with the adapter sentence, and nothing is written', async () => {
        const { service, repo } = await serviceWith({ country: 'FR', business: false });
        await assert.rejects(() => conclude(service), refusedWith('TAX_TREATMENT_NOT_SUPPORTED'));
        assert.deepEqual(await repo.list({ tenantId: 'tenant-1' }), []);
    });

    test('a business in Austria whose number is not validated is refused', async () => {
        const { service } = await serviceWith({
            country: 'AT',
            business: true,
            vatId: 'ATU12345678',
        });
        await assert.rejects(() => conclude(service), refusedWith('TAX_TREATMENT_NOT_SUPPORTED'));
    });

    test('a contract handed over at a rate other than the decided one is refused, naming the field', async () => {
        const { service } = await serviceWith(
            { country: 'AT', business: true, vatId: 'ATU12345678' },
            { validated: 'ATU12345678' },
        );
        const atNineteen = service.createDataFromOffer(consumedOffer(), {
            tenantId: 'tenant-1',
            effectiveFrom: EFFECTIVE_FROM,
        });
        await assert.rejects(
            () => service.create(atNineteen),
            (error) =>
                refusedWith('SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_DECIDED')(error) &&
                error.getResponse().params.field === 'priceSnapshot.vatRate' &&
                error.getResponse().params.decided === 0,
        );
    });

    test('a subscriber the adapter cannot treat gets no new contract: refused before a change moves anything', async () => {
        const { service } = await serviceWith({ country: 'FR', business: false });
        await assert.rejects(
            () => service.assertPartyFor('tenant-1'),
            refusedWith('TAX_TREATMENT_NOT_SUPPORTED'),
        );
        const domestic = await serviceWith({ country: 'DE', business: false });
        await domestic.service.assertPartyFor('tenant-1');
    });

    test('a successor is decided before the contract in force ends, so a refusal leaves that one running', async () => {
        const { service, subscribers, repo } = await serviceWith({
            country: 'DE',
            business: false,
        });
        const first = await conclude(service);
        // The subscriber moves to France as a consumer: a case the adapter does not support.
        await subscribers.changeContactOfTenant('tenant-1', { country: 'FR' }, 'operator:test');

        const next = {
            ...service.dataOf(first),
            effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        };
        await assert.rejects(
            () => service.writeSuccessor(first, next, next.effectiveFrom),
            refusedWith('TAX_TREATMENT_NOT_SUPPORTED'),
        );
        const contracts = await repo.list({ tenantId: 'tenant-1' });
        assert.equal(contracts.length, 1);
        assert.equal(contracts[0].status, 'active');
        assert.equal(contracts[0].effectiveUntil, null);
    });
});

describe('without a tax adapter', () => {
    test('the offer rate stands and no treatment is recorded', async () => {
        const { service } = await serviceWith(
            { country: 'FR', business: false },
            { settings: FILE_SETTINGS },
        );
        const contract = await conclude(service);
        assert.deepEqual(money(contract), {
            vatRate: 19,
            totalNet: 91.6,
            totalGross: 109,
            codeNet: 8.4,
            lineRates: [19],
        });
        assert.equal(contract.taxTreatment ?? null, null);
    });
});
