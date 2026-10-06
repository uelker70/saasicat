// The descriptor for withdrawing a feature, and the four requests it issues.
//
// Pinned the way `version-retirements-resource.test.js` pins its descriptors:
// no composable predates it, so the request itself is what is measured. The
// paths are the ones `@saasicat/nest` serves under `/admin/feature-withdrawals`,
// and `tests/openapi-covers-the-implementation.test.js` holds those to the
// contract from the other side. Announcing and lifting carry the second factor.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, featureWithdrawalsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };
const BASE = '/api/v1/admin/feature-withdrawals';

function recordingHttp(body, status = 200) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body === undefined ? undefined : JSON.parse(init.body),
            mfa: init?.headers?.['X-Mfa-Code'],
        });
        return Promise.resolve({
            status,
            headers: { get: () => (status === 204 ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === null ? '' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

const bound = (http) => bindResource(featureWithdrawalsResource, http, CTX);

describe('featureWithdrawalsResource', () => {
    test('list asks for every withdrawal', async () => {
        const rows = [{ id: 'fw-1' }];
        const { http, calls } = recordingHttp(rows);
        assert.deepEqual(await bound(http).list(), rows);
        assert.deepEqual(calls, [{ url: BASE, method: 'GET', body: undefined, mfa: undefined }]);
    });

    test('preview names the feature, escaped, and the date only where one is chosen', async () => {
        const preview = { reached: [], skipped: [], targets: [], blockers: [] };
        const { http, calls } = recordingHttp(preview);
        assert.deepEqual(await bound(http).preview('EXPORT&PDF', null), preview);
        await bound(http).preview('EXPORT', '2026-07-01T00:00:00.000Z');
        assert.deepEqual(
            calls.map((call) => call.url),
            [
                `${BASE}/preview?featureKey=EXPORT%26PDF`,
                `${BASE}/preview?featureKey=EXPORT&effectiveFrom=2026-07-01T00%3A00%3A00.000Z`,
            ],
        );
    });

    test('announce posts what the operator decided and was shown, with the second factor', async () => {
        const announcement = {
            featureKey: 'EXPORT',
            reason: 'The export service has been switched off.',
            effectiveFrom: '2026-07-01T00:00:00.000Z',
            reductions: [{ kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 5 }],
            subscriptionIds: ['sub-1'],
        };
        const { http, calls } = recordingHttp({ withdrawal: { id: 'fw-1' }, told: 1, failed: 0 });
        await bound(http).announce(announcement, '123456');
        assert.deepEqual(calls, [{ url: BASE, method: 'POST', body: announcement, mfa: '123456' }]);
    });

    test('lift posts the date only where one is chosen, escaped, with the second factor', async () => {
        const { http, calls } = recordingHttp({ withdrawal: { id: 'fw/1' }, told: 0, failed: 0 });
        await bound(http).lift('fw/1', null, '123456');
        await bound(http).lift('fw-1', '2026-08-01T00:00:00.000Z', '654321');
        assert.deepEqual(calls, [
            { url: `${BASE}/fw%2F1/lift`, method: 'POST', body: {}, mfa: '123456' },
            {
                url: `${BASE}/fw-1/lift`,
                method: 'POST',
                body: { liftedFrom: '2026-08-01T00:00:00.000Z' },
                mfa: '654321',
            },
        ]);
    });

    test('a list that is not one is refused, not handed to the page', async () => {
        const { http } = recordingHttp({ items: [] });
        await assert.rejects(() => bound(http).list(), /not a list/);
    });

    test('a list that answers nothing is empty', async () => {
        const { http } = recordingHttp(null, 204);
        assert.deepEqual(await bound(http).list(), []);
    });

    test('a preview that answers nothing is an error, not an empty dialog', async () => {
        const { http } = recordingHttp(null, 204);
        await assert.rejects(() => bound(http).preview('EXPORT', null), /no body/);
    });

    test('every operation the descriptor declares has a case above', () => {
        assert.deepEqual(Object.keys(featureWithdrawalsResource.ops).sort(), [
            'announce',
            'lift',
            'list',
            'preview',
        ]);
    });
});
