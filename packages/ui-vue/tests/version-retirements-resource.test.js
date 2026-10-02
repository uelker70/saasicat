// The descriptor for retiring a version — the three requests it issues.
//
// Pinned the way `maintenance-resource.test.js` pins its descriptor: no
// composable predates it, so the request itself is what is measured. The paths
// are the ones `@saasicat/nest` serves under `/admin/catalog`, and
// `tests/openapi-covers-the-implementation.test.js` holds those to the contract
// from the other side. Announcing carries the second factor.

// @requirement SC-UI-003 — Replacing one operation that does not exist is refused at start-up

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, versionRetirementsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function recordingHttp(body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body === undefined ? undefined : JSON.parse(init.body),
            mfa: init?.headers?.['X-Mfa-Code'],
        });
        return Promise.resolve({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

const bound = (http) => bindResource(versionRetirementsResource, http, CTX);

describe('versionRetirementsResource', () => {
    test('list asks for every announcement', async () => {
        const records = [{ id: 'r-1' }];
        const { http, calls } = recordingHttp(records);
        assert.deepEqual(await bound(http).list(), records);
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/catalog/version-retirements',
                method: 'GET',
                body: undefined,
                mfa: undefined,
            },
        ]);
    });

    test('preview asks for the version, naming the replacement, both escaped', async () => {
        const preview = { reached: [], skipped: [], blockers: [] };
        const { http, calls } = recordingHttp(preview);
        assert.deepEqual(await bound(http).preview('v/1', 'v&2'), preview);
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/catalog/plan-versions/v%2F1/retirement?replacement=v%262',
                method: 'GET',
                body: undefined,
                mfa: undefined,
            },
        ]);
    });

    test('announce posts the replacement and the subscriptions shown, with the second factor', async () => {
        const { http, calls } = recordingHttp({ retirement: { id: 'r-1' }, told: 1, failed: 0 });
        const announcement = { replacementPlanVersionId: 'v-2', subscriptionIds: ['s-1'] };
        await bound(http).announce('v-1', announcement, '123456');
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/catalog/plan-versions/v-1/retirement',
                method: 'POST',
                body: announcement,
                mfa: '123456',
            },
        ]);
    });

    test('a preview that answers nothing is an error, not an empty dialog', async () => {
        const http = () =>
            Promise.resolve({
                status: 204,
                headers: { get: () => null },
                json: async () => null,
                text: async () => '',
            });
        await assert.rejects(() => bound(http).preview('v-1', 'v-2'), /no body/);
    });

    test('every operation this descriptor declares has a case above', () => {
        assert.deepEqual(Object.keys(versionRetirementsResource.ops).sort(), [
            'announce',
            'list',
            'preview',
        ]);
    });
});
