// The subscriber's record, as the subscribers descriptor asks for it: the list
// searched, the head of one record, its history and its corrections.
//
// Pinned the way `subscriber-charges-resource.test.js` pins its request: the
// path is the one `@saasicat/nest` serves, and
// `tests/openapi-covers-the-implementation.test.js` holds it to the contract
// from the other side.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, subscribersResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

const STANDING = {
    subscriber: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    readiness: { ready: true, missing: [], taxRefusal: null },
};

// @requirement SC-SUB-045 — The operator corrects a subscriber's identity and business status in its record
describe("the subscriber's corrections", () => {
    /** Every request with its headers and its body as sent. */
    function recording(body) {
        const calls = [];
        const http = (url, init) => {
            calls.push({
                url,
                method: init?.method ?? 'GET',
                mfa: init?.headers?.['X-Mfa-Code'] ?? null,
                body: init?.body === undefined ? undefined : JSON.parse(init.body),
            });
            return Promise.resolve({
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => body,
                text: async () => JSON.stringify(body),
            });
        };
        return { http, calls, ops: bindResource(subscribersResource, http, CTX) };
    }
    const CORRECTED = { subscriber: STANDING, vatIdCheck: null };

    test('a correction is declared one of the same legal entity, and carries the second factor', async () => {
        const { calls, ops } = recording(CORRECTED);

        const answer = await ops.correctIdentity(
            'a b',
            { vatId: null, reason: 'Withdrawn' },
            '123456',
        );

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/subscribers/a%20b/identity',
                method: 'POST',
                mfa: '123456',
                body: { kind: 'correction', vatId: null, reason: 'Withdrawn' },
            },
        ]);
        assert.deepEqual(answer, CORRECTED);
    });

    test('a change of business status carries the second factor', async () => {
        const { calls, ops } = recording(CORRECTED);

        await ops.changeBusinessStatus('s-wien', { business: true, reason: 'Why' }, '654321');

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/subscribers/s-wien/business-status',
                method: 'POST',
                mfa: '654321',
                body: { business: true, reason: 'Why' },
            },
        ]);
    });

    test('a check sends nothing but the request, and no second factor', async () => {
        const { calls, ops } = recording(CORRECTED);

        await ops.checkVatId('s-wien');

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/subscribers/s-wien/vat-id-check',
                method: 'POST',
                mfa: null,
                body: undefined,
            },
        ]);
    });

    test('the history is read as its entries', async () => {
        const entries = [{ kind: 'vat-id-checked', at: '2026-10-06T08:00:00.000Z' }];
        const { calls, ops } = recording({ entries });

        assert.deepEqual(await ops.history('s-wien'), entries);
        assert.deepEqual(calls[0].url, '/api/v1/admin/subscribers/s-wien/history');
    });
});

/** Every request as it was sent, answered with `body`. */
function answeringWith(body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        return Promise.resolve({
            status: body === undefined ? 204 : 200,
            headers: { get: () => (body === undefined ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === undefined ? '' : JSON.stringify(body)),
        });
    };
    return { calls, ops: bindResource(subscribersResource, http, CTX) };
}

// @requirement SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not
describe('subscribersResource.list', () => {
    const PAGE = { subscribers: [], next: null };

    for (const [what, request, url] of [
        ['every subscriber, asking nothing', undefined, '/api/v1/admin/subscribers'],
        ['a blank search as no search', { query: '   ' }, '/api/v1/admin/subscribers'],
        [
            'what the operator typed, trimmed and escaped',
            { query: '  Müller & Söhne ' },
            '/api/v1/admin/subscribers?q=M%C3%BCller+%26+S%C3%B6hne',
        ],
        [
            'only those without a live tenant',
            { withoutLiveTenant: true },
            '/api/v1/admin/subscribers?withoutLiveTenant=true',
        ],
        ['the page after a subscriber', { after: 's/9' }, '/api/v1/admin/subscribers?after=s%2F9'],
    ]) {
        test(`asks for ${what}`, async () => {
            const { calls, ops } = answeringWith(PAGE);

            assert.deepEqual(await ops.list(request), PAGE);
            assert.deepEqual(calls, [{ url, method: 'GET' }]);
        });
    }

    test('an answer with no body is an error, not a list with nobody on it', async () => {
        const { ops } = answeringWith(undefined);

        await assert.rejects(() => ops.list(), /no body/);
    });
});

// @requirement SC-ADM-021 — An operator finds everything about a subscriber in one record
describe('subscribersResource.record', () => {
    test("asks for the subscriber's record by its id, escaped", async () => {
        const record = { ...STANDING, tenants: [] };
        const { calls, ops } = answeringWith(record);

        assert.deepEqual(await ops.record('a b'), record);
        assert.deepEqual(calls, [{ url: '/api/v1/admin/subscribers/a%20b', method: 'GET' }]);
    });

    test('an answer with no body is an error', async () => {
        const { ops } = answeringWith(undefined);

        await assert.rejects(() => ops.record('s-1'), /no body/);
    });
});

// @requirement SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another
describe('subscribersResource.contract', () => {
    test("asks for one of the subscriber's contracts by both ids, each escaped", async () => {
        const dossier = { contract: { id: 'c/1' }, lines: [], invoices: [], integrity: 'intact' };
        const { calls, ops } = answeringWith(dossier);

        assert.deepEqual(await ops.contract('a b', 'c/1'), dossier);
        assert.deepEqual(calls, [
            { url: '/api/v1/admin/subscribers/a%20b/contracts/c%2F1', method: 'GET' },
        ]);
    });

    test('an answer with no body is an error', async () => {
        const { ops } = answeringWith(undefined);

        await assert.rejects(() => ops.contract('s-1', 'c-1'), /no body/);
    });
});
