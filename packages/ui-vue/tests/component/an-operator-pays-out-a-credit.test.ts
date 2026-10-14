// The tenant detail shows the credits of the tenant's subscriber, where the
// platform serves them, and records a payout against one behind the second
// factor.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown and what is sent — where each credit comes from, what was paid out
// and what is open, and a payout only what the form describes.

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice

import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { payoutOf, type PayoutForm } from '../../src/internal/tenant-detail/subscriber-payout.js';
import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'wien', name: 'Wien', isActive: true, users: [] };
const CODE = '123456';

const CREDITS = {
    credits: [
        {
            id: 'credit-1',
            amount: 5,
            currency: 'EUR',
            origin: { kind: 'payment', paymentRef: 'pi_1', invoiceNumber: 'AHP-2026-000001' },
            createdAt: '2026-02-01T05:30:00.000Z',
            open: 0,
            entries: [],
        },
        {
            id: 'credit-2',
            amount: 40,
            currency: 'EUR',
            origin: { kind: 'invoice', invoiceNumber: 'AHP-2026-000002' },
            createdAt: '2026-02-02T00:00:00.000Z',
            open: 32.5,
            entries: [],
        },
    ],
    // Fourteen hours ahead of UTC: its day turns long before the browser's.
    timeZone: 'Pacific/Kiritimati',
};

const PAYING = { capabilities: { 'credits.read': true, 'credits.payout': true } };

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
}

type Call = [string, ...unknown[]];

async function mountPage(manifest: unknown = PAYING) {
    const calls: Call[] = [];
    const notices: Array<[string, string]> = [];
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/wien');
    await router.isReady();
    const tenants = {
        detail: async () => TENANT,
        credits: async (...args: unknown[]) => {
            calls.push(['credits', ...args]);
            return CREDITS;
        },
        recordPayout: async (...args: unknown[]) => {
            calls.push(['payout', ...args]);
            return CREDITS;
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

/** The rows of the credit table, cell by cell. */
function creditRows(wrapper: Mounted): string[][] {
    const section = wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === 'Credit');
    expect(section, 'no credit section').toBeTruthy();
    return (section?.findAll('tbody tr') ?? []).map((row) =>
        row.findAll('td').map((cell) => cell.text()),
    );
}

/** The buttons of the page labelled `label`. */
function buttonsNamed(wrapper: Mounted, label: string) {
    return wrapper.findAll('button').filter((button) => button.text().endsWith(label));
}

/** The dialog on screen, and its confirming button. */
function dialog() {
    const node = [...document.querySelectorAll<HTMLElement>('.sa-dialog')].at(-1);
    const buttons = node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__actions button');
    return { node, submit: buttons?.[1] };
}

/** The field of the dialog labelled `label`. */
function fieldOf(label: string): HTMLInputElement {
    const field = [...(dialog().node?.querySelectorAll('.sa-field') ?? [])].find((candidate) =>
        candidate.textContent?.includes(label),
    );
    const input = field?.querySelector<HTMLInputElement>('input, textarea');
    if (!input) throw new Error(`no field ${label}`);
    return input;
}

/** Types `value` into the field of the dialog labelled `label`. */
async function typeInto(label: string, value: string): Promise<void> {
    const input = fieldOf(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await nextTick();
}

/** Answers the second factor's dialog with the code, as the operator does. */
async function enterTheCode(): Promise<void> {
    await settle();
    const card = document.querySelector<HTMLElement>('.mfa-card');
    if (!card) throw new Error('the second factor was not asked for');
    const input = card.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('the second factor has no field');
    input.value = CODE;
    input.dispatchEvent(new Event('input'));
    await nextTick();
    [...card.querySelectorAll<HTMLButtonElement>('button')].at(-1)?.click();
    await settle();
}

describe("the tenant detail shows the subscriber's credits", () => {
    test('where each comes from, what was paid out and what is open, the oldest first', async () => {
        const { wrapper, calls } = await mountPage();

        expect(calls).toEqual([['credits', 'wien']]);
        expect(creditRows(wrapper).map((row) => row.slice(0, 5))).toEqual([
            ['2026-02-01', 'Payment pi_1 for AHP-2026-000001', '€5', '€5', '€0'],
            ['2026-02-02', 'Invoice AHP-2026-000002', '€40', '€7.50', '€32.50'],
        ]);
    });

    test('offers a payout only for a credit with something open', async () => {
        const { wrapper } = await mountPage();

        expect(buttonsNamed(wrapper, 'Record payout')).toHaveLength(1);
    });

    // @requirement SC-ADM-015 — The administration only offers what the application actually has
    test('without the capabilities, shows nothing and reads nothing, and offers no payout with the view alone', async () => {
        const without = await mountPage({ capabilities: {} });
        expect(without.calls).toEqual([]);
        expect(without.wrapper.text()).not.toContain('Credit');

        const readOnly = await mountPage({ capabilities: { 'credits.read': true } });
        expect(creditRows(readOnly.wrapper)).toHaveLength(2);
        expect(buttonsNamed(readOnly.wrapper, 'Record payout')).toHaveLength(0);
    });
});

describe('a payout the operator records on the tenant page', () => {
    test('opens with what is open, is sent once a reference names it, with the second factor', async () => {
        const { wrapper, calls, notices } = await mountPage();

        await buttonsNamed(wrapper, 'Record payout')[0]!.trigger('click');
        await settle();
        expect(fieldOf('Amount').value).toBe('32.5');
        expect(dialog().submit?.disabled, 'no reference yet').toBe(true);

        await typeInto('Reference', ' TRF-2026-0042 ');
        await typeInto('Transferred on', '2026-03-03');
        expect(dialog().submit?.disabled).toBe(false);

        dialog().submit!.click();
        await enterTheCode();

        expect(calls.slice(1, 2)).toEqual([
            [
                'payout',
                'wien',
                'credit-2',
                { amount: 32.5, reference: 'TRF-2026-0042', paidOn: '2026-03-03', note: null },
                CODE,
            ],
        ]);
        expect(document.querySelector('.sa-dialog')).toBeNull();
        expect(notices).toEqual([['positive', 'Payout recorded.']]);
    });

    test("is dated today in the installation's time zone, read again each time the dialog opens", async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            // Noon in UTC, where the test runs, and already the 4th in Kiritimati.
            vi.setSystemTime(new Date('2026-03-03T12:00:00.000Z'));
            const { wrapper } = await mountPage();

            await buttonsNamed(wrapper, 'Record payout')[0]!.trigger('click');
            await settle();
            expect(fieldOf('Transferred on').value).toBe('2026-03-04');
            expect(fieldOf('Transferred on').getAttribute('max')).toBe('2026-03-04');
            dialog().node?.querySelector<HTMLButtonElement>('.sa-dialog__actions button')?.click();
            await settle();

            vi.setSystemTime(new Date('2026-03-04T12:00:00.000Z'));
            await buttonsNamed(wrapper, 'Record payout')[0]!.trigger('click');
            await settle();
            expect(fieldOf('Transferred on').value).toBe('2026-03-05');
        } finally {
            vi.useRealTimers();
        }
    });

    test('more than is open cannot be sent', async () => {
        const { wrapper } = await mountPage();

        await buttonsNamed(wrapper, 'Record payout')[0]!.trigger('click');
        await settle();
        await typeInto('Reference', 'TRF-2026-0042');
        await typeInto('Amount', '32.51');

        expect(dialog().submit?.disabled).toBe(true);
    });
});

describe('the payout the form describes', () => {
    const FORM: PayoutForm = {
        amount: 40,
        reference: 'TRF-2026-0042',
        paidOn: '2026-03-03',
        note: '',
    };

    test.each<[string, Partial<PayoutForm>]>([
        ['no amount', { amount: null }],
        ['nothing', { amount: 0 }],
        ['less than nothing', { amount: -1 }],
        ['a fraction of a cent', { amount: 1.005 }],
        ['one cent more than is open', { amount: 40.01 }],
        ['a reference of blanks', { reference: '   ' }],
        ['a reference too long', { reference: 'x'.repeat(201) }],
        ['no day', { paidOn: '' }],
        ['a moment instead of a day', { paidOn: '2026-03-03T10:00' }],
        ['a note too long', { note: 'x'.repeat(501) }],
    ])('is none for %s', (_, change) => {
        expect(payoutOf({ ...FORM, ...change }, 40)).toBeNull();
    });

    test('is what is open, a reference and a note trimmed, an empty note as none', () => {
        expect(payoutOf({ ...FORM, reference: ' TRF ', note: '  ' }, 40)).toEqual({
            amount: 40,
            reference: 'TRF',
            paidOn: '2026-03-03',
            note: null,
        });
        expect(payoutOf({ ...FORM, amount: 0.01, note: ' Bank closed ' }, 40)?.note).toBe(
            'Bank closed',
        );
    });
});
