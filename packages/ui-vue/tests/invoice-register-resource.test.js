// The register of every invoice, as the invoices descriptor asks for it: a
// page of the months picked, and what they add up to.
//
// Pinned the way `subscriber-record-resource.test.js` pins its requests: the
// paths are the ones `@saasicat/nest` serves, and
// `tests/openapi-covers-the-implementation.test.js` holds them to the contract
// from the other side.

// @requirement SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, invoicesResource } from '../dist/index.js';

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
    return { calls, ops: bindResource(invoicesResource, http, CTX) };
}

describe('the register’s requests', () => {
    test('every operation the descriptor declares is pinned here', () => {
        assert.deepEqual(Object.keys(invoicesResource.ops).sort(), ['list', 'totals']);
    });

    for (const [request, url] of [
        [undefined, '/api/v1/admin/invoices'],
        [{}, '/api/v1/admin/invoices'],
        [{ from: '2026-07' }, '/api/v1/admin/invoices?from=2026-07'],
        [
            { from: '2026-07', until: '2026-09', after: 'invoice 9' },
            '/api/v1/admin/invoices?from=2026-07&until=2026-09&after=invoice+9',
        ],
    ]) {
        test(`a page of ${JSON.stringify(request)} asks ${url}`, async () => {
            const page = { from: '2026-07', until: '2026-09', invoices: [], next: null };
            const { calls, ops } = recording(page);

            assert.deepEqual(await ops.list(request), page);
            assert.deepEqual(calls, [{ url, method: 'GET' }]);
        });
    }

    for (const [months, url] of [
        [undefined, '/api/v1/admin/invoice-totals'],
        [{ until: '2026-09' }, '/api/v1/admin/invoice-totals?until=2026-09'],
        [
            { from: '2026-07', until: '2026-09' },
            '/api/v1/admin/invoice-totals?from=2026-07&until=2026-09',
        ],
    ]) {
        test(`the totals of ${JSON.stringify(months)} ask ${url}, never after an invoice`, async () => {
            const totals = { from: '2026-07', until: '2026-09', months: [], range: [] };
            const { calls, ops } = recording(totals);

            assert.deepEqual(
                await ops.totals(months === undefined ? undefined : { ...months, after: 'x' }),
                totals,
            );
            assert.deepEqual(calls, [{ url, method: 'GET' }]);
        });
    }
});
