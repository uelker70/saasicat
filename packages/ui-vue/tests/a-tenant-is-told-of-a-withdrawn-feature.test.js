// The features withdrawn from a tenant's subscription are read beside its plan
// by every user of the tenant, and nothing at all is shown where the
// installation does not withdraw features — the server answers 404 there. The
// composable reads that as "not here", every other failure as an error the card
// has to say, and asks what ending at once would credit before it ends
// anything.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantFeatureWithdrawals } from '../dist/index.js';
import { scriptedHttp } from './helpers/scripted-http.js';

const WITHDRAWAL = {
    withdrawalId: 'fw-1',
    featureKey: 'EXPORT',
    featureLabel: 'Data export',
    reason: 'The export service has been switched off.',
    effectiveFrom: '2026-07-01T00:00:00.000Z',
    liftedFrom: null,
    inEffect: true,
    lines: [],
    specialTerms: false,
    endable: { subscription: true, subscriptionBundleIds: [] },
};
const PREVIEW = { endsAt: '2026-07-10T09:00:00.000Z', creditNet: 33.87, currency: 'EUR' };

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('reading the withdrawals', () => {
    test('a tenant whose subscription was told sees them', async () => {
        const { client, calls } = scriptedHttp([200, [WITHDRAWAL]]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await state.reload();

        assert.deepEqual(calls, [
            { url: '/billing/feature-withdrawals', method: 'GET', body: undefined },
        ]);
        assert.equal(state.available.value, true);
        assert.deepEqual(state.withdrawals.value, [WITHDRAWAL]);
        assert.equal(state.error.value, null);
    });

    test('a 404 hides everything without an error: the installation does not withdraw features', async () => {
        const { client } = scriptedHttp([200, [WITHDRAWAL]], [404, { code: 'X' }]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });
        await state.reload();

        await state.reload();

        assert.equal(state.available.value, false);
        assert.deepEqual(state.withdrawals.value, [], 'a hidden card kept its data');
        assert.equal(state.error.value, null);
    });

    test('any other failure is an error to say, not an empty list', async () => {
        const { client } = scriptedHttp([500, { code: 'X' }]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await state.reload();

        assert.equal(state.available.value, true);
        assert.ok(state.error.value instanceof Error);
    });

    // @requirement SC-UI-020 — A page never takes the whole screen down because data arrived in an unexpected shape
    test('a list of something else is an error, not withdrawals to draw', async () => {
        const booking = { id: 'sb-1', bundleVersionId: 'bv-1', label: 'Seats' };
        const { client } = scriptedHttp([200, [booking]]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await state.reload();

        assert.deepEqual(state.withdrawals.value, []);
        assert.match(
            String(state.error.value?.message),
            /did not answer with a list of withdrawals/,
        );
    });

    test('an answer that is not a list is an error, not "nothing withdrawn"', async () => {
        const { client } = scriptedHttp([200, { withdrawals: [WITHDRAWAL] }]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await state.reload();

        assert.deepEqual(state.withdrawals.value, []);
        assert.match(String(state.error.value?.message), /did not answer with a list/);
    });
});

// @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
describe('ending at once', () => {
    test('asks what the subscription would credit, and ends it, under the prefix given', async () => {
        const { client, calls } = scriptedHttp(
            [200, PREVIEW],
            [200, { ...PREVIEW, withdrawalId: 'fw/1', subscriptionBundleId: null }],
            [200, []],
        );
        const state = useTenantFeatureWithdrawals({
            http: client,
            apiPrefix: '/api/billing/',
            autoLoad: false,
        });

        assert.deepEqual(await state.previewEnd('fw/1', null), PREVIEW);
        await state.end('fw/1', null);

        assert.deepEqual(calls, [
            { url: '/api/billing/feature-withdrawals/fw%2F1/end', method: 'GET', body: undefined },
            { url: '/api/billing/feature-withdrawals/fw%2F1/end', method: 'POST', body: {} },
            { url: '/api/billing/feature-withdrawals', method: 'GET', body: undefined },
        ]);
        assert.deepEqual(state.withdrawals.value, [], 'read again after the end');
    });

    test('ends one booking by its own path', async () => {
        const { client, calls } = scriptedHttp([200, PREVIEW], [200, PREVIEW], [200, []]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await state.previewEnd('fw-1', 'sb-1');
        await state.end('fw-1', 'sb-1');

        assert.deepEqual(
            calls.map((call) => `${call.method} ${call.url}`),
            [
                'GET /billing/feature-withdrawals/fw-1/bookings/sb-1/end',
                'POST /billing/feature-withdrawals/fw-1/bookings/sb-1/end',
                'GET /billing/feature-withdrawals',
            ],
        );
    });

    test('a refused end is thrown to the card, and nothing is read again', async () => {
        const { client, calls } = scriptedHttp([422, { code: 'FEATURE_WITHDRAWAL_NOT_IN_EFFECT' }]);
        const state = useTenantFeatureWithdrawals({ http: client, autoLoad: false });

        await assert.rejects(() => state.end('fw-1', null));

        assert.equal(calls.length, 1);
    });
});
