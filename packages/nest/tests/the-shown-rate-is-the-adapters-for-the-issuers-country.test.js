// Before a subscriber says where it is, a price shows the rate for a
// subscriber in the issuer's country — the tax adapter's answer where
// config/saas.yaml names one — and the pricing page says which country that is.
// The adapter is then the one source: a rate the application passes beside it
// is an error, not a second answer. Without an adapter everything is as it was.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePlanRepository } from '../dist/testing/index.js';
import { PublicMarketingCatalogService } from '../dist/catalog/index.js';
import { ConfiguratorCatalogBuilder, TaxTreatments } from '../dist/billing/index.js';

const ADAPTER = { name: 'test-tax', version: '1.0.0' };
/** 19 % in Germany, 0 % for a small business, nothing else asked here. */
const adapterCharging = (rate) => ({
    ...ADAPTER,
    decide: ({ origin }) => ({
        supported: true,
        treatment: {
            kind: rate === 0 ? 'small-business' : 'standard',
            rate,
            note: null,
            adapter: ADAPTER,
            seen: origin,
        },
    }),
    checkVatId: async () => ({ completed: false, reason: 'not asked' }),
});

const SETTINGS = {
    currency: 'EUR',
    timeZone: 'Europe/Berlin',
    tax: { adapter: 'test-tax' },
    issuer: { legalName: 'Issuer GmbH', country: 'DE', vatId: 'DE123456789' },
};
const withAdapter = (rate = 19) => new TaxTreatments(SETTINGS, adapterCharging(rate));
const withoutAdapter = new TaxTreatments({ vatRate: 7 }, null);

function catalogueService(taxes) {
    return new PublicMarketingCatalogService(
        new FakePlanRepository(),
        { findByTarget: async () => null },
        { list: async () => [] },
        null,
        null,
        null,
        taxes,
    );
}

const marketing = (vatRate) => ({
    listPlanMarketing: () => [],
    getCurrency: () => 'EUR',
    ...(vatRate === undefined ? {} : { getVatRate: () => vatRate }),
});
const NO_PLANS = { listLivePlans: async () => [] };

// @requirement SC-PRIC-065 — Gross, net and tax are one calculation at the rate that applies, stated once
describe('the shown rate is the tax adapter answer for the issuer country', () => {
    test('the adapter is asked for a subscriber in the issuer country whose other details are unknown', () => {
        let seen;
        const taxes = new TaxTreatments(SETTINGS, {
            ...adapterCharging(19),
            decide: (request) => {
                seen = request;
                return adapterCharging(19).decide(request);
            },
        });
        taxes.shown(new Date('2026-05-15T10:00:00.000Z'), 'yearly');
        assert.deepEqual(seen.origin, {
            country: 'DE',
            business: null,
            vatId: null,
            validatedVatId: null,
        });
        assert.deepEqual(seen.issuer, { country: 'DE', vatId: 'DE123456789' });
        assert.equal(seen.timeZone, 'Europe/Berlin');
        assert.equal(
            seen.period.until.toISOString(),
            '2027-05-15T10:00:00.000Z',
            'one yearly period',
        );
    });

    test('the pricing page shows it, and says it is the rate for the issuer country', async () => {
        const page = await catalogueService(withAdapter()).getCatalog('de', 'EUR', null);
        assert.equal(page.vatRate, 19);
        assert.equal(page.vatRateShownFor, 'DE');
        const small = await catalogueService(withAdapter(0)).getCatalog('de', 'EUR', null);
        assert.equal(small.vatRate, 0);
    });

    test('without an adapter the page shows the rate passed, for everybody', async () => {
        const page = await catalogueService(withoutAdapter).getCatalog('de', 'EUR', 19);
        assert.deepEqual([page.vatRate, page.vatRateShownFor], [19, null]);
    });

    test('the configurator shows the adapter rate, and refuses a provider rate beside it', async () => {
        const builder = new ConfiguratorCatalogBuilder(withAdapter());
        assert.equal(
            (await builder.build({ sources: NO_PLANS, marketing: marketing() })).vatRate,
            19,
        );
        await assert.rejects(
            () => builder.build({ sources: NO_PLANS, marketing: marketing(19) }),
            /beside the tax adapter/,
        );
    });

    test('without an adapter the configurator needs the provider rate', async () => {
        const builder = new ConfiguratorCatalogBuilder(withoutAdapter);
        assert.equal(
            (await builder.build({ sources: NO_PLANS, marketing: marketing(7) })).vatRate,
            7,
        );
        await assert.rejects(
            () =>
                new ConfiguratorCatalogBuilder().build({
                    sources: NO_PLANS,
                    marketing: marketing(),
                }),
            /getVatRate is required/,
        );
    });
});
