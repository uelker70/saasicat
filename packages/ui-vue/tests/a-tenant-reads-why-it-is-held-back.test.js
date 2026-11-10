// useTenantAccessState — the tenant's state, from the route that tells the
// user the most: the billing permission's first, the one every user reads
// where that one is not for this user.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick } from 'vue';

import { TENANT_ACCESS_POLL_MS, useTenantAccessState } from '../dist/index.js';

// Stopped here rather than at the end of each case: a case that fails an
// assertion never reaches its own `scope.stop()`, and the composable's timer
// would then keep the process alive.
const scopes = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    mock.timers.reset();
});

async function settled() {
    for (let i = 0; i < 6; i += 1) {
        await nextTick();
        await Promise.resolve();
    }
}

const HELD_BACK = {
    state: 'read-only',
    reasons: [{ kind: 'overdue', since: '2026-11-16', invoiceNumber: 'RE-2026-0042' }],
    holdsBillingPermission: true,
    mayPay: true,
};
const OPEN = { state: 'open', reasons: [], holdsBillingPermission: true, mayPay: true };
const UNNAMED = {
    ...HELD_BACK,
    reasons: [{ kind: 'overdue', since: '2026-11-16', invoiceNumber: null }],
    holdsBillingPermission: false,
    mayPay: false,
};

const answered = (status, body) => ({
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
});

/** A client answering each path with its `[status, body]`, as `answers` holds it when asked. */
function routing(answers) {
    const asked = [];
    const http = async (url) => {
        asked.push(url);
        const [status, body] = answers[url] ?? [404, {}];
        return answered(status, body);
    };
    return { http, asked };
}

/** The state read through `routing(answers)`, only when asked to. */
function stateAnswering(answers, options = {}) {
    const { http, asked } = routing(answers);
    return { access: useTenantAccessState({ http, autoLoad: false, ...options }), asked };
}

/** The state as a mounted page reads it: on its own, inside a scope that ends. */
function watching(answers) {
    const { http, asked } = routing(answers);
    const scope = effectScope();
    scopes.push(scope);
    return { access: scope.run(() => useTenantAccessState({ http })), asked, scope };
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

// @requirement SC-ADM-054 — A tenant's users read why it is held back
describe('while the page is open', () => {
    test('reads again every minute, and not once the page is gone', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        const { asked, scope } = watching({ '/billing/account/access': [200, OPEN] });
        await settled();
        assert.equal(asked.length, 1);
        mock.timers.tick(TENANT_ACCESS_POLL_MS);
        await settled();
        assert.equal(asked.length, 2);
        scope.stop();
        mock.timers.tick(TENANT_ACCESS_POLL_MS);
        await settled();
        assert.equal(asked.length, 2);
    });

    test('a hold begun during the session shows on the next read, and goes once lifted', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        const answers = { '/billing/account/access': [200, OPEN] };
        const { access } = watching(answers);
        await settled();
        assert.equal(access.view.value?.state, 'open');

        answers['/billing/account/access'] = [200, HELD_BACK];
        mock.timers.tick(TENANT_ACCESS_POLL_MS);
        await settled();
        assert.equal(access.view.value?.state, 'read-only');

        answers['/billing/account/access'] = [200, OPEN];
        mock.timers.tick(TENANT_ACCESS_POLL_MS);
        await settled();
        assert.equal(access.view.value?.state, 'open');
    });

    test('an answer that arrives after a newer one does not put back what it replaced', async () => {
        let answerTheFirst;
        let reads = 0;
        const http = (url) => {
            reads += 1;
            if (reads === 1) {
                return new Promise((resolve) => {
                    answerTheFirst = () => resolve(answered(200, HELD_BACK));
                });
            }
            return Promise.resolve(answered(url.endsWith('/account/access') ? 200 : 404, OPEN));
        };
        const access = useTenantAccessState({ http, autoLoad: false });

        const first = access.reload();
        await access.reload();
        answerTheFirst();
        await first;

        assert.equal(access.view.value?.state, 'open');
        assert.equal(access.loading.value, false);
    });
});
