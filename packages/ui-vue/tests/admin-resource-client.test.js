import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminResourceClient } from '../dist/client/index.js';

test('createAdminResourceClient exposes every standard Admin loader and action', async () => {
    const calls = [];
    const http = async (url, init = {}) => {
        calls.push({ url, init });
        return {
            status: 200,
            headers: { get: () => null },
            json: async () => [],
            text: async () => '[]',
        };
    };
    const client = createAdminResourceClient({ http });

    await client.loadTenantDetail('acme west');
    await client.loadUsers({ q: 'owner', tenant: 'acme' });
    await client.loadAudit({ actor: 'admin', action: 'TENANT_SUSPEND', limit: 25 });
    await client.loadSubscriptions();
    await client.loadPromos({ search: 'WELCOME', status: null });
    await client.createPromo({ code: 'WELCOME' });
    await client.updatePromo('promo/1', { status: 'PAUSED' });
    await client.deletePromo('promo/1');
    await client.suspendTenant('acme west', 'invoice overdue');
    await client.reactivateTenant('acme west');

    assert.deepEqual(
        calls.map(({ url, init }) => [init.method, url]),
        [
            ['GET', '/api/v1/admin/tenants/acme%20west'],
            ['GET', '/api/v1/admin/users?q=owner&tenant=acme'],
            ['GET', '/api/v1/admin/audit?actor=admin&action=TENANT_SUSPEND&limit=25'],
            ['GET', '/api/v1/admin/subscriptions'],
            ['GET', '/api/v1/admin/promo-codes?search=WELCOME'],
            ['POST', '/api/v1/admin/promo-codes'],
            ['PATCH', '/api/v1/admin/promo-codes/promo%2F1'],
            ['DELETE', '/api/v1/admin/promo-codes/promo%2F1'],
            ['POST', '/api/v1/admin/tenants/acme%20west/suspend'],
            ['POST', '/api/v1/admin/tenants/acme%20west/reactivate'],
        ],
    );
    assert.equal(calls[5].init.body, JSON.stringify({ code: 'WELCOME' }));
    assert.equal(calls[8].init.body, JSON.stringify({ reason: 'invoice overdue' }));
});

test('createAdminResourceClient reports failed Admin requests', async () => {
    const client = createAdminResourceClient({
        http: async () => ({
            status: 403,
            headers: { get: () => null },
            json: async () => ({}),
            text: async () => '',
        }),
    });

    await assert.rejects(client.loadSubscriptions(), /GET .*subscriptions.*HTTP 403/);
});
