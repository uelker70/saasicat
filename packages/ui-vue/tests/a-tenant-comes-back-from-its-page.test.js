// useTenantReturn — a tenant whose subscription ended asks what it would come
// back on and pay, and takes the new subscription out, sending what the
// preview showed; once it has, every reader of the tenant's state on the page
// reads it again.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick } from 'vue';

import { useTenantAccessState, useTenantReturn } from '../dist/index.js';

/** The first period of a return on 20 October, and the day it lifts. */
const RETURNED = {
    plan: 'STANDARD',
    billingCycle: 'MONTHLY',
    planVersionId: 'standard-v3',
    periodStart: '2026-10-20T08:00:00.000Z',
    periodEnd: '2026-11-20T08:00:00.000Z',
    periodStartDays: { until: '2026-10-19', from: '2026-10-20' },
    periodEndDays: { until: '2026-11-19', from: '2026-11-20' },
};
const TERMS = {
    ...RETURNED,
    refusal: null,
    deletesOn: '2026-10-30',
    blockers: [],
    price: {
        currency: 'EUR',
        billingCycle: 'monthly',
        subtotalNet: 59,
        discountNet: 0,
        totalNet: 59,
        vatRate: 19,
        totalGross: 70.21,
    },
    cancellationNoticeDays: 0,
    paymentMethodRequired: false,
};
const OPEN = {
    state: 'open',
    reasons: [],
    holdsBillingPermission: true,
    mayPay: true,
    mayExport: false,
    exportDeliveredBy: null,
    mayReturn: false,
};

/** A client answering each `METHOD url` in turn with the `[status, body]` listed for it. */
function routedHttp(routes) {
    const calls = [];
    const client = async (url, init) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
        const [status, body] = routes[key]?.shift() ?? [404, {}];
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { client, calls };
}

const scopes = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

/** A reader of the tenant's state, as a page holds one, that reads only when told. */
function aReaderOfTheState(client) {
    const scope = effectScope();
    scopes.push(scope);
    return {
        scope,
        access: scope.run(() => useTenantAccessState({ http: client, autoLoad: false })),
    };
}

async function settled() {
    for (let i = 0; i < 6; i += 1) {
        await nextTick();
        await Promise.resolve();
    }
}

const reads = (calls) => calls.filter((call) => call.key === 'GET /billing/access').length;

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('what a tenant would come back on', () => {
    test('is asked for the plan and the rhythm chosen, under the prefix the app gives, and answered as the server says', async () => {
        const { client, calls } = routedHttp({
            'POST /api/billing/subscription/return/preview': [[200, TERMS]],
        });

        const preview = await useTenantReturn({
            http: client,
            apiPrefix: '/api/billing/',
        }).preview({ plan: 'STANDARD', billingCycle: 'MONTHLY' });

        assert.deepEqual(preview, TERMS);
        assert.deepEqual(calls, [
            {
                key: 'POST /api/billing/subscription/return/preview',
                body: { plan: 'STANDARD', billingCycle: 'MONTHLY' },
            },
        ]);
    });

    test('is why it cannot, where the server says so', async () => {
        const refused = { refusal: 'deletion-day-reached', deletesOn: '2026-10-30' };
        const { client } = routedHttp({
            'POST /billing/subscription/return/preview': [[200, refused]],
        });

        const preview = await useTenantReturn({ http: client }).preview({
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
        });

        assert.deepEqual(preview, refused);
    });

    test('answered with neither terms nor a refusal, is an error rather than terms nobody stated', async () => {
        // No refusal at all, and no refusal with none of the terms beside it.
        const { client } = routedHttp({
            'POST /billing/subscription/return/preview': [
                [200, { plan: 'STANDARD' }],
                [200, { refusal: null, plan: 'STANDARD' }],
            ],
        });
        const returns = useTenantReturn({ http: client });

        for (let answer = 0; answer < 2; answer += 1) {
            await assert.rejects(
                returns.preview({ plan: 'STANDARD', billingCycle: 'MONTHLY' }),
                /did not answer with what a return would be/,
            );
        }
    });
});

// @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
describe('taking the return out', () => {
    test('sends the version and the deletion day the preview showed, and every reader of the state reads it again', async () => {
        const { client, calls } = routedHttp({
            'POST /billing/subscription/return': [[201, RETURNED]],
            'GET /billing/access': [
                [200, OPEN],
                [200, OPEN],
            ],
        });
        const banner = aReaderOfTheState(client);
        const planSection = aReaderOfTheState(client);

        const returned = await useTenantReturn({ http: client }).takeOut({
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            planVersionId: 'standard-v3',
            expectedDeletesOn: '2026-10-30',
        });
        await settled();

        assert.deepEqual(returned, RETURNED);
        assert.deepEqual(calls[0], {
            key: 'POST /billing/subscription/return',
            body: {
                plan: 'STANDARD',
                billingCycle: 'MONTHLY',
                planVersionId: 'standard-v3',
                expectedDeletesOn: '2026-10-30',
            },
        });
        assert.equal(reads(calls), 2);
        assert.deepEqual(banner.access.view.value, OPEN);
        assert.deepEqual(planSection.access.view.value, OPEN);
    });

    test('names no version where the installation binds none', async () => {
        const { client, calls } = routedHttp({
            'POST /billing/subscription/return': [[201, { ...RETURNED, planVersionId: null }]],
        });

        await useTenantReturn({ http: client }).takeOut({
            plan: 'STANDARD',
            billingCycle: 'YEARLY',
            planVersionId: null,
            expectedDeletesOn: '2026-10-30',
        });

        assert.deepEqual(calls[0].body, {
            plan: 'STANDARD',
            billingCycle: 'YEARLY',
            expectedDeletesOn: '2026-10-30',
        });
    });

    test('refused, reaches the caller with its code and the preview as it now stands, and the state is read again', async () => {
        const now = { ...TERMS, planVersionId: 'standard-v4' };
        const { client, calls } = routedHttp({
            'POST /billing/subscription/return': [
                [409, { code: 'PLAN_CHANGE_QUOTE_CHANGED', message: '…', preview: now }],
            ],
            'GET /billing/access': [[200, OPEN]],
        });
        aReaderOfTheState(client);

        await assert.rejects(
            useTenantReturn({ http: client }).takeOut({
                plan: 'STANDARD',
                billingCycle: 'MONTHLY',
                planVersionId: 'standard-v3',
                expectedDeletesOn: '2026-10-30',
            }),
            (err) => {
                assert.equal(err.body.code, 'PLAN_CHANGE_QUOTE_CHANGED');
                assert.deepEqual(err.body.preview, now);
                return true;
            },
        );
        await settled();

        assert.equal(reads(calls), 1);
    });

    test('a reader whose page is gone is not told', async () => {
        const { client, calls } = routedHttp({
            'POST /billing/subscription/return': [[201, RETURNED]],
        });
        aReaderOfTheState(client).scope.stop();

        await useTenantReturn({ http: client }).takeOut({
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            planVersionId: 'standard-v3',
            expectedDeletesOn: '2026-10-30',
        });
        await settled();

        assert.equal(reads(calls), 0);
    });
});
