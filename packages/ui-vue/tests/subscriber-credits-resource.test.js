// A subscriber's credits and the payout recorded against one — two requests of
// the subscribers descriptor that have no twin in the admin client.
//
// Pinned the way `subscriber-charges-resource.test.js` pins the charges: the
// request itself is what is measured. The paths are the ones `@saasicat/nest`
// serves (`GET /admin/subscribers/{id}/credits`,
// `POST /admin/subscribers/{id}/credits/{creditId}/payouts`), and
// `tests/openapi-covers-the-implementation.test.js` holds them to the contract
// from the other side.

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, subscribersResource } from '../dist/index.js';

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

describe('subscribersResource.credits', () => {
    test("asks for the subscriber's credits, with its id escaped", async () => {
        const { http, calls } = answering(200, CREDITS);

        const credits = await bindResource(subscribersResource, http, CTX).credits('a b');

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/subscribers/a%20b/credits',
                method: 'GET',
                body: undefined,
                mfa: null,
            },
        ]);
        assert.deepEqual(credits, CREDITS);
    });

    test('an answer with no credits is an error, not a subscriber with none', async () => {
        const { http } = answering(204, undefined);

        await assert.rejects(
            () => bindResource(subscribersResource, http, CTX).credits('s1'),
            /no body/,
        );
    });
});

describe('subscribersResource.recordPayout', () => {
    test('posts the payout against the credit, both escaped, with the second factor', async () => {
        const { http, calls } = answering(200, CREDITS);

        const credits = await bindResource(subscribersResource, http, CTX).recordPayout(
            'a b',
            'credit/1',
            PAYOUT,
            '123456',
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/v1/admin/subscribers/a%20b/credits/credit%2F1/payouts');
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].mfa, '123456');
        assert.deepEqual(JSON.parse(calls[0].body), PAYOUT);
        assert.deepEqual(credits, CREDITS);
    });
});
