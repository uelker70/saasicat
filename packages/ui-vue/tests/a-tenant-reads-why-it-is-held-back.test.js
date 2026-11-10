// useTenantAccessState — the tenant's state, from the route that tells the
// user the most: the billing permission's first, the one every user reads
// where that one is not for this user.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantAccessState } from '../dist/index.js';

const HELD_BACK = {
    state: 'read-only',
    reasons: [{ kind: 'overdue', since: '2026-11-16', invoiceNumber: 'RE-2026-0042' }],
    holdsBillingPermission: true,
    mayPay: true,
};
const UNNAMED = {
    ...HELD_BACK,
    reasons: [{ kind: 'overdue', since: '2026-11-16', invoiceNumber: null }],
    holdsBillingPermission: false,
    mayPay: false,
};

/** The state read through a client answering each path with its `[status, body]`. */
function stateAnswering(answers, options = {}) {
    const asked = [];
    const http = async (url) => {
        asked.push(url);
        const [status, body] = answers[url] ?? [404, {}];
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { access: useTenantAccessState({ http, autoLoad: false, ...options }), asked };
}

// @requirement SC-ADM-054 — A tenant's users read why it is held back
describe("the tenant's state, as its users read it", () => {
    test('a user with the billing permission reads it from that route, under the prefix the app gives', async () => {
        const { access, asked } = stateAnswering(
            { '/api/billing/account/access': [200, HELD_BACK] },
            { apiPrefix: '/api/billing/' },
        );

        await access.reload();

        assert.deepEqual(asked, ['/api/billing/account/access']);
        assert.deepEqual(access.view.value, HELD_BACK);
        assert.equal(access.error.value, null);
    });

    for (const status of [403, 404]) {
        test(`where that route answers ${status}, from the route every user reads`, async () => {
            const { access, asked } = stateAnswering({
                '/billing/account/access': [status, {}],
                '/billing/access': [200, UNNAMED],
            });

            await access.reload();

            assert.deepEqual(asked, ['/billing/account/access', '/billing/access']);
            assert.deepEqual(access.view.value, UNNAMED);
            assert.equal(access.error.value, null);
        });
    }

    test('where neither route is there, nothing to show and no error', async () => {
        const { access } = stateAnswering({});

        await access.reload();

        assert.equal(access.view.value, null);
        assert.equal(access.error.value, null);
    });

    test('a failure is an error, and the state read before stays', async () => {
        const answers = { '/billing/account/access': [200, HELD_BACK] };
        const { access } = stateAnswering(answers);
        await access.reload();

        answers['/billing/account/access'] = [500, {}];
        await access.reload();

        assert.ok(access.error.value instanceof Error);
        assert.deepEqual(access.view.value, HELD_BACK);
    });

    test('an answer without a state it knows is an error, not an open tenant', async () => {
        const { access } = stateAnswering({
            '/billing/account/access': [200, { ...HELD_BACK, state: 'paused' }],
        });

        await access.reload();

        assert.match(access.error.value?.message ?? '', /tenant access view/);
        assert.equal(access.view.value, null);
    });
});
