// The subscriber's record shows its contracts — one timeline per tenant, each
// contract naming what it changed and where its confirmation stands — and
// opens a contract into what it froze, with its confirmation's download where
// the archived file is intact; and it downloads an invoice's archived document
// beside them. Each only where the platform serves it.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry. The browser's save is watched where it happens: an object URL is
// made of the file, and a link is clicked under the file's name.

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
    AdminContractChange,
    AdminContractConfirmationState,
    AdminContractLine,
    AdminSubscriberContract,
    AdminSubscriberContractDossier,
} from '@saasicat/core';
import { flushPromises } from '@vue/test-utils';

import { RECORD, mountRecord } from './support/subscriber-record.js';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const UNCHANGED: AdminContractChange = {
    concluded: false,
    plan: null,
    bundlesAdded: [],
    bundlesRemoved: [],
    frozenAnew: false,
    priceChanged: false,
    cancelled: false,
};

const contract = (
    id: string,
    state: AdminContractConfirmationState,
    overrides: Partial<AdminSubscriberContract> = {},
): AdminSubscriberContract => ({
    id,
    tenantId: 't-1',
    status: 'superseded',
    concludedAt: '2026-01-05T09:00:00.000Z',
    effectiveFrom: '2026-01-05T09:00:00.000Z',
    effectiveUntil: null,
    firstDay: '2026-01-05',
    lastDay: null,
    neverInForce: false,
    billingCycle: 'monthly',
    currency: 'EUR',
    totalGross: 58.31,
    termsVersion: '2026-10',
    cancellationNoticeDays: 14,
    plan: { key: 'STANDARD', title: 'Standard' },
    bundles: [],
    minimumTermUntil: null,
    change: UNCHANGED,
    confirmation: { state, archivedAt: null, deliveredAt: null, deliveredTo: null },
    ...overrides,
});

const SENT = {
    state: 'sent' as const,
    archivedAt: '2026-02-01T09:15:00.000Z',
    deliveredAt: '2026-02-01T09:30:00.000Z',
    deliveredTo: 'rechnung@northwind.example',
};

// Northwind: concluded in January, upgraded in February and running since; a
// tenant the application no longer has, cancelled.
const CONTRACTS = {
    contracts: [
        contract('c-3', 'not-due', {
            tenantId: 't-gone',
            status: 'terminated',
            firstDay: '2025-06-01',
            effectiveFrom: '2025-06-01T00:00:00.000Z',
            lastDay: '2025-12-31',
            change: { ...UNCHANGED, concluded: true, cancelled: true },
        }),
        contract('c-2', 'sent', {
            status: 'active',
            concludedAt: '2026-02-01T09:00:00.000Z',
            effectiveFrom: '2026-02-01T00:00:00.000Z',
            firstDay: '2026-02-01',
            totalGross: 106.81,
            termsVersion: null,
            plan: { key: 'PRO', title: 'Pro' },
            change: {
                ...UNCHANGED,
                plan: 'upgraded',
                bundlesAdded: [{ key: 'STORAGE', title: 'Storage' }],
            },
            confirmation: SENT,
        }),
        contract('c-1', 'not-due', {
            effectiveUntil: '2026-02-01T00:00:00.000Z',
            lastDay: '2026-01-31',
            change: { ...UNCHANGED, concluded: true },
        }),
    ],
};

const line = (overrides: Partial<AdminContractLine>): AdminContractLine => ({
    id: 'l',
    kind: 'plan',
    key: 'PRO',
    versionId: 'pv-pro-2',
    title: 'Pro',
    description: null,
    quantity: 1,
    unit: null,
    priceNet: 89,
    priceGross: 105.91,
    taxRate: 19,
    taxAmount: 16.91,
    billingCycle: 'monthly',
    currency: 'EUR',
    minimumTermUntil: null,
    features: [],
    quotas: {},
    source: 'in-catalog',
    ...overrides,
});

/** What c-2 froze: its plan, since removed from the catalogue, an add-on still in it, and a discount. */
const dossierOf = (
    summary: AdminSubscriberContract,
    overrides: Partial<AdminSubscriberContractDossier> = {},
): AdminSubscriberContractDossier => ({
    contract: summary,
    agreedAt: '2026-02-01T09:00:00.000Z',
    originalOfferId: 'offer-7',
    originalPlanVersionId: 'pv-pro-2',
    originalBundleVersionIds: ['bv-storage-1'],
    partiesMigrated: false,
    subtotalNet: 99,
    discountNet: 9,
    totalNet: 90,
    lines: [
        line({
            id: 'l-plan',
            features: ['export', 'api-access'],
            quotas: { users: 25 },
            source: 'removed',
        }),
        line({
            id: 'l-storage',
            kind: 'bundle',
            key: 'STORAGE',
            versionId: 'bv-storage-1',
            title: 'Storage',
            priceNet: 10,
            quotas: { storageGb: 50 },
            source: 'in-catalog',
        }),
        line({
            id: 'l-discount',
            kind: 'discount',
            key: 'WELCOME',
            versionId: null,
            title: 'Welcome',
            priceNet: -9,
            source: null,
        }),
    ],
    invoices: [
        {
            id: 'inv-2',
            number: 'AHP-2026-000002',
            issueDate: '2026-03-01',
            currency: 'EUR',
            totalGross: 106.81,
        },
    ],
    integrity: 'intact',
    ...overrides,
});

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

// The record names the gone tenant's link too, so its timeline is headed by it.
const TENANTS_RECORD = {
    ...RECORD,
    tenants: [
        ...RECORD.tenants,
        {
            tenantId: 't-gone',
            linkedAt: '2025-06-01T00:00:00.000Z',
            unlinkedAt: '2025-12-31T23:00:00.000Z',
            known: false,
            slug: null,
            name: null,
            deletedAt: null,
        },
    ],
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
    standardPages = {},
    contracts = CONTRACTS,
    dossier = async (contractId: string): Promise<unknown> => {
        const summary = CONTRACTS.contracts.find((each) => each.id === contractId);
        if (!summary) throw new Error(`no contract ${contractId}`);
        return dossierOf(summary);
    },
    confirmation = async (): Promise<unknown> => ({
        content: PDF,
        mediaType: 'application/pdf',
        fileName: 'contract-confirmation-c-2.pdf',
    }),
}: {
    manifest?: { capabilities: Record<string, boolean> };
    standardPages?: Record<string, { enabled: boolean }>;
    contracts?: { contracts: AdminSubscriberContract[] };
    dossier?: (contractId: string) => Promise<unknown>;
    confirmation?: () => Promise<unknown>;
} = {}) {
    const asked: string[] = [];
    const page = await mountRecord({
        capabilities: manifest.capabilities,
        standardPages,
        attach: true,
        subscribers: {
            record: async () => TENANTS_RECORD,
            payments: async () => PAYMENTS,
            contracts: async (id: string) => {
                asked.push(`contracts ${id}`);
                return contracts;
            },
            contract: async (id: string, contractId: string) => {
                asked.push(`contract ${id} ${contractId}`);
                return dossier(contractId);
            },
            contractConfirmation: async (id: string) => {
                asked.push(`confirmation ${id}`);
                return confirmation();
            },
            invoiceDocument: async (id: string) => {
                asked.push(`document ${id}`);
                return {
                    content: PDF,
                    mediaType: 'application/pdf',
                    fileName: 'AHP-2026-000001.pdf',
                };
            },
        },
    });
    mounted.push(page.wrapper);
    await settle();
    return { ...page, asked };
}

type Mounted = Awaited<ReturnType<typeof mountPage>>['wrapper'];

function sectionTitled(wrapper: Mounted, title: string) {
    return wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === title);
}

/** The contracts section's timelines: each tenant's heading, and its contracts' headers. */
function timelinesOf(wrapper: Mounted): Array<{ tenant: string; entries: string[] }> {
    return (
        sectionTitled(wrapper, 'Contracts')?.findAll('.sa-subscriber-contracts__tenant') ?? []
    ).map((timeline) => ({
        tenant: timeline.find('h3').text(),
        entries: timeline
            .findAll('.sa-accordion')
            .map((entry) => entry.find('.sa-accordion__head').text().replace(/\s+/g, ' ').trim()),
    }));
}

/** Opens the contract whose header holds `text`. */
async function openContract(wrapper: Mounted, text: string): Promise<void> {
    const entry = sectionTitled(wrapper, 'Contracts')
        ?.findAll('.sa-subscriber-contracts__tenant .sa-accordion')
        .find((each) => each.find('.sa-accordion__head').text().includes(text));
    expect(entry?.exists(), `no contract headed "${text}"`).toBe(true);
    await entry?.find('button[aria-expanded]').trigger('click');
    await settle();
}

const dossierIn = (wrapper: Mounted) => wrapper.find('.sa-contract-dossier');

// @requirement SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another
describe("the subscriber's record shows its contracts", () => {
    test('one timeline per tenant, the latest start first, each naming what it changed and where its confirmation stands', async () => {
        const { wrapper, asked } = await mountPage();

        expect(asked).toContain('contracts s-1');
        expect(timelinesOf(wrapper)).toEqual([
            {
                tenant: 'Tenant Northwind',
                entries: [
                    'from 2026-02-01, open-ended · Plan upgraded · Add-on Storage added · €106.81 gross, Monthly In force Sent',
                    '2026-01-05 – 2026-01-31 · Concluded · €58.31 gross, Monthly Superseded Not due',
                ],
            },
            {
                tenant: 'Tenant t-gone, no longer in the application',
                entries: [
                    '2025-06-01 – 2025-12-31 · Concluded · Cancelled · €58.31 gross, Monthly Ended Not due',
                ],
            },
        ]);
    });

    test('marks the contracts in force on a day picked, and says so when none was', async () => {
        const { wrapper } = await mountPage();
        const asOf = sectionTitled(wrapper, 'Contracts')?.find('input[type="date"]');
        const marked = () =>
            timelinesOf(wrapper)
                .flatMap(({ entries }) => entries)
                .filter((entry) => entry.includes('In force on'));

        await asOf?.setValue('2026-01-31');
        await settle();
        expect(marked()).toEqual([expect.stringContaining('2026-01-05 – 2026-01-31')]);

        await asOf?.setValue('2026-02-01');
        await settle();
        expect(marked()).toEqual([expect.stringContaining('from 2026-02-01')]);

        await asOf?.setValue('2025-05-31');
        await settle();
        expect(marked()).toEqual([]);
        expect(sectionTitled(wrapper, 'Contracts')?.text()).toContain(
            'No contract was in force on that day.',
        );
    });

    test('a contract superseded before it began says it was never in force, and is marked on no day', async () => {
        const { wrapper } = await mountPage({
            contracts: {
                contracts: [
                    contract('c-9', 'not-due', {
                        firstDay: '2026-04-01',
                        neverInForce: true,
                        change: { ...UNCHANGED, plan: 'upgraded' },
                    }),
                ],
            },
        });

        await sectionTitled(wrapper, 'Contracts')
            ?.find('input[type="date"]')
            .setValue('2026-04-01');
        await settle();

        const [entry] = timelinesOf(wrapper)[0].entries;
        expect(entry).toContain('Never in force — superseded before it began');
        expect(entry).not.toContain('In force on');
    });

    test('opens a contract into what it froze: its lines with where each came from, its invoices and its ids', async () => {
        const { wrapper, asked } = await mountPage({
            standardPages: { plans: { enabled: true }, bundles: { enabled: true } },
        });

        await openContract(wrapper, 'Plan upgraded');

        expect(asked).toContain('contract s-1 c-2');
        const dossier = dossierIn(wrapper);
        expect(dossier.text()).toContain(
            'As frozen when it was concluded — not today’s catalogue.',
        );
        expect(dossier.text(), 'the day and address the header leaves out').toContain(
            'Sent on 2026-02-01 to rechnung@northwind.example',
        );
        const lines = dossier.findAll('.sa-contract-lines .sa-accordion');
        expect(
            lines.map((each) => [
                each.find('.sa-accordion__label').text(),
                each.find('.sa-accordion__actions .sa-pill').text(),
            ]),
        ).toEqual([
            ['Plan · Pro · €89 net, Monthly', 'removed from the catalogue'],
            ['Add-on · Storage · €10 net, Monthly', 'in the catalogue'],
        ]);
        expect(lines[1].find('a.sa-link').attributes('href')).toBe('/admin/bundles');
        expect(lines[0].find('a.sa-link').exists(), 'no link to a plan the catalogue removed').toBe(
            false,
        );
        expect(dossier.find('.sa-contract-lines__discounts').text()).toContain('Welcome');
        const invoice = dossier.find('a[href="#sa-subscriber-invoices"]');
        expect(invoice.text()).toBe('AHP-2026-000002');
        expect(
            wrapper.find('#sa-subscriber-invoices').exists(),
            'the invoices section it leads to',
        ).toBe(true);
        expect(
            dossier
                .findAll('button[aria-label^="Copy"]')
                .map((button) => button.attributes('aria-label')),
        ).toEqual([
            'Copy Contract c-2',
            'Copy Offer offer-7',
            'Copy Plan version pv-pro-2',
            'Copy Add-on version bv-storage-1',
        ]);
    });

    test('leads to no catalogue page the platform does not serve', async () => {
        const { wrapper } = await mountPage();

        await openContract(wrapper, 'Plan upgraded');

        expect(dossierIn(wrapper).text()).toContain('in the catalogue');
        expect(dossierIn(wrapper).find('a.sa-link[href^="/admin"]').exists()).toBe(false);
    });

    test('shows each line’s features and quotas, and filters the lines by them', async () => {
        const { wrapper } = await mountPage();
        await openContract(wrapper, 'Plan upgraded');
        const titles = () =>
            dossierIn(wrapper)
                .findAll('.sa-contract-lines .sa-accordion .sa-contract-lines__title')
                .map((each) => each.text());
        const filter = dossierIn(wrapper).find('.sa-contract-lines__filter input');

        await dossierIn(wrapper)
            .find('.sa-contract-lines .sa-accordion button[aria-expanded]')
            .trigger('click');
        expect(dossierIn(wrapper).find('.sa-contract-lines .sa-accordion').text()).toContain(
            'api-access',
        );
        expect(dossierIn(wrapper).find('.sa-contract-lines .sa-accordion').text()).toContain(
            'users: 25',
        );

        await filter.setValue('STORAGE');
        await settle();
        expect(titles()).toEqual(['Storage']);
        expect(dossierIn(wrapper).find('.sa-contract-lines__discounts').exists()).toBe(false);

        await filter.setValue('nothing-like-it');
        await settle();
        expect(titles()).toEqual([]);
        expect(dossierIn(wrapper).text()).toContain(
            'No line has a feature or a quota “nothing-like-it”.',
        );
    });

    test('copies an id, and says whether the browser let it', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { wrapper, notices } = await mountPage();
        await openContract(wrapper, 'Plan upgraded');

        await dossierIn(wrapper).find('button[aria-label="Copy Contract c-2"]').trigger('click');
        await settle();
        expect(writeText).toHaveBeenCalledWith('c-2');
        expect(notices).toEqual([['positive', '“c-2” copied']]);

        writeText.mockRejectedValueOnce(new Error('not allowed'));
        await dossierIn(wrapper).find('button[aria-label="Copy Offer offer-7"]').trigger('click');
        await settle();
        expect(notices.at(-1)?.[0]).toBe('negative');
    });

    test('a confirmation that no longer matches its checksum is said at the contract, and not offered', async () => {
        const { wrapper } = await mountPage({
            dossier: async () => dossierOf(CONTRACTS.contracts[1], { integrity: 'mismatch' }),
        });

        await openContract(wrapper, 'Plan upgraded');

        expect(dossierIn(wrapper).text()).toContain(
            'The archived confirmation no longer matches the checksum recorded when it was rendered.',
        );
        expect(dossierIn(wrapper).find('button[aria-label^="Download"]').exists()).toBe(false);
    });

    test('a confirmation not archived yet, or not due, is said and not offered', async () => {
        const { wrapper } = await mountPage({
            dossier: async () => dossierOf(CONTRACTS.contracts[1], { integrity: 'waiting' }),
        });

        await openContract(wrapper, 'Plan upgraded');

        expect(dossierIn(wrapper).text()).toContain('The confirmation is not archived yet.');
        expect(dossierIn(wrapper).find('button[aria-label^="Download"]').exists()).toBe(false);
    });

    test('downloads an intact confirmation under the name it was archived with', async () => {
        const { wrapper, asked } = await mountPage();
        await openContract(wrapper, 'Plan upgraded');
        const button = dossierIn(wrapper).find(
            'button[aria-label="Download the confirmation of the contract of 2026-02-01"]',
        );
        expect(button.exists(), 'no download button').toBe(true);

        await button.trigger('click');
        await settle();

        expect(asked).toContain('confirmation c-2');
        expect(saved.map((each) => each.name)).toEqual(['contract-confirmation-c-2.pdf']);
        expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(PDF);
    });

    test('a download that fails says so, and saves nothing', async () => {
        const { wrapper, notices } = await mountPage({
            confirmation: async () => {
                throw new Error('offline');
            },
        });
        await openContract(wrapper, 'Plan upgraded');

        await dossierIn(wrapper).find('button[aria-label^="Download"]').trigger('click');
        await settle();

        expect(notices.map(([kind]) => kind)).toEqual(['negative']);
        expect(saved).toEqual([]);
    });

    test('a contract that fails to load says so', async () => {
        const { wrapper } = await mountPage({
            dossier: async () => {
                throw new Error('offline');
            },
        });

        await openContract(wrapper, 'Plan upgraded');

        expect(dossierIn(wrapper).text()).toContain('The contract could not be loaded.');
    });

    test('opening another contract closes the first, and reads the one opened', async () => {
        const { wrapper, asked } = await mountPage();

        await openContract(wrapper, 'Plan upgraded');
        await openContract(wrapper, '2026-01-05 – 2026-01-31');

        expect(asked.filter((each) => each.startsWith('contract '))).toEqual([
            'contract s-1 c-2',
            'contract s-1 c-1',
        ]);
        expect(wrapper.findAll('.sa-contract-dossier')).toHaveLength(1);
    });

    test('nothing of them where the platform does not serve them', async () => {
        const { wrapper, asked } = await mountPage({
            manifest: { capabilities: { 'payments.read': true } },
        });

        expect(sectionTitled(wrapper, 'Contracts')).toBeUndefined();
        expect(asked.filter((each) => each.startsWith('contract'))).toEqual([]);
        expect(wrapper.find('button[aria-label="Download invoice AHP-2026-000001"]').exists()).toBe(
            false,
        );
    });
});

describe("the subscriber's record downloads an invoice's document", () => {
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
