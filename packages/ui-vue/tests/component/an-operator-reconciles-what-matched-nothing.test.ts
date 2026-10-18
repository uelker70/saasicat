// The operator reconciles what the gateway reported and nothing matched: the
// reconciliation page lists the cases, open or closed, and closes one with a
// note behind the second factor; the tenant page shows the tenant's invoices
// with what each still owes, its open cases, and a credit a reversal given
// back left.
//
// Mounted against a stubbed registry: the test says what the server answers
// and reads what the operator is shown and what is sent.

// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note

import type { AdminReconciliationCase } from '@saasicat/core';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import ReconciliationPage from '../../src/pages/ReconciliationPage.vue';
import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { dialog, enterTheCode, settle, typeInto } from './support/dialog-flow.js';
import { provideStubResources } from './support/stub-resources.js';

const CODE = '123456';
const TENANT = { id: 't-1', slug: 'wien', name: 'Wien', isActive: true, users: [] };

const caseOf = (
    id: string,
    overrides: Partial<AdminReconciliationCase> = {},
): AdminReconciliationCase => ({
    id,
    kind: 'REFUND_UNMATCHED',
    amount: 30,
    currency: 'EUR',
    tenantId: 't-1',
    subscriber: { id: 'subscriber-1', customerNumber: 'K-000001', legalName: 'Wien GmbH' },
    payment: { ref: 'pi_1', invoiceNumber: 'AHP-2026-000001' },
    gatewayAccount: 'stripe-main',
    reference: 're_1',
    recordedAt: '2026-02-10T09:00:00.000Z',
    closedAt: null,
    closedBy: null,
    note: null,
    ...overrides,
});

const RECONCILING = {
    capabilities: { 'reconciliation.read': true, 'reconciliation.close': true },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

// SAFETY: the two keys are the symbols the pages inject their manifest and
// their notify port under, typed as Vue's injection keys rather than as symbols.
const manifestKey = SUPER_ADMIN_MANIFEST_KEY as symbol;
// SAFETY: as above, for the notify port.
const notifyKey = SUPER_ADMIN_NOTIFY_KEY as symbol;

type Call = [string, ...unknown[]];

async function mountReconciliation(
    cases: (state: string) => unknown[],
    manifest: unknown = RECONCILING,
) {
    const calls: Call[] = [];
    const reconciliation = {
        cases: async (state: string, after?: string) => {
            calls.push(['cases', state, after]);
            return { cases: cases(state), next: null };
        },
        close: async (caseId: string, note: string, code: string) => {
            calls.push(['close', caseId, note, code]);
            return caseOf('k-1', { closedAt: '2026-02-11T09:00:00.000Z', note });
        },
    };
    const wrapper = mountWithQuasar(ReconciliationPage, {
        attachTo: document.body,
        global: {
            provide: {
                ...provideStubResources({ reconciliation }),
                [manifestKey]: () => manifest,
                [notifyKey]: () => undefined,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, calls };
}

type Mounted = Awaited<ReturnType<typeof mountReconciliation>>['wrapper'];

const rowsOf = (wrapper: Mounted) =>
    wrapper.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()));

const buttonsNamed = (wrapper: Mounted, label: string) =>
    wrapper.findAll('button').filter((button) => button.text().endsWith(label));

describe('the reconciliation page', () => {
    test('lists the open cases with whom and what each is about', async () => {
        const { wrapper, calls } = await mountReconciliation(() => [caseOf('k-1')]);

        expect(calls).toEqual([['cases', 'open', undefined]]);
        const [row] = rowsOf(wrapper);
        expect(row?.slice(1, 6)).toEqual([
            'Refund without a credit',
            'Wien GmbH (K-000001)',
            'pi_1 for AHP-2026-000001',
            're_1',
            '€30',
        ]);
    });

    test('with nothing open, says so', async () => {
        const { wrapper } = await mountReconciliation(() => []);

        expect(wrapper.text()).toContain('Nothing to reconcile.');
    });

    test('closes a case with its note behind the second factor', async () => {
        const { wrapper, calls } = await mountReconciliation(() => [caseOf('k-1')]);

        await buttonsNamed(wrapper, 'Close')[0]?.trigger('click');
        await settle();
        expect(dialog().submit?.disabled, 'closed without a note').toBe(true);
        await typeInto('Note', '   ');
        expect(dialog().submit?.disabled, 'closed with a note of blanks').toBe(true);
        await typeInto('Note', '  Recovered by transfer TRF-9.  ');
        dialog().submit?.click();
        await enterTheCode(CODE);

        expect(calls.filter(([name]) => name === 'close')).toEqual([
            ['close', 'k-1', 'Recovered by transfer TRF-9.', CODE],
        ]);
    });

    test('offers no closing without the capability to close', async () => {
        const { wrapper } = await mountReconciliation(() => [caseOf('k-1')], {
            capabilities: { 'reconciliation.read': true },
        });

        expect(buttonsNamed(wrapper, 'Close')).toHaveLength(0);
    });

    test('the closed cases show the note, and who closed one where SaaSiCat did', async () => {
        const { wrapper, calls } = await mountReconciliation((state) =>
            state === 'closed'
                ? [
                      caseOf('k-2', {
                          closedAt: '2026-05-20T09:00:00.000Z',
                          note: 'The gateway gave the reversal back.',
                      }),
                  ]
                : [],
        );

        await buttonsNamed(wrapper, 'Closed')[0]?.trigger('click');
        await settle();

        expect(calls.at(-1)).toEqual(['cases', 'closed', undefined]);
        expect(rowsOf(wrapper)[0]?.join(' ')).toContain(
            'The gateway gave the reversal back. (by SaaSiCat)',
        );
        expect(buttonsNamed(wrapper, 'Close')).toHaveLength(0);
    });
});

async function mountTenant(manifest: unknown) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/wien');
    await router.isReady();
    const asked: string[] = [];
    const tenants = {
        detail: async () => TENANT,
        payments: async (slug: string) => {
            asked.push(slug);
            return {
                invoices: [
                    {
                        id: 'invoice-2',
                        number: 'AHP-2026-000002',
                        issuedAt: '2026-03-01T05:15:00.000Z',
                        dueDate: '2026-03-15',
                        totalGross: 58.31,
                        currency: 'EUR',
                        owed: 58.31,
                    },
                ],
                openCases: [caseOf('k-1', { kind: 'REVERSAL_UNMATCHED', reference: 'du_1' })],
            };
        },
        credits: async () => ({
            credits: [
                {
                    id: 'credit-1',
                    amount: 58.31,
                    currency: 'EUR',
                    origin: {
                        kind: 'reversal',
                        reversalRef: 'du_1',
                        invoiceNumber: 'AHP-2026-000001',
                    },
                    createdAt: '2026-05-20T09:00:00.000Z',
                    open: 58.31,
                    entries: [],
                },
            ],
            timeZone: 'Europe/Berlin',
        }),
    };
    const wrapper = mountWithQuasar(defineComponent({ template: '<router-view />' }), {
        attachTo: document.body,
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({ tenants }),
                [manifestKey]: () => manifest,
                [notifyKey]: () => undefined,
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, asked };
}

describe("the tenant page's payments", () => {
    test('shows the invoices with what each still owes, and the open cases', async () => {
        const { wrapper, asked } = await mountTenant({ capabilities: { 'payments.read': true } });

        expect(asked).toEqual(['wien']);
        const text = wrapper.text();
        expect(text).toContain('AHP-2026-000002');
        expect(text).toContain('Reversal without a credit');
        expect(text).toContain('du_1');
    });

    test('are not asked for where the platform does not serve them', async () => {
        const { wrapper, asked } = await mountTenant({ capabilities: {} });

        expect(asked).toEqual([]);
        expect(wrapper.text()).not.toContain('Open cases');
    });

    // @requirement SC-PRIC-086 — A dispute won takes its reversal back, and what was paid meanwhile becomes a credit
    test('a credit a reversal given back left names the reversal', async () => {
        const { wrapper } = await mountTenant({ capabilities: { 'credits.read': true } });

        expect(wrapper.text()).toContain('Reversal du_1 given back, for AHP-2026-000001');
    });
});
