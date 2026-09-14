// The sign-up configurator shows the price the offer and the contract charge.
//
// The yearly price is the one the plan version carries. A plan at 9.99 a month
// and 99.00 a year is not ten monthly prices, and a configurator that derived
// its own figure showed 99.90 for a contract of 99.00 — and let a promo code
// preview work on the wrong amount.

// @requirement SC-PRIC-007 — An amount a tenant sees is the amount that is charged
// @requirement SC-PRIC-010 — A yearly price is a price per year, not a monthly price with a discount attached

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PendingRegistrationService } from '../dist/registration/index.js';

const BASIC = {
    id: 'basic',
    code: 'B',
    name: 'Basic',
    glyph: 'B',
    tagline: '',
    planId: 'BASIC',
    monthlyNet: 9.99,
    yearlyNet: 99,
    tags: [],
    includedFeatureKeys: [],
    quotaBase: {},
};

/** A yearly price above twelve monthly ones, which saves nothing. */
const DEAR = { ...BASIC, id: 'dear', planId: 'DEAR', monthlyNet: 10, yearlyNet: 130 };

const CATALOG = { currency: 'EUR', vatRate: 19, models: [BASIC, DEAR] };

/**
 * The service with only what configuring a plan reaches: one pending
 * registration past e-mail verification, the catalogue, and a promo preview
 * that records the subtotal it was asked about.
 */
function configurator() {
    const pending = {
        id: 'pending-1',
        email: 'kasse@verein.example',
        status: 'EMAIL_VERIFIED',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        configJson: null,
    };
    const repo = {
        async findById(id) {
            return id === pending.id ? pending : null;
        },
        async update(id, data) {
            Object.assign(pending, data);
            return pending;
        },
    };
    const previews = [];
    const promoPreview = {
        async preview(params) {
            previews.push(params);
            return { valid: true, discountAmount: 5, percent: 5, label: 'Start' };
        },
    };
    const unused = null;
    const service = new PendingRegistrationService(
        repo,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        { log: async () => {} },
        undefined,
        undefined,
        undefined,
        { getCatalog: async () => CATALOG },
        promoPreview,
    );
    const save = (modelId, billingCycle, appliedPromoCode = null) =>
        service.saveConfiguration({
            pendingRegistrationId: pending.id,
            selection: { modelId, billingCycle, appliedPromoCode },
        });
    return { service, save, previews, pendingId: pending.id };
}

describe('the configurator breakdown', () => {
    test('a monthly plan costs its monthly price and saves nothing', async () => {
        const { breakdown } = await configurator().save('basic', 'MONTHLY');

        assert.equal(breakdown.subtotalNet, 9.99);
        assert.equal(breakdown.totalGross, 11.89);
        assert.equal(breakdown.yearlySavings, 0);
    });

    test('a yearly plan costs the yearly price its plan version carries', async () => {
        const { breakdown } = await configurator().save('basic', 'YEARLY');

        assert.equal(breakdown.subtotalNet, 99, 'not ten monthly prices, 99.90');
        assert.equal(breakdown.totalNet, 99);
        assert.equal(breakdown.totalGross, 117.81);
        assert.equal(breakdown.yearlySavings, 20.88, 'twelve monthly prices minus the yearly one');
    });

    test('a yearly price above twelve monthly ones saves nothing rather than a negative amount', async () => {
        const { breakdown } = await configurator().save('dear', 'YEARLY');

        assert.equal(breakdown.subtotalNet, 130);
        assert.equal(breakdown.yearlySavings, 0);
    });

    test('a promo code is previewed on the yearly price that is charged', async () => {
        const saving = configurator();
        await saving.save('basic', 'YEARLY', 'START5');
        assert.equal(saving.previews.at(-1).subtotalGross, 117.81, 'on saving the configuration');

        await saving.service.previewConfigPromo(saving.pendingId, 'START5');
        assert.equal(saving.previews.at(-1).subtotalGross, 117.81, 'on the live preview');
    });

    test('resuming the step shows the same yearly figure', async () => {
        const resumed = configurator();
        await resumed.save('basic', 'YEARLY');

        const breakdown = await resumed.service.getCurrentBreakdown(resumed.pendingId);

        assert.equal(breakdown.subtotalNet, 99);
    });
});
