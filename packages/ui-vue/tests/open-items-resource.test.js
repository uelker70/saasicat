// The open items, as the openItems descriptor asks for them: a page of the
// invoices that still owe, a page of the credits still owed, and their totals.
//
// Pinned the way `invoice-register-resource.test.js` pins its requests: the
// paths are the ones `@saasicat/nest` serves, and
// `tests/openapi-covers-the-implementation.test.js` holds them to the contract
// from the other side.

// @requirement SC-ADM-044 — An operator lists what subscribers still owe and are still owed, across every tenant

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, openItemsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

/** Every request with its method, answered with `body`. */
function recording(body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        return Promise.resolve({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { calls, ops: bindResource(openItemsResource, http, CTX) };
}

describe('the open items’ requests', () => {
    test('every operation the descriptor declares is pinned here', () => {
        assert.deepEqual(Object.keys(openItemsResource.ops).sort(), [
            'credits',
            'invoices',
            'totals',
        ]);
    });

    for (const [request, url] of [
        [undefined, '/api/v1/admin/open-items'],
        [{ overdue: false }, '/api/v1/admin/open-items'],
        [{ overdue: true }, '/api/v1/admin/open-items?overdue=true'],
        [
            { overdue: true, after: 'invoice 9' },
            '/api/v1/admin/open-items?overdue=true&after=invoice+9',
        ],
    ]) {
        test(`a page of open invoices for ${JSON.stringify(request)} asks ${url}`, async () => {
            const page = { today: '2026-10-27', overdueOnly: false, invoices: [], next: null };
            const { calls, ops } = recording(page);

            assert.deepEqual(await ops.invoices(request), page);
            assert.deepEqual(calls, [{ url, method: 'GET' }]);
        });
    }

    for (const [request, url] of [
        [undefined, '/api/v1/admin/open-credits'],
        [{ after: 'c-1' }, '/api/v1/admin/open-credits?after=c-1'],
    ]) {
        test(`a page of open credits for ${JSON.stringify(request)} asks ${url}`, async () => {
            const page = { credits: [], next: null, timeZone: 'Europe/Berlin' };
            const { calls, ops } = recording(page);

            assert.deepEqual(await ops.credits(request), page);
            assert.deepEqual(calls, [{ url, method: 'GET' }]);
        });
    }

    test('the totals ask /open-item-totals', async () => {
        const totals = { today: '2026-10-27', invoices: [], credits: [] };
        const { calls, ops } = recording(totals);

        assert.deepEqual(await ops.totals(), totals);
        assert.deepEqual(calls, [{ url: '/api/v1/admin/open-item-totals', method: 'GET' }]);
    });
});
