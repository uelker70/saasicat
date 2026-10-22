// The operator cancels one of a tenant's invoices from its page: at which
// invoices it is offered, what of each line the operator may say is owed, the
// request the input makes, the three requests of the tenants descriptor, and
// the flow — the invoice's lines read on opening, preview, back, the second
// factor, the preview's digest sent along, and a preview that no longer holds
// put in place of the one confirmed.
//
// The paths are the ones `@saasicat/nest` serves
// (`GET /admin/tenants/{slug}/invoices/{invoiceId}`, `…/cancellation/preview`
// and `…/cancellation`); `tests/openapi-covers-the-implementation.test.js`
// holds them to the contract from the other side.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import {
    AdminError,
    bindResource,
    cancellationRequestOf,
    emptyCancellationDraft,
    isAskable,
    isCancellable,
    tenantsResource,
    useInvoiceCancellation,
    whyNotCorrectable,
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

/** The digest the preview answers, and the one a preview read again answers once a payment came in. */
const DIGEST = '1'.repeat(64);
const DIGEST_AFTER_A_PAYMENT = '2'.repeat(64);

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
    digest: DIGEST,
    ...overrides,
});

/** The invoice with its lines, as the dialog reads it: the plan may be corrected, the discount not. */
const readOf = (id = 'invoice-123') => ({
    id,
    number: 'AHP-2026-000123',
    issuedAt: '2026-02-01T05:15:00.000Z',
    dueDate: '2026-02-15',
    currency: 'EUR',
    totalNet: 100,
    totalTax: 19,
    totalGross: 119,
    lines: [
        { position: 1, title: 'Standard', origin: 'renewal', source: 'plan', amountNet: 110 },
        { position: 2, title: 'Welcome', origin: 'renewal', source: 'discount', amountNet: -10 },
    ].map((line) => ({
        periodFrom: '2026-02-01',
        periodUntil: '2026-02-28',
        taxRate: 19,
        correctedPosition: null,
        correctsPosition: null,
        standsAt: line.amountNet,
        correctable: line.source === 'plan',
        ...line,
    })),
});

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
                lines: {},
            }),
            {
                reason: 'Wrong address.',
                corrections: { addressLine1: 'Hauptstraße 5', addressLine2: null },
                deliverTo: 'accounts@acme.example',
            },
        );
    });
});

// @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
describe('what of each line the operator says is owed', () => {
    const withLines = (lines) => ({ ...emptyCancellationDraft(), reason: 'Not owed.', lines });

    test('names a line not owed as nothing owed, one owed in part with its amount, and leaves one owed out', () => {
        assert.deepEqual(
            cancellationRequestOf(
                withLines({
                    1: { choice: 'not-owed', amount: 12 },
                    2: { choice: 'part', amount: 24.5 },
                    3: { choice: 'owed', amount: 7 },
                }),
            ).lines,
            [
                { position: 1, owed: 0 },
                { position: 2, owed: 24.5 },
            ],
        );
    });

    test('names no lines where every line is owed', () => {
        assert.equal(
            'lines' in cancellationRequestOf(withLines({ 1: { choice: 'owed', amount: null } })),
            false,
        );
    });

    for (const [what, draft, askable] of [
        ['a reason and nothing else', withLines({}), true],
        [
            'a line owed in part with its amount',
            withLines({ 1: { choice: 'part', amount: 0 } }),
            true,
        ],
        [
            'a line owed in part without one',
            withLines({ 1: { choice: 'part', amount: null } }),
            false,
        ],
        [
            'a line not owed, nothing typed',
            withLines({ 1: { choice: 'not-owed', amount: null } }),
            true,
        ],
        ['no reason', { ...withLines({}), reason: '  ' }, false],
    ]) {
        test(`with ${what}: ${askable ? 'asked about' : 'not asked about yet'}`, () => {
            assert.equal(isAskable(draft), askable);
        });
    }

    for (const [what, line, why] of [
        ['a discount', { origin: 'renewal', source: 'discount' }, 'discount'],
        ['a correction', { origin: 'correction', source: 'plan' }, 'correction'],
        ['a correction of a discount', { origin: 'correction', source: 'discount' }, 'correction'],
        ['a charge taken to nothing', { origin: 'renewal', source: 'plan' }, 'nothing'],
    ]) {
        test(`${what} offers no choice, and says why: ${why}`, () => {
            assert.equal(whyNotCorrectable(line), why);
        });
    }
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

    // @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
    test('reads the invoice with its lines, the tenant and the invoice escaped', async () => {
        const { http, calls } = answering(200, readOf());

        const read = await bindResource(tenantsResource, http, CTX).invoice('a b', 'invoice/1');

        assert.deepEqual(calls, [
            {
                url: '/api/v1/admin/tenants/a%20b/invoices/invoice%2F1',
                method: 'GET',
                body: undefined,
                mfa: null,
            },
        ]);
        assert.deepEqual(read, readOf());
    });

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
    test('cancels with the second factor and the preview’s digest', async () => {
        const { http, calls } = answering(200, CANCELLED);
        const request = { ...REQUEST, previewDigest: DIGEST };

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
    answer = CANCELLED,
    readWith = (invoiceId) => Promise.resolve(readOf(invoiceId)),
} = {}) {
    const calls = [];
    const reads = [];
    const notices = [];
    const reloads = [];
    const answers = [...plans];
    const tenants = {
        invoice: async (slug, invoiceId) => {
            reads.push([slug, invoiceId]);
            return readWith(invoiceId);
        },
        previewInvoiceCancellation: async (slug, invoiceId, request) => {
            calls.push(['preview', slug, invoiceId, request]);
            return previewWith ? previewWith() : answers.shift();
        },
        cancelInvoice: async (slug, invoiceId, request, mfaCode) => {
            calls.push(['cancel', slug, invoiceId, request, mfaCode]);
            if (failWith) throw failWith;
            return answer;
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
    return { flow, calls, reads, notices, reloads, slug };
}

const DRAFT = {
    reason: '  The billing address was wrong. ',
    deliverTo: '',
    corrections: {},
    lines: {},
};
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
    test('is confirmed behind the second factor with the request previewed and its digest, announced, and read again', async () => {
        const { flow, calls, notices, reloads } = cancellationOf();
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        const cancelled = await flow.cancel();

        assert.deepEqual(cancelled, CANCELLED);
        assert.deepEqual(calls.slice(1), [
            ['mfa', 'Cancel invoice AHP-2026-000123. Enter the TOTP code.'],
            ['cancel', 'acme', 'invoice-123', { ...ASKED, previewDigest: DIGEST }, '123456'],
        ]);
        assert.deepEqual(notices, [
            ['positive', 'Cancelled by AHP-2026-000140, replaced by AHP-2026-000141.'],
        ]);
        assert.deepEqual(reloads, ['reloaded']);
        assert.equal(flow.target.value, null);
    });

    test('announces a cancellation that left no replacement as one', async () => {
        const answer = { ...CANCELLED, replacement: null };
        const { flow, notices } = cancellationOf({
            plans: [{ ...planOf(), replacement: null }],
            answer,
        });
        flow.open(invoiceOf());
        await flow.ask(DRAFT);

        assert.deepEqual(await flow.cancel(), answer);
        assert.deepEqual(notices, [
            [
                'positive',
                'Cancelled by AHP-2026-000140. Nothing of it is owed any more, so there is no replacement.',
            ],
        ]);
    });

    test('sends what the preview answered, not what was entered after it', async () => {
        const { flow, calls } = cancellationOf();
        flow.open(invoiceOf());
        const draft = { ...DRAFT, corrections: {} };
        await flow.ask(draft);
        draft.reason = 'Something else entirely.';
        draft.corrections.city = 'Bremen';

        await flow.cancel();

        assert.deepEqual(calls.at(-1)[3], { ...ASKED, previewDigest: DIGEST });
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

    test('confirmed again after such a refusal, carries the digest of the new preview', async () => {
        const changed = planOf({ movedIn: 119, credited: 0, digest: DIGEST_AFTER_A_PAYMENT });
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

        assert.equal(setUp.calls.at(-1)[3].previewDigest, DIGEST_AFTER_A_PAYMENT);
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

    // @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
    test('asks nothing while a line owed in part says no amount', async () => {
        const { flow, calls } = cancellationOf();
        flow.open(invoiceOf());

        await flow.ask({ ...DRAFT, lines: { 1: { choice: 'part', amount: null } } });

        assert.deepEqual([calls, flow.preview.value], [[], null]);
    });

    // @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
    test('sends the lines the operator named with the request it previews', async () => {
        const { flow, calls } = cancellationOf();
        flow.open(invoiceOf());

        await flow.ask({ ...DRAFT, lines: { 1: { choice: 'part', amount: 24.5 } } });

        assert.deepEqual(calls[0][3].lines, [{ position: 1, owed: 24.5 }]);
    });
});

// @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
describe('the lines the dialog offers', () => {
    test('are read when it opens', async () => {
        const { flow, reads } = cancellationOf();

        flow.open(invoiceOf());
        await settle();

        assert.deepEqual(reads, [['acme', 'invoice-123']]);
        assert.deepEqual(flow.invoice.data.value, readOf());
        assert.equal(flow.invoice.pending.value, false);
    });

    test('of another invoice replace the first one’s at once, and are read for it', async () => {
        let answer;
        const { flow, reads } = cancellationOf({
            readWith: (invoiceId) =>
                invoiceId === 'invoice-123'
                    ? Promise.resolve(readOf(invoiceId))
                    : new Promise((resolve) => {
                          answer = () => resolve(readOf(invoiceId));
                      }),
        });
        flow.open(invoiceOf());
        await settle();

        flow.open(invoiceOf({ id: 'invoice-124', number: 'AHP-2026-000124' }));
        await settle();

        assert.equal(flow.invoice.data.value, null);
        assert.equal(flow.invoice.pending.value, true);
        answer();
        await settle();
        assert.deepEqual(
            [reads.at(-1), flow.invoice.data.value.id],
            [['acme', 'invoice-124'], 'invoice-124'],
        );
    });

    test('go when it closes', async () => {
        const { flow } = cancellationOf();
        flow.open(invoiceOf());
        await settle();

        flow.close();
        await settle();

        assert.equal(flow.invoice.data.value, null);
    });

    test('that fail to load say so, and are read again on retry', async () => {
        let fail = true;
        const { flow, reads } = cancellationOf({
            readWith: (invoiceId) =>
                fail
                    ? Promise.reject(new AdminError({ status: 500 }))
                    : Promise.resolve(readOf(invoiceId)),
        });
        flow.open(invoiceOf());
        await settle();

        assert.deepEqual([flow.invoice.data.value, flow.invoice.error.value?.status], [null, 500]);
        fail = false;
        await flow.invoice.reload();
        assert.deepEqual(
            [reads.length, flow.invoice.data.value, flow.invoice.error.value],
            [2, readOf(), null],
        );
    });
});
