// The run that collects the invoices that announced how they are paid.
//
// Every case goes through `InvoiceCollectionService.collectDue`, the call the
// quarter-hourly job makes as its fourth step, over an installation in memory
// whose attempts are kept the way the persistence contract holds both adapters
// to keep them, and a gateway whose answers each test writes — so what is
// asserted is the request a gateway receives, how often, and what the
// installation records of its answer.

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import {
    INVOICE_COLLECTION_ASK_EVERY_MS,
    INVOICE_COLLECTION_LEASE_MS,
    INVOICE_ERROR_CODES,
} from '@saasicat/core';

import { InvoiceCollectionService, SubscriptionInvoiceCron } from '../dist/billing/index.js';
import { aCollectingInstallation, paymentMethodOf } from './helpers/invoice-collection.js';
import { MAIN_ACCOUNT, hanging, lostAfter } from './helpers/payments.js';

/** 06:15 in Berlin on 1 February, when the invoices of February are issued. */
const ISSUED = new Date('2026-02-01T05:15:00.000Z');

/** `days` days and `minutes` minutes after `at`. */
const after = (at, { days = 0, minutes = 0 } = {}) =>
    new Date(at.getTime() + days * 86_400_000 + minutes * 60_000);

/** The audit entries of `action`, as what they changed. */
const entriesOf = (audits, action) =>
    audits.filter((entry) => entry.action === action).map((entry) => entry.changes);

/** Leaves the log out of the output of a test that provokes it. */
function quietLog() {
    mock.method(Logger.prototype, 'warn', () => {});
    mock.method(Logger.prototype, 'error', () => {});
}

/** An installation with one subscriber paying by `method`, its February invoice issued and mailed. */
async function anInvoiceToCollect(method = 'card', { mailedAt = ISSUED } = {}) {
    const installation = aCollectingInstallation();
    const paying = await installation.aPayingSubscriber('t1', method);
    const invoice = await installation.anInvoiceMailed(paying.subscriber.id, ISSUED, mailedAt);
    return { ...installation, ...paying, invoice };
}

// @requirement SC-PRIC-079 — An invoice is collected once it has reached the subscriber
// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('an invoice that reached the subscriber', () => {
    test('by card is collected at once, through the account its payment method is held at, under its attempt key', async () => {
        const { collect, gateway, collections, invoice, method } = await anInvoiceToCollect();

        const run = await collect(after(ISSUED, { minutes: 15 }));

        assert.deepEqual(run, { collected: 1, pending: 0, failed: 0, waiting: 0, unanswered: 0 });
        assert.deepEqual(gateway.collections, [
            {
                attemptKey: `saasicat:collect:${invoice.id}:1`,
                invoiceId: invoice.id,
                invoiceNumber: invoice.number,
                amountCents: Math.round(invoice.totalGross * 100),
                currency: 'EUR',
                customerRef: method.customerRef,
                paymentMethodRef: method.paymentMethodRef,
                type: 'card',
            },
        ]);
        const [attempt] = collections.attempts;
        assert.deepEqual(
            [attempt.status, attempt.paymentRef, attempt.gatewayAccount, attempt.paymentMethodId],
            ['SUCCEEDED', 'pi_1', MAIN_ACCOUNT, method.id],
        );
    });

    test('is collected once: a second run, and one running beside the first, send nothing more', async () => {
        const { collect, gateway } = await anInvoiceToCollect();
        const now = after(ISSUED, { minutes: 15 });

        await Promise.all([collect(now), collect(now)]);
        await collect(after(now, { minutes: 15 }));

        assert.equal(gateway.collections.length, 1);
    });

    test('not yet mailed is not collected', async () => {
        const installation = aCollectingInstallation();
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        await installation.run(ISSUED);

        await installation.collect(after(ISSUED, { minutes: 15 }));

        assert.equal(installation.store.invoices[0].subscriberId, subscriber.id);
        assert.deepEqual(installation.gateway.collections, []);
    });

    test('by direct debit is collected from the day it announced, not the day before', async () => {
        const { collect, gateway, collections, invoice } = await anInvoiceToCollect('sepa_debit');
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        assert.equal(invoice.collectionDate, '2026-02-15');

        // 23:59 on the 14th in Berlin.
        await collect(new Date('2026-02-14T22:59:00.000Z'));
        assert.deepEqual(gateway.collections, []);

        const run = await collect(new Date('2026-02-14T23:00:00.000Z'));

        assert.equal(run.pending, 1);
        assert.equal(gateway.collections[0].type, 'sepa_debit');
        assert.deepEqual(
            [collections.attempts[0].status, collections.attempts[0].resolvedAt],
            ['PENDING', null],
        );
    });
});

// @requirement SC-PRIC-028 — A direct debit is announced before it is collected
describe('an invoice not collected as it announced', () => {
    test('waits where the payment method in use is another than it named, and the audit log says so once', async () => {
        quietLog();
        const installation = await anInvoiceToCollect('sepa_debit');
        const { collect, gateway, audits, invoice, paymentMethods, subscriber, method } =
            installation;
        const { method: replaced } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', { confirmedAt: new Date('2026-02-03') }),
        );

        const run = await collect(new Date('2026-02-15T08:00:00.000Z'));
        await collect(new Date('2026-02-15T08:15:00.000Z'));

        assert.equal(run.waiting, 1);
        assert.deepEqual(gateway.collections, []);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING'), [
            {
                number: invoice.number,
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_PAYMENT_METHOD_CHANGED,
                params: { announced: method.id, paymentMethodId: replaced.id },
            },
        ]);
    });

    test('by direct debit waits where it reached the subscriber less than the lead time before its day', async () => {
        quietLog();
        // Mailed on the 2nd: the 14 days end on the 16th, after the 15th it announced.
        const { collect, gateway, audits } = await anInvoiceToCollect('sepa_debit', {
            mailedAt: new Date('2026-02-02T09:00:00.000Z'),
        });

        const run = await collect(new Date('2026-02-20T08:00:00.000Z'));

        assert.equal(run.waiting, 1);
        assert.deepEqual(gateway.collections, []);
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING').map((entry) => [
                entry.code,
                entry.params,
            ]),
            [
                [
                    INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ANNOUNCED_TOO_LATE,
                    { deliveredOn: '2026-02-02', leadDays: 14, collectionDate: '2026-02-15' },
                ],
            ],
        );
    });

    test('by direct debit mailed exactly the lead time before its day is collected', async () => {
        // Mailed at 23:30 on the 1st in Berlin: the 14 days end on the 15th.
        const { collect, gateway } = await anInvoiceToCollect('sepa_debit', {
            mailedAt: new Date('2026-02-01T22:30:00.000Z'),
        });

        await collect(new Date('2026-02-15T08:00:00.000Z'));

        assert.equal(gateway.collections.length, 1);
    });

    test('waits where the subscriber has no payment method in use any more', async () => {
        quietLog();
        const { collect, gateway, paymentMethods } = await anInvoiceToCollect();
        paymentMethods.rows = [];

        const run = await collect(after(ISSUED, { minutes: 15 }));

        assert.equal(run.waiting, 1);
        assert.deepEqual(gateway.collections, []);
    });
});

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('a failed collection', () => {
    test('is recorded with its reason and the gateway’s code, written to the audit log once, and not collected again', async () => {
        quietLog();
        const { collect, gateway, collections, audits, invoice } = await anInvoiceToCollect();
        gateway.answers.push({
            status: 'failed',
            paymentRef: 'pi_1',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        });

        const run = await collect(after(ISSUED, { minutes: 15 }));
        await collect(after(ISSUED, { days: 1 }));

        assert.equal(run.failed, 1);
        assert.equal(gateway.collections.length, 1);
        const [attempt] = collections.attempts;
        assert.deepEqual(
            [attempt.status, attempt.failureReason, attempt.failureCode],
            ['FAILED', 'insufficient-funds', 'insufficient_funds'],
        );
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED'), [
            {
                number: invoice.number,
                attempt: 1,
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            },
        ]);
    });
});

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('a request whose answer was lost', () => {
    test('stays submitted, and no run sends anything for it while the lease holds', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));
        const now = after(ISSUED, { minutes: 15 });

        const run = await collect(now);
        // The hold is stamped with the clock, as another instance reads it.
        const [submitted] = collections.attempts;
        await collect(new Date(submitted.heldAt.getTime() + INVOICE_COLLECTION_LEASE_MS));

        assert.equal(run.unanswered, 1);
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
        assert.equal(gateway.collections.length, 1);
        assert.deepEqual(gateway.asked, []);
    });

    test('is asked about once the lease has passed, and what the gateway made is recorded, with nothing sent again', async () => {
        quietLog();
        const { collect, gateway, collections, invoice, method } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));
        const now = after(ISSUED, { minutes: 15 });
        await collect(now);
        const [submitted] = collections.attempts;

        const run = await collect(
            new Date(submitted.heldAt.getTime() + INVOICE_COLLECTION_LEASE_MS + 1),
        );

        assert.equal(run.collected, 1);
        assert.equal(gateway.collections.length, 1, 'the request was sent again');
        assert.deepEqual(gateway.asked, [
            {
                attemptKey: `saasicat:collect:${invoice.id}:1`,
                customerRef: method.customerRef,
                paymentRef: null,
                submittedAt: submitted.submittedAt,
            },
        ]);
        assert.deepEqual(
            [collections.attempts[0].status, collections.attempts[0].paymentRef],
            ['SUCCEEDED', 'pi_made'],
        );
    });

    test('found by two runs after the lease is taken on by one: it asks, and the other sends nothing', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));
        await collect(after(ISSUED, { minutes: 15 }));
        const [submitted] = collections.attempts;
        const later = new Date(submitted.heldAt.getTime() + INVOICE_COLLECTION_LEASE_MS + 1);

        await Promise.all([collect(later), collect(later)]);

        assert.equal(gateway.asked.length, 1);
        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('that never reached the gateway is sent again once the lease has passed: the same request under the same key', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(new Error('connect ECONNREFUSED'));
        await collect(after(ISSUED, { minutes: 15 }));
        const [submitted] = collections.attempts;

        await collect(new Date(submitted.heldAt.getTime() + INVOICE_COLLECTION_LEASE_MS + 1));

        assert.equal(gateway.collections.length, 2);
        assert.deepEqual(gateway.collections[1], gateway.collections[0]);
        assert.equal(gateway.asked.length, 1, 'it was sent again without asking first');
        assert.equal(collections.attempts.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('whose gateway does not answer in time counts as unanswered, and the next run after the lease asks', async () => {
        quietLog();
        const { collection, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(hanging);
        collection.timeoutMs = 10;

        const run = await collection.collectDue(after(ISSUED, { minutes: 15 }));

        assert.equal(run.unanswered, 1);
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
    });

    test('whose answer arrived and could not be recorded is asked about later, and charged once', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        collections.failNextRecord = new Error('database unreachable');
        await collect(after(ISSUED, { minutes: 15 }));
        const [submitted] = collections.attempts;
        assert.equal(submitted.status, 'SUBMITTED');

        await collect(new Date(submitted.heldAt.getTime() + INVOICE_COLLECTION_LEASE_MS + 1));

        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('whose gateway cannot be asked stays as it is, and is asked again after the next lease', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(new Error('connect ECONNREFUSED'));
        await collect(after(ISSUED, { minutes: 15 }));
        gateway.findCollection = async () => {
            throw new Error('the gateway is down');
        };
        const [submitted] = collections.attempts;

        const run = await collect(
            new Date(submitted.heldAt.getTime() + INVOICE_COLLECTION_LEASE_MS + 1),
        );

        assert.equal(run.unanswered, 1);
        assert.equal(gateway.collections.length, 1, 'it was sent again without an answer');
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
    });
});

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('a direct debit on its way', () => {
    test('is asked about once an hour, and settled by what the gateway says', async () => {
        const { collect, gateway, collections } = await anInvoiceToCollect('sepa_debit');
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await collect(new Date('2026-02-15T08:00:00.000Z'));
        const [pending] = collections.attempts;
        gateway.held.set(pending.attemptKey, { status: 'succeeded', paymentRef: 'pi_debit' });

        await collect(new Date(pending.heldAt.getTime() + INVOICE_COLLECTION_ASK_EVERY_MS));
        assert.deepEqual(gateway.asked, [], 'asked before the hour was over');

        const run = await collect(
            new Date(pending.heldAt.getTime() + INVOICE_COLLECTION_ASK_EVERY_MS + 1),
        );

        assert.equal(run.collected, 1);
        assert.equal(gateway.asked.length, 1);
        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('that the gateway holds nothing of is left on its way, and nothing is sent again', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect('sepa_debit');
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await collect(new Date('2026-02-15T08:00:00.000Z'));
        gateway.held.clear();
        const [pending] = collections.attempts;

        const run = await collect(
            new Date(pending.heldAt.getTime() + INVOICE_COLLECTION_ASK_EVERY_MS + 1),
        );

        assert.equal(run.unanswered, 1);
        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'PENDING');
    });
});

describe('collecting starts', () => {
    test('not without the gateways and the payment methods, which it names', () => {
        const installation = aCollectingInstallation();
        const without = new InvoiceCollectionService(
            installation.collections,
            installation.store,
            installation.settings,
            null,
            installation.paymentMethods,
        );

        assert.throws(
            () => without.onModuleInit(),
            /collecting invoices needs the payment accounts/,
        );
        assert.doesNotThrow(() => installation.collection.onModuleInit());
    });
});

// @requirement SC-PRIC-079 — An invoice is collected once it has reached the subscriber
describe('the quarter-hourly run', () => {
    test('issues, archives, mails and collects an invoice by card in one run', async () => {
        const installation = aCollectingInstallation();
        await installation.aPayingSubscriber('t1', 'card');

        await new SubscriptionInvoiceCron(
            installation.service,
            null,
            installation.documents,
            installation.collection,
        ).issueDueInvoices();

        assert.equal(installation.mail.sent.length, 1);
        assert.equal(installation.gateway.collections.length, 1);
        assert.equal(installation.collections.attempts[0].status, 'SUCCEEDED');
    });

    test('whose collection fails says so and leaves the next run to try again', async () => {
        quietLog();
        const steps = [];
        const collections = {
            collectDue: async () => {
                steps.push('collect');
                throw new Error('the database is unreachable');
            },
        };
        const installation = aCollectingInstallation();
        const cron = new SubscriptionInvoiceCron(installation.service, null, null, collections);

        await cron.issueDueInvoices();
        await cron.issueDueInvoices();

        assert.deepEqual(steps, ['collect', 'collect']);
    });
});
