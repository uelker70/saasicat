// Whom the tenant is billed to is shown to whoever holds the billing
// permission, and to nobody else — decided by the server, which answers 403 to
// a user without it and 404 where the installation has no billing area. The
// composable reads those two as "not for this user", every other failure as an
// error the page has to say, and sends a change of the contact details only.

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantBillingDetails } from '../dist/index.js';
import { scriptedHttp } from './helpers/scripted-http.js';

const DETAILS = {
    customerNumber: 'K-1001',
    legalName: 'Meier GmbH',
    vatId: 'DE123456789',
    taxNumber: null,
    addressLine1: 'Hauptstraße 1',
    addressLine2: null,
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    invoiceEmail: 'rechnung@meier.example',
};

describe('loading the billing details', () => {
    test('a user holding the permission sees them', async () => {
        const { client, calls } = scriptedHttp([200, { details: DETAILS }]);
        const billing = useTenantBillingDetails({ http: client, autoLoad: false });

        await billing.reload();

        assert.deepEqual(calls, [{ url: '/billing/details', method: 'GET', body: undefined }]);
        assert.equal(billing.available.value, true);
        assert.deepEqual(billing.details.value, DETAILS);
        assert.equal(billing.error.value, null);
    });

    for (const [status, why] of [
        [403, 'the user lacks the billing permission'],
        [404, 'the installation has no billing area'],
    ]) {
        test(`a ${status} hides them without an error: ${why}`, async () => {
            const { client } = scriptedHttp([200, { details: DETAILS }], [status, { code: 'X' }]);
            const billing = useTenantBillingDetails({ http: client, autoLoad: false });
            await billing.reload();

            await billing.reload();

            assert.equal(billing.available.value, false);
            assert.equal(
                billing.details.value,
                null,
                'details hidden after a reload kept their data',
            );
            assert.equal(billing.error.value, null);
        });
    }

    test('any other failure keeps the part and says it failed', async () => {
        const { client } = scriptedHttp([500, { message: 'boom' }]);
        const billing = useTenantBillingDetails({ http: client, autoLoad: false });

        await billing.reload();

        assert.equal(billing.available.value, true);
        assert.ok(billing.error.value instanceof Error);
        assert.equal(billing.loading.value, false);
    });

    test('an answer in another shape is an error, not a subscriber nobody told anything', async () => {
        const { client } = scriptedHttp([200, { details: { city: 'Berlin' } }]);
        const billing = useTenantBillingDetails({ http: client, autoLoad: false });

        await billing.reload();

        assert.equal(billing.details.value, null);
        assert.match(billing.error.value?.message ?? '', /did not answer with \{ details \}/);
    });

    test('the prefix the billing routes sit under is used as given', async () => {
        const { client, calls } = scriptedHttp([200, { details: DETAILS }]);
        const billing = useTenantBillingDetails({
            http: client,
            apiPrefix: '/api/v1/billing/',
            autoLoad: false,
        });

        await billing.reload();

        assert.equal(calls[0].url, '/api/v1/billing/details');
    });
});

describe('changing the contact details', () => {
    test('sends the change and shows the details as the server now has them', async () => {
        const saved = { ...DETAILS, city: 'Potsdam', postalCode: '14467' };
        const { client, calls } = scriptedHttp([200, { details: saved }]);
        const billing = useTenantBillingDetails({ http: client, autoLoad: false });

        assert.deepEqual(await billing.save({ city: 'Potsdam', postalCode: '14467' }), saved);
        assert.deepEqual(calls, [
            {
                url: '/billing/details',
                method: 'PATCH',
                body: { city: 'Potsdam', postalCode: '14467' },
            },
        ]);
        assert.deepEqual(billing.details.value, saved);
    });

    test('a refusal reaches the caller with its code and field, and the details shown stay', async () => {
        const { client } = scriptedHttp(
            [200, { details: DETAILS }],
            [
                422,
                {
                    code: 'SUBSCRIBER_DETAIL_INVALID',
                    params: { field: 'invoiceEmail' },
                    message: 'no',
                },
            ],
        );
        const billing = useTenantBillingDetails({ http: client, autoLoad: false });
        await billing.reload();

        await assert.rejects(
            billing.save({ invoiceEmail: 'no address' }),
            (error) => error.code === 'SUBSCRIBER_DETAIL_INVALID' && error.status === 422,
        );
        assert.deepEqual(billing.details.value, DETAILS);
    });
});
