// The settings descriptor — the two requests it issues.
//
// Pinned the way `app-served-resources.test.js` pins its descriptors, and for
// the same reason: there is no second implementation of this contract to
// compare against — no composable predates the descriptor — so the request
// itself is what is measured. The paths are the ones `@saasicat/nest` serves
// (`GET /admin/settings`, `POST /admin/settings/changes/{id}/acknowledge`), and
// `tests/openapi-covers-the-implementation.test.js` holds those to the contract
// from the other side.

// @requirement SC-CFG-008 — An operator can see when the running configuration was applied, and from where
// @requirement SC-UI-003 — Replacing one operation that does not exist is refused at start-up

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bindResource, settingsResource } from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function recordingHttp(body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        return Promise.resolve({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

const VIEW = {
    source: '/srv/app/config/saas.yaml',
    fingerprint: 'sha256-a',
    settings: { currency: 'EUR' },
    recorded: true,
    appliedAt: '2026-09-01T06:30:00.000Z',
    changes: [],
};

describe('settingsResource', () => {
    test('read asks for the settings', async () => {
        const { http, calls } = recordingHttp(VIEW);
        const view = await bindResource(settingsResource, http, CTX).read();
        assert.deepEqual(calls, [
            { url: '/api/v1/admin/settings', method: 'GET', body: undefined },
        ]);
        assert.deepEqual(view, VIEW);
    });

    test('acknowledgeChange posts to the change, with its id escaped', async () => {
        const change = { id: 'c/1', acknowledgedAt: '2026-09-02T00:00:00.000Z' };
        const { http, calls } = recordingHttp(change);
        const view = await bindResource(settingsResource, http, CTX).acknowledgeChange('c/1');
        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/settings/changes/c%2F1/acknowledge',
                method: 'POST',
                body: undefined,
            },
        ]);
        assert.deepEqual(view, change);
    });

    test('a read that answers nothing is an error, not a page with no facts', async () => {
        const http = () =>
            Promise.resolve({
                status: 204,
                headers: { get: () => null },
                json: async () => null,
                text: async () => '',
            });
        await assert.rejects(() => bindResource(settingsResource, http, CTX).read(), /no body/);
    });

    test('every operation this descriptor declares has a case above', () => {
        // The completeness half of `resources-match-the-composables`, carried
        // here because this file is where the descriptor is measured.
        assert.deepEqual(Object.keys(settingsResource.ops).sort(), ['acknowledgeChange', 'read']);
    });
});
