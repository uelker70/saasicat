// The operator cancels one of a tenant's invoices from its page: at which
// invoices it is offered, the request the input makes, the two requests of
// the tenants descriptor, and the flow — preview, back, the second factor,
// the figures shown sent along, and a preview that no longer holds put in
// place of the one confirmed.
//
// The paths are the ones `@saasicat/nest` serves
// (`POST /admin/tenants/{slug}/invoices/{invoiceId}/cancellation/preview` and
// `…/cancellation`); `tests/openapi-covers-the-implementation.test.js` holds
// them to the contract from the other side.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import {
    AdminError,
    bindResource,
    cancellationRequestOf,
    emptyCancellationDraft,
    isCancellable,
    tenantsResource,
    useInvoiceCancellation,
} from '../dist/index.js';

async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

/** An invoice of the tenant's list, standing unless `overrides` say otherwise. */
const invoiceOf = (overrides = {}) => ({
    id: 'invoice-123',
    number: 'AHP-2026-000123',
    issuedAt: '2026-02-01T05:15:00.000Z',
    dueDate: '2026-02-15',
    totalGross: 119,
    currency: 'EUR',
    owed: 0,
    correction: null,
    cancelledBy: null,
    ...overrides,
});

const OF = { invoiceId: 'invoice-123', number: 'AHP-2026-000123', issueDate: '2026-02-01' };

/** What the server says cancelling it would write: 100 net, reverse charge, 19 credited. */
const planOf = (overrides = {}) => ({
    cancelled: { number: 'AHP-2026-000123', currency: 'EUR', subscriber: {} },
    cancellation: { totalGross: 119 },
    replacement: {
        issueDate: '2026-03-20',
        dueDate: '2026-04-03',
        totalNet: 100,
        totalTax: 0,
        totalGross: 100,
        taxTreatment: { kind: 'reverse-charge', rate: 0 },
        subscriber: {},
    },
    movedIn: 100,
    credited: 19,
    reason: 'The billing address was wrong.',
    deliverTo: null,
    ...overrides,
});

const SHOWN = {
    replacement: { totalGross: 100, totalTax: 0, dueDate: '2026-04-03' },
    movedIn: 100,
    credited: 19,
};

const CANCELLED = {
    cancellationInvoice: { number: 'AHP-2026-000140' },
    replacement: { number: 'AHP-2026-000141', paidOnIssue: 100 },
    credits: [{ amount: 19 }],
};

// @requirement SC-ADM-034 — Each invoice on the tenant page says what it corrects and what cancelled it
describe('the invoices a cancellation is offered at', () => {
    for (const [what, overrides, offered] of [
        ['an invoice issued for the charges', {}, true],
        ['a replacement that stands', { correction: { kind: 'replacement', of: OF } }, true],
        ['a cancellation invoice', { correction: { kind: 'cancellation', of: OF } }, false],
        [
            'an invoice cancelled already',
            { cancelledBy: { invoiceId: 'invoice-140', number: 'AHP-2026-000140' } },
            false,
        ],
    ]) {
        test(`${what}: ${offered ? 'offered' : 'not offered'}`, () => {
            assert.equal(isCancellable(invoiceOf(overrides)), offered);
        });
    }
});

// @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
describe('the request what the operator entered makes', () => {
    test('with nothing but a reason: the reason trimmed, no corrections, no address', () => {
        assert.deepEqual(
            cancellationRequestOf({ ...emptyCancellationDraft(), reason: '  Wrong address. ' }),
            { reason: 'Wrong address.', deliverTo: null },
        );
    });

    test('each text trimmed, a detail typed as nothing left as it was, one taken over as none kept', () => {
        assert.deepEqual(
            cancellationRequestOf({
                reason: 'Wrong address.',
                deliverTo: ' accounts@acme.example ',
                corrections: { addressLine1: ' Hauptstraße 5 ', city: '   ', addressLine2: null },
            }),
            {
                reason: 'Wrong address.',
                corrections: { addressLine1: 'Hauptstraße 5', addressLine2: null },
                deliverTo: 'accounts@acme.example',
            },
        );
    });
});

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function answering(status, body) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body === undefined ? undefined : JSON.parse(init.body),
            mfa: init?.headers?.['X-Mfa-Code'] ?? null,
        });
        return Promise.resolve({
            status,
            headers: { get: () => (body === undefined ? null : 'application/json') },
            json: async () => body,
            text: async () => (body === undefined ? '' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

describe('the tenants descriptor', () => {
    const REQUEST = { reason: 'Wrong address.', deliverTo: null };

    test('asks for the preview, the tenant and the invoice escaped, without the second factor', async () => {
        const { http, calls } = answering(200, planOf());

        const plan = await bindResource(tenantsResource, http, CTX).previewInvoiceCancellation(
            'a b',
            'invoice/1',
            REQUEST,
        );

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/tenants/a%20b/invoices/invoice%2F1/cancellation/preview',
                method: 'POST',
                body: REQUEST,
                mfa: null,
            },
        ]);
        assert.deepEqual(plan, planOf());
    });

    // @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
    test('cancels with the second factor and the figures shown', async () => {
        const { http, calls } = answering(200, CANCELLED);
        const request = { ...REQUEST, shown: SHOWN };

        const cancelled = await bindResource(tenantsResource, http, CTX).cancelInvoice(
            'acme',
            'invoice-123',
            request,
            '123456',
        );

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/tenants/acme/invoices/invoice-123/cancellation',
                method: 'POST',
                body: request,
                mfa: '123456',
            },
        ]);
        assert.deepEqual(cancelled, CANCELLED);
    });
});

const serving = (capabilities) => ({ capabilities });
const BOTH = serving({ 'payments.read': true, 'invoices.cancel': true });

/**
 * The cancellation on tenant `acme`, every call recorded: the preview answers
 * `plans` one after another, the cancellation answers `CANCELLED` or throws
 * `failWith`, and the second factor is answered as `code` after
 * `whilePrompted` has run.
 */
function cancellationOf({
    manifest = BOTH,
    plans = [planOf()],
    previewWith,
    failWith,
    code = '123456',
    whilePrompted,
} = {}) {
    const calls = [];
    const notices = [];
    const reloads = [];
    const answers = [...plans];
    const tenants = {
        previewInvoiceCancellation: async (slug, invoiceId, request) => {
            calls.push(['preview', slug, invoiceId, request]);
            return previewWith ? previewWith() : answers.shift();
        },
        cancelInvoice: async (slug, invoiceId, request, mfaCode) => {
            calls.push(['cancel', slug, invoiceId, request, mfaCode]);
            if (failWith) throw failWith;
            return CANCELLED;
        },
    };
    const slug = ref('acme');
    const mfa = {
        async run(description, _invalidCode, action) {
            calls.push(['mfa', description]);
            whilePrompted?.(slug);
            if (code === null) return { done: false };
            return { done: true, value: await action(code) };
        },
    };
    const flow = useInvoiceCancellation(slug, ref(manifest), tenants, {
        notify: (kind, message) => notices.push([kind, message]),
        mfa,
        onCancelled: async () => reloads.push('reloaded'),
    });
    return { flow, calls, notices, reloads, slug };
}

const DRAFT = { reason: '  The billing address was wrong. ', deliverTo: '', corrections: {} };
const ASKED = { reason: 'The billing address was wrong.', deliverTo: null };

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where cancelling is offered', () => {
    for (const [what, capabilities, offered] of [
        ['with the payments and the cancellation served', BOTH, true],
        ['with the payments alone', serving({ 'payments.read': true }), false],
        ['with the cancellation alone', serving({ 'invoices.cancel': true }), false],
        ['with neither', serving({}), false],
    ]) {
        test(`${what}: ${offered ? 'at an invoice that stands' : 'nowhere'}`, () => {
            const { flow } = cancellationOf({ manifest: capabilities });

            assert.equal(flow.available.value, offered);
            assert.equal(flow.canCancel(invoiceOf()), offered);
        });
    }

    test('never at a cancellation invoice, wherever it is served', () => {
        const { flow } = cancellationOf();

        assert.equal(
            flow.canCancel(invoiceOf({ correction: { kind: 'cancellation', of: OF } })),
            false,
        );
    });
});

// @requirement SC-UI-017 — A confirmation shows the answer to the question actually being asked
describe('cancelling an invoice', () => {
    test('previews what the input would write, and that is the second step', async () => {
        const { flow, calls } = cancellationOf();
        flow.open(invoiceOf());

        const answered = await flow.ask(DRAFT);

        assert.deepEqual(calls, [['preview', 'acme', 'invoice-123', ASKED]]);
        assert.deepEqual([answered, flow.preview.value], [null, planOf()]);
    });

    test('a refused preview rejects with the refusal, and the first step stays', async () => {
        const refusal = new AdminError({
            status: 409,
            code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_YET_ARCHIVED,
        });
        const { flow } = cancellationOf({ previewWith: () => Promise.reject(refusal) });
        flow.open(invoiceOf());

        await assert.rejects(() => flow.ask(DRAFT), refusal);

        assert.equal(flow.preview.value, null);
    });

    test('asks nothing of an input that gives no reason', async () => {
        const { flow, calls } = cancellationOf();
        flow.open(invoiceOf());

        await flow.ask({ ...DRAFT, reason: '   ' });

        assert.deepEqual([calls, flow.preview.value], [[], null]);
    });

    test('going back discards the preview, and an answer still on its way is dropped', async () => {
        let answer;
        const { flow } = cancellationOf({
            previewWith: () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        });
        flow.open(invoiceOf());

        const asking = flow.ask(DRAFT);
        flow.back();
        answer(planOf());

        assert.equal(await asking, null);
        assert.equal(flow.preview.value, null);
    });

    test('a refusal of a question no longer asked is dropped, not shown against the one on screen', async () => {
        let refuse;
        const { flow } = cancellationOf({
            previewWith: () =>
                new Promise((_resolve, reject) => {
                    refuse = reject;
                }),
        });
        flow.open(invoiceOf());

        const asking = flow.ask(DRAFT);
        flow.back();
        refuse(new AdminError({ status: 500 }));

        assert.equal(await asking, null);
    });

    // @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
    test('is confirmed behind the second factor with the request previewed and the figures shown, announced, and read again', async () => {
        const { flow, calls, notices, reloads } = cancellationOf();
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        const cancelled = await flow.cancel();

        assert.deepEqual(cancelled, CANCELLED);
        assert.deepEqual(calls.slice(1), [
            ['mfa', 'Cancel invoice AHP-2026-000123. Enter the TOTP code.'],
            ['cancel', 'acme', 'invoice-123', { ...ASKED, shown: SHOWN }, '123456'],
        ]);
        assert.deepEqual(notices, [
            ['positive', 'Cancelled by AHP-2026-000140, replaced by AHP-2026-000141.'],
        ]);
        assert.deepEqual(reloads, ['reloaded']);
        assert.equal(flow.target.value, null);
    });

    test('sends what the preview answered, not what was entered after it', async () => {
        const { flow, calls } = cancellationOf();
        flow.open(invoiceOf());
        const draft = { ...DRAFT, corrections: {} };
        await flow.ask(draft);
        draft.reason = 'Something else entirely.';
        draft.corrections.city = 'Bremen';

        await flow.cancel();

        assert.deepEqual(calls.at(-1)[3], { ...ASKED, shown: SHOWN });
    });

    test('for the tenant it was opened on, though the page moved on meanwhile', async () => {
        const { flow, calls } = cancellationOf({
            whilePrompted: (slug) => {
                slug.value = 'northwind';
            },
        });
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        await flow.cancel();

        assert.equal(calls.at(-1)[1], 'acme');
    });

    test('stepped back from at the second factor stays on its preview, cancelling nothing', async () => {
        const { flow, calls, notices, reloads } = cancellationOf({ code: null });
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        assert.equal(await flow.cancel(), null);

        assert.equal(calls.filter(([what]) => what === 'cancel').length, 0);
        assert.deepEqual([notices, reloads], [[], []]);
        assert.deepEqual(flow.preview.value, planOf());
    });

    test('refused because what it writes changed shows the new preview to confirm, and nothing else', async () => {
        const changed = planOf({ movedIn: 119, credited: 0 });
        const { flow, notices, reloads } = cancellationOf({
            failWith: new AdminError({
                status: 409,
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED,
                body: { preview: changed },
            }),
        });
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        await assert.rejects(() => flow.cancel(), /Something changed since the preview/);

        assert.deepEqual(flow.preview.value, changed);
        assert.deepEqual([notices, reloads], [[], []]);
        assert.equal(flow.target.value?.id, 'invoice-123');
    });

    test('confirmed again after such a refusal, carries the figures of the new preview', async () => {
        const changed = planOf({ movedIn: 119, credited: 0 });
        const failWith = new AdminError({
            status: 409,
            code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED,
            body: { preview: changed },
        });
        const setUp = cancellationOf({ failWith });
        setUp.flow.open(invoiceOf());
        await setUp.flow.ask(DRAFT);
        await assert.rejects(() => setUp.flow.cancel());

        await assert.rejects(() => setUp.flow.cancel());

        assert.deepEqual(setUp.calls.at(-1)[3].shown, { ...SHOWN, movedIn: 119, credited: 0 });
    });

    test('refused otherwise rejects with the refusal, and keeps the preview it was refused on', async () => {
        const refusal = new AdminError({
            status: 409,
            code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED,
            body: {},
        });
        const { flow, notices } = cancellationOf({ failWith: refusal });
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        await assert.rejects(() => flow.cancel(), refusal);

        assert.deepEqual([flow.preview.value, notices], [planOf(), []]);
    });

    test('opened on another invoice starts afresh', async () => {
        const { flow } = cancellationOf();
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        flow.open(invoiceOf({ id: 'invoice-124', number: 'AHP-2026-000124' }));
        await settle();

        assert.equal(flow.preview.value, null);
    });
});
