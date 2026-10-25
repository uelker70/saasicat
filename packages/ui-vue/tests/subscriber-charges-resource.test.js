// A subscriber's charges, as its record reads them — a request of the
// subscribers descriptor that has no twin in the admin client.
//
// Pinned the way `settings-resource.test.js` pins its descriptor: there is no
// second implementation to compare against, so the request itself is what is
// measured. The path is the one `@saasicat/nest` serves
// (`GET /admin/subscribers/{id}/charges`), and
// `tests/openapi-covers-the-implementation.test.js` holds it to the contract
// from the other side.

// @requirement SC-ADM-037 — An operator reads a subscriber's charges in its record

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, subscribersResource } from '../dist/index.js';

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

describe('subscribersResource.charges', () => {
    test("asks for the subscriber's charges, with its id escaped", async () => {
        const { http, calls } = answering(200, ACCOUNT);

        const account = await bindResource(subscribersResource, http, CTX).charges('a b');

        assert.deepEqual(calls, [
            { url: '/api/v1/admin/subscribers/a%20b/charges', method: 'GET', body: undefined },
        ]);
        assert.deepEqual(account, ACCOUNT);
    });

    test('an answer with no account is an error, not an account with no charges', async () => {
        const { http } = answering(204, undefined);

        await assert.rejects(
            () => bindResource(subscribersResource, http, CTX).charges('s1'),
            /no body/,
        );
    });
});
