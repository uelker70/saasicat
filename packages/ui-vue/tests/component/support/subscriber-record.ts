// A subscriber's record mounted through a router, the way an app mounts the
// page, against a stubbed registry.
//
// The record shows its sections once its head is read, so every test that
// reads a section of it gets the head from here — a subscriber, live for one
// tenant — and stubs only what its section asks the server for.

import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import SubscriberRecordPage from '../../../src/pages/SubscriberRecordPage.vue';
import { mountWithQuasar } from '../../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../../src/vue/ui-notify.js';
import { provideStubResources, type ResourceStubs } from './stub-resources.js';

/** The subscriber the record is opened on, as the server answers its master data. */
export const SUBSCRIBER = {
    id: 's-1',
    customerNumber: 'K-10001',
    legalName: 'Northwind GmbH',
    addressLine1: 'Hafenstraße 1',
    addressLine2: null,
    postalCode: '20457',
    city: 'Hamburg',
    country: 'DE',
    invoiceEmail: 'invoices@northwind.example',
    business: true,
    vatId: 'DE123456789',
    vatIdValidated: true,
    taxNumber: null,
    migrated: false,
};

/** The head of its record: the subscriber, live for the tenant `northwind`. */
export const RECORD = {
    subscriber: SUBSCRIBER,
    readiness: null,
    tenants: [
        {
            tenantId: 't-1',
            linkedAt: '2026-01-05T09:00:00.000Z',
            unlinkedAt: null,
            known: true,
            slug: 'northwind',
            name: 'Northwind',
            deletedAt: null,
        },
    ],
};

export interface MountedRecordOptions {
    /** The manifest's capabilities beside `subscribers.read`, which the record needs. */
    capabilities?: Record<string, boolean>;
    /** The subscribers descriptor's operations; `record` answers `RECORD` unless given. */
    subscribers?: ResourceStubs[string];
    /** Which record the route opens. */
    id?: string;
    /** Where the notify port puts what it is told. */
    notices?: Array<[string, string]>;
    /** Mounted into the document, for a dialog teleported out of the wrapper. */
    attach?: boolean;
}

/** The record page under `/admin/subscribers/:id`, its manifest and notify port provided. */
export async function mountRecord({
    capabilities = {},
    subscribers = {},
    id = 's-1',
    notices = [],
    attach = false,
}: MountedRecordOptions = {}) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/subscribers/:id', component: SubscriberRecordPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push(`/admin/subscribers/${id}`);
    await router.isReady();
    const manifest = { capabilities: { 'subscribers.read': true, ...capabilities } };
    // SAFETY: the two keys are the symbols the page injects its manifest and its
    // notify port under, typed as Vue's injection keys rather than as symbols.
    const manifestKey = SUPER_ADMIN_MANIFEST_KEY as symbol;
    // SAFETY: as above, for the notify port.
    const notifyKey = SUPER_ADMIN_NOTIFY_KEY as symbol;
    const mountOptions = {
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    subscribers: { record: async () => RECORD, ...subscribers },
                }),
                [manifestKey]: () => manifest,
                [notifyKey]: (kind: string, message: string) => notices.push([kind, message]),
            },
        },
    };
    const wrapper = mountWithQuasar(
        defineComponent({ template: '<router-view />' }),
        attach ? { ...mountOptions, attachTo: document.body } : mountOptions,
    );
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    return { wrapper, router, notices };
}

export type MountedRecord = Awaited<ReturnType<typeof mountRecord>>['wrapper'];
