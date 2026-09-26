// The tenant's charges — the one request of the tenants descriptor that has no
// twin in the admin client.
//
// Pinned the way `settings-resource.test.js` pins its descriptor: there is no
// second implementation to compare against, so the request itself is what is
// measured. The path is the one `@saasicat/nest` serves
// (`GET /admin/tenants/{slug}/charges`), and
// `tests/openapi-covers-the-implementation.test.js` holds it to the contract
// from the other side.

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, tenantsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function answering(status, body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        return Promise.resolve({
            status,
            headers: { get: () => (body === undefined ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === undefined ? '' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

const ACCOUNT = {
    holder: { id: 's1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    entries: [],
};

describe('tenantsResource.charges', () => {
    test("asks for the tenant's charges, with its slug escaped", async () => {
        const { http, calls } = answering(200, ACCOUNT);

        const account = await bindResource(tenantsResource, http, CTX).charges('a b');

        assert.deepEqual(calls, [
            { url: '/api/v1/admin/tenants/a%20b/charges', method: 'GET', body: undefined },
        ]);
        assert.deepEqual(account, ACCOUNT);
    });

    test('an answer with no account is an error, not an account with no charges', async () => {
        const { http } = answering(204, undefined);

        await assert.rejects(
            () => bindResource(tenantsResource, http, CTX).charges('northwind'),
            /no body/,
        );
    });
});
