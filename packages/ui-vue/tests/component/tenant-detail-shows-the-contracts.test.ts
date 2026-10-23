// The tenant detail shows the tenant's contracts with where each confirmation
// stands, downloads an archived confirmation, and downloads an invoice's
// archived document beside it — each only where the platform serves it.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry. The browser's save is watched where it happens: an object URL is
// made of the file, and a link is clicked under the file's name.

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminContractConfirmationState, AdminTenantContract } from '@saasicat/core';
import { defineComponent } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'northwind', name: 'Northwind', isActive: true, users: [] };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const contract = (
    id: string,
    state: AdminContractConfirmationState,
    overrides: Partial<AdminTenantContract> = {},
): AdminTenantContract => ({
    id,
    status: 'superseded',
    concludedAt: '2026-01-05T09:00:00.000Z',
    effectiveFrom: '2026-01-05T09:00:00.000Z',
    effectiveUntil: null,
    billingCycle: 'monthly',
    currency: 'EUR',
    totalGross: 58.31,
    termsVersion: '2026-10',
    cancellationNoticeDays: 14,
    confirmation: { state, archivedAt: null, deliveredAt: null, deliveredTo: null },
    ...overrides,
});

const CONTRACTS = {
    contracts: [
        contract('c-3', 'being-made', {
            status: 'active',
            concludedAt: '2026-03-01T09:00:00.000Z',
        }),
        contract('c-2', 'sent', {
            termsVersion: null,
            concludedAt: '2026-02-01T09:00:00.000Z',
            confirmation: {
                state: 'sent',
                archivedAt: '2026-02-01T09:15:00.000Z',
                deliveredAt: '2026-02-01T09:30:00.000Z',
                deliveredTo: 'rechnung@northwind.example',
            },
        }),
        contract('c-1', 'not-due'),
    ],
};

const PAYMENTS = {
    invoices: [
        {
            id: 'inv-1',
            number: 'AHP-2026-000001',
            issuedAt: '2026-02-01T05:15:00.000Z',
            dueDate: '2026-02-15',
            totalGross: 58.31,
            currency: 'EUR',
            owed: 0,
            correction: null,
            cancelledBy: null,
            documentArchived: true,
        },
        {
            id: 'inv-2',
            number: 'AHP-2026-000002',
            issuedAt: '2026-03-01T05:15:00.000Z',
            dueDate: '2026-03-15',
            totalGross: 58.31,
            currency: 'EUR',
            owed: 58.31,
            correction: null,
            cancelledBy: null,
            documentArchived: false,
        },
    ],
    openCases: [],
};

const SERVING = {
    capabilities: { 'contracts.read': true, 'invoices.read': true, 'payments.read': true },
};

const mounted: { unmount: () => void }[] = [];
const saved: Array<{ name: string; blob: Blob }> = [];
beforeEach(() => {
    let made: Blob | null = null;
    // jsdom has no object URLs, and a followed link would navigate.
    URL.createObjectURL = vi.fn((blob: Blob) => {
        made = blob;
        return 'blob:file';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
    ) {
        if (made) saved.push({ name: this.download, blob: made });
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    saved.length = 0;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
}

async function mountPage({
    manifest = SERVING,
    contracts = CONTRACTS,
    confirmation = async (): Promise<unknown> => ({
        content: PDF,
        mediaType: 'application/pdf',
        fileName: 'contract-confirmation-c-2.pdf',
    }),
}: {
    manifest?: unknown;
    contracts?: { contracts: AdminTenantContract[] };
    confirmation?: () => Promise<unknown>;
} = {}) {
    const asked: string[] = [];
    const notices: Array<[string, string]> = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/northwind');
    await router.isReady();
    const tenants = {
        detail: async () => TENANT,
        payments: async () => PAYMENTS,
        contracts: async (slug: string) => {
            asked.push(`contracts ${slug}`);
            return contracts;
        },
        contractConfirmation: async (id: string) => {
            asked.push(`confirmation ${id}`);
            return confirmation();
        },
        invoiceDocument: async (id: string) => {
            asked.push(`document ${id}`);
            return { content: PDF, mediaType: 'application/pdf', fileName: 'AHP-2026-000001.pdf' };
        },
    };
    // SAFETY: the two keys are the symbols the page injects its manifest and its
    // notify port under, typed as Vue's injection keys rather than as symbols.
    const manifestKey = SUPER_ADMIN_MANIFEST_KEY as symbol;
    // SAFETY: as above, for the notify port.
    const notifyKey = SUPER_ADMIN_NOTIFY_KEY as symbol;
    const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
        attachTo: document.body,
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({ tenants }),
                [manifestKey]: () => manifest,
                [notifyKey]: (kind: string, message: string) => notices.push([kind, message]),
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, asked, notices };
}

type Mounted = Awaited<ReturnType<typeof mountPage>>['wrapper'];

function sectionTitled(wrapper: Mounted, title: string) {
    return wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === title);
}

/**
 * The rows of a section's table, cell by cell. A cell a slot renders stays a
 * `q-td` element here: the test mount registers no `QTd`, which in an app the
 * auto-import resolves — so both are read, in the order they stand.
 */
function rowsOf(wrapper: Mounted, title: string): string[][] {
    return (sectionTitled(wrapper, title)?.findAll('tbody tr') ?? []).map((row) =>
        row.findAll('td, q-td').map((cell) => cell.text()),
    );
}

describe("the tenant detail shows the tenant's contracts", () => {
    test('every one, the newest first, with what it records and where its confirmation stands', async () => {
        const { wrapper, asked } = await mountPage();

        expect(asked).toContain('contracts northwind');
        expect(rowsOf(wrapper, 'Contracts')).toEqual([
            [
                '2026-03-01',
                'In force',
                '2026-01-05',
                'Monthly',
                '€58.31',
                '2026-10',
                '14 days',
                'Being made',
                '',
            ],
            [
                '2026-02-01',
                'Superseded',
                '2026-01-05',
                'Monthly',
                '€58.31',
                'none',
                '14 days',
                'Sent on 2026-02-01 to rechnung@northwind.example',
                'Download',
            ],
            [
                '2026-01-05',
                'Superseded',
                '2026-01-05',
                'Monthly',
                '€58.31',
                '2026-10',
                '14 days',
                'Concluded before confirmations',
                '',
            ],
        ]);
    });

    test('downloads an archived confirmation under the name it was archived with', async () => {
        const { wrapper, asked } = await mountPage();
        const button = sectionTitled(wrapper, 'Contracts')?.find(
            'button[aria-label="Download the confirmation of the contract of 2026-02-01"]',
        );
        expect(button?.exists(), 'no download button').toBe(true);

        await button?.trigger('click');
        await settle();

        expect(asked).toContain('confirmation c-2');
        expect(saved.map((each) => each.name)).toEqual(['contract-confirmation-c-2.pdf']);
        expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(PDF);
    });

    test('while one confirmation is on its way, the other downloads wait', async () => {
        const archived = {
            state: 'awaiting-mail' as const,
            archivedAt: '2026-02-01T09:15:00.000Z',
            deliveredAt: null,
            deliveredTo: null,
        };
        const { wrapper } = await mountPage({
            contracts: {
                contracts: [
                    contract('c-5', 'awaiting-mail', { confirmation: archived }),
                    contract('c-4', 'awaiting-mail', {
                        concludedAt: '2026-01-04T09:00:00.000Z',
                        confirmation: archived,
                    }),
                ],
            },
            confirmation: () => new Promise(() => {}),
        });
        const buttons = () =>
            sectionTitled(wrapper, 'Contracts')?.findAll('button[aria-label^="Download"]') ?? [];
        expect(buttons().length, 'the premise').toBe(2);

        await buttons()[0].trigger('click');
        await settle();

        expect(buttons()[1].attributes('disabled'), 'the other is still offered').toBeDefined();
    });

    test('a download that fails says so, and saves nothing', async () => {
        const { wrapper, notices } = await mountPage({
            confirmation: async () => {
                throw new Error('offline');
            },
        });

        await sectionTitled(wrapper, 'Contracts')
            ?.find('button[aria-label^="Download"]')
            .trigger('click');
        await settle();

        expect(notices.map(([kind]) => kind)).toEqual(['negative']);
        expect(saved).toEqual([]);
    });

    test('nothing of them where the platform does not serve them', async () => {
        const { wrapper, asked } = await mountPage({
            manifest: { capabilities: { 'payments.read': true } },
        });

        expect(sectionTitled(wrapper, 'Contracts')).toBeUndefined();
        expect(asked.filter((each) => each.startsWith('contracts'))).toEqual([]);
        expect(wrapper.find('button[aria-label="Download invoice AHP-2026-000001"]').exists()).toBe(
            false,
        );
    });
});

describe("the tenant detail downloads an invoice's document", () => {
    test('only where the platform serves it, the cancellation beside it or not', async () => {
        const { wrapper } = await mountPage({
            manifest: { capabilities: { 'payments.read': true, 'invoices.cancel': true } },
        });

        expect(wrapper.find('button[aria-label="Cancel invoice AHP-2026-000001"]').exists()).toBe(
            true,
        );
        expect(wrapper.find('button[aria-label="Download invoice AHP-2026-000001"]').exists()).toBe(
            false,
        );
    });

    test('only for an invoice whose document is archived', async () => {
        const { wrapper } = await mountPage();

        expect(wrapper.find('button[aria-label="Download invoice AHP-2026-000001"]').exists()).toBe(
            true,
        );
        expect(wrapper.find('button[aria-label="Download invoice AHP-2026-000002"]').exists()).toBe(
            false,
        );
    });

    test('beside the invoice, under the name it was issued with', async () => {
        const { wrapper, asked } = await mountPage();
        const button = wrapper.find('button[aria-label="Download invoice AHP-2026-000001"]');
        expect(button.exists(), 'no download button').toBe(true);

        await button.trigger('click');
        await settle();

        expect(asked).toContain('document inv-1');
        expect(saved.map((each) => each.name)).toEqual(['AHP-2026-000001.pdf']);
    });
});
