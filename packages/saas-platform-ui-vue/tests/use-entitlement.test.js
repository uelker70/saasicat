import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useEntitlement } from '../dist/index.js';

function buildHttp({ status = 200, body = {}, headers = {} } = {}) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            headers: { get: (n) => headers[n.toLowerCase()] ?? null },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

const SAMPLE = {
    plan: 'STANDARD',
    quotas: { users: 1, vehicles: 15, storageGb: 5 },
    features: ['CASHBOOK', 'INVOICE_BASIC'],
};

const ENDPOINT = '/api/billing/entitlement';

describe('useEntitlement', () => {
    test('autoLoad lädt Snapshot', async () => {
        const { http } = buildHttp({ body: SAMPLE });
        const ent = useEntitlement({ http, endpoint: ENDPOINT });
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(ent.entitlement.value.plan, 'STANDARD');
        assert.equal(ent.entitlement.value.quotas.vehicles, 15);
    });

    test('hasFeature(key) gibt boolean', async () => {
        const { http } = buildHttp({ body: SAMPLE });
        const ent = useEntitlement({ http, endpoint: ENDPOINT, autoLoad: false });
        await ent.load();
        assert.equal(ent.hasFeature('CASHBOOK'), true);
        assert.equal(ent.hasFeature('SSO'), false);
    });

    test('hasFeature ohne geladenes Entitlement → false', () => {
        const { http } = buildHttp({ body: SAMPLE });
        const ent = useEntitlement({ http, endpoint: ENDPOINT, autoLoad: false });
        assert.equal(ent.hasFeature('CASHBOOK'), false);
    });

    test('Auth-Token wird mitgesendet', async () => {
        const { http, calls } = buildHttp({ body: SAMPLE });
        const ent = useEntitlement({
            http,
            endpoint: ENDPOINT,
            autoLoad: false,
            getAuthToken: () => 'jwt-x',
        });
        await ent.load();
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-x');
    });

    test('500 → error gesetzt, entitlement null', async () => {
        const { http } = buildHttp({ status: 500 });
        const ent = useEntitlement({ http, endpoint: ENDPOINT, autoLoad: false });
        await ent.load();
        assert.equal(ent.entitlement.value, null);
        assert.notEqual(ent.error.value, null);
    });

    test('endpoint=Pflicht: ohne Endpoint wirft useEntitlement', () => {
        const { http } = buildHttp({ body: SAMPLE });
        assert.throws(() => useEntitlement({ http }), /endpoint.*Pflicht/);
    });
});
