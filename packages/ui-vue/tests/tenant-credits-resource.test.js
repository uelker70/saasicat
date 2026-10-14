// The tenant's credits and the payout recorded against one — two requests of
// the tenants descriptor that have no twin in the admin client.
//
// Pinned the way `tenant-charges-resource.test.js` pins the charges: the
// request itself is what is measured. The paths are the ones `@saasicat/nest`
// serves (`GET /admin/tenants/{slug}/credits`,
// `POST /admin/tenants/{slug}/credits/{creditId}/payouts`), and
// `tests/openapi-covers-the-implementation.test.js` holds them to the contract
// from the other side.

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, tenantsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function answering(status, body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body,
            mfa: init?.headers?.['X-Mfa-Code'] ?? null,
        });
        return Promise.resolve({
            status,
            headers: { get: () => (body === undefined ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === undefined ? '' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

const CREDITS = { credits: [], timeZone: 'Europe/Berlin' };
const PAYOUT = { amount: 40, reference: 'TRF-2026-0042', paidOn: '2026-03-03', note: null };

describe('tenantsResource.credits', () => {
    test("asks for the tenant's credits, with its slug escaped", async () => {
        const { http, calls } = answering(200, CREDITS);

        const credits = await bindResource(tenantsResource, http, CTX).credits('a b');

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/tenants/a%20b/credits',
                method: 'GET',
                body: undefined,
                mfa: null,
            },
        ]);
        assert.deepEqual(credits, CREDITS);
    });

    test('an answer with no credits is an error, not a tenant with none', async () => {
        const { http } = answering(204, undefined);

        await assert.rejects(
            () => bindResource(tenantsResource, http, CTX).credits('northwind'),
            /no body/,
        );
    });
});

describe('tenantsResource.recordPayout', () => {
    test('posts the payout against the credit, both escaped, with the second factor', async () => {
        const { http, calls } = answering(200, CREDITS);

        const credits = await bindResource(tenantsResource, http, CTX).recordPayout(
            'a b',
            'credit/1',
            PAYOUT,
            '123456',
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/v1/admin/tenants/a%20b/credits/credit%2F1/payouts');
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].mfa, '123456');
        assert.deepEqual(JSON.parse(calls[0].body), PAYOUT);
        assert.deepEqual(credits, CREDITS);
    });
});
