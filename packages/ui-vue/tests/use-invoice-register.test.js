// useInvoiceRegister — the register of every invoice, the months the operator
// picks, a page at a time, and what they add up to; useCancellationParty — the
// subscriber an invoice opened for cancelling names; invoiceStandingOf — how an
// invoice stands to another, worded alike in the record and the register.

// @requirement SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';
import { ERROR_MESSAGES_EN, INVOICE_ERROR_CODES, catalogueSentenceFor } from '@saasicat/core';

import { invoiceStandingOf, useCancellationParty, useInvoiceRegister } from '../dist/index.js';

async function settle() {
    await nextTick();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

const row = (id) => ({ id, number: `AHP-2026-${id}`, correction: null, cancelledBy: null });
const TOTALS = (from, until) => ({ from, until, months: [], range: [] });

/**
 * The register's operations, every request recorded. `pages` answers a page
 * by what it was asked, the platform's current month where none is.
 */
function aRegister(pages = async () => ({ invoices: [row('1')], next: null })) {
    const asked = { list: [], totals: [] };
    const current = '2026-10';
    return {
        asked,
        invoices: {
            list: async (request) => {
                asked.list.push(request);
                const from = request.from ?? request.until ?? current;
                const until = request.until ?? request.from ?? current;
                return { from, until, ...(await pages(request)) };
            },
            totals: async (months) => {
                asked.totals.push(months);
                return TOTALS(months.from ?? current, months.until ?? current);
            },
        },
    };
}

describe('useInvoiceRegister', () => {
    test('reads the platform’s current month at once, page and totals, and shows the months it answered', async () => {
        const { asked, invoices } = aRegister();

        const register = useInvoiceRegister(invoices);
        await settle();

        assert.deepEqual(asked, { list: [{}], totals: [{}] });
        assert.deepEqual([register.from.value, register.until.value], ['2026-10', '2026-10']);
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['1'],
        );
        assert.deepEqual(register.totals.value, TOTALS('2026-10', '2026-10'));
        assert.equal(register.refusal.value, null);
    });

    test('showing the months it answered is no change of what is asked, and reads nothing again', async () => {
        const { asked, invoices } = aRegister();
        useInvoiceRegister(invoices);
        await settle();
        await settle();

        assert.equal(asked.list.length, 1);
        assert.equal(asked.totals.length, 1);
    });

    test('months picked are read anew, page and totals, from the first page', async () => {
        const { asked, invoices } = aRegister(({ after }) =>
            after ? { invoices: [row('2')], next: null } : { invoices: [row('1')], next: '1' },
        );
        const register = useInvoiceRegister(invoices);
        await settle();
        await register.more();

        register.from.value = '2026-07';
        register.until.value = '2026-09';
        await settle();

        assert.deepEqual(asked.list.at(-1), { from: '2026-07', until: '2026-09' });
        assert.deepEqual(asked.totals.at(-1), { from: '2026-07', until: '2026-09' });
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['1'],
            'the page read for the months before is gone',
        );
    });

    for (const [why, from, until, code, params] of [
        [
            'the second month before the first',
            '2026-09',
            '2026-07',
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_REVERSED,
            { from: '2026-09', until: '2026-07' },
        ],
        [
            'more than a year',
            '2026-01',
            '2027-01',
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_TOO_LONG,
            { from: '2026-01', until: '2027-01', months: 13, max: 12 },
        ],
    ]) {
        test(`${why} is said in the platform’s words before anything is asked`, async () => {
            const { asked, invoices } = aRegister();
            const register = useInvoiceRegister(invoices);
            await settle();

            register.from.value = from;
            register.until.value = until;
            await settle();

            assert.equal(
                register.refusal.value,
                catalogueSentenceFor({ code, params }, ERROR_MESSAGES_EN),
            );
            assert.deepEqual([asked.list.length, asked.totals.length], [1, 1]);
            assert.deepEqual([register.rows.value, register.totals.value], [[], null]);
        });
    }

    for (const typed of ['2026-1', '2026-13', '0999-12']) {
        test(`${JSON.stringify(typed)} is no month, and nothing is asked for it`, async () => {
            const { asked, invoices } = aRegister();
            const register = useInvoiceRegister(invoices);
            await settle();

            register.until.value = typed;
            await settle();

            assert.match(register.refusal.value, /YYYY-MM/);
            assert.equal(asked.list.length, 1);
        });
    }

    test('back from refused months to the ones read before, reads them again', async () => {
        const { asked, invoices } = aRegister();
        const register = useInvoiceRegister(invoices);
        await settle();

        register.until.value = '2026-01';
        await settle();
        register.until.value = '2026-10';
        await settle();

        assert.equal(register.refusal.value, null);
        assert.deepEqual(asked.list.at(-1), { from: '2026-10', until: '2026-10' });
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['1'],
        );
    });

    test('the next page is added after the last invoice read', async () => {
        const { asked, invoices } = aRegister(({ after }) =>
            after === '1'
                ? { invoices: [row('2')], next: null }
                : { invoices: [row('1')], next: '1' },
        );
        const register = useInvoiceRegister(invoices);
        await settle();

        assert.equal(register.hasMore.value, true);
        await register.more();

        assert.deepEqual(asked.list.at(-1), { from: '2026-10', until: '2026-10', after: '1' });
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['1', '2'],
        );
        assert.equal(register.hasMore.value, false);
    });

    test('a page whose months were left while it was on its way is dropped', async () => {
        let release;
        const { invoices } = aRegister(({ after }) =>
            after
                ? new Promise((resolve) => {
                      release = () => resolve({ invoices: [row('late')], next: null });
                  })
                : { invoices: [row('1')], next: '1' },
        );
        const register = useInvoiceRegister(invoices);
        await settle();

        const more = register.more();
        await settle();
        register.from.value = '2026-07';
        await settle();
        release();
        await more;

        assert.ok(!register.rows.value.some(({ id }) => id === 'late'));
    });

    test('months typed while the first answer is on its way are not overwritten by it', async () => {
        let release;
        const { asked, invoices } = aRegister(({ from }) =>
            from
                ? { invoices: [row('picked')], next: null }
                : new Promise((resolve) => {
                      release = () => resolve({ invoices: [row('current')], next: null });
                  }),
        );
        const register = useInvoiceRegister(invoices);
        await settle();

        register.from.value = '2026-03';
        await settle();
        release();
        await settle();

        // The month left out is the one the answer to what was typed names,
        // not the current month the earlier answer named.
        assert.deepEqual([register.from.value, register.until.value], ['2026-03', '2026-03']);
        assert.deepEqual(asked.list.at(-1), { from: '2026-03' });
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['picked'],
        );
    });

    test('the months a stale answer named are read when they are picked, not taken as shown', async () => {
        let release;
        const { asked, invoices } = aRegister(({ from }) =>
            from === undefined
                ? new Promise((resolve) => {
                      release = () => resolve({ invoices: [row('stale')], next: null });
                  })
                : { invoices: [row(from)], next: null },
        );
        const register = useInvoiceRegister(invoices);
        await settle();
        register.from.value = '2026-03';
        await settle();
        release();
        await settle();

        // Both at once, the months the stale answer named: what is on screen
        // was read for March, so October is asked for.
        register.from.value = '2026-10';
        register.until.value = '2026-10';
        await settle();

        assert.deepEqual(asked.list.at(-1), { from: '2026-10', until: '2026-10' });
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['2026-10'],
        );
    });

    test('back to the months on screen while others are on their way, reads them again and drops the others', async () => {
        const held = [];
        const { asked, invoices } = aRegister(({ from }) =>
            from === '2026-07'
                ? new Promise((resolve) => {
                      held.push(() => resolve({ invoices: [row('july')], next: 'july' }));
                  })
                : { invoices: [row(from ?? 'current')], next: null },
        );
        const totals = invoices.totals;
        invoices.totals = (months) =>
            months.from === '2026-07'
                ? new Promise((resolve) => held.push(() => resolve(totals(months))))
                : totals(months);
        const register = useInvoiceRegister(invoices);
        await settle();

        register.from.value = '2026-07';
        register.until.value = '2026-07';
        await settle();
        register.from.value = '2026-10';
        register.until.value = '2026-10';
        await settle();
        for (const release of held) release();
        await settle();

        assert.deepEqual(asked.list.at(-1), { from: '2026-10', until: '2026-10' });
        assert.deepEqual(
            register.rows.value.map(({ id }) => id),
            ['2026-10'],
        );
        assert.deepEqual(register.totals.value?.from, '2026-10');
        assert.equal(register.hasMore.value, false, 'no page continues July under October');
    });

    test('a failure of the totals is the register’s failure, and a reload clears it', async () => {
        const { invoices } = aRegister();
        let fail = true;
        const totals = invoices.totals;
        invoices.totals = async (months) => {
            if (fail) throw new Error('the totals failed');
            return totals(months);
        };
        const register = useInvoiceRegister(invoices);
        await settle();

        assert.ok(register.error.value);
        fail = false;
        await register.reload();

        assert.equal(register.error.value, null);
        assert.deepEqual(register.totals.value, TOTALS('2026-10', '2026-10'));
    });
});

describe('useCancellationParty', () => {
    test('reads nothing until an invoice names a subscriber, then that subscriber’s record', async () => {
        const reads = [];
        const subscribers = {
            record: async (id) => {
                reads.push(id);
                return { subscriber: { id, legalName: `${id} GmbH` }, tenants: [] };
            },
        };
        const subject = ref(null);

        const party = useCancellationParty(subscribers, () => subject.value);
        await settle();
        assert.deepEqual([reads, party.data.value], [[], null]);

        subject.value = 's-1';
        await settle();
        assert.deepEqual([reads, party.data.value?.legalName], [['s-1'], 's-1 GmbH']);

        subject.value = 's-2';
        await settle();
        subject.value = null;
        await settle();
        assert.deepEqual([reads, party.data.value], [['s-1', 's-2'], null]);
    });
});

describe('invoiceStandingOf', () => {
    const MESSAGES = {
        cancellationOf: 'Cancellation of {number}',
        replacementOf: 'Replaces {number}',
        cancelledBy: 'Cancelled by {number}',
    };
    const of = { invoiceId: 'i-1', number: 'AHP-2026-000001', issueDate: '2026-02-01' };

    for (const [why, invoice, standing] of [
        [
            'an invoice that corrects nothing and stands',
            { correction: null, cancelledBy: null },
            '',
        ],
        [
            'a cancellation invoice',
            { correction: { kind: 'cancellation', of }, cancelledBy: null },
            'Cancellation of AHP-2026-000001',
        ],
        [
            'a replacement cancelled in turn',
            {
                correction: { kind: 'replacement', of },
                cancelledBy: { invoiceId: 'i-9', number: 'AHP-2026-000009' },
            },
            'Replaces AHP-2026-000001 · Cancelled by AHP-2026-000009',
        ],
    ]) {
        test(`${why} reads ${JSON.stringify(standing)}`, () => {
            assert.equal(invoiceStandingOf(invoice, MESSAGES), standing);
        });
    }
});
