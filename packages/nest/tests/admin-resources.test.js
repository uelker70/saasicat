// @requirement SC-ADM-015 — The administration only offers what the application actually has

// The administration's tenant routes: the application's rows with the
// platform's state beside each, and a suspension that is the platform's own
// record (`SC-ADM-052`). The application's port is a fake that answers reads
// and has nothing to write: suspending or reactivating writes neither its
// tenant row nor a subscription.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Reflector } from '@nestjs/core';
import { AdminResourcesService } from '../dist/admin/index.js';
import { TenantAccessService } from '../dist/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';

const SINCE = new Date('2026-11-02T08:30:00.000Z');

const ACME = { id: 'tenant-1', slug: 'acme', name: 'Acme', isActive: true };
const BETA = { id: 'tenant-2', slug: 'beta', name: 'Beta', isActive: true };
const ASLEEP = { id: 'tenant-3', slug: 'asleep', name: 'Asleep', isActive: false };

/**
 * The application's side, read only: three tenants, newest first, filtered the
 * way the shipped adapter filters in its query, and cut to `limit` rows after
 * filtering, as the adapter's `take` does.
 */
function applicationResources({ limit = 200, ignoresFilters = false } = {}) {
    const listed = [];
    const rows = [ACME, BETA, ASLEEP].map((tenant, at) => ({
        ...tenant,
        deletedAt: null,
        plan: 'PRO',
        status: 'ACTIVE',
        createdAt: `2026-01-0${3 - at}T00:00:00.000Z`,
    }));
    return {
        listed,
        async listTenants(filter) {
            listed.push(filter);
            return rows
                .filter((row) => ignoresFilters || mayActAs(filter, row))
                .slice(0, limit)
                .map((row) => ({ ...row }));
        },
        async getTenantDetail(slug) {
            const row = rows.find((candidate) => candidate.slug === slug);
            return row ? { ...row, subscription: null, users: [] } : null;
        },
        async findTenantsByIds() {
            return [];
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
}

/** The may-act filter as the shipped adapter applies it in its query. */
function mayActAs(filter, row) {
    if (filter.mayAct === undefined) return true;
    const heldBack = (filter.heldBackTenantIds ?? []).includes(row.id);
    return filter.mayAct ? row.isActive && !heldBack : !row.isActive || heldBack;
}

function platform(options) {
    const holds = new FakeTenantAccessHoldRepository();
    const audits = [];
    const resources = applicationResources(options);
    const access = new TenantAccessService(holds, new Reflector());
    const service = new AdminResourcesService(
        resources,
        {
            async log(entry) {
                audits.push(entry);
            },
        },
        access,
    );
    return { service, holds, audits, resources, access };
}

const ACTOR = {
    userId: 'admin-1',
    email: 'admin@example.com',
    source: 'web',
    context: 'session-1',
};

const openOf = (holds, tenantId) =>
    holds.holds.filter((hold) => hold.tenantId === tenantId && !hold.liftedAt);

// @requirement SC-ADM-052 — A suspended tenant cannot act, and a read-only one writes nothing but a payment
describe("a suspension is the platform's record", () => {
    test('suspending records the reason with its note and who, audits it, and answers the state', async () => {
        const { service, holds, audits } = platform();

        const result = await service.suspendTenant('acme', 'Contract under review', ACTOR);

        assert.deepEqual(result, { ok: true, id: 'tenant-1', slug: 'acme', access: 'suspended' });
        const [suspension] = openOf(holds, 'tenant-1');
        assert.equal(suspension.kind, 'suspended');
        assert.equal(suspension.note, 'Contract under review');
        assert.equal(suspension.recordedBy, 'web:admin@example.com:session-1');
        assert.deepEqual(audits, [
            {
                actor: ACTOR,
                entity: 'Tenant',
                entityId: 'tenant-1',
                action: 'TENANT_SUSPEND',
                changes: { slug: 'acme', reason: 'Contract under review' },
            },
        ]);
    });

    test('a second suspension is refused, and the first keeps its note', async () => {
        const { service, holds, audits } = platform();
        await service.suspendTenant('acme', 'first', ACTOR);
        await assert.rejects(
            service.suspendTenant('acme', 'second', ACTOR),
            (error) =>
                error.getStatus() === 409 &&
                error.getResponse().code === 'TENANT_ALREADY_SUSPENDED',
        );
        assert.deepEqual(
            openOf(holds, 'tenant-1').map((hold) => hold.note),
            ['first'],
        );
        assert.equal(audits.length, 1, 'a refused suspension is not audited');
    });

    test('reactivating lifts the suspension and leaves an overdue invoice holding', async () => {
        const { service, holds, audits } = platform();
        await service.suspendTenant('acme', 'review', ACTOR);
        await holds.record({
            tenantId: 'tenant-1',
            kind: 'overdue',
            reference: 'invoice-1',
            note: null,
            since: SINCE,
            recordedBy: 'run:collection',
        });

        const result = await service.reactivateTenant('acme', ACTOR);

        assert.deepEqual(result, { ok: true, id: 'tenant-1', slug: 'acme', access: 'read-only' });
        assert.deepEqual(
            openOf(holds, 'tenant-1').map((hold) => hold.kind),
            ['overdue'],
        );
        assert.equal(audits.at(-1).action, 'TENANT_REACTIVATE');
    });

    test('reactivating a tenant that is not suspended is refused', async () => {
        const { service, audits } = platform();
        await assert.rejects(
            service.reactivateTenant('acme', ACTOR),
            (error) =>
                error.getStatus() === 409 && error.getResponse().code === 'TENANT_NOT_SUSPENDED',
        );
        assert.deepEqual(audits, []);
    });

    test('an unknown tenant is refused by name', async () => {
        const { service } = platform();
        await assert.rejects(
            service.suspendTenant('nobody', 'x', ACTOR),
            (error) => error.getStatus() === 404 && error.getResponse().code === 'TENANT_NOT_FOUND',
        );
    });
});

// @requirement SC-ADM-052 — A suspended tenant cannot act, and a read-only one writes nothing but a payment
describe("the administration reads each tenant with the platform's state", () => {
    test('every row carries its state, and a suspended tenant is not active', async () => {
        const { service } = platform();
        await service.suspendTenant('acme', 'review', ACTOR);

        const rows = await service.listTenants({});

        assert.deepEqual(
            rows.map((row) => [row.slug, row.access, row.isActive]),
            [
                ['acme', 'suspended', false],
                ['beta', 'open', true],
                ['asleep', 'open', false],
            ],
        );
    });

    test('the active and suspended filters are answered here, from the state', async () => {
        const { service, resources } = platform();
        await service.suspendTenant('acme', 'review', ACTOR);

        const active = await service.listTenants({ status: 'ACTIVE', search: 'a' });
        const suspended = await service.listTenants({ status: 'INACTIVE' });

        assert.deepEqual(
            active.map((row) => row.slug),
            ['beta'],
        );
        assert.deepEqual(
            suspended.map((row) => row.slug),
            ['acme', 'asleep'],
        );
        assert.deepEqual(
            resources.listed,
            [
                { search: 'a', mayAct: true, heldBackTenantIds: ['tenant-1'] },
                { mayAct: false, heldBackTenantIds: ['tenant-1'] },
            ],
            'the status is answered as one filter the application applies before its limit',
        );
    });

    test('a suspended tenant past the first page is still found, and an active one is not lost', async () => {
        const { service } = platform({ limit: 1 });
        // The newest tenant is suspended; the application cuts every list to
        // one row. Filtering after the cut would find nothing in either case.
        await service.suspendTenant('acme', 'review', ACTOR);
        assert.deepEqual(
            (await service.listTenants({ status: 'ACTIVE' })).map((row) => row.slug),
            ['beta'],
        );
        const { service: older } = platform({ limit: 1 });
        await older.suspendTenant('beta', 'review', ACTOR);
        assert.deepEqual(
            (await older.listTenants({ status: 'SUSPENDED' })).map((row) => row.slug),
            ['beta'],
        );
    });

    test('suspended or deactivated is one list, cut once, newest first', async () => {
        // Two lists cut on their own and merged would answer the newest
        // suspended tenant beside an older deactivated one, while a newer
        // deactivated tenant past the first list's cut went missing.
        const { service, resources } = platform({ limit: 1 });
        await service.suspendTenant('acme', 'review', ACTOR);
        assert.deepEqual(
            (await service.listTenants({ status: 'INACTIVE' })).map((row) => row.slug),
            ['acme'],
        );
        assert.equal(resources.listed.length, 1, 'one query');
    });

    test('a port that ignores the filter still lists no suspended tenant as active', async () => {
        const { service } = platform({ ignoresFilters: true });
        await service.suspendTenant('acme', 'review', ACTOR);
        assert.deepEqual(
            (await service.listTenants({ status: 'ACTIVE' })).map((row) => row.slug),
            ['beta'],
        );
        assert.deepEqual(
            (await service.listTenants({ status: 'INACTIVE' })).map((row) => row.slug),
            ['acme', 'asleep'],
        );
    });

    test('a status the platform does not answer goes to the application as it was', async () => {
        const { service, resources } = platform();
        await service.listTenants({ status: 'deleted' });
        assert.deepEqual(resources.listed, [{ status: 'deleted' }]);
    });

    test("the platform's own filters cannot be set by the caller", async () => {
        const { service, resources } = platform();
        await service.listTenants({
            search: 'a',
            isActive: 'false',
            tenantIds: 'tenant-1',
            excludeTenantIds: ['tenant-2'],
        });
        assert.deepEqual(resources.listed, [{ search: 'a' }]);
    });

    test('the detail carries the state too', async () => {
        const { service } = platform();
        await service.suspendTenant('acme', 'review', ACTOR);
        const detail = await service.getTenantDetail('acme');
        assert.equal(detail.access, 'suspended');
        assert.equal(detail.isActive, false);
    });
});

// @requirement SC-ADM-053 — The operator sees every reason a tenant is held back for
describe('the detail names every reason a tenant is held back for', () => {
    const OVERDUE_SINCE = new Date('2026-02-15T23:00:00.000Z');

    /** `tenant-1` suspended with a note, and held back by an invoice unpaid on its due date before that. */
    async function heldBackTwice({ invoicesNamed = true } = {}) {
        const { service, holds, access } = platform();
        if (invoicesNamed) {
            access.nameInvoicesFrom({
                invoicesNamed: async (ids) =>
                    ids
                        .filter((id) => id === 'invoice-7')
                        .map((id) => ({ id, number: 'AHP-2026-000007', subscriberId: 'sub-1' })),
            });
        }
        await holds.record({
            tenantId: ACME.id,
            kind: 'overdue',
            reference: 'invoice-7',
            note: null,
            since: OVERDUE_SINCE,
            recordedBy: 'job:platform:overdue-invoices',
        });
        await service.suspendTenant('acme', 'chargeback under review', ACTOR);
        return { service, holds };
    }

    test('the oldest first, a suspension with its note and an invoice by its number and subscriber', async () => {
        const { service, holds } = await heldBackTwice();

        const detail = await service.getTenantDetail('acme');

        assert.equal(detail.access, 'suspended');
        assert.deepEqual(
            detail.accessReasons.map((reason) => [
                reason.kind,
                reason.note,
                reason.invoice,
                reason.subscriptionId,
            ]),
            [
                [
                    'overdue',
                    null,
                    { id: 'invoice-7', number: 'AHP-2026-000007', subscriberId: 'sub-1' },
                    null,
                ],
                ['suspended', 'chargeback under review', null, null],
            ],
        );
        assert.equal(detail.accessReasons[0].since, OVERDUE_SINCE.toISOString());
        assert.deepEqual(
            detail.accessReasons.map((reason) => reason.id),
            ['overdue', 'suspended'].map(
                (kind) => openOf(holds, ACME.id).find((hold) => hold.kind === kind).id,
            ),
            'each reason by the id of its own record',
        );
    });

    test('an invoice where invoices cannot be read is named as none, and the reason stays', async () => {
        const { service } = await heldBackTwice({ invoicesNamed: false });

        const detail = await service.getTenantDetail('acme');

        assert.deepEqual(
            detail.accessReasons.map((reason) => [reason.kind, reason.invoice]),
            [
                ['overdue', null],
                ['suspended', null],
            ],
        );
    });

    test('none for a tenant held back by nothing', async () => {
        const { service } = platform();

        const detail = await service.getTenantDetail('acme');

        assert.deepEqual(detail.accessReasons, []);
    });
});
