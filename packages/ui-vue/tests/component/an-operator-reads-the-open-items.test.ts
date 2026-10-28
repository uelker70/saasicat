// The operator reads the open items: what is owed and overdue per currency and
// what credits hold, the invoices that still owe — all, or the overdue ones —
// with how each is paid and its last collection, each leading into its
// subscriber's record, and the credits still owed, paid out from their row
// behind the second factor.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is asked.

// @requirement SC-ADM-044 — An operator lists what subscribers still owe and are still owed, across every tenant

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { AdminOpenCredit, AdminOpenInvoice } from '@saasicat/core';

import { standardPageRouteOf } from '../../src/client/nav-builder.js';
import type { OpenInvoicesRequest } from '../../src/client/resources/open-items.resource.js';
import OpenItemsPage from '../../src/pages/OpenItemsPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import {
    STANDARD_PAGE_ROUTES_KEY,
    type StandardPageRoute,
} from '../../src/vue/standard-page-routes.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { dialog, enterTheCode, settle, typeInto } from './support/dialog-flow.js';
import { provideStubResources } from './support/stub-resources.js';

const PAYING = { 'payments.read': true, 'credits.read': true, 'credits.payout': true };

const INVOICES: AdminOpenInvoice[] = [
    {
        id: 'i-1',
        number: 'AHP-2026-000001',
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        daysOverdue: 12,
        currency: 'EUR',
        totalGross: 119,
        owed: 100,
        subscriber: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
        tenantId: 't-1',
        payment: { type: 'sepa_debit', last4: '3000' },
        lastAttempt: {
            status: 'FAILED',
            submittedAt: '2026-10-15T06:00:00.000Z',
            failureReason: 'insufficient-funds',
        },
    },
    {
        id: 'i-2',
        number: 'AHP-2026-000002',
        issueDate: '2026-10-20',
        dueDate: '2026-11-03',
        daysOverdue: 0,
        currency: 'EUR',
        totalGross: 59.5,
        owed: 59.5,
        subscriber: { id: 's-2', customerNumber: 'K-10002', legalName: 'Fabrikam GmbH' },
        tenantId: 't-2',
        payment: null,
        lastAttempt: null,
    },
];

const CREDITS: AdminOpenCredit[] = [
    {
        id: 'c-1',
        currency: 'EUR',
        amount: 30,
        open: 20,
        origin: 'payment',
        createdAt: '2026-10-02T09:00:00.000Z',
        subscriber: { id: 's-2', customerNumber: 'K-10002', legalName: 'Fabrikam GmbH' },
        tenantId: 't-2',
    },
];

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

type Call = [string, ...unknown[]];

async function mountOpenItems({
    capabilities = PAYING,
    invoices = INVOICES,
    credits = CREDITS,
    totals = {
        today: '2026-10-27',
        invoices: [{ currency: 'EUR', owed: 159.5, overdue: 100 }],
        credits: [{ currency: 'EUR', open: 20 }],
    },
    standardPageRoute = standardPageRouteOf(undefined),
    timeZone,
}: {
    capabilities?: Record<string, boolean>;
    invoices?: AdminOpenInvoice[];
    credits?: AdminOpenCredit[];
    totals?: unknown;
    standardPageRoute?: StandardPageRoute;
    /** The installation's zone, as the manifest names it; none where left out. */
    timeZone?: string;
} = {}) {
    const calls: Call[] = [];
    const notices: Array<[string, string]> = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/open-items', component: OpenItemsPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/open-items');
    await router.isReady();
    const manifest = {
        capabilities,
        navigation: { standardPages: {}, projectPages: [] },
        timeZone,
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
                ...provideStubResources({
                    openItems: {
                        invoices: async (request: OpenInvoicesRequest) => {
                            calls.push(['invoices', request]);
                            return {
                                today: '2026-10-27',
                                overdueOnly: Boolean(request.overdue),
                                invoices: request.overdue
                                    ? invoices.filter((each) => each.daysOverdue > 0)
                                    : invoices,
                                next: null,
                            };
                        },
                        credits: async (request: unknown) => {
                            calls.push(['credits', request]);
                            return { credits, next: null, timeZone: 'Europe/Berlin' };
                        },
                        totals: async () => {
                            calls.push(['totals']);
                            return totals;
                        },
                    },
                    subscribers: {
                        recordPayout: async (...args: unknown[]) => {
                            calls.push(['payout', ...args]);
                            return { credits: [], timeZone: 'Europe/Berlin' };
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

type Mounted = Awaited<ReturnType<typeof mountOpenItems>>['wrapper'];

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

describe('the open items', () => {
    test('read each list and the totals once, and say per currency what is owed, overdue and held as credit', async () => {
        const { wrapper, calls } = await mountOpenItems();

        expect(calls).toEqual([['invoices', { overdue: false }], ['credits', {}], ['totals']]);
        const tiles = wrapper.findAll('.sa-kpi').map((tile) => tile.text());
        expect(tiles).toEqual([
            expect.stringContaining('Owed (EUR)'),
            expect.stringContaining('Of it overdue (EUR)'),
            expect.stringContaining('Credits open (EUR)'),
        ]);
        expect(tiles.join(' ')).toContain('€159.50');
    });

    test('list each open invoice with what it owes, the days it is overdue, how it is paid and its last collection', async () => {
        const { wrapper } = await mountOpenItems();

        expect(tableOf(wrapper, 'Open invoices').map((cells) => cells.slice(0, 8))).toEqual([
            [
                'AHP-2026-000001',
                '2026-10-15',
                '12',
                'K-10001 · Northwind GmbH',
                '€119',
                '€100',
                'Direct debit ···3000',
                'failed: insufficient funds',
            ],
            [
                'AHP-2026-000002',
                '2026-11-03',
                '—',
                'K-10002 · Fabrikam GmbH',
                '€59.50',
                '€59.50',
                'Bank transfer',
                'none',
            ],
        ]);
    });

    test('lead into a subscriber’s record wherever the shell put the subscribers', async () => {
        const { wrapper } = await mountOpenItems({
            standardPageRoute: standardPageRouteOf({ subscribers: '/backoffice/parties' }),
        });

        const links = wrapper.findAll('a[aria-label="Open the record of K-10002"]');
        expect(links.map((link) => link.attributes('href'))).toEqual([
            '/backoffice/parties/s-2',
            '/backoffice/parties/s-2',
        ]);
    });

    test('overdue alone asks for those again, and reads neither the credits nor the totals anew', async () => {
        const { wrapper, calls } = await mountOpenItems();

        await wrapper.find('.q-toggle').trigger('click');
        await settle();

        expect(calls.slice(3)).toEqual([['invoices', { overdue: true }]]);
        expect(tableOf(wrapper, 'Open invoices').map((cells) => cells[0])).toEqual([
            'AHP-2026-000001',
        ]);
    });

    test('say so where nothing is open', async () => {
        const { wrapper } = await mountOpenItems({
            invoices: [],
            credits: [],
            totals: { today: '2026-10-27', invoices: [], credits: [] },
        });

        expect(wrapper.text()).toContain('No open invoice.');
        expect(wrapper.text()).toContain('No open credit.');
        expect(wrapper.find('.sa-kpi').text()).toContain('Nothing open');
    });

    test('list each open credit with its origin, and offer its payout only where the platform takes one', async () => {
        const paying = await mountOpenItems();
        expect(tableOf(paying.wrapper, 'Open credits').map((cells) => cells.slice(0, 5))).toEqual([
            ['K-10002 · Fabrikam GmbH', 'A payment beyond its invoice', '2026-10-02', '€30', '€20'],
        ]);
        expect(
            paying.wrapper.find('button[aria-label="Record a payout to K-10002"]').exists(),
        ).toBe(true);
        paying.wrapper.unmount();
        mounted.pop();

        const reading = await mountOpenItems({
            capabilities: { 'payments.read': true, 'credits.read': true },
        });
        expect(
            reading.wrapper.find('button[aria-label="Record a payout to K-10002"]').exists(),
        ).toBe(false);
    });
});

// @requirement SC-ADM-048 — Every day the administration shows is a day of the installation
describe('the open items’ days', () => {
    // 00:30 on 2 November in Berlin, still 1 November in UTC.
    const LATE = '2026-11-01T23:30:00.000Z';
    const sentLate = (): AdminOpenInvoice[] => [
        {
            ...INVOICES[0]!,
            lastAttempt: { status: 'SUBMITTED', submittedAt: LATE, failureReason: null },
        },
    ];

    for (const [timeZone, day] of [
        ['Europe/Berlin', '2026-11-02'],
        [undefined, '2026-11-01'],
    ] as const) {
        test(`are the days of ${timeZone ?? 'UTC, where the manifest names no zone'}: ${day}`, async () => {
            const { wrapper } = await mountOpenItems({
                invoices: sentLate(),
                credits: [{ ...CREDITS[0]!, createdAt: LATE }],
                timeZone,
            });

            expect(tableOf(wrapper, 'Open invoices')[0]?.[7]).toContain(day);
            expect(tableOf(wrapper, 'Open credits')[0]?.[2]).toBe(day);
        });
    }
});

// @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
describe('a credit paid out from the open items', () => {
    test('is recorded for its subscriber behind the second factor, and the credits and totals are read again', async () => {
        const { wrapper, calls, notices } = await mountOpenItems();

        await wrapper.find('button[aria-label="Record a payout to K-10002"]').trigger('click');
        await settle();
        expect(dialog().node?.textContent).toContain('€20');
        await typeInto('Reference', 'TRF-77');
        dialog().submit?.click();
        const asked = calls.length;
        await enterTheCode('123456');

        const [payout] = calls.filter(([what]) => what === 'payout');
        expect(payout?.slice(1, 3)).toEqual(['s-2', 'c-1']);
        expect(payout?.[3]).toMatchObject({ amount: 20, reference: 'TRF-77' });
        expect(payout?.[4]).toBe('123456');
        expect(notices).toEqual([['positive', 'Payout recorded.']]);
        expect(
            calls
                .slice(asked)
                .map(([what]) => what)
                .sort(),
        ).toEqual(['credits', 'payout', 'totals']);
    });
});
