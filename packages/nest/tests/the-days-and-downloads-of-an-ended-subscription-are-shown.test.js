// What is shown of a subscription that ended: to every user of its tenant the
// last day it can still read and the day its data is deleted on, and to the
// operator on the tenant's page that day and every download of the tenant's
// export, each with its moment and who took it (`SC-CANC-033`, `SC-PRIV-019`).
//
// The ends and the downloads are read once per request, whatever the number of
// reasons, and only where an ended subscription is among them; the operator
// reads them past the tenants' policy, as every read of the administration is,
// and a tenant's own users within it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';

import { AdminResourcesService } from '../dist/admin/index.js';
import {
    TenantAccessStateController,
    TenantDataExportService,
    TenantInvoicesController,
} from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';

const ENDED = new Date('2026-11-30T23:00:00.000Z');
const FIRST = new Date('2026-12-02T08:00:00.000Z');
const SECOND = new Date('2026-12-09T08:00:00.000Z');
const ACME = { id: 't1', slug: 'acme', name: 'Acme', isActive: true };

/** Counts every read of the ends and of the downloads. */
function countedEnds() {
    const ends = new FakeSubscriptionEndRepository();
    const reads = { ends: 0, downloads: 0 };
    const listFor = ends.listFor.bind(ends);
    const listExportDownloadsFor = ends.listExportDownloadsFor.bind(ends);
    ends.listFor = async (ids) => {
        reads.ends += 1;
        return listFor(ids);
    };
    ends.listExportDownloadsFor = async (ids) => {
        reads.downloads += 1;
        return listExportDownloadsFor(ids);
    };
    return { ends, reads };
}

/**
 * `t1` held back for `kinds`, its subscription's end recorded where
 * `endRecorded`, and the export wired over the counted store.
 */
async function installation({ kinds = ['ended'], endRecorded = true } = {}) {
    const holds = new FakeTenantAccessHoldRepository();
    for (const kind of kinds) {
        await holds.record({
            tenantId: ACME.id,
            kind,
            reference: kind === 'ended' ? 'sub-t1' : kind === 'overdue' ? 'inv-1' : null,
            note: kind === 'suspended' ? 'chargeback under review' : null,
            since: ENDED,
            recordedBy: 'job:platform:subscription-ends',
        });
    }
    const { ends, reads } = countedEnds();
    if (endRecorded) {
        await ends.record({
            tenantId: ACME.id,
            subscriptionId: 'sub-t1',
            endsAt: ENDED,
            deletesOn: '2026-12-31',
            recordedAt: ENDED,
            recordedBy: 'job:platform:subscription-ends',
        });
    }
    const lifted = { count: 0 };
    const bypass = {
        runWithBypass: async (work) => {
            lifted.count += 1;
            return work();
        },
    };
    const access = new TenantAccessService(holds, new Reflector());
    const exports = new TenantDataExportService(
        ends,
        { export: async () => ({ content: new Uint8Array(1), mediaType: 'x/y', fileName: 'f' }) },
        access,
        bypass,
        null,
    );
    exports.onModuleInit();
    const admin = new AdminResourcesService(
        {
            getTenantDetail: async (slug) =>
                slug === ACME.slug ? { ...ACME, subscription: null, users: [] } : null,
        },
        { log: async () => {} },
        access,
    );
    return { ends, reads, lifted, access, admin };
}

/** A download of `tenantId`'s export for `subscriptionId` at `at`. */
const downloaded = (ends, at, tenantId = ACME.id, subscriptionId = 'sub-t1') =>
    ends.recordExportDownload({
        tenantId,
        subscriptionId,
        downloadedAt: at,
        downloadedBy: `web:admin@${tenantId}.example:s-1`,
    });

const asUser = (role) => ({
    method: 'GET',
    user: { tenantId: ACME.id, sub: 'u-1', role },
    headers: {},
});

// @requirement SC-CANC-033 — An ended subscription's deletion day is shown to the tenant and to the operator
describe('every user of the tenant reads the days its ended subscription leaves', () => {
    test('a user without any role reads the last readable day and the deletion day', async () => {
        const { access } = await installation();

        const view = await new TenantAccessStateController(null, null, access).state(
            asUser('USER'),
        );

        assert.deepEqual(
            view.reasons.map(({ kind, readOnlyUntil, deletesOn }) => [
                kind,
                readOnlyUntil,
                deletesOn,
            ]),
            [['ended', '2026-12-30', '2026-12-31']],
        );
        assert.equal(view.mayExport, false);
    });

    test('a user holding the billing permission reads them too, and the administrator is offered the export', async () => {
        const { access } = await installation();

        const view = await new TenantInvoicesController(null, null, null, null, access).accessState(
            asUser('TENANT_ADMIN'),
        );

        assert.equal(view.reasons[0].deletesOn, '2026-12-31');
        assert.equal(view.mayExport, true);
    });

    test('the ends are read once, whatever the number of reasons', async () => {
        const { access, reads } = await installation({ kinds: ['ended', 'overdue', 'suspended'] });

        await access.viewOf(ACME.id, {
            timeZone: 'UTC',
            holdsBillingPermission: false,
            mayPay: false,
            isTenantAdministrator: false,
        });

        assert.equal(reads.ends, 1);
    });

    test('and not at all where no subscription ended', async () => {
        const { access, reads } = await installation({ kinds: ['overdue'], endRecorded: false });

        await access.viewOf(ACME.id, {
            timeZone: 'UTC',
            holdsBillingPermission: true,
            mayPay: false,
            isTenantAdministrator: true,
        });

        assert.equal(reads.ends, 0);
    });

    test("a tenant's own users read the ends within its own scope", async () => {
        const { access, lifted } = await installation();

        await access.viewOf(ACME.id, {
            timeZone: 'UTC',
            holdsBillingPermission: false,
            mayPay: false,
            isTenantAdministrator: true,
        });

        assert.equal(lifted.count, 0);
    });
});

// @requirement SC-CANC-033 — An ended subscription's deletion day is shown to the tenant and to the operator
// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe("the operator's page names the day and every download of the export", () => {
    test('the deletion day, and every download with its moment and who took it, the oldest first', async () => {
        const { admin, ends } = await installation();
        await downloaded(ends, SECOND);
        await downloaded(ends, FIRST);

        const [reason] = (await admin.getTenantDetail('acme')).accessReasons;

        assert.equal(reason.kind, 'ended');
        assert.equal(reason.deletesOn, '2026-12-31');
        assert.deepEqual(reason.exportDownloads, [
            { at: FIRST.toISOString(), by: 'web:admin@t1.example:s-1' },
            { at: SECOND.toISOString(), by: 'web:admin@t1.example:s-1' },
        ]);
    });

    test('none taken yet is an empty list, not an absent one', async () => {
        const { admin } = await installation();

        const [reason] = (await admin.getTenantDetail('acme')).accessReasons;

        assert.deepEqual(reason.exportDownloads, []);
    });

    test('every other reason carries neither a day nor downloads', async () => {
        const { admin } = await installation({ kinds: ['ended', 'overdue', 'suspended'] });

        const reasons = (await admin.getTenantDetail('acme')).accessReasons;

        assert.deepEqual(
            reasons.map(({ kind, deletesOn, exportDownloads }) => [
                kind,
                deletesOn,
                exportDownloads,
            ]),
            [
                ['ended', '2026-12-31', []],
                ['overdue', null, null],
                ['suspended', null, null],
            ],
        );
    });

    test('an ended subscription whose end is not recorded yet carries no day and no downloads', async () => {
        const { admin } = await installation({ endRecorded: false });

        const [reason] = (await admin.getTenantDetail('acme')).accessReasons;

        assert.deepEqual([reason.deletesOn, reason.exportDownloads], [null, []]);
    });

    test("another tenant's downloads under the same subscription are not listed", async () => {
        const { admin, ends } = await installation();
        await downloaded(ends, FIRST, 't2', 'sub-t1');

        const [reason] = (await admin.getTenantDetail('acme')).accessReasons;

        assert.deepEqual(reason.exportDownloads, []);
    });

    test('the ends and the downloads are read once each, past the tenants’ policy', async () => {
        const { admin, reads, lifted } = await installation({
            kinds: ['ended', 'overdue', 'suspended'],
        });

        await admin.getTenantDetail('acme');

        assert.deepEqual(reads, { ends: 1, downloads: 1 });
        assert.equal(lifted.count, 1);
    });

    test('and not at all where no subscription ended', async () => {
        const { admin, reads, lifted } = await installation({
            kinds: ['overdue'],
            endRecorded: false,
        });

        await admin.getTenantDetail('acme');

        assert.deepEqual(reads, { ends: 0, downloads: 0 });
        assert.equal(lifted.count, 0);
    });

    test('where nothing answers for the ends, the reason stays without a day', async () => {
        const holds = new FakeTenantAccessHoldRepository();
        await holds.record({
            tenantId: ACME.id,
            kind: 'ended',
            reference: 'sub-t1',
            note: null,
            since: ENDED,
            recordedBy: 'job:platform:subscription-ends',
        });
        const admin = new AdminResourcesService(
            { getTenantDetail: async () => ({ ...ACME, subscription: null, users: [] }) },
            { log: async () => {} },
            new TenantAccessService(holds, new Reflector()),
        );

        const [reason] = (await admin.getTenantDetail('acme')).accessReasons;

        assert.deepEqual(
            [reason.kind, reason.deletesOn, reason.exportDownloads],
            ['ended', null, []],
        );
    });
});
