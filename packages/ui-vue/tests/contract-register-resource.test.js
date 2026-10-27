// The contract register, as the contracts descriptor asks for it: one page of
// every contract of the installation, narrowed to a standing on a day.
//
// Pinned the way `open-items-resource.test.js` pins its requests: the path is
// the one `@saasicat/nest` serves, and
// `tests/openapi-covers-the-implementation.test.js` holds it to the contract
// from the other side.

// @requirement SC-ADM-046 — The contract register reads where each contract stands on a day of the installation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, contractsResource } from '../dist/index.js';

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
    return { calls, ops: bindResource(contractsResource, http, CTX) };
}

describe('the contract register’s requests', () => {
    test('every operation the descriptor declares is pinned here', () => {
        assert.deepEqual(Object.keys(contractsResource.ops), ['page']);
    });

    for (const [request, url] of [
        [undefined, '/api/v1/admin/contracts'],
        [{ state: 'in-force' }, '/api/v1/admin/contracts?state=in-force'],
        [
            { state: 'never-in-force', day: '2026-02-17' },
            '/api/v1/admin/contracts?state=never-in-force&day=2026-02-17',
        ],
        [
            { state: 'all', after: 'contract 9' },
            '/api/v1/admin/contracts?state=all&after=contract+9',
        ],
    ]) {
        test(`a page for ${JSON.stringify(request)} asks ${url}`, async () => {
            const page = {
                today: '2026-02-17',
                state: 'in-force',
                day: '2026-02-17',
                contracts: [],
                next: null,
            };
            const { calls, ops } = recording(page);

            assert.deepEqual(await ops.page(request), page);
            assert.deepEqual(calls, [{ url, method: 'GET' }]);
        });
    }
});
