// A tenant confirms the end of its subscription — by cancelling it, or by
// ending it at once while a feature is withdrawn — on the deletion day its
// page showed, and the composables send that day for the server to check. A
// day the page did not show is not sent: the server refuses one where it
// announces none.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantBilling, useTenantFeatureWithdrawals } from '../dist/index.js';
import { scriptedHttp } from './helpers/scripted-http.js';

const LANDS = '2027-01-01T00:00:00.000Z';
const ENDED = { endsAt: LANDS, creditNet: 0, currency: 'EUR', deletion: null };

/** What a cancellation sends, given what its page showed. */
async function cancellationSent(...shown) {
    const { client, calls } = scriptedHttp([200, {}], [200, {}], [200, []]);
    const billing = useTenantBilling({ http: client, autoLoad: false });
    await billing.cancelSubscription(...shown);
    return calls[0];
}

// @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
describe('a cancellation sends what the page showed', () => {
    test('the date and the deletion day, where both were shown', async () => {
        assert.deepEqual(await cancellationSent(LANDS, '2027-01-31'), {
            url: '/billing/cancel',
            method: 'POST',
            body: { expectedEffectiveAt: LANDS, expectedDeletesOn: '2027-01-31' },
        });
    });

    test('the date alone, where no deletion day was shown', async () => {
        assert.deepEqual((await cancellationSent(LANDS, undefined)).body, {
            expectedEffectiveAt: LANDS,
        });
    });

    test('nothing, where nothing was shown', async () => {
        assert.equal((await cancellationSent()).body, undefined);
    });
});

// @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
describe('ending at once sends the deletion day the preview showed', () => {
    test('where it showed one', async () => {
        const { client, calls } = scriptedHttp(
            [200, { ...ENDED, withdrawalId: 'fw-1', subscriptionBundleId: null }],
            [200, []],
        );
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await state.end('fw-1', null, '2027-01-31');

        assert.deepEqual(calls[0], {
            url: '/billing/feature-withdrawals/fw-1/end',
            method: 'POST',
            body: { expectedDeletesOn: '2027-01-31' },
        });
    });
});
