// The subscriber's record shows its charges, where the platform serves them.
//
// Mounted through a router, the way an app mounts the page, against a stubbed
// registry: the test says what the server answers and reads what the operator
// is shown — whose account it is, each charge in the order served, and the
// empty and failed states.

// @requirement SC-ADM-037 — An operator reads a subscriber's charges in its record
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';

import { settle } from './support/dialog-flow.js';
import { mountRecord } from './support/subscriber-record.js';

const charge = (overrides: Record<string, unknown>) => ({
    id: 'c-1',
    subscriberId: 's-1',
    tenantId: 't-1',
    subscriptionId: 'sub-1',
    contractId: 'k-1',
    contractLineItemId: 'l-1',
    origin: 'renewal',
    source: 'plan',
    sourceRef: 'sub-1',
    periodStart: '2026-02-01T00:00:00.000Z',
    periodEnd: '2026-03-01T00:00:00.000Z',
    currency: 'EUR',
    amountNet: 49,
    bookedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
});

const ACCOUNT = {
    holder: { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    entries: [
        { charge: charge({}), title: 'Standard' },
        {
            charge: charge({ id: 'c-2', source: 'discount', amountNet: -9.8 }),
            title: 'Welcome 20 %',
        },
        {
            charge: charge({
                id: 'c-3',
                origin: 'activation',
                periodStart: '2026-01-01T00:00:00.000Z',
                periodEnd: '2026-02-01T00:00:00.000Z',
                bookedAt: '2026-01-01T00:00:00.000Z',
            }),
            title: null,
        },
    ],
};

const SERVING: Record<string, boolean> = { 'charges.read': true };

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function mountPage({
    capabilities = SERVING,
    charges = async (_id: string): Promise<unknown> => ACCOUNT,
} = {}) {
    const asked: string[] = [];
    const page = await mountRecord({
        capabilities,
        subscribers: {
            charges: async (id: string) => {
                asked.push(id);
                return charges(id);
            },
        },
    });
    mounted.push(page.wrapper);
    return { ...page, asked };
}

type Mounted = Awaited<ReturnType<typeof mountPage>>['wrapper'];

/** The rows of the charges table, cell by cell. */
function chargeRows(wrapper: Mounted): string[][] {
    const section = wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === 'Charges');
    expect(section, 'no charges section').toBeTruthy();
    return (section?.findAll('tbody tr') ?? []).map((row) =>
        row.findAll('td').map((cell) => cell.text()),
    );
}

describe("the subscriber's record shows its account", () => {
    test("moving to another subscriber shows nothing of the first one's account while the next one's is read", async () => {
        const { wrapper, router } = await mountPage({
            charges: (id: string) =>
                id === 's-2' ? new Promise(() => {}) : Promise.resolve(ACCOUNT),
        });
        expect(wrapper.text(), 'the premise').toContain('Welcome 20 %');

        await router.push('/admin/subscribers/s-2');
        await settle();

        expect(wrapper.text()).not.toContain('Welcome 20 %');
    });

    test('whose account it is, and each charge in the order the platform serves them', async () => {
        const { wrapper, asked } = await mountPage();

        expect(asked).toEqual(['s-1']);
        expect(wrapper.text()).toContain('Account of K-10001 · Northwind GmbH');
        expect(chargeRows(wrapper)).toEqual([
            ['2026-02-01', '2026-02-01 – 2026-02-28', 'Standard', 'Plan', 'Renewal', '€49'],
            [
                '2026-02-01',
                '2026-02-01 – 2026-02-28',
                'Welcome 20 %',
                'Discount',
                'Renewal',
                '-€9.80',
            ],
            ['2026-01-01', '2026-01-01 – 2026-01-31', 'Plan', 'Plan', 'Activation', '€49'],
        ]);
    });

    test('an amount is shown in the currency it was charged in', async () => {
        const { wrapper } = await mountPage({
            charges: async () => ({
                holder: ACCOUNT.holder,
                entries: [
                    { charge: charge({ currency: 'CHF', amountNet: 10 }), title: 'Standard' },
                ],
            }),
        });

        // Intl puts a no-break space between the code and the figure.
        expect(chargeRows(wrapper)[0].at(-1)).toMatch(/^CHF\s10$/);
    });

    test('a subscriber without charges says so', async () => {
        const { wrapper } = await mountPage({
            charges: async () => ({ holder: ACCOUNT.holder, entries: [] }),
        });

        expect(wrapper.text()).toContain('No charges yet.');
    });

    test('a read that fails says so, and a retry asks again', async () => {
        let attempts = 0;
        const { wrapper, asked } = await mountPage({
            charges: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('offline');
                return ACCOUNT;
            },
        });

        expect(wrapper.text()).toContain('The charges could not be loaded.');
        const retry = wrapper.findAll('button').find((button) => /retry/i.test(button.text()));
        expect(retry, 'no retry button').toBeTruthy();
        await retry?.trigger('click');
        await settle();

        expect(asked).toEqual(['s-1', 's-1']);
        expect(wrapper.text()).not.toContain('The charges could not be loaded.');
        expect(wrapper.text()).toContain('Account of K-10001 · Northwind GmbH');
    });

    test('without the capability, nothing is asked and no section is shown', async () => {
        const { wrapper, asked } = await mountPage({ capabilities: {} });

        expect(asked).toEqual([]);
        expect(wrapper.text()).not.toContain('Charges');
    });
});
