// The tenant page says of each invoice what it stands in relation to, and
// cancels one that stands in two steps: what the operator gives, then what the
// server says the cancellation will write, confirmed behind the second factor.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is sent.

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
    INVOICE_ERROR_CODES,
    type AdminInvoiceCancellationPlan,
    type AdminTenantInvoice,
} from '@saasicat/core';

import { AdminError } from '../../src/client/admin-error.js';
import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { dialog, enterTheCode, fieldOf, settle, typeInto } from './support/dialog-flow.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'acme', name: 'Acme', isActive: true, users: [] };
const CODE = '123456';

const of = (number: string) => ({
    invoiceId: `invoice-${number.slice(-3)}`,
    number,
    issueDate: '2026-02-01',
});

const invoice = (number: string, overrides: Partial<AdminTenantInvoice> = {}) => ({
    id: `invoice-${number.slice(-3)}`,
    number,
    issuedAt: '2026-02-01T05:15:00.000Z',
    dueDate: '2026-02-15',
    totalGross: 119,
    currency: 'EUR',
    owed: 0,
    correction: null,
    cancelledBy: null,
    ...overrides,
});

/**
 * A replacement, its cancellation invoice, an invoice of its own, the one
 * cancelled, and an earlier replacement cancelled in turn.
 */
const PAYMENTS = {
    invoices: [
        invoice('AHP-2026-000141', {
            totalGross: 100,
            correction: { kind: 'replacement', of: of('AHP-2026-000123') },
        }),
        invoice('AHP-2026-000140', {
            correction: { kind: 'cancellation', of: of('AHP-2026-000123') },
        }),
        invoice('AHP-2026-000124'),
        invoice('AHP-2026-000123', {
            cancelledBy: { invoiceId: 'invoice-140', number: 'AHP-2026-000140' },
        }),
        invoice('AHP-2026-000112', {
            correction: { kind: 'replacement', of: of('AHP-2026-000110') },
            cancelledBy: { invoiceId: 'invoice-113', number: 'AHP-2026-000113' },
        }),
    ],
    openCases: [],
};

const PARTY = {
    customerNumber: 'K-1',
    legalName: 'Acme GmbH',
    vatId: 'ATU12345678',
    taxNumber: null,
    addressLine1: 'Hauptstraße 5',
    addressLine2: 'c/o Müller',
    postalCode: '20095',
    city: 'Hamburg',
    country: 'AT',
};

const RECORD = {
    subscriber: {
        id: 'subscriber-1',
        ...PARTY,
        addressLine2: null,
        business: true,
        vatIdValidated: true,
        migrated: false,
    },
    readiness: null,
};

const planOf = (
    overrides: Partial<Pick<AdminInvoiceCancellationPlan, 'movedIn' | 'credited'>> = {},
) => ({
    cancelled: { number: 'AHP-2026-000124', currency: 'EUR', subscriber: PARTY },
    cancellation: { totalGross: 119 },
    replacement: {
        issueDate: '2026-03-20',
        dueDate: '2026-04-03',
        totalNet: 100,
        totalTax: 0,
        totalGross: 100,
        taxTreatment: { kind: 'reverse-charge', rate: 0 },
        subscriber: { ...PARTY, addressLine2: null, city: 'Bremen' },
    },
    movedIn: 100,
    credited: 19,
    reason: 'The billing address was wrong.',
    deliverTo: null,
    digest: 'd'.repeat(64),
    ...overrides,
});

const CANCELLED = {
    cancellationInvoice: { number: 'AHP-2026-000142' },
    replacement: { number: 'AHP-2026-000143', paidOnIssue: 100 },
    credits: [{ amount: 19 }],
};

const CANCELLING = {
    capabilities: { 'payments.read': true, 'invoices.cancel': true, 'subscribers.read': true },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

type Call = [string, ...unknown[]];

async function mountPage({
    manifest = CANCELLING,
    cancelWith,
}: { manifest?: unknown; cancelWith?: () => never } = {}) {
    const calls: Call[] = [];
    const notices: Array<[string, string]> = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/acme');
    await router.isReady();
    const tenants = {
        detail: async () => TENANT,
        payments: async (...args: unknown[]) => {
            calls.push(['payments', ...args]);
            return PAYMENTS;
        },
        subscriber: async () => RECORD,
        previewInvoiceCancellation: async (...args: unknown[]) => {
            calls.push(['preview', ...args]);
            return planOf();
        },
        cancelInvoice: async (...args: unknown[]) => {
            calls.push(['cancel', ...args]);
            return cancelWith ? cancelWith() : CANCELLED;
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
    return { wrapper, calls, notices };
}

type Mounted = Awaited<ReturnType<typeof mountPage>>['wrapper'];

/** The rows of the invoice table: number, relation, and whether it offers cancelling. */
function invoiceRows(wrapper: Mounted): [string, string, boolean][] {
    const section = wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === 'Payments');
    const table = section?.findAll('.sa-table')[0];
    expect(table, 'no invoice table').toBeTruthy();
    return (table?.findAll('tbody tr') ?? []).map((row) => {
        const cells = row.findAll('td').map((cell) => cell.text());
        return [cells[0] ?? '', cells[1] ?? '', row.find('.sa-table__actions button').exists()];
    });
}

/** The cancel button at the invoice numbered `number`. */
function cancelAt(wrapper: Mounted, number: string) {
    const button = wrapper.find(`button[aria-label="Cancel invoice ${number}"]`);
    expect(button.exists(), `no cancel button at ${number}`).toBe(true);
    return button;
}

/** The dialog's buttons, by what they say. */
function dialogButton(label: string): HTMLButtonElement {
    const button = [
        ...(dialog().node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__actions button') ?? []),
    ].find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`no button ${label}`);
    return button;
}

/** Opens the dialog's section of the replacement's details. */
async function openCorrections(): Promise<void> {
    dialog().node?.querySelector<HTMLElement>('.sa-accordion__trigger')?.click();
    await settle();
}

const REASON = 'The billing address was wrong.';

// @requirement SC-ADM-034 — Each invoice on the tenant page says what it corrects and what cancelled it
describe('the invoices on the tenant page', () => {
    test('say what each stands in relation to, and offer cancelling only where one stands', async () => {
        const { wrapper } = await mountPage();

        expect(invoiceRows(wrapper)).toEqual([
            ['AHP-2026-000141', 'Replaces AHP-2026-000123', true],
            ['AHP-2026-000140', 'Cancellation invoice for AHP-2026-000123', false],
            ['AHP-2026-000124', '', true],
            ['AHP-2026-000123', 'Cancelled by AHP-2026-000140', false],
            ['AHP-2026-000112', 'Replaces AHP-2026-000110 · Cancelled by AHP-2026-000113', false],
        ]);
    });

    test('offer no cancelling where the platform does not serve it', async () => {
        const { wrapper } = await mountPage({
            manifest: { capabilities: { 'payments.read': true } },
        });

        expect(invoiceRows(wrapper).some(([, , offered]) => offered)).toBe(false);
    });
});

// @requirement SC-UI-017 — A confirmation shows the answer to the question actually being asked
// @requirement SC-UI-009 — A destructive action says what it will destroy, by name
describe('an invoice cancelled from the tenant page', () => {
    test('names the invoice, and previews nothing before a reason is given', async () => {
        const { wrapper, calls } = await mountPage();

        await cancelAt(wrapper, 'AHP-2026-000124').trigger('click');
        await settle();

        expect(dialog().node?.textContent).toContain('Cancel invoice AHP-2026-000124');
        expect(dialogButton('Show preview').disabled).toBe(true);
        await typeInto('Reason', '   ');
        expect(dialogButton('Show preview').disabled).toBe(true);
        expect(calls.filter(([what]) => what === 'preview')).toEqual([]);
    });

    // @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
    test('previews what the reason and the corrections would write, the record’s values offered', async () => {
        const { wrapper, calls } = await mountPage();
        await cancelAt(wrapper, 'AHP-2026-000124').trigger('click');
        await settle();

        await typeInto('Reason', ` ${REASON} `);
        await openCorrections();
        expect(dialog().node?.textContent).toContain("On the customer's record: Hamburg");
        dialog()
            .node?.querySelector<HTMLButtonElement>(
                `button[aria-label="Take over Address line 2 from the customer's record"]`,
            )
            ?.click();
        await settle();
        await typeInto('City', 'Bremen');
        dialogButton('Show preview').click();
        await settle();

        expect(calls.filter(([what]) => what === 'preview')).toEqual([
            [
                'preview',
                'acme',
                'invoice-124',
                {
                    reason: REASON,
                    corrections: { addressLine2: null, city: 'Bremen' },
                    deliverTo: null,
                },
            ],
        ]);
        const shown = dialog().node?.textContent ?? '';
        for (const figure of [
            'Cancellation invoice€119',
            '€100 net · €0 VAT · €100 gross',
            'Issued on 03/20/2026, due on 04/03/2026',
            'reverse charge',
            'Taken over as paid€100',
            'Becomes a credit, to refund€19',
            'Bremen (on the invoice: Hamburg)',
            'none (on the invoice: c/o Müller)',
            "Delivered tothe invoice email on the customer's record",
        ]) {
            expect(shown).toContain(figure);
        }
    });

    // @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
    test('is confirmed behind the second factor with the preview’s digest, announced, and the invoices read again', async () => {
        const { wrapper, calls, notices } = await mountPage();
        await cancelAt(wrapper, 'AHP-2026-000124').trigger('click');
        await settle();
        await typeInto('Reason', REASON);
        dialogButton('Show preview').click();
        await settle();

        dialogButton('Cancel invoice').click();
        await enterTheCode(CODE);

        expect(calls.filter(([what]) => what === 'cancel')).toEqual([
            [
                'cancel',
                'acme',
                'invoice-124',
                {
                    reason: REASON,
                    deliverTo: null,
                    previewDigest: 'd'.repeat(64),
                },
                CODE,
            ],
        ]);
        expect(notices).toEqual([
            ['positive', 'Cancelled by AHP-2026-000142, replaced by AHP-2026-000143.'],
        ]);
        expect(calls.filter(([what]) => what === 'payments')).toHaveLength(2);
        expect(document.querySelector('.sa-dialog')).toBeNull();
    });

    test('goes back to what was entered, the preview discarded', async () => {
        const { wrapper } = await mountPage();
        await cancelAt(wrapper, 'AHP-2026-000124').trigger('click');
        await settle();
        await typeInto('Reason', REASON);
        dialogButton('Show preview').click();
        await settle();

        [...(dialog().node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__body button') ?? [])]
            .find((button) => button.textContent?.includes('Change the details'))
            ?.click();
        await settle();

        expect(fieldOf('Reason').value).toBe(REASON);
        expect(dialog().node?.textContent).not.toContain('Taken over as paid');
    });

    test('refused because what it writes changed, shows the new preview to confirm again', async () => {
        const { wrapper, notices } = await mountPage({
            cancelWith: () => {
                throw new AdminError({
                    status: 409,
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED,
                    body: { preview: planOf({ movedIn: 119, credited: 0 }) },
                });
            },
        });
        await cancelAt(wrapper, 'AHP-2026-000124').trigger('click');
        await settle();
        await typeInto('Reason', REASON);
        dialogButton('Show preview').click();
        await settle();

        dialogButton('Cancel invoice').click();
        await enterTheCode(CODE);

        const shown = dialog().node?.textContent ?? '';
        expect(shown).toContain('Something changed since the preview');
        expect(shown).toContain('Taken over as paid€119');
        expect(shown).not.toContain('Becomes a credit');
        expect(dialogButton('Cancel invoice').disabled).toBe(false);
        expect(notices.map(([kind]) => kind)).toEqual(['negative']);
    });
});
