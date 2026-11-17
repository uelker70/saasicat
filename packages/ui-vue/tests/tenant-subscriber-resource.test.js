// The tenant's subscriber, the tenants a list holds back and where the
// tenant's deletion stands — requests of the tenants descriptor that have no
// twin in the admin client.
//
// Pinned the way `subscriber-charges-resource.test.js` pins its request: the path
// is the one `@saasicat/nest` serves, and
// `tests/openapi-covers-the-implementation.test.js` holds it to the contract
// from the other side.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, tenantsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function answering(answer) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        const { status, body } = answer(url);
        return Promise.resolve({
            status,
            headers: { get: () => (body === undefined ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === undefined ? '' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

const STANDING = {
    subscriber: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    readiness: { ready: true, missing: [], taxRefusal: null },
};

/** The tenant ids a request named, in order. */
const namedIn = (url) => new URL(url, 'http://admin.example').searchParams.getAll('tenantId');

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe('tenantsResource.subscriber', () => {
    test("asks for the tenant's subscriber, with its slug escaped", async () => {
        const { http, calls } = answering(() => ({ status: 200, body: STANDING }));

        const standing = await bindResource(tenantsResource, http, CTX).subscriber('a b');

        assert.deepEqual(calls, [{ url: '/api/v1/admin/tenants/a%20b/subscriber', method: 'GET' }]);
        assert.deepEqual(standing, STANDING);
    });

    test('an answer with no body is an error, not a tenant without a subscriber', async () => {
        const { http } = answering(() => ({ status: 204, body: undefined }));

        await assert.rejects(
            () => bindResource(tenantsResource, http, CTX).subscriber('northwind'),
            /no body/,
        );
    });
});

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe('tenantsResource.subscriberAttention', () => {
    const heldBack = (tenantId) => ({
        tenantId,
        readiness: { ready: false, missing: ['city'], taxRefusal: null },
    });

    test('names each tenant once, and answers what the server holds back', async () => {
        const { http, calls } = answering((url) => ({
            status: 200,
            body: {
                attention: namedIn(url)
                    .filter((id) => id !== 't-1')
                    .map(heldBack),
            },
        }));

        const attention = await bindResource(tenantsResource, http, CTX).subscriberAttention([
            't-1',
            't-2',
            't-1',
            't 3',
        ]);

        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.startsWith('/api/v1/admin/subscribers/attention?'));
        assert.deepEqual(namedIn(calls[0].url), ['t-1', 't-2', 't 3']);
        assert.deepEqual(
            attention.map(({ tenantId }) => tenantId),
            ['t-2', 't 3'],
        );
    });

    test('a list longer than the server takes is asked in pages of two hundred', async () => {
        const { http, calls } = answering((url) => ({
            status: 200,
            body: { attention: namedIn(url).map(heldBack) },
        }));
        const ids = Array.from({ length: 401 }, (_, index) => `t-${index}`);

        const attention = await bindResource(tenantsResource, http, CTX).subscriberAttention(ids);

        assert.deepEqual(
            calls.map(({ url }) => namedIn(url).length),
            [200, 200, 1],
        );
        assert.deepEqual(
            attention.map(({ tenantId }) => tenantId),
            ids,
        );
    });

    test('no tenants, no request', async () => {
        const { http, calls } = answering(() => ({ status: 200, body: { attention: [] } }));

        assert.deepEqual(
            await bindResource(tenantsResource, http, CTX).subscriberAttention([]),
            [],
        );
        assert.deepEqual(calls, []);
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('tenantsResource.deletion', () => {
    const DELETION = {
        tenantId: 't-1',
        status: { kind: 'due', deletesOn: '2026-12-01' },
        record: null,
    };

    test("asks where the tenant's deletion stands, with its slug escaped", async () => {
        const { http, calls } = answering(() => ({ status: 200, body: { deletion: DELETION } }));

        const deletion = await bindResource(tenantsResource, http, CTX).deletion('a b');

        assert.deepEqual(calls, [{ url: '/api/v1/admin/tenants/a%20b/deletion', method: 'GET' }]);
        assert.deepEqual(deletion, DELETION);
    });

    test('a tenant with no deletion to come answers none', async () => {
        const { http } = answering(() => ({ status: 200, body: { deletion: null } }));

        assert.equal(await bindResource(tenantsResource, http, CTX).deletion('northwind'), null);
    });

    test('an unknown tenant is refused with its code, not answered as one with no deletion', async () => {
        const { http } = answering(() => ({
            status: 404,
            body: { code: 'TENANT_NOT_FOUND', message: 'Tenant gone not found' },
        }));

        await assert.rejects(
            () => bindResource(tenantsResource, http, CTX).deletion('gone'),
            (error) => error.status === 404 && error.code === 'TENANT_NOT_FOUND',
        );
    });

    test('an answer with no body is an error', async () => {
        const { http } = answering(() => ({ status: 204, body: undefined }));

        await assert.rejects(
            () => bindResource(tenantsResource, http, CTX).deletion('northwind'),
            /no body/,
        );
    });
});
