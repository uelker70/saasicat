// The subscriber's record shows the deletion of each of its tenants — also of
// a tenant the application no longer has — and what is recorded of a begun
// one: since when the export was offered, whether a suspension kept it, what
// the tenant was told to keep, what each store counted and confirmed, the
// commercial record before and after, the reminders and the downloads, with
// roles and numbers in words.
//
// Mounted through a router against a stubbed registry, as an app mounts it.
// The days are written for the catalog's English, `en-US`.

import type {
    AdminSubscriberRecord,
    AdminTenantDeletion,
    AdminTenantDeletionRecord,
} from '@saasicat/core';
import type { DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, test } from 'vitest';

import { AdminError } from '../../src/client/admin-error.js';
import { RECORD, mountRecord } from './support/subscriber-record.js';

const SERVING = { 'deletions.read': true };

const COUNTS = { subscriber: 1, contracts: 2, charges: 5, invoices: 3, payments: 3, credits: 0 };

/** The record of a deletion that closed: every store counted and confirmed. */
const CLOSED: AdminTenantDeletionRecord = {
    exportOfferedFrom: '2026-10-31T23:00:00.000Z',
    exportBlockedBySuspension: false,
    announcedOn: '2026-10-31',
    keep: [
        { category: 'receipts', count: 412, labels: { en: 'Receipts', de: 'Belege' } },
        { category: 'sales-contracts', count: 37, labels: { en: 'Sales contracts' } },
    ],
    stores: [
        {
            store: 'files',
            position: 0,
            countedAt: '2026-11-30T23:15:00.000Z',
            counts: [{ category: 'files', count: 1204 }],
            erasedAt: '2026-11-30T23:38:00.000Z',
        },
        {
            store: 'notes-data',
            position: 1,
            countedAt: '2026-11-30T23:15:00.000Z',
            counts: [
                { category: 'notes', count: 3812 },
                { category: 'users', count: 7 },
            ],
            erasedAt: '2026-11-30T23:41:00.000Z',
        },
    ],
    commercialBefore: COUNTS,
    commercialAfter: COUNTS,
    startedAt: '2026-11-30T23:15:00.000Z',
    closedAt: '2026-11-30T23:41:00.000Z',
    attempts: 0,
    lastFailure: null,
    reminders: [
        {
            daysBefore: 30,
            createdAt: '2026-10-31T23:05:00.000Z',
            deliveredAt: '2026-10-31T23:06:00.000Z',
            recipientCount: 2,
            channel: 'email',
        },
        {
            daysBefore: 7,
            createdAt: '2026-11-23T23:05:00.000Z',
            deliveredAt: '2026-11-23T23:06:00.000Z',
            recipientCount: 0,
            channel: 'email',
        },
        {
            daysBefore: 1,
            createdAt: '2026-11-29T23:05:00.000Z',
            deliveredAt: null,
            recipientCount: null,
            channel: null,
        },
    ],
    downloads: [{ at: '2026-11-03T10:00:00.000Z', size: 48_000_000, by: 'tenant-admin' }],
};

const DELETED: AdminTenantDeletion = {
    tenantId: 't-gone',
    status: { kind: 'deleted', deletesOn: '2026-12-01', closedAt: '2026-11-30T23:41:00.000Z' },
    record: CLOSED,
};

/** A deletion just begun: nothing counted, nobody told, nothing taken. */
const BEGUN: AdminTenantDeletion = {
    tenantId: 't-1',
    status: {
        kind: 'running',
        deletesOn: '2026-12-01',
        startedAt: '2026-11-30T23:15:00.000Z',
        storesErased: 0,
        storesTotal: 1,
        lastFailure: null,
    },
    record: {
        ...CLOSED,
        exportBlockedBySuspension: true,
        announcedOn: null,
        keep: [],
        stores: [{ store: 'files', position: 0, countedAt: null, counts: [], erasedAt: null }],
        commercialBefore: null,
        commercialAfter: null,
        closedAt: null,
        reminders: [],
        downloads: [],
    },
};

const LOST: AdminTenantDeletion = {
    tenantId: 't-1',
    status: {
        kind: 'halted',
        deletesOn: '2026-12-01',
        heldBy: [{ reason: 'commercial-record-lost', store: 'notes-data', lost: ['invoices'] }],
    },
    record: { ...CLOSED, closedAt: null, commercialAfter: { ...COUNTS, invoices: 2 } },
};

const SCHEDULED: AdminTenantDeletion = {
    tenantId: 't-1',
    status: { kind: 'scheduled', deletesOn: '2026-12-01', wouldBeHeldBy: [] },
    record: null,
};

/** The head of the record with the tenant the application no longer has beside the live one. */
const WITH_GONE: AdminSubscriberRecord = {
    ...RECORD,
    tenants: [
        ...RECORD.tenants,
        {
            tenantId: 't-gone',
            linkedAt: '2025-01-05T09:00:00.000Z',
            unlinkedAt: '2026-10-31T23:00:00.000Z',
            known: false,
            slug: null,
            name: null,
            deletedAt: '2026-11-30T23:41:00.000Z',
        },
    ],
};

afterEach(() => {
    document.body.innerHTML = '';
});

async function mountDeletions({
    deletions = async (): Promise<AdminTenantDeletion[]> => [DELETED],
    capabilities = SERVING,
    record = WITH_GONE,
}: {
    deletions?: () => Promise<AdminTenantDeletion[]>;
    capabilities?: Record<string, boolean>;
    record?: AdminSubscriberRecord;
} = {}) {
    const asked: string[] = [];
    const mounted = await mountRecord({
        capabilities,
        subscribers: {
            record: async () => record,
            deletions: async (id: string) => {
                asked.push(id);
                return deletions();
            },
        },
    });
    const section = () => mounted.wrapper.find('.sa-subscriber-deletions');
    return { ...mounted, asked, section };
}

/** The rows of the table under the heading `title`, each as its cells' texts. */
function rowsUnder(within: DOMWrapper<Element>, title: string): string[][] {
    const part = within
        .findAll('.sa-deletion-record__part')
        .find((each) => each.find('h4').text() === title);
    expect(part, `no part "${title}"`).toBeTruthy();
    return (part?.findAll('tbody tr') ?? []).map((row) =>
        row.findAll('td').map((cell) => cell.text().split(/\s+/).join(' ')),
    );
}

// @requirement SC-ADM-021 — An operator finds everything about a subscriber in one record
// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
// @requirement SC-PRIV-024 — A tenant is deleted only after its full export was offered in the read-only period
// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe("the subscriber's record shows its tenants' deletions", () => {
    test('a tenant the application no longer has, named by its id, with all that is recorded of its deletion', async () => {
        const { asked, section } = await mountDeletions();

        expect(asked).toEqual(['s-1']);
        expect(section().find('h2').text()).toBe('Deletions');
        const entry = section().find('.sa-subscriber-deletions__entry');
        expect(entry.find('h3').text()).toBe('t-gone');
        expect(entry.find('h3 a').exists(), 'a link to a tenant that is gone').toBe(false);
        expect(entry.find('.sa-pill').text()).toBe('Deleted');

        const text = entry.text();
        expect(text).toContain('Export offered since ');
        expect(text).toContain('No suspension kept the export from being taken.');
        expect(text).toContain('Deletion day announced on 10/31/2026.');

        const keep = entry.findAll('.sa-deletion-record__keep dt').map((term) => term.text());
        expect(keep).toEqual(['Receipts', 'Sales contracts']);
        const kept = entry.findAll('.sa-deletion-record__keep dd').map((value) => value.text());
        expect(kept).toEqual(['412', '37']);

        const stores = entry.findAll('.sa-deletion-record__store');
        expect(stores.map((store) => store.find('code').text())).toEqual(['files', 'notes-data']);
        expect(stores[1]?.text()).toContain('Counted on ');
        expect(stores[1]?.text()).toContain('Confirmed on ');
        expect(stores[1]?.findAll('dt').map((term) => term.text())).toEqual(['notes', 'users']);
        expect(stores[1]?.findAll('dd').map((value) => value.text())).toEqual(['3,812', '7']);

        expect(rowsUnder(entry, 'Commercial record')).toEqual([
            ['Subscriber', '1', '1'],
            ['Contracts', '2', '2'],
            ['Charges', '5', '5'],
            ['Invoices', '3', '3'],
            ['Payments', '3', '3'],
            ['Credits', '0', '0'],
        ]);
        const reminders = rowsUnder(entry, 'Reminders');
        expect(reminders.map((row) => [row[0], row[3], row[4]])).toEqual([
            ['30', 'email', '2'],
            ['7', 'email', 'Nobody'],
            ['1', '—', '—'],
        ]);
        expect(reminders[2]?.[2]).toBe('Not delivered');
        const downloads = rowsUnder(entry, 'Downloads of the export');
        expect(downloads.map((row) => [row[1], row[2]])).toEqual([
            ['48 MB', 'Tenant administrator'],
        ]);
    });

    test('a deletion just begun says what is not there yet', async () => {
        const { section } = await mountDeletions({ deletions: async () => [BEGUN] });

        const entry = section().find('.sa-subscriber-deletions__entry');
        expect(entry.find('.sa-pill').text()).toBe('Under way');
        const text = entry.text();
        expect(text).toContain('A suspension kept the export from being taken for a while.');
        expect(text).toContain('The deletion day was not announced.');
        expect(text).toContain('Nothing named.');
        expect(text).toContain('Not counted yet');
        expect(text).toContain('Not confirmed yet');
        expect(rowsUnder(entry, 'Commercial record')[0]).toEqual(['Subscriber', '—', '—']);
        expect(text).toContain('No reminder.');
        expect(text).toContain('No download.');
    });

    test('a deletion halted for a lost commercial record marks the part that fell', async () => {
        const { section } = await mountDeletions({ deletions: async () => [LOST] });

        const entry = section().find('.sa-subscriber-deletions__entry');
        expect(entry.find('.sa-pill').text()).toBe('Halted');
        expect(entry.find('li').text()).toBe(
            'Store “notes-data” took parts of the commercial record with it (Invoices 3 → 2). No further store erases until a person decides.',
        );
        const rows = rowsUnder(entry, 'Commercial record');
        expect(rows.find((row) => row[0] === 'Invoices')).toEqual([
            'Invoices',
            '3',
            '2 Fewer than before',
        ]);
        expect(rows.filter((row) => row[2]?.includes('Fewer than before'))).toHaveLength(1);
    });

    test('a deletion still to come shows where it stands, and no record yet', async () => {
        const { wrapper, section } = await mountDeletions({ deletions: async () => [SCHEDULED] });

        const entry = section().find('.sa-subscriber-deletions__entry');
        const link = entry.find('h3 a');
        expect(link.text()).toBe('Northwind');
        expect(link.attributes('href')).toBe('/admin/tenants/northwind');
        expect(entry.find('.sa-pill').text()).toBe('Scheduled');
        expect(entry.text()).toContain("The tenant's data is deleted on 12/01/2026.");
        expect(wrapper.find('.sa-deletion-record').exists()).toBe(false);
    });

    test('two tenants, each with its own deletion, in the order the server gives them', async () => {
        const { section } = await mountDeletions({ deletions: async () => [SCHEDULED, DELETED] });

        const entries = section().findAll('.sa-subscriber-deletions__entry');
        expect(entries.map((entry) => entry.find('h3').text())).toEqual(['Northwind', 't-gone']);
        expect(entries.map((entry) => entry.find('.sa-pill').text())).toEqual([
            'Scheduled',
            'Deleted',
        ]);
    });

    test('a subscriber with no deletion says so', async () => {
        const { section } = await mountDeletions({ deletions: async () => [] });

        expect(section().text()).toContain('No deletion scheduled or begun.');
        expect(section().find('.sa-subscriber-deletions__entry').exists()).toBe(false);
    });

    test('a read that fails says so, and asks again on retry', async () => {
        let failing = true;
        const { asked, section } = await mountDeletions({
            deletions: async () => {
                if (failing) throw new Error('offline');
                return [DELETED];
            },
        });

        const banner = section().find('.sa-banner--negative');
        expect(banner.exists(), 'no error banner').toBe(true);
        expect(banner.text()).toContain('The deletions could not be loaded.');
        expect(section().text()).not.toContain('No deletion scheduled or begun.');

        failing = false;
        const retry = banner.findAll('button').find((button) => button.text() === 'Retry');
        expect(retry, 'no retry').toBeTruthy();
        await retry?.trigger('click');
        for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

        expect(asked).toEqual(['s-1', 's-1']);
        expect(section().find('.sa-banner--negative').exists()).toBe(false);
        expect(section().find('.sa-pill').text()).toBe('Deleted');
    });

    test('a subscriber the platform does not have shows nothing to delete', async () => {
        const { section } = await mountDeletions({
            deletions: async () => {
                throw new AdminError({
                    status: 404,
                    code: 'SUBSCRIBER_NOT_FOUND',
                    url: '/api/v1/admin/subscribers/s-1/deletions',
                    method: 'GET',
                });
            },
        });

        expect(section().find('.sa-banner--negative').exists()).toBe(false);
        expect(section().text()).toContain('No deletion scheduled or begun.');
    });

    test('without the capability, nothing is asked and no section is shown', async () => {
        const { asked, section } = await mountDeletions({ capabilities: {} });

        expect(asked).toEqual([]);
        expect(section().exists()).toBe(false);
    });
});
