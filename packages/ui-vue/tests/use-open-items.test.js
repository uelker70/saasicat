// useOpenItems — the open invoices, all or overdue alone, the open credits,
// each a page at a time, their totals, and the payout of a credit from its
// row behind the second factor.

// @requirement SC-ADM-044 — An operator lists what subscribers still owe and are still owed, across every tenant

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useOpenItems } from '../dist/index.js';

async function settle() {
    await nextTick();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

const invoice = (id) => ({ id, number: `AHP-${id}` });
const credit = (id, subscriberId = 's-1') => ({ id, subscriber: { id: subscriberId } });

/**
 * The open items' operations, every request recorded. `invoicePages` and
 * `creditPages` answer by what was asked.
 */
function anInstallation({
    invoicePages = () => ({ invoices: [invoice('1')], next: null }),
    creditPages = () => ({ credits: [credit('c-1')], next: null, timeZone: 'Europe/Berlin' }),
} = {}) {
    const asked = { invoices: [], credits: [], totals: 0, payouts: [] };
    const openItems = {
        invoices: async (request) => {
            asked.invoices.push(request);
            return {
                today: '2026-10-27',
                overdueOnly: Boolean(request.overdue),
                ...(await invoicePages(request)),
            };
        },
        credits: async (request) => {
            asked.credits.push(request);
            return creditPages(request);
        },
        totals: async () => {
            asked.totals += 1;
            return { today: '2026-10-27', invoices: [], credits: [] };
        },
    };
    const subscribers = {
        recordPayout: async (...args) => {
            asked.payouts.push(args);
            return { credits: [], timeZone: 'Europe/Berlin' };
        },
    };
    return { asked, openItems, subscribers };
}

/** The ports a page binds: what is told, and a second factor that answers `code` or steps back. */
function portsWith(code = '123456') {
    const told = [];
    const prompted = [];
    return {
        told,
        prompted,
        ports: {
            notify: (kind, message) => told.push([kind, message]),
            mfa: {
                run: async (description, _invalid, fn) => {
                    prompted.push(description);
                    return code === null ? { done: false } : { done: true, value: await fn(code) };
                },
            },
        },
    };
}

const PAYING = ref({ capabilities: { 'payments.read': true, 'credits.payout': true } });

describe('useOpenItems', () => {
    test('reads the first page of open invoices and credits and the totals at once', async () => {
        const { asked, openItems, subscribers } = anInstallation();

        const open = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        await settle();

        assert.deepEqual(asked.invoices, [{ overdue: false }]);
        assert.deepEqual(asked.credits, [{}]);
        assert.equal(asked.totals, 1);
        assert.deepEqual(
            [
                open.invoices.rows.value.map(({ id }) => id),
                open.credits.rows.value.map(({ id }) => id),
            ],
            [['1'], ['c-1']],
        );
        assert.equal(open.timeZone.value, 'Europe/Berlin');
    });

    test('overdue alone reads the invoices anew from their first page, and leaves the credits as they are', async () => {
        const { asked, openItems, subscribers } = anInstallation({
            invoicePages: ({ after }) =>
                after
                    ? { invoices: [invoice('2')], next: null }
                    : { invoices: [invoice('1')], next: '1' },
        });
        const open = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        await settle();
        await open.invoices.more();

        open.overdueOnly.value = true;
        await settle();

        assert.deepEqual(asked.invoices.at(-1), { overdue: true });
        assert.deepEqual(
            open.invoices.rows.value.map(({ id }) => id),
            ['1'],
            'the page read before is gone',
        );
        assert.equal(asked.credits.length, 1);
    });

    test('the next page of each list is added after the last row read', async () => {
        const { asked, openItems, subscribers } = anInstallation({
            invoicePages: ({ after }) =>
                after === '1'
                    ? { invoices: [invoice('2')], next: null }
                    : { invoices: [invoice('1')], next: '1' },
            creditPages: ({ after }) =>
                after === 'c-1'
                    ? { credits: [credit('c-2')], next: null, timeZone: 'Europe/Berlin' }
                    : { credits: [credit('c-1')], next: 'c-1', timeZone: 'Europe/Berlin' },
        });
        const open = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        await settle();

        assert.deepEqual([open.invoices.hasMore.value, open.credits.hasMore.value], [true, true]);
        await open.invoices.more();
        await open.credits.more();

        assert.deepEqual(asked.invoices.at(-1), { overdue: false, after: '1' });
        assert.deepEqual(asked.credits.at(-1), { after: 'c-1' });
        assert.deepEqual(
            [
                open.invoices.rows.value.map(({ id }) => id),
                open.credits.rows.value.map(({ id }) => id),
            ],
            [
                ['1', '2'],
                ['c-1', 'c-2'],
            ],
        );
        assert.deepEqual([open.invoices.hasMore.value, open.credits.hasMore.value], [false, false]);
    });

    test('a page of invoices for a filter left while it was on its way is dropped', async () => {
        let release;
        const { openItems, subscribers } = anInstallation({
            invoicePages: ({ after }) =>
                after
                    ? new Promise((resolve) => {
                          release = () => resolve({ invoices: [invoice('late')], next: null });
                      })
                    : { invoices: [invoice('1')], next: '1' },
        });
        const open = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        await settle();

        const more = open.invoices.more();
        await settle();
        open.overdueOnly.value = true;
        await settle();
        release();
        await more;

        assert.ok(!open.invoices.rows.value.some(({ id }) => id === 'late'));
    });

    test('a page asked for twice before the first answer is added once', async () => {
        const { asked, openItems, subscribers } = anInstallation({
            invoicePages: ({ after }) =>
                after
                    ? { invoices: [invoice('2')], next: null }
                    : { invoices: [invoice('1')], next: '1' },
        });
        const open = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        await settle();

        await Promise.all([open.invoices.more(), open.invoices.more()]);

        assert.equal(asked.invoices.filter(({ after }) => after === '1').length, 2);
        assert.deepEqual(
            open.invoices.rows.value.map(({ id }) => id),
            ['1', '2'],
        );
    });

    test('a page that fails is the list’s failure, for the list on screen', async () => {
        const { openItems, subscribers } = anInstallation({
            creditPages: ({ after }) => {
                if (after) throw new Error('the next page failed');
                return { credits: [credit('c-1')], next: 'c-1', timeZone: 'Europe/Berlin' };
            },
        });
        const open = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        await settle();

        await open.credits.more();

        assert.ok(open.credits.error.value);
        assert.equal(open.invoices.error.value, null);
    });

    // @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
    test('a credit is paid out for its subscriber behind the second factor, and the credits and totals read again', async () => {
        const { asked, openItems, subscribers } = anInstallation();
        const { ports, told, prompted } = portsWith('654321');
        const open = useOpenItems(PAYING, openItems, subscribers, ports);
        await settle();
        const payout = { amount: 20, reference: 'TRF-1', paidOn: '2026-10-27', note: null };

        await open.payOut(credit('c-9', 's-7'), payout);

        assert.equal(prompted.length, 1);
        assert.deepEqual(asked.payouts, [['s-7', 'c-9', payout, '654321']]);
        assert.deepEqual(
            told.map(([kind]) => kind),
            ['positive'],
        );
        assert.deepEqual([asked.credits.length, asked.totals], [2, 2]);
        assert.equal(asked.invoices.length, 1, 'a payout changes no invoice');
    });

    test('a payout the second factor was not given for records nothing and reads nothing again', async () => {
        const { asked, openItems, subscribers } = anInstallation();
        const { ports, told } = portsWith(null);
        const open = useOpenItems(PAYING, openItems, subscribers, ports);
        await settle();

        const answered = await open.payOut(credit('c-9'), {
            amount: 1,
            reference: 'R',
            paidOn: '2026-10-27',
        });

        assert.equal(answered, null);
        assert.deepEqual([asked.payouts, told, asked.credits.length], [[], [], 1]);
    });

    test('offers a payout only where the platform takes one', async () => {
        const { openItems, subscribers } = anInstallation();

        const paying = useOpenItems(PAYING, openItems, subscribers, portsWith().ports);
        const reading = useOpenItems(
            ref({ capabilities: { 'payments.read': true } }),
            openItems,
            subscribers,
            portsWith().ports,
        );

        assert.deepEqual([paying.canPayOut.value, reading.canPayOut.value], [true, false]);
    });
});
