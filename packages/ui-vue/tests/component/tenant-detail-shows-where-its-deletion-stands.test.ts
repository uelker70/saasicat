// The tenant detail shows where the tenant's deletion stands — scheduled, due,
// halted with every reason, under way, retried or done — in words, with the
// way into the subscriber's record once the deletion has a record there.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown. The days are written for the catalog's English, `en-US`.

import type {
    AdminTenantDeletion,
    AdminTenantDeletionFailure,
    AdminTenantDeletionRecord,
} from '@saasicat/core';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { AdminError } from '../../src/client/admin-error.js';
import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'wien', name: 'Wien', isActive: false, users: [] };

const SUBSCRIBER = {
    id: 's-1',
    customerNumber: 'K-10001',
    legalName: 'Wien GmbH',
    addressLine1: 'Ringstraße 1',
    addressLine2: null,
    postalCode: '1010',
    city: 'Wien',
    country: 'AT',
    business: true,
    vatId: 'ATU12345678',
    vatIdValidated: true,
    taxNumber: null,
    invoiceEmail: null,
    migrated: false,
};
const READY = { ready: true, missing: [], taxRefusal: null };

const SERVING = { capabilities: { 'deletions.read': true, 'subscribers.read': true } };

const COUNTS = { subscriber: 1, contracts: 2, charges: 5, invoices: 3, payments: 3, credits: 0 };

const RECORD: AdminTenantDeletionRecord = {
    exportOfferedFrom: '2026-10-31T23:00:00.000Z',
    exportBlockedBySuspension: false,
    announcedOn: '2026-10-31',
    keep: [],
    stores: [
        {
            store: 'files',
            position: 0,
            countedAt: '2026-11-30T23:15:00.000Z',
            counts: [],
            erasedAt: '2026-11-30T23:38:00.000Z',
        },
        {
            store: 'notes-data',
            position: 1,
            countedAt: '2026-11-30T23:15:00.000Z',
            counts: [],
            erasedAt: null,
        },
    ],
    commercialBefore: COUNTS,
    commercialAfter: null,
    startedAt: '2026-11-30T23:15:00.000Z',
    closedAt: null,
    attempts: 0,
    lastFailure: null,
    reminders: [],
    downloads: [],
};

const FAILURE: AdminTenantDeletionFailure = {
    step: 'erase',
    store: 'files',
    code: 'ECONNRESET',
    at: '2026-11-30T23:40:00.000Z',
};

const SCHEDULED: AdminTenantDeletion = {
    tenantId: 't-1',
    status: { kind: 'scheduled', deletesOn: '2026-12-01', wouldBeHeldBy: [] },
    record: null,
};
const DUE: AdminTenantDeletion = {
    tenantId: 't-1',
    status: { kind: 'due', deletesOn: '2026-12-01' },
    record: null,
};
const HALTED: AdminTenantDeletion = {
    tenantId: 't-1',
    status: {
        kind: 'halted',
        deletesOn: '2026-12-01',
        heldBy: [{ reason: 'installation-unmarked', expected: 'ahp-prod' }],
    },
    record: null,
};
const RUNNING: AdminTenantDeletion = {
    tenantId: 't-1',
    status: {
        kind: 'running',
        deletesOn: '2026-12-01',
        startedAt: RECORD.startedAt,
        storesErased: 1,
        storesTotal: 2,
        lastFailure: null,
    },
    record: RECORD,
};
const RETRYING: AdminTenantDeletion = {
    tenantId: 't-1',
    status: {
        kind: 'retrying',
        deletesOn: '2026-12-01',
        startedAt: RECORD.startedAt,
        attempts: 3,
        lastFailure: FAILURE,
    },
    record: { ...RECORD, attempts: 3, lastFailure: FAILURE },
};
const DELETED: AdminTenantDeletion = {
    tenantId: 't-1',
    status: { kind: 'deleted', deletesOn: '2026-12-01', closedAt: '2026-11-30T23:41:00.000Z' },
    record: {
        ...RECORD,
        stores: RECORD.stores.map((store) => ({ ...store, erasedAt: '2026-11-30T23:41:00.000Z' })),
        commercialAfter: COUNTS,
        closedAt: '2026-11-30T23:41:00.000Z',
    },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountPage({
    manifest = SERVING,
    deletion = async (): Promise<AdminTenantDeletion | null> => SCHEDULED,
}: {
    manifest?: { capabilities: Record<string, boolean> };
    deletion?: () => Promise<AdminTenantDeletion | null>;
} = {}) {
    const asked: string[] = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/wien');
    await router.isReady();
    // SAFETY: the key is the symbol the page injects its manifest under, typed
    // as Vue's injection key rather than as a symbol.
    const manifestKey = SUPER_ADMIN_MANIFEST_KEY as symbol;
    const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    tenants: {
                        detail: async () => TENANT,
                        subscriber: async () => ({ subscriber: SUBSCRIBER, readiness: READY }),
                        deletion: async (slug: string) => {
                            asked.push(slug);
                            return deletion();
                        },
                    },
                }),
                [manifestKey]: () => manifest,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    const section = () => wrapper.find('.sa-tenant-deletion');
    return { wrapper, asked, section };
}

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe("the tenant detail shows where the tenant's deletion stands", () => {
    test.each([
        {
            deletion: SCHEDULED,
            label: 'Scheduled',
            tone: 'info',
            line: "The tenant's data is deleted on 12/01/2026.",
        },
        {
            deletion: DUE,
            label: 'Due',
            tone: 'primary',
            line: 'Due since 12/01/2026. The next run begins the deletion.',
        },
        {
            deletion: HALTED,
            label: 'Halted',
            tone: 'warning',
            line: 'Due since 12/01/2026, halted:',
        },
        {
            deletion: RUNNING,
            label: 'Under way',
            tone: 'primary',
            line: '1 of 2 stores erased.',
        },
        {
            deletion: RETRYING,
            label: 'Being retried',
            tone: 'negative',
            line: 'failed attempts so far: 3. The next run tries again.',
        },
        { deletion: DELETED, label: 'Deleted', tone: 'muted', line: 'Deleted on ' },
    ])('$label: its pill and what it says', async ({ deletion, label, tone, line }) => {
        const { asked, section } = await mountPage({ deletion: async () => deletion });

        expect(asked).toEqual(['wien']);
        expect(section().exists(), 'no deletion section').toBe(true);
        expect(section().find('h2').text()).toBe('Deletion');
        const pill = section().find('.sa-pill');
        expect(pill.text()).toBe(label);
        expect(pill.classes()).toContain(`sa-pill--${tone}`);
        expect(section().text()).toContain(line);
    });

    test('a retried deletion names its last failure, by store, step and code', async () => {
        const { section } = await mountPage({ deletion: async () => RETRYING });

        expect(section().text()).toContain('store “files”, step “Erasing”, code “ECONNRESET”.');
    });

    test('a halted deletion lists every reason, in the order the run asks them', async () => {
        const { section } = await mountPage({
            deletion: async () => ({
                ...HALTED,
                status: {
                    kind: 'halted',
                    deletesOn: '2026-12-01',
                    heldBy: [
                        { reason: 'installation-unmarked', expected: 'ahp-prod' },
                        { reason: 'no-subscriber' },
                        { reason: 'contract-runs-past-end' },
                    ],
                },
            }),
        });

        const reasons = section()
            .findAll('li')
            .map((item) => item.text());
        expect(reasons).toEqual([
            "The database is not marked as installation “ahp-prod”. Once it is the one to delete in: “installation mark ahp-prod” on the application's command line.",
            'The tenant has no subscriber to keep the record of its deletion with.',
            'A contract of the tenant runs past the end of its subscription.',
        ]);
    });

    test('before its day, it says what would hold the deletion were the day today', async () => {
        const { section } = await mountPage({
            deletion: async () => ({
                ...SCHEDULED,
                status: {
                    kind: 'scheduled',
                    deletesOn: '2026-12-01',
                    wouldBeHeldBy: [{ reason: 'installation-unmarked', expected: 'ahp-prod' }],
                },
            }),
        });

        expect(section().text()).toContain(
            'Were the deletion day today, the deletion would be halted:',
        );
        expect(section().findAll('li')).toHaveLength(1);
        expect(section().find('li').text()).toContain('installation mark ahp-prod');
    });

    test('a begun deletion leads into the record kept with its subscriber', async () => {
        const { section } = await mountPage({ deletion: async () => RUNNING });

        const open = section()
            .findAll('a')
            .find((link) => link.text().includes('Open the record of the deletion'));
        expect(open, 'no way into the record').toBeTruthy();
        expect(open?.attributes('href')).toBe('/admin/subscribers/s-1');
    });

    test('a deletion not yet begun has no record to lead into', async () => {
        const { section } = await mountPage({ deletion: async () => DUE });

        expect(section().text()).not.toContain('Open the record of the deletion');
    });

    test('a tenant with no deletion to come shows no section', async () => {
        const { asked, section } = await mountPage({ deletion: async () => null });

        expect(asked).toEqual(['wien']);
        expect(section().exists()).toBe(false);
    });

    test('a tenant the application does not have shows no section', async () => {
        const { section } = await mountPage({
            deletion: async () => {
                throw new AdminError({
                    status: 404,
                    code: 'TENANT_NOT_FOUND',
                    url: '/api/v1/admin/tenants/wien/deletion',
                    method: 'GET',
                });
            },
        });

        expect(section().exists()).toBe(false);
    });

    test('a read that fails says so, and asks again on retry', async () => {
        let failing = true;
        const { wrapper, asked, section } = await mountPage({
            deletion: async () => {
                if (failing) throw new Error('offline');
                return HALTED;
            },
        });

        const banner = section().find('.sa-banner--negative');
        expect(banner.exists(), 'no error banner').toBe(true);
        expect(banner.text()).toContain('The deletion could not be loaded.');

        failing = false;
        const retry = banner.findAll('button').find((button) => button.text() === 'Retry');
        expect(retry, 'no retry').toBeTruthy();
        await retry?.trigger('click');
        await settle();

        expect(asked).toEqual(['wien', 'wien']);
        expect(wrapper.find('.sa-tenant-deletion .sa-banner--negative').exists()).toBe(false);
        expect(section().find('.sa-pill').text()).toBe('Halted');
    });

    test('without the capability, nothing is asked and no section is shown', async () => {
        const { asked, section } = await mountPage({
            manifest: { capabilities: { 'subscribers.read': true } },
        });

        expect(asked).toEqual([]);
        expect(section().exists()).toBe(false);
    });
});
