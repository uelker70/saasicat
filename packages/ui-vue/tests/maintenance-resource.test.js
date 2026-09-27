// The maintenance descriptor — the six requests it issues.
//
// Pinned the way `settings-resource.test.js` pins its descriptor: no composable
// predates it, so the request itself is what is measured. The paths are the
// ones `@saasicat/nest` serves under `/admin/maintenance`, and
// `tests/openapi-covers-the-implementation.test.js` holds those to the contract
// from the other side. Locking and unlocking carry the second factor.

// @requirement SC-ADM-029 — Locking tenants out and letting them back in needs the second factor in the administration
// @requirement SC-UI-003 — Replacing one operation that does not exist is refused at start-up

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, maintenanceResource } from '../dist/index.js';

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

const WINDOW = { id: 'w/1', status: 'announced' };
const bound = (http) => bindResource(maintenanceResource, http, CTX);

describe('maintenanceResource', () => {
    test('overview asks for the windows', async () => {
        const overview = { open: null, recent: [], takesEffectWithinSeconds: 5 };
        const { http, calls } = recordingHttp(overview);
        assert.deepEqual(await bound(http).overview(), overview);
        assert.deepEqual(calls, [
            { url: '/api/v1/admin/maintenance', method: 'GET', body: undefined, mfa: undefined },
        ]);
    });

    test('announce posts the times and the message, and no second factor', async () => {
        const { http, calls } = recordingHttp(WINDOW);
        const input = {
            startsAt: '2026-10-02T20:00:00.000Z',
            endsAt: '2026-10-02T21:00:00.000Z',
            message: 'Upgrade',
        };
        await bound(http).announce(input);
        assert.deepEqual(calls, [
            { url: '/api/v1/admin/maintenance', method: 'POST', body: input, mfa: undefined },
        ]);
    });

    test('reschedule patches the window, with its id escaped', async () => {
        const { http, calls } = recordingHttp(WINDOW);
        await bound(http).reschedule('w/1', { message: null });
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/maintenance/w%2F1',
                method: 'PATCH',
                body: { message: null },
                mfa: undefined,
            },
        ]);
    });

    test('cancel posts to the window', async () => {
        const { http, calls } = recordingHttp(WINDOW);
        await bound(http).cancel('w/1');
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/maintenance/w%2F1/cancel',
                method: 'POST',
                body: undefined,
                mfa: undefined,
            },
        ]);
    });

    test('lock and unlock carry the second factor', async () => {
        const { http, calls } = recordingHttp({ window: WINDOW, alreadyLocked: false });
        await bound(http).lock({ windowId: 'w/1' }, '123456');
        await bound(http).unlock({ windowId: 'w/1' }, '654321');
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/maintenance/lock',
                method: 'POST',
                body: { windowId: 'w/1' },
                mfa: '123456',
            },
            {
                url: '/api/v1/admin/maintenance/unlock',
                method: 'POST',
                body: { windowId: 'w/1' },
                mfa: '654321',
            },
        ]);
    });

    test('an overview that answers nothing is an error, not an empty page', async () => {
        const http = () =>
            Promise.resolve({
                status: 204,
                headers: { get: () => null },
                json: async () => null,
                text: async () => '',
            });
        await assert.rejects(() => bound(http).overview(), /no body/);
    });

    // @requirement SC-UI-020 — A page never takes the whole screen down because data arrived in an unexpected shape
    test('an overview that is not one is refused at the boundary, not handed to the page', async () => {
        for (const body of [
            [],
            {},
            { open: null, recent: 'x', takesEffectWithinSeconds: 5 },
            { open: 'x', recent: [], takesEffectWithinSeconds: 5 },
            { open: null, recent: [], takesEffectWithinSeconds: '5' },
        ]) {
            const { http } = recordingHttp(body);
            await assert.rejects(
                () => bound(http).overview(),
                /not an overview/,
                JSON.stringify(body),
            );
        }
    });

    test('every operation this descriptor declares has a case above', () => {
        assert.deepEqual(Object.keys(maintenanceResource.ops).sort(), [
            'announce',
            'cancel',
            'lock',
            'overview',
            'reschedule',
            'unlock',
        ]);
    });
});
