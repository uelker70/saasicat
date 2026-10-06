// Where a tax adapter decides, a subscriber can be given its next contract
// once the address an invoice names is complete and the adapter treats it as
// it stands. `readinessFor` says which of the two holds it back, computed when
// it is read: the operator's views and the tenant's own read it from here.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TaxTreatments } from '../dist/billing/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../dist/testing/index.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './helpers/tax-adapter.js';

const AT = new Date('2026-10-05T10:00:00.000Z');
const ADDRESS = { addressLine1: 'Ringstraße 1', postalCode: '1010', city: 'Wien' };
const SETTINGS = { ...TAX_SETTINGS, app: { name: 'Test App' } };

/** A subscriber of tenant-1 with these details, in an installation whose adapter is `adapter`. */
async function subscriberWith(details, { adapter = TEST_TAX_ADAPTER, settings = SETTINGS } = {}) {
    const repo = new FakeSubscriberRepository();
    const subscribers = new SubscriberService(
        repo,
        settings,
        new TaxTreatments(settings, settings.tax ? adapter : null),
    );
    const created = await subscribers.createForTenant('tenant-1', {
        legalName: 'Customer GmbH',
        ...ADDRESS,
        ...details,
    });
    return { subscribers, repo, created };
}

const readiness = (subscribers) => subscribers.readinessFor({ tenantId: 'tenant-1' }, AT);

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe('what holds a subscriber’s next contract back', () => {
    test('nothing, for a consumer in Germany with its address', async () => {
        const { subscribers } = await subscriberWith({ country: 'DE', business: false });
        assert.deepEqual(await readiness(subscribers), {
            ready: true,
            missing: [],
            taxRefusal: null,
        });
    });

    test('the empty fields of its address, in the order an invoice names them', async () => {
        const { subscribers } = await subscriberWith({
            country: 'DE',
            postalCode: null,
            addressLine1: null,
        });
        assert.deepEqual(await readiness(subscribers), {
            ready: false,
            missing: ['addressLine1', 'postalCode'],
            taxRefusal: null,
        });
    });

    test('the adapter sentence, for a case it supports no treatment for', async () => {
        const { subscribers } = await subscriberWith({ country: 'FR', business: false });
        assert.deepEqual(await readiness(subscribers), {
            ready: false,
            missing: [],
            taxRefusal: 'A consumer outside Germany is not supported.',
        });
    });

    test('a business in Austria: held back until its number is validated, then not', async () => {
        const { subscribers, repo, created } = await subscriberWith({
            country: 'AT',
            business: true,
            vatId: 'ATU12345678',
        });
        assert.equal((await readiness(subscribers)).taxRefusal, 'No validated VAT number.');

        await repo.recordVatIdCheck(created.id, {
            vatId: 'ATU12345678',
            checkedAt: new Date('2026-10-05T08:00:00.000Z'),
            valid: true,
            service: 'VIES',
            confirmation: {},
        });

        assert.equal((await readiness(subscribers)).ready, true);
    });

    test('an adapter that fails is not read as a refusal: its error comes through', async () => {
        const { subscribers } = await subscriberWith(
            { country: 'DE' },
            {
                adapter: {
                    ...TEST_TAX_ADAPTER,
                    decide: () => {
                        throw new Error('the rate table could not be read');
                    },
                },
            },
        );
        await assert.rejects(readiness(subscribers), /the rate table could not be read/);
    });

    test('a tenant without a subscriber is told so', async () => {
        const { subscribers } = await subscriberWith({ country: 'DE' });
        await assert.rejects(
            subscribers.readinessFor({ tenantId: 'tenant-without' }, AT),
            (error) => error.getResponse().code === 'SUBSCRIBER_REQUIRED',
        );
    });

    test('without an adapter nothing holds a contract back, so there is no answer', async () => {
        const { subscribers } = await subscriberWith(
            { country: null, addressLine1: null },
            { settings: { vatRate: 19, app: { name: 'Test App' } } },
        );
        assert.equal(await readiness(subscribers), null);
    });
});
