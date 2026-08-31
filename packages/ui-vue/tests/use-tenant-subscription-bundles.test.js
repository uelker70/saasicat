// useTenantSubscriptionBundles — the tenant self-service composable behind
// "my bundles".
//
// It had no test of its own, which is why nobody noticed that its two
// mutations and its loader answer a failed request in opposite ways: `load()`
// catches into `error`, `add()` and `cancel()` reject. Both are deliberate —
// a page renders the list either way, but a mutation the caller awaited has to
// fail loudly — and both need to keep the shape `toAdminError` reads.

// @requirement SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TenantSubscriptionBundlesApiError,
    adminErrorMessage,
    SA_MESSAGES,
    toAdminError,
    useTenantSubscriptionBundles,
} from '../dist/index.js';
import { authenticating } from './support/authenticating-client.mjs';

const EN = SA_MESSAGES.en.errors;

const RECORD = {
    id: 'sb-1',
    tenantId: 't-1',
    bundleVersionId: 'bv-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    minimumTermEndsAt: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    billingCycle: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
};

function httpReturning({ status = 200, body = null } = {}) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            headers: { get: () => null },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

function bundles(options = {}) {
    return useTenantSubscriptionBundles({ billingEndpoint: '/api/v1', ...options });
}

describe('useTenantSubscriptionBundles', () => {
    test('the endpoint is required — there is no prefix the platform could guess', () => {
        assert.throws(() => useTenantSubscriptionBundles({}), /billingEndpoint/);
    });

    // Named for what it checks: the round trip on this record. The claim that
    // EVERY declared date is converted is proved next door, against the type
    // itself, in `every-wire-date-is-hydrated.test.js`.
    test('load() maps the wire dates on a record onto Dates', async () => {
        const { http, calls } = httpReturning({ body: [RECORD] });
        const view = bundles({ http });
        await view.load();
        assert.equal(calls[0].url, '/api/v1/billing/subscription-bundles');
        assert.equal(view.loading.value, false);
        assert.equal(view.error.value, null);
        assert.ok(view.bundles.value[0].startedAt instanceof Date);
        assert.ok(view.bundles.value[0].createdAt instanceof Date);
        // The nullable ones stay null rather than becoming `new Date(null)`,
        // which is the epoch and would render as 1970.
        assert.equal(view.bundles.value[0].canceledAt, null);
        assert.equal(view.bundles.value[0].minimumTermEndsAt, null);
    });

    test('the booking’s own period arrives as dates, not as wire strings', async () => {
        // A monthly bundle beside a yearly plan: its window is the one a tenant
        // reads to see when the booking renews, and a string here throws the
        // moment anything calls a date method on it.
        const { http } = httpReturning({
            body: [
                {
                    ...RECORD,
                    billingCycle: 'MONTHLY',
                    currentPeriodStart: '2026-02-28T00:00:00.000Z',
                    currentPeriodEnd: '2026-03-31T00:00:00.000Z',
                },
            ],
        });
        const view = bundles({ http });
        await view.load();
        const booking = view.bundles.value[0];
        assert.ok(booking.currentPeriodStart instanceof Date);
        assert.ok(booking.currentPeriodEnd instanceof Date);
        assert.equal(booking.currentPeriodEnd.toISOString(), '2026-03-31T00:00:00.000Z');
    });

    test('a booking with no period of its own keeps null, not the epoch', async () => {
        const { http } = httpReturning({ body: [RECORD] });
        const view = bundles({ http });
        await view.load();
        assert.equal(view.bundles.value[0].currentPeriodStart, null);
        assert.equal(view.bundles.value[0].currentPeriodEnd, null);
    });

    test('a nullable date that is set is mapped too', async () => {
        const { http } = httpReturning({
            body: [{ ...RECORD, canceledAt: '2026-02-01T00:00:00.000Z' }],
        });
        const view = bundles({ http });
        await view.load();
        assert.ok(view.bundles.value[0].canceledAt instanceof Date);
    });

    test('load() keeps the list usable and reports the failure on `error`', async () => {
        const { http } = httpReturning({ status: 500, body: { message: 'nope' } });
        const view = bundles({ http });
        await view.load();
        assert.equal(view.bundles.value.length, 0);
        assert.ok(view.error.value instanceof TenantSubscriptionBundlesApiError);
        assert.equal(view.error.value.status, 500);
        // The class's own message is a diagnostic; the body's is the one a
        // person may read.
        assert.equal(adminErrorMessage(view.error.value, EN), 'nope');
    });

    test('a 204 to load() is an empty list, not a failure', async () => {
        const { http } = httpReturning({ status: 204 });
        const view = bundles({ http });
        await view.load();
        assert.deepEqual(view.bundles.value, []);
        assert.equal(view.error.value, null);
    });

    test('add() prepends the new bundle and sends the token', async () => {
        const { http, calls } = httpReturning({ body: RECORD });
        const view = bundles({ http: authenticating(http, 'tok') });
        const created = await view.add({ bundleVersionId: 'bv-1', minimumTermMonths: 12 });
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
        assert.ok(created.startedAt instanceof Date);
        assert.deepEqual(
            view.bundles.value.map((b) => b.id),
            ['sb-1'],
        );
    });

    test('without a token no Authorization header is invented', async () => {
        const { http, calls } = httpReturning({ body: RECORD });
        await bundles({ http }).add({ bundleVersionId: 'bv-1' });
        assert.equal(calls[0].init.headers.Authorization, undefined);
    });

    test('cancel() replaces the row it cancelled', async () => {
        const { http, calls } = httpReturning({
            body: { ...RECORD, canceledAt: RECORD.updatedAt },
        });
        const view = bundles({ http });
        view.bundles.value = [{ ...RECORD, canceledAt: null }];
        const canceled = await view.cancel('sb-1', { canceledAt: RECORD.updatedAt });
        assert.equal(calls[0].url, '/api/v1/billing/subscription-bundles/sb-1');
        assert.equal(calls[0].init.method, 'DELETE');
        assert.ok(canceled.canceledAt instanceof Date);
        assert.equal(view.bundles.value.length, 1);
        assert.ok(view.bundles.value[0].canceledAt instanceof Date);
    });

    test('a mutation the server answered without a body says the change may have landed', async () => {
        // The empty-body sentinel, at one of the sites that raises it. `add`
        // is a POST the caller awaited: the server accepted it and returned
        // 204, so the row is missing but the subscription may exist.
        const { http } = httpReturning({ status: 204 });
        for (const call of [
            () => bundles({ http }).add({ bundleVersionId: 'bv-1' }),
            () => bundles({ http }).cancel('sb-1'),
        ]) {
            const err = await call().then(
                () => null,
                (e) => e,
            );
            assert.ok(err instanceof TenantSubscriptionBundlesApiError);
            assert.equal(toAdminError(err).emptyResponse, true);
            assert.equal(adminErrorMessage(err, EN), EN.emptyResponse);
        }
    });

    test('a mutation that failed outright is not that — it says check the status', async () => {
        // Same class, other throw site. This is the discrimination the brand
        // alone could not make: identity says "our diagnostic", it does not
        // say "the server answered".
        const { http } = httpReturning({ status: 409, body: {} });
        const err = await bundles({ http })
            .add({ bundleVersionId: 'bv-1' })
            .then(
                () => null,
                (e) => e,
            );
        assert.equal(err.status, 409);
        assert.equal(toAdminError(err).emptyResponse, false);
        assert.equal(adminErrorMessage(err, EN), EN.conflict);
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpReturning({ body: [RECORD] });
        const view = bundles({ http, autoLoad: true });
        // `void load()` is fire-and-forget, so there is no promise to await —
        // a timer is what lets the whole chain (request, `json()`, the
        // assignment) settle before the state is read.
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
        assert.equal(view.bundles.value.length, 1);
        assert.equal(view.loading.value, false);
    });
});
