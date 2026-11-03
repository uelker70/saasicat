// @requirement SC-UI-022 — A tenant downloads its subscription's invoices and tells them from the application's
// @requirement SC-UI-024 — A tenant's invoice list says what each invoice stands for

import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { TenantInvoice } from '@saasicat/core';
import type { HttpClient } from '@saasicat/ui-vue';

import TenantBillingSection from '../../src/TenantBillingSection.vue';
import { dayAsInstant } from '../../src/day-as-instant';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

// The invoices the operator issues the tenant, in its billing section: each
// with what it stands for, the links between a cancelled invoice, its
// cancellation and its replacement, the archived document once it is there,
// and the contract confirmations beside them.

const i18n = defaultTenantPlanSectionI18n('en');
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB');
const formatCurrency = (amount: number) => `€${amount.toFixed(2)}`;
/** A day as the page writes it. */
const written = (day: string) => formatDate(dayAsInstant(day));
const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce(
        (text, [key, value]) => text.split(`{${key}}`).join(value),
        template,
    );

const ISSUER = { legalName: 'Systemhaus Nord GmbH' };
const of = (id: string) => ({ invoiceId: id, number: `R-${id}` });

const invoice = (id: string, overrides: Partial<TenantInvoice> = {}): TenantInvoice => ({
    id,
    number: `R-${id}`,
    issueDate: '2026-06-01',
    servicePeriod: { from: '2026-06-01', until: '2026-06-30' },
    dueDate: '2026-06-15',
    totalGross: 49,
    currency: 'EUR',
    issuer: ISSUER,
    correction: null,
    cancelledBy: null,
    replacedBy: null,
    payment: null,
    documentArchived: true,
    ...overrides,
});

/** A replacement owing part, its cancellation invoice, the one cancelled, and one paid without its document yet. */
const PAGE = {
    invoices: [
        invoice('3', {
            totalGross: 39,
            correction: { kind: 'replacement', of: of('1') },
            payment: { kind: 'open', owed: 20, overdue: false },
        }),
        invoice('2', { totalGross: -49, correction: { kind: 'cancellation', of: of('1') } }),
        invoice('1', { cancelledBy: of('2'), replacedBy: of('3') }),
        invoice('0', { payment: { kind: 'paid', on: '2026-07-01' }, documentArchived: false }),
    ],
    next: null,
};

const CONFIRMATIONS = {
    confirmations: [
        {
            contractId: 'c-2',
            concludedOn: '2026-07-01',
            firstDay: '2026-07-01',
            planTitle: 'Pro',
            archived: true,
        },
        {
            contractId: 'c-3',
            concludedOn: '2026-07-02',
            firstDay: '2026-08-01',
            planTitle: null,
            archived: false,
        },
    ],
};

type Answer = [number, unknown];

/** Answers by path; a request nobody scripted is a 404, and every one is recorded. */
function httpRouting(routes: Record<string, Answer>) {
    const calls: string[] = [];
    const http: HttpClient = async (url) => {
        calls.push(url);
        const [status, body] = routes[url] ?? [404, {}];
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
            bytes: async () => new TextEncoder().encode(JSON.stringify(body)),
        };
    };
    return { http, calls };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountSection(routes: Record<string, Answer>) {
    const { http, calls } = httpRouting(routes);
    const wrapper = mount(TenantBillingSection, {
        props: { http, formatDate, formatCurrency },
        attachTo: document.body,
    });
    // SAFETY: `mount` types a wrapper by its component's props; the list holds
    // wrappers of any component and only ever unmounts them.
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return { wrapper, calls };
}

/** The cells of the row of invoice `id`, by column. */
function rowOf(wrapper: VueWrapper, id: string) {
    const row = wrapper.find(`tr#sp-invoice-${id}`);
    expect(row.exists(), `no row for invoice ${id}`).toBe(true);
    const cells = row.findAll('td');
    return { row, cells: cells.map((cell) => cell.text()), standing: cells[5] };
}

describe("the tenant's invoices", () => {
    test('stand under their own heading, named by who issued them', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [200, PAGE],
            '/billing/contracts': [200, CONFIRMATIONS],
        });

        expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
            i18n.invoicesTitle,
            i18n.confirmationsTitle,
        ]);
        expect(wrapper.find('.sp-invoices__sub').text()).toBe(
            fill(i18n.invoicesIssuedBy, { issuer: ISSUER.legalName }),
        );
        expect(wrapper.find('.sp-invoices__issuer').exists()).toBe(false);
        // The payment method and the billing details are not served here: the
        // invoices alone make the section show.
        expect(wrapper.find('.sp-card').isVisible()).toBe(true);
    });

    test('name each its own issuer where more than one issued them', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [
                200,
                {
                    invoices: [
                        invoice('2', { issuer: { legalName: 'Systemhaus Süd GmbH' } }),
                        invoice('1'),
                    ],
                    next: null,
                },
            ],
            '/billing/contracts': [200, { confirmations: [] }],
        });

        expect(wrapper.findAll('.sp-invoices__issuer').map((issuer) => issuer.text())).toEqual([
            fill(i18n.invoicesIssuedBy, { issuer: 'Systemhaus Süd GmbH' }),
            fill(i18n.invoicesIssuedBy, { issuer: ISSUER.legalName }),
        ]);
        expect(wrapper.findAll('p.sp-invoices__sub').map((line) => line.text())).not.toContain(
            fill(i18n.invoicesIssuedBy, { issuer: ISSUER.legalName }),
        );
    });

    test('show number, issue date, period, due date and total, each day as the page writes days', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [200, PAGE],
            '/billing/contracts': [200, CONFIRMATIONS],
        });

        expect(rowOf(wrapper, '0').cells.slice(0, 5)).toEqual([
            'R-0',
            written('2026-06-01'),
            fill(i18n.invoicesPeriod, {
                from: written('2026-06-01'),
                until: written('2026-06-30'),
            }),
            written('2026-06-15'),
            '€49.00',
        ]);
    });

    test('say where each stands, a payment paid on the day the server names', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [200, PAGE],
            '/billing/contracts': [200, CONFIRMATIONS],
        });

        expect(rowOf(wrapper, '0').cells[5]).toBe(
            fill(i18n.invoicePaymentPaid, { day: written('2026-07-01') }),
        );
        expect(rowOf(wrapper, '3').cells[5]).toContain(
            fill(i18n.invoicePaymentOpenPart, { owed: '€20.00', total: '€39.00' }),
        );
    });

    test('link a cancelled invoice to its cancellation and its replacement, and each of those back', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [200, PAGE],
            '/billing/contracts': [200, CONFIRMATIONS],
        });
        const linksOf = (id: string) =>
            rowOf(wrapper, id)
                .standing!.findAll('a')
                .map((link) => [link.text(), link.attributes('href')]);

        expect(rowOf(wrapper, '1').cells[5]).toBe(
            `${fill(i18n.invoiceCancelledBy, { number: 'R-2' })}${fill(i18n.invoiceReplacedBy, { number: 'R-3' })}`,
        );
        expect(linksOf('1')).toEqual([
            ['R-2', '#sp-invoice-2'],
            ['R-3', '#sp-invoice-3'],
        ]);
        expect(linksOf('2')).toEqual([['R-1', '#sp-invoice-1']]);
        expect(linksOf('3')).toEqual([['R-1', '#sp-invoice-1']]);
        expect(rowOf(wrapper, '2').cells[5]).toBe(
            fill(i18n.invoiceCancellationOf, { number: 'R-1' }),
        );
    });

    test('lead from a link to an invoice on a page not read yet, reading it first', async () => {
        const { wrapper, calls } = await mountSection({
            '/billing/invoices': [
                200,
                {
                    invoices: [invoice('9', { correction: { kind: 'replacement', of: of('1') } })],
                    next: '9',
                },
            ],
            '/billing/invoices?after=9': [
                200,
                { invoices: [invoice('1', { replacedBy: of('9') })], next: null },
            ],
            '/billing/contracts': [200, { confirmations: [] }],
        });

        await rowOf(wrapper, '9').standing!.find('a').trigger('click');
        await flushPromises();

        expect(calls).toContain('/billing/invoices?after=9');
        expect(document.activeElement?.id).toBe('sp-invoice-1');
    });

    test('offer the document once it is archived, and say it follows until then', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [200, PAGE],
            '/billing/contracts': [200, CONFIRMATIONS],
        });

        const archived = rowOf(wrapper, '1').row.find('button');
        expect(archived.attributes('aria-label')).toBe(
            fill(i18n.invoicesDownloadInvoice, { number: 'R-1' }),
        );
        expect(rowOf(wrapper, '0').row.find('button').exists()).toBe(false);
        expect(rowOf(wrapper, '0').cells[6]).toBe(i18n.invoicesDocumentFollows);
    });

    test('say so where a document could not be downloaded, and keep the list', async () => {
        const { wrapper, calls } = await mountSection({
            '/billing/invoices': [200, PAGE],
            '/billing/contracts': [200, CONFIRMATIONS],
        });

        await rowOf(wrapper, '1').row.find('button').trigger('click');
        await flushPromises();

        expect(calls).toContain('/billing/invoices/1/document');
        expect(wrapper.find('[role="alert"]').text()).toBe(i18n.invoicesDownloadFailed);
        expect(wrapper.findAll('tbody tr')).toHaveLength(4);
    });

    test('go on with the next page below the first, where there is one', async () => {
        const { wrapper, calls } = await mountSection({
            '/billing/invoices': [200, { invoices: [invoice('2')], next: '2' }],
            '/billing/invoices?after=2': [200, { invoices: [invoice('1')], next: null }],
            '/billing/contracts': [200, { confirmations: [] }],
        });

        const more = wrapper
            .findAll('button')
            .find((button) => button.text() === i18n.invoicesMore);
        await more!.trigger('click');
        await flushPromises();

        expect(calls).toContain('/billing/invoices?after=2');
        expect(wrapper.findAll('tbody tr').map((row) => row.attributes('id'))).toEqual([
            'sp-invoice-2',
            'sp-invoice-1',
        ]);
        expect(
            wrapper.findAll('button').some((button) => button.text() === i18n.invoicesMore),
        ).toBe(false);
    });

    test('that could not be read are said to be so', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [500, {}],
            '/billing/contracts': [200, { confirmations: [] }],
        });

        expect(wrapper.find('[role="alert"]').text()).toBe(i18n.invoicesLoadFailed);
    });
});

describe('the contract confirmations beside them', () => {
    test('name each contract and its days, and offer the archived ones for download', async () => {
        const { wrapper } = await mountSection({
            '/billing/invoices': [200, { invoices: [], next: null }],
            '/billing/contracts': [200, CONFIRMATIONS],
        });

        const items = wrapper.findAll('.sp-invoices__list li');
        expect(items.map((item) => item.find('span').text())).toEqual([
            fill(i18n.confirmationLine, {
                plan: 'Pro',
                concluded: written('2026-07-01'),
                firstDay: written('2026-07-01'),
            }),
            fill(i18n.confirmationLine, {
                plan: i18n.confirmationNoPlan,
                concluded: written('2026-07-02'),
                firstDay: written('2026-08-01'),
            }),
        ]);
        expect(items[0]!.find('button').attributes('aria-label')).toBe(
            fill(i18n.confirmationDownload, { concluded: written('2026-07-01') }),
        );
        expect(items[1]!.find('button').exists()).toBe(false);
        expect(items[1]!.text()).toContain(i18n.confirmationBeingMade);
        expect(wrapper.text()).toContain(i18n.invoicesEmpty);
    });
});
