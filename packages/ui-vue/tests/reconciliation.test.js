// The cases to reconcile, driven without a page: the requests the descriptor
// issues — the paths `@saasicat/nest` serves, which
// `tests/openapi-covers-the-implementation.test.js` holds to the contract from
// the other side —, the list read a page at a time and switched between open
// and closed, and closing a case behind the second factor; and a tenant's
// payments, asked for only where the manifest announces them.

// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick, ref } from 'vue';

import {
    bindResource,
    reconciliationResource,
    tenantsResource,
    useReconciliation,
} from '../dist/index.js';
import { useTenantPayments } from '../dist/vue/index.js';
import { answeringSecondFactor } from './support/retirement-flow.mjs';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };
const BASE = '/api/v1/admin/reconciliation';

async function settled() {
    await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

function recordingHttp(body, status = 200) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body === undefined ? undefined : JSON.parse(init.body),
            mfa: init?.headers?.['X-Mfa-Code'],
        });
        return Promise.resolve({
            status,
            headers: { get: () => (status === 204 ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === null ? '' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

const caseOf = (id) => ({
    id,
    kind: 'REFUND_UNMATCHED',
    amount: 30,
    currency: 'EUR',
    tenantId: 'tenant-1',
    subscriber: { id: 'subscriber-1', customerNumber: 'K-1', legalName: 'Kunde GmbH' },
    payment: { ref: 'pi_1', invoiceNumber: 'AHP-2026-000001' },
    gatewayAccount: 'stripe-main',
    reference: `re_${id}`,
    recordedAt: '2026-02-10T09:00:00.000Z',
    closedAt: null,
    closedBy: null,
    note: null,
});

describe('reconciliationResource', () => {
    test('has the two operations the cases below drive, and no other', () => {
        assert.deepEqual(Object.keys(reconciliationResource.ops).sort(), ['cases', 'close']);
    });

    test('cases asks for the state, and continues after a case where one is named', async () => {
        const page = { cases: [caseOf('k-1')], next: null };
        const { http, calls } = recordingHttp(page);
        const bound = bindResource(reconciliationResource, http, CTX);

        assert.deepEqual(await bound.cases('open'), page);
        await bound.cases('closed', 'k/1');

        assert.deepEqual(
            calls.map((call) => [call.method, call.url]),
            [
                ['GET', `${BASE}?state=open`],
                ['GET', `${BASE}?state=closed&after=k%2F1`],
            ],
        );
    });

    test('close posts the note against the case, escaped, with the second factor', async () => {
        const { http, calls } = recordingHttp(caseOf('k-1'));

        await bindResource(reconciliationResource, http, CTX).close('k/1', 'Reconciled.', '123456');

        assert.deepEqual(calls, [
            {
                url: `${BASE}/k%2F1/close`,
                method: 'POST',
                body: { note: 'Reconciled.' },
                mfa: '123456',
            },
        ]);
    });
});

describe('tenantsResource.payments', () => {
    test("asks for the tenant's payments, with its slug escaped", async () => {
        const payments = { invoices: [], openCases: [] };
        const { http, calls } = recordingHttp(payments);

        assert.deepEqual(await bindResource(tenantsResource, http, CTX).payments('a b'), payments);
        assert.deepEqual(
            calls.map((call) => call.url),
            ['/api/v1/admin/tenants/a%20b/payments'],
        );
    });
});

function driveCases({ code = '123456', pages } = {}) {
    const requests = [];
    const prompts = [];
    const resource = {
        cases: async (state, after) => {
            requests.push(['cases', state, after]);
            return pages(state, after);
        },
        close: async (...args) => {
            requests.push(['close', ...args]);
            return { ...caseOf(args[0]), note: args[1] };
        },
    };
    const state = useReconciliation(resource, answeringSecondFactor({ prompts, code }));
    return { state, requests, prompts };
}

describe('the list of cases', () => {
    const twoPages = (state, after) =>
        after === undefined
            ? { cases: [caseOf(`${state}-1`)], next: `${state}-1` }
            : { cases: [caseOf(`${state}-2`)], next: null };

    test('reads the open cases when the page opens, and the next page when asked', async () => {
        const { state, requests } = driveCases({ pages: twoPages });
        await settled();
        assert.deepEqual(
            state.rows.value.map((row) => row.id),
            ['open-1'],
        );
        assert.equal(state.hasMore.value, true);

        await state.more();

        assert.deepEqual(
            state.rows.value.map((row) => row.id),
            ['open-1', 'open-2'],
        );
        assert.equal(state.hasMore.value, false);
        assert.deepEqual(requests, [
            ['cases', 'open', undefined],
            ['cases', 'open', 'open-1'],
        ]);
    });

    test('switching to the closed cases reads them from the first page, dropping what was added', async () => {
        const { state } = driveCases({ pages: twoPages });
        await settled();
        await state.more();

        state.state.value = 'closed';
        await settled();

        assert.deepEqual(
            state.rows.value.map((row) => row.id),
            ['closed-1'],
        );
    });

    test("a page that fails to load is shown as the list's error, not thrown", async () => {
        const { state } = driveCases({
            pages: (stateName, after) => {
                if (after) throw new Error('the server went away');
                return twoPages(stateName, after);
            },
        });
        await settled();

        await state.more();

        assert.ok(state.error.value, 'the failure was not shown');
        assert.deepEqual(
            state.rows.value.map((row) => row.id),
            ['open-1'],
        );
    });

    test('closes a case with its note behind the second factor, and reads the list again', async () => {
        const { state, requests, prompts } = driveCases({ pages: twoPages });
        await settled();

        const closed = await state.close(caseOf('open-1'), 'Recovered by transfer.');

        assert.equal(closed.note, 'Recovered by transfer.');
        assert.deepEqual(requests.slice(1), [
            ['close', 'open-1', 'Recovered by transfer.', '123456'],
            ['cases', 'open', undefined],
        ]);
        assert.equal(prompts.length, 1);
    });

    test('a cancelled code closes nothing', async () => {
        const { state, requests } = driveCases({ code: null, pages: twoPages });
        await settled();

        assert.equal(await state.close(caseOf('open-1'), 'Note.'), null);
        assert.deepEqual(requests, [['cases', 'open', undefined]]);
    });
});

describe("a tenant's payments", () => {
    const manifestWith = (capabilities) => ref({ capabilities });

    test('are read where the manifest announces them, and not otherwise', async () => {
        const asked = [];
        const tenants = {
            payments: async (slug) => {
                asked.push(slug);
                return { invoices: [], openCases: [] };
            },
        };

        const served = useTenantPayments(
            ref('northwind'),
            manifestWith({ 'payments.read': true }),
            tenants,
        );
        const unserved = useTenantPayments(ref('northwind'), manifestWith({}), tenants);
        await settled();

        assert.equal(served.available.value, true);
        assert.deepEqual(served.data.value, { invoices: [], openCases: [] });
        assert.equal(unserved.available.value, false);
        assert.equal(unserved.data.value, null);
        assert.deepEqual(asked, ['northwind']);
    });
});
