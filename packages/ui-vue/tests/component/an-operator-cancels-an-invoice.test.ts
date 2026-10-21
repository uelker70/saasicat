// The tenant page says of each invoice what it stands in relation to, and
// cancels one that stands in two steps: what the operator gives — what of
// each line is still owed among it —, then what the server says the
// cancellation will write, confirmed behind the second factor.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is sent.

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
    INVOICE_ERROR_CODES,
    type AdminInvoice,
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

/** A line as the invoice read states it. */
const lineOf = (
    position: number,
    title: string,
    amountNet: number,
    overrides: Partial<AdminInvoice['lines'][number]> = {},
) => ({
    position,
    title,
    origin: 'renewal' as const,
    source: 'plan' as const,
    periodFrom: '2026-02-01',
    periodUntil: '2026-02-28',
    amountNet,
    taxRate: 0,
    correctedPosition: null,
    correctsPosition: null,
    standsAt: amountNet,
    correctable: amountNet > 0,
    ...overrides,
});

/** The invoice with its lines, as the dialog reads it: a plan and its discount. */
const READ: AdminInvoice = {
    id: 'invoice-124',
    number: 'AHP-2026-000124',
    issuedAt: '2026-02-01T05:15:00.000Z',
    dueDate: '2026-02-15',
    currency: 'EUR',
    totalNet: 100,
    totalTax: 0,
    totalGross: 100,
    lines: [
        lineOf(1, 'Standard', 110),
        lineOf(2, 'Welcome', -10, { source: 'discount', correctable: false }),
    ],
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
        lines: [lineOf(1, 'Standard', 110), lineOf(2, 'Welcome', -10, { source: 'discount' })],
    },
    lines: [
        { position: 1, standsAt: 110, becomes: 110 },
        { position: 2, standsAt: -10, becomes: -10 },
    ],
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
    plan = planOf(),
    cancelled = CANCELLED,
    readWith = async () => READ,
}: {
    manifest?: unknown;
    cancelWith?: () => never;
    plan?: unknown;
    cancelled?: unknown;
    readWith?: () => Promise<AdminInvoice>;
} = {}) {
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
        invoice: async (...args: unknown[]) => {
            calls.push(['invoice', ...args]);
            return readWith();
        },
        previewInvoiceCancellation: async (...args: unknown[]) => {
            calls.push(['preview', ...args]);
            return plan;
        },
        cancelInvoice: async (...args: unknown[]) => {
            calls.push(['cancel', ...args]);
            return cancelWith ? cancelWith() : cancelled;
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

/** The item of the dialog's lines that begins with `label`, as `1. Standard`. */
function lineItem(label: string): HTMLElement {
    const item = [...(dialog().node?.querySelectorAll<HTMLElement>('li') ?? [])].find((candidate) =>
        candidate.textContent?.trim().startsWith(label),
    );
    if (!item) throw new Error(`no line ${label}`);
    return item;
}

/** Chooses `choice` at the line that begins with `label`. */
async function chooseAt(label: string, choice: string): Promise<void> {
    const button = [...lineItem(label).querySelectorAll<HTMLElement>('.q-btn-toggle button')].find(
        (candidate) => candidate.textContent?.trim() === choice,
    );
    if (!button) throw new Error(`no choice ${choice} at ${label}`);
    button.click();
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

        expect(calls.filter(([what]) => what === 'invoice')).toEqual([
            ['invoice', 'acme', 'invoice-124'],
        ]);
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
        expect(
            dialog().node?.querySelector('section[aria-label="Lines not owed in full"]'),
        ).toBeNull();
    });

    test('previews and announces a cancellation that leaves no replacement, naming no party for one', async () => {
        const { wrapper, notices } = await mountPage({
            plan: { ...planOf({ movedIn: 0, credited: 119 }), replacement: null },
            cancelled: { ...CANCELLED, replacement: null, credits: [{ amount: 119 }] },
        });
        await cancelAt(wrapper, 'AHP-2026-000124').trigger('click');
        await settle();
        await typeInto('Reason', REASON);
        dialogButton('Show preview').click();
        await settle();

        const shown = dialog().node?.textContent ?? '';
        expect(shown).toContain('ReplacementNone — nothing of the invoice is owed any more.');
        expect(shown).toContain('Becomes a credit, to refund€119');
        expect(shown).not.toContain('reverse charge');
        expect(dialog().node?.querySelector('section[aria-label]')).toBeNull();

        dialogButton('Cancel invoice').click();
        await enterTheCode(CODE);

        expect(notices).toEqual([
            [
                'positive',
                'Cancelled by AHP-2026-000142. Nothing of it is owed any more, so there is no replacement.',
            ],
        ]);
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

// @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
describe('the lines of an invoice cancelled from the tenant page', () => {
    async function openedAt(options: Parameters<typeof mountPage>[0] = {}) {
        const page = await mountPage(options);
        await cancelAt(page.wrapper, 'AHP-2026-000124').trigger('click');
        await settle();
        await typeInto('Reason', REASON);
        return page;
    }

    test('offer a choice at the line the server says may be corrected, and say why at the others', async () => {
        await openedAt();

        expect(lineItem('1. Standard').textContent).toContain('€110');
        expect(
            [...lineItem('1. Standard').querySelectorAll('.q-btn-toggle button')].map((button) =>
                button.textContent?.trim(),
            ),
        ).toEqual(['Owed', 'Not owed', 'Owed in part']);
        expect(lineItem('2. Welcome').querySelector('.q-btn-toggle')).toBeNull();
        expect(lineItem('2. Welcome').textContent).toContain('Follows what it reduced');
    });

    test('name each choice after its line, and say which option is chosen', async () => {
        await openedAt();

        await chooseAt('1. Standard', 'Not owed');

        const group = lineItem('1. Standard').querySelector<HTMLElement>('.q-btn-toggle');
        expect([group?.getAttribute('role'), group?.getAttribute('aria-label')]).toEqual([
            'group',
            'What of line 1, Standard, is still owed',
        ]);
        expect(
            [...(group?.querySelectorAll('button') ?? [])].map((button) => [
                button.textContent?.trim(),
                button.getAttribute('aria-pressed'),
            ]),
        ).toEqual([
            ['Owed', 'false'],
            ['Not owed', 'true'],
            ['Owed in part', 'false'],
        ]);
    });

    test('owed in part ask for the amount before the preview, and send it', async () => {
        const { calls } = await openedAt();

        await chooseAt('1. Standard', 'Owed in part');
        expect(dialogButton('Show preview').disabled).toBe(true);
        await typeInto('Still owed, net', '24.50');
        expect(dialogButton('Show preview').disabled).toBe(false);
        dialogButton('Show preview').click();
        await settle();

        expect(calls.filter(([what]) => what === 'preview').map((call) => call[3])).toEqual([
            { reason: REASON, deliverTo: null, lines: [{ position: 1, owed: 24.5 }] },
        ]);
    });

    test('not owed send nothing owed, and owed again send nothing of the line', async () => {
        const { calls } = await openedAt();

        await chooseAt('1. Standard', 'Not owed');
        dialogButton('Show preview').click();
        await settle();
        [...(dialog().node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__body button') ?? [])]
            .find((button) => button.textContent?.includes('Change the details'))
            ?.click();
        await settle();
        await chooseAt('1. Standard', 'Owed');
        dialogButton('Show preview').click();
        await settle();

        expect(calls.filter(([what]) => what === 'preview').map((call) => call[3])).toEqual([
            { reason: REASON, deliverTo: null, lines: [{ position: 1, owed: 0 }] },
            { reason: REASON, deliverTo: null },
        ]);
    });

    test('in the preview, show each line that moves from what to what, and the replacement’s lines with what each correction corrects', async () => {
        await openedAt({
            plan: {
                ...planOf(),
                replacement: {
                    ...planOf().replacement,
                    lines: [
                        lineOf(1, 'Standard', 110),
                        lineOf(2, 'Standard', -85.5, { origin: 'correction', correctsPosition: 1 }),
                        lineOf(3, 'Welcome', -10, { source: 'discount' }),
                        lineOf(4, 'Welcome', 7.77, {
                            origin: 'correction',
                            source: 'discount',
                            correctsPosition: 3,
                        }),
                    ],
                },
                lines: [
                    { position: 1, standsAt: 110, becomes: 24.5 },
                    { position: 2, standsAt: -10, becomes: -2.23 },
                ],
            },
        });
        await chooseAt('1. Standard', 'Owed in part');
        await typeInto('Still owed, net', '24.50');
        dialogButton('Show preview').click();
        await settle();

        const moved = dialog().node?.querySelector('section[aria-label="Lines not owed in full"]');
        expect(moved?.textContent).toContain('1. Standard€110 → €24.50');
        expect(moved?.textContent).toContain('2. Welcome-€10 → -€2.23');
        const replacement = dialog().node?.querySelector(
            'section[aria-label="Lines of the replacement"]',
        );
        expect(replacement?.textContent).toContain('2. Standard-€85.50 · Corrects item 1');
        expect(replacement?.textContent).toContain('4. Welcome€7.77 · Corrects item 3');
    });

    test('that fail to load say so, offer to read them again, and leave the rest of the dialog working', async () => {
        let fail = true;
        const { calls } = await openedAt({
            readWith: async () => {
                if (fail) throw new AdminError({ status: 500 });
                return READ;
            },
        });

        expect(dialog().node?.textContent).toContain("The invoice's lines could not be loaded");
        expect(dialogButton('Show preview').disabled).toBe(false);
        fail = false;
        [...(dialog().node?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
            .find((button) => button.textContent?.trim() === 'Retry')
            ?.click();
        await settle();

        expect(calls.filter(([what]) => what === 'invoice')).toHaveLength(2);
        expect(lineItem('1. Standard').textContent).toContain('€110');
    });
});
