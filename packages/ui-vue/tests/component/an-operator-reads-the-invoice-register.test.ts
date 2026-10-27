// The operator reads the register of every invoice: the platform's current
// month at first, then the months picked — what they add up to per month, tax
// treatment and rate, and their invoices by issue date and number, each
// leading into its subscriber's record — and cancels an invoice from it the
// way the record does.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is asked.

// @requirement SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
    INVOICE_ERROR_CODES,
    type AdminInvoiceRegisterRow,
    type AdminInvoiceRegisterTotals,
} from '@saasicat/core';

import { AdminError } from '../../src/client/admin-error.js';
import { standardPageRouteOf } from '../../src/client/nav-builder.js';
import type {
    InvoiceExportQuery,
    InvoiceRegisterRequest,
} from '../../src/client/resources/invoices.resource.js';
import InvoicesPage from '../../src/pages/InvoicesPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import {
    STANDARD_PAGE_ROUTES_KEY,
    type StandardPageRoute,
} from '../../src/vue/standard-page-routes.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { dialog, enterTheCode, fieldOf, settle, typeInto } from './support/dialog-flow.js';
import { provideStubResources } from './support/stub-resources.js';
import { RECORD } from './support/subscriber-record.js';

const SERVED = { 'invoices.read': true, 'invoices.cancel': true, 'payments.read': true };

const of = { invoiceId: 'i-1', number: 'AHP-2026-000001', issueDate: '2026-10-02' };
const rowOf = (
    number: string,
    overrides: Partial<AdminInvoiceRegisterRow> = {},
): AdminInvoiceRegisterRow => ({
    id: `i-${Number(number.slice(-6))}`,
    number,
    issueDate: '2026-10-02',
    correction: null,
    subscriber: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    tenantId: 't-1',
    currency: 'EUR',
    totalNet: 100,
    totalTax: 19,
    totalGross: 119,
    documentArchived: true,
    cancelledBy: null,
    ...overrides,
});

const ROWS = [
    rowOf('AHP-2026-000001', { cancelledBy: { invoiceId: 'i-3', number: 'AHP-2026-000003' } }),
    rowOf('AHP-2026-000002', {
        issueDate: '2026-10-05',
        subscriber: { id: 's-2', customerNumber: 'K-10002', legalName: 'Fabrikam GmbH' },
        documentArchived: false,
    }),
    rowOf('AHP-2026-000003', {
        issueDate: '2026-10-09',
        correction: { kind: 'cancellation', of },
        totalNet: -100,
        totalTax: -19,
        totalGross: -119,
    }),
];

const total = (rate: number, net: number, tax: number, gross: number) => ({
    currency: 'EUR',
    kind: 'standard' as const,
    rate,
    net,
    tax,
    gross,
});

const totalsOf = (from: string, until: string): AdminInvoiceRegisterTotals => ({
    from,
    until,
    months: [
        { month: from, totals: [total(19, 100, 19, 119)] },
        ...(from === until ? [] : [{ month: until, totals: [] }]),
    ],
    range: [total(19, 100, 19, 119)],
});

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

type Call = [string, ...unknown[]];

const ARCHIVE_NAME = 'invoices-2026-10-2026-10-as-of-2026-10-27T13-55-00-en.zip';

async function mountRegister({
    capabilities = SERVED,
    rows = ROWS,
    standardPageRoute = standardPageRouteOf(undefined),
    exportRefusal = null,
}: {
    capabilities?: Record<string, boolean>;
    rows?: AdminInvoiceRegisterRow[];
    standardPageRoute?: StandardPageRoute;
    exportRefusal?: AdminError | null;
} = {}) {
    const calls: Call[] = [];
    const notices: Array<[string, string]> = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/invoices', component: InvoicesPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/invoices');
    await router.isReady();
    const manifest = { capabilities, navigation: { standardPages: {}, projectPages: [] } };
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
                ...provideStubResources({
                    invoices: {
                        list: async (request: InvoiceRegisterRequest) => {
                            calls.push(['list', request]);
                            const from = request.from ?? request.until ?? '2026-10';
                            return {
                                from,
                                until: request.until ?? from,
                                invoices: rows,
                                next: null,
                            };
                        },
                        totals: async (months: InvoiceRegisterRequest) => {
                            calls.push(['totals', months]);
                            const from = months.from ?? months.until ?? '2026-10';
                            return totalsOf(from, months.until ?? from);
                        },
                        export: async (query: InvoiceExportQuery) => {
                            calls.push(['export', query]);
                            if (exportRefusal) throw exportRefusal;
                            return {
                                content: Uint8Array.from([0x50, 0x4b]),
                                mediaType: 'application/zip',
                                fileName: ARCHIVE_NAME,
                            };
                        },
                    },
                    subscribers: {
                        record: async (id: string) => {
                            calls.push(['record', id]);
                            return RECORD;
                        },
                        invoice: async (id: string) => ({
                            id,
                            number: 'AHP-2026-000002',
                            issuedAt: '2026-10-05T09:00:00.000Z',
                            dueDate: '2026-10-19',
                            currency: 'EUR',
                            totalNet: 100,
                            totalTax: 19,
                            totalGross: 119,
                            lines: [],
                        }),
                        previewInvoiceCancellation: async () => ({
                            cancelled: {
                                number: 'AHP-2026-000002',
                                currency: 'EUR',
                                subscriber: RECORD.subscriber,
                            },
                            cancellation: { totalGross: 119 },
                            replacement: null,
                            lines: [],
                            movedIn: 0,
                            credited: 0,
                            reason: 'Wrong address.',
                            deliverTo: null,
                            digest: 'd'.repeat(64),
                        }),
                        cancelInvoice: async (...args: unknown[]) => {
                            calls.push(['cancel', ...args]);
                            return {
                                cancellationInvoice: { number: 'AHP-2026-000004' },
                                replacement: null,
                                credits: [],
                            };
                        },
                    },
                }),
                [manifestKey]: () => manifest,
                [notifyKey]: (kind: string, message: string) => notices.push([kind, message]),
                [STANDARD_PAGE_ROUTES_KEY]: standardPageRoute,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, calls, notices };
}

type Mounted = Awaited<ReturnType<typeof mountRegister>>['wrapper'];

/** The cells of the section headed `title`, row by row. */
function tableOf(wrapper: Mounted, title: string): string[][] {
    const section = wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === title);
    expect(section, `no section ${title}`).toBeTruthy();
    return (section?.findAll('tbody tr') ?? []).map((row) =>
        row.findAll('td, q-td').map((cell) => cell.text()),
    );
}

/** The month field labelled `label`. */
function monthField(wrapper: Mounted, label: string) {
    const field = wrapper
        .findAll('.q-field')
        .find((candidate) => candidate.find('.q-field__label').text() === label);
    expect(field, `no field ${label}`).toBeTruthy();
    return field!;
}

/** Types `month` into the field labelled `label`, and lets its debounce pass. */
async function pick(wrapper: Mounted, label: string, month: string): Promise<void> {
    await monthField(wrapper, label).find('input').setValue(month);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
}

describe('the register of invoices', () => {
    test('reads the platform’s current month once, and shows the months it answered', async () => {
        const { wrapper, calls } = await mountRegister();

        expect(calls).toEqual([
            ['list', {}],
            ['totals', {}],
        ]);
        expect(monthField(wrapper, 'From (month)').find('input').element.value).toBe('2026-10');
        expect(monthField(wrapper, 'Until (month)').find('input').element.value).toBe('2026-10');
    });

    test('adds up each month per treatment and rate, and the whole span beneath', async () => {
        const { wrapper } = await mountRegister();
        await pick(wrapper, 'Until (month)', '2026-11');

        expect(tableOf(wrapper, 'Totals')).toEqual([
            ['2026-10', '19 % VAT', '€100', '€19', '€119'],
            ['2026-11', 'No invoice', '', '', ''],
            ['Total 2026-10 to 2026-11', '19 % VAT', '€100', '€19', '€119'],
        ]);
    });

    test('lists each invoice with how it stands, its subscriber and amounts, and whether its document is archived', async () => {
        const { wrapper } = await mountRegister();

        expect(tableOf(wrapper, 'Issued invoices').map((cells) => cells.slice(0, 8))).toEqual([
            [
                'AHP-2026-000001',
                '2026-10-02',
                'Cancelled by AHP-2026-000003',
                'K-10001 · Northwind GmbH',
                '€100',
                '€19',
                '€119',
                'archived',
            ],
            [
                'AHP-2026-000002',
                '2026-10-05',
                '',
                'K-10002 · Fabrikam GmbH',
                '€100',
                '€19',
                '€119',
                'awaited',
            ],
            [
                'AHP-2026-000003',
                '2026-10-09',
                'Cancellation invoice for AHP-2026-000001',
                'K-10001 · Northwind GmbH',
                '-€100',
                '-€19',
                '-€119',
                'archived',
            ],
        ]);
    });

    test('leads into a subscriber’s record wherever the shell put the subscribers', async () => {
        const { wrapper } = await mountRegister({
            standardPageRoute: standardPageRouteOf({ subscribers: '/backoffice/parties' }),
        });

        const link = wrapper.find('a[aria-label="Open the record of K-10002"]');
        expect(link.attributes('href')).toBe('/backoffice/parties/s-2');
    });

    test('asks again for the months picked, and refuses months it cannot read without asking', async () => {
        const { wrapper, calls } = await mountRegister();

        await pick(wrapper, 'From (month)', '2026-07');
        await pick(wrapper, 'Until (month)', '2026-09');
        expect(calls.slice(-2)).toEqual([
            ['list', { from: '2026-07', until: '2026-09' }],
            ['totals', { from: '2026-07', until: '2026-09' }],
        ]);

        const asked = calls.length;
        await pick(wrapper, 'Until (month)', '2027-09');
        expect(calls.length).toBe(asked);
        expect(monthField(wrapper, 'Until (month)').text()).toContain(
            'The register shows at most 12 months at a time, and 2026-07 to 2027-09 spans 15.',
        );
    });

    test('says so where no invoice was issued in the months', async () => {
        const { wrapper } = await mountRegister({ rows: [] });

        expect(wrapper.text()).toContain('No invoice was issued in these months.');
    });

    test('offers cancelling where an invoice stands and the platform serves it, and nowhere else', async () => {
        const offered = async (capabilities: Record<string, boolean>) => {
            const { wrapper } = await mountRegister({ capabilities });
            return ['AHP-2026-000001', 'AHP-2026-000002', 'AHP-2026-000003'].filter((number) =>
                wrapper.find(`button[aria-label="Cancel invoice ${number}"]`).exists(),
            );
        };

        expect(await offered(SERVED)).toEqual(['AHP-2026-000002']);
        expect(await offered({ 'invoices.read': true, 'payments.read': true })).toEqual([]);
    });
});

// @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
describe('an invoice cancelled from the register', () => {
    test('reads the subscriber’s record each time the dialog opens, for the same subscriber too', async () => {
        const { wrapper, calls } = await mountRegister();
        const open = async () => {
            await wrapper
                .find('button[aria-label="Cancel invoice AHP-2026-000002"]')
                .trigger('click');
            await settle();
        };

        await open();
        dialog()
            .node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__actions button')[0]
            ?.click();
        await settle();
        await open();

        // The record may have been corrected in between; what the dialog
        // offers to take over is the record as it is when it opens.
        expect(calls.filter(([what]) => what === 'record')).toEqual([
            ['record', 's-2'],
            ['record', 's-2'],
        ]);
    });

    test('reads its subscriber’s record for the dialog, is confirmed behind the second factor, and the register read again', async () => {
        const { wrapper, calls, notices } = await mountRegister();

        await wrapper.find('button[aria-label="Cancel invoice AHP-2026-000002"]').trigger('click');
        await settle();
        expect(calls.filter(([what]) => what === 'record')).toEqual([['record', 's-2']]);
        expect(dialog().node?.textContent).toContain('Cancel invoice AHP-2026-000002');

        await typeInto('Reason', 'Wrong address.');
        [
            ...(dialog().node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__actions button') ??
                []),
        ]
            .find((button) => button.textContent?.trim() === 'Show preview')
            ?.click();
        await settle();
        [
            ...(dialog().node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__actions button') ??
                []),
        ]
            .find((button) => button.textContent?.trim() === 'Cancel invoice')
            ?.click();
        const asked = calls.length;
        await enterTheCode('123456');

        expect(calls.filter(([what]) => what === 'cancel').map(([, id]) => id)).toEqual(['i-2']);
        expect(notices).toEqual([
            [
                'positive',
                'Cancelled by AHP-2026-000004. Nothing of it is owed any more, so there is no replacement.',
            ],
        ]);
        expect(calls.slice(asked).map(([what]) => what)).toEqual(['cancel', 'list', 'totals']);
    });
});

// @requirement SC-ADM-047 — The invoice register's export is one archive whose bytes repeat
describe('the invoices exported for a tax advisor', () => {
    const saved: Array<{ name: string; type: string }> = [];
    beforeEach(() => {
        let made: Blob | null = null;
        // jsdom has no object URLs, and a followed link would navigate.
        URL.createObjectURL = vi.fn((blob: Blob) => {
            made = blob;
            return 'blob:archive';
        });
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            if (made) saved.push({ name: this.download, type: made.type });
        });
    });
    afterEach(() => {
        saved.length = 0;
        vi.restoreAllMocks();
    });

    const exportButton = (wrapper: Mounted) => {
        // The label stands beside the icon, whose name Quasar renders as text.
        const button = wrapper
            .findAll('button')
            .find(
                (each) => each.find('.block').exists() && each.find('.block').text() === 'Export',
            );
        expect(button, 'no export button').toBeTruthy();
        return button!;
    };
    const exportsAsked = (calls: Call[]) => calls.filter(([name]) => name === 'export');
    const pickLanguage = async (label: string) => {
        const choice = [
            ...(dialog().node?.querySelectorAll<HTMLButtonElement>('[role="group"] button') ?? []),
        ].find((each) => each.textContent?.includes(label));
        expect(choice, `no language ${label}`).toBeTruthy();
        choice?.click();
        await settle();
        expect(choice?.getAttribute('aria-pressed')).toBe('true');
    };

    test('downloads the months the register shows, as of five minutes ago in the screen’s language', async () => {
        const { wrapper, calls, notices } = await mountRegister();

        await exportButton(wrapper).trigger('click');
        await settle();
        expect(dialog().node?.textContent).toContain('The invoices of 2026-10 to 2026-10');
        dialog().submit?.click();
        await settle();

        expect(exportsAsked(calls)).toEqual([
            ['export', { from: '2026-10', until: '2026-10', asOf: undefined, locale: 'en' }],
        ]);
        expect(saved).toEqual([{ name: ARCHIVE_NAME, type: 'application/zip' }]);
        expect(notices).toEqual([
            [
                'positive',
                'The export was downloaded. Its file name names the months, the moment and the language.',
            ],
        ]);
        expect(dialog().node).toBeUndefined();
    });

    test('as of the moment and in the language picked, and starts again from five minutes ago when opened again', async () => {
        const { wrapper, calls } = await mountRegister();

        await exportButton(wrapper).trigger('click');
        await settle();
        await typeInto('As of (day and time)', '2026-10-20T12:00');
        await pickLanguage('German');
        dialog().submit?.click();
        await settle();
        await exportButton(wrapper).trigger('click');
        await settle();

        expect(exportsAsked(calls)).toEqual([
            [
                'export',
                { from: '2026-10', until: '2026-10', asOf: '2026-10-20T12:00', locale: 'de' },
            ],
        ]);
        expect(fieldOf('As of (day and time)').value).toBe('');
        dialog().submit?.click();
        await settle();
        expect(exportsAsked(calls).at(-1)).toEqual([
            'export',
            { from: '2026-10', until: '2026-10', asOf: undefined, locale: 'en' },
        ]);
    });

    test('refused, says why in the dialog, which stays open, and saves nothing', async () => {
        const { wrapper, notices } = await mountRegister({
            exportRefusal: new AdminError({
                status: 422,
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE,
                body: {
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE,
                    params: { asOf: '2026-10-27T14:00:00', latest: '2026-10-27T13:55:00' },
                },
            }),
        });

        await exportButton(wrapper).trigger('click');
        await settle();
        await typeInto('As of (day and time)', '2026-10-27T14:00');
        dialog().submit?.click();
        await settle();

        expect(dialog().node?.textContent).toContain(
            'An export is taken as of 2026-10-27T13:55:00 at the latest',
        );
        expect(saved).toEqual([]);
        expect(notices.filter(([kind]) => kind === 'positive')).toEqual([]);
    });

    test('is not offered for months the register cannot read', async () => {
        const { wrapper } = await mountRegister();

        await pick(wrapper, 'From (month)', '2026-12');

        expect(exportButton(wrapper).attributes('disabled')).toBeDefined();
    });
});
