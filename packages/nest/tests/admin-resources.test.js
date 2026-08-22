import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminResourcesService } from '../dist/admin/index.js';

test('AdminResourcesService keeps tenant actions and writes their audit entry', async () => {
    const stateChanges = [];
    const audits = [];
    const resources = {
        async listTenants() {
            return [];
        },
        async getTenantDetail() {
            return null;
        },
        async setTenantActive(slug, active, status) {
            stateChanges.push({ slug, active, status });
            return { ok: true, id: 'tenant-1', slug, isActive: active, status };
        },
        async listUsers() {
            return [];
        },
        async listAudit() {
            return [];
        },
        async listSubscriptions() {
            return [];
        },
    };
    const service = new AdminResourcesService(resources, {
        async log(entry) {
            audits.push(entry);
        },
    });
    const actor = {
        userId: 'admin-1',
        email: 'admin@example.com',
        source: 'web',
        context: 'session-1',
    };

    const result = await service.suspendTenant('acme', 'invoice overdue', actor);

    assert.deepEqual(stateChanges, [{ slug: 'acme', active: false, status: 'PAST_DUE' }]);
    assert.deepEqual(result, {
        ok: true,
        id: 'tenant-1',
        slug: 'acme',
        isActive: false,
        status: 'PAST_DUE',
    });
    assert.deepEqual(audits, [
        {
            actor,
            entity: 'Tenant',
            entityId: 'tenant-1',
            action: 'TENANT_SUSPEND',
            changes: { slug: 'acme', reason: 'invoice overdue' },
        },
    ]);
});
