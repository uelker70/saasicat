// The run that collects the invoices that announced how they are paid.
//
// Every case goes through `InvoiceCollectionService.collectDue`, the call the
// quarter-hourly job makes as its fourth step, over an installation in memory
// whose attempts are kept the way the persistence contract holds both adapters
// to keep them, and a gateway whose answers each test writes — so what is
// asserted is the request a gateway receives, how often, and what the
// installation records of its answer.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_COLLECTION_ASK_EVERY_MS, INVOICE_COLLECTION_LEASE_MS } from '@saasicat/core';

import { InvoiceCollectionService, SubscriptionInvoiceCron } from '../dist/billing/index.js';
import {
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    after,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    entriesOf,
    quietLog,
    sinceHeld,
} from './helpers/invoice-collection.js';
import { MAIN_ACCOUNT, hanging, lostAfter } from './helpers/payments.js';

// @requirement SC-PRIC-082 — An invoice is collected as it, or an announcement after it, says
// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('an invoice that reached the subscriber', () => {
    test('by card is collected at once, through the account its payment method is held at, under its attempt key', async () => {
        const { collect, gateway, collections, invoice, method } = await anInvoiceToCollect();

        const run = await collect(after(ISSUED, { minutes: 15 }));

        assert.deepEqual(run, {
            collected: 1,
            pending: 0,
            failed: 0,
            planned: 0,
            announced: 0,
            told: 0,
            waiting: 0,
            unanswered: 0,
        });
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
describe('a direct debit and the lead time of its announcement', () => {
    test('by direct debit mailed exactly the lead time before its day is collected on that day', async () => {
        // Mailed at 23:30 on the 1st in Berlin: the 14 days end on the 15th.
        const { collect, gateway } = await anInvoiceToCollect('sepa_debit', {
            mailedAt: new Date('2026-02-01T22:30:00.000Z'),
        });

        await collect(new Date('2026-02-15T08:00:00.000Z'));

        assert.equal(gateway.collections.length, 1);
    });
});

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('a failed collection', () => {
    test('is recorded with its reason and the gateway’s code, and written to the audit log once', async () => {
        quietLog();
        const { collect, gateway, collections, audits, invoice } = await anInvoiceToCollect();
        gateway.answers.push({
            status: 'failed',
            paymentRef: 'pi_1',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        });

        const run = await collect(after(ISSUED, { minutes: 15 }));
        await collect(after(ISSUED, { minutes: 30 }));

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
    clockFrom(FIRST_RUN);

    test('stays submitted, and no run sends anything for it while the lease holds', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));

        const run = await collect(FIRST_RUN);
        const [submitted] = collections.attempts;
        await collect(clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS)));

        assert.equal(run.unanswered, 1);
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
        assert.equal(gateway.collections.length, 1);
        assert.deepEqual(gateway.asked, []);
    });

    test('is not taken on within the lease by a run called for a later moment than the clock’s', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));
        await collect(FIRST_RUN);

        await collect(after(FIRST_RUN, { days: 1 }));

        assert.deepEqual(gateway.asked, []);
        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
    });

    test('is taken on once the clock is past the lease, by a run called for an earlier moment', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));
        await collect(FIRST_RUN);
        const [submitted] = collections.attempts;
        clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1));

        await collect(FIRST_RUN);

        assert.equal(gateway.asked.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('is asked about once the lease has passed, and what the gateway made is recorded, with nothing sent again', async () => {
        quietLog();
        const { collect, gateway, collections, invoice, method } = await anInvoiceToCollect();
        gateway.answers.push(lostAfter({ status: 'succeeded', paymentRef: 'pi_made' }));
        await collect(FIRST_RUN);
        const [submitted] = collections.attempts;

        const run = await collect(clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1)));

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
        await collect(FIRST_RUN);
        const [submitted] = collections.attempts;
        const later = clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1));

        // The second run is called for a later moment than the clock's: the
        // hold the first one took is judged by the clock all the same.
        await Promise.all([collect(later), collect(after(later, { days: 1 }))]);

        assert.equal(gateway.asked.length, 1);
        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('that never reached the gateway is sent again once the lease has passed: the same request under the same key', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(new Error('connect ECONNREFUSED'));
        await collect(FIRST_RUN);
        const [submitted] = collections.attempts;

        await collect(clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1)));

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

        const run = await collection.collectDue(FIRST_RUN);

        assert.equal(run.unanswered, 1);
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
    });

    test('whose answer arrived and could not be recorded is asked about later, and charged once', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        collections.failNextRecord = new Error('database unreachable');
        await collect(FIRST_RUN);
        const [submitted] = collections.attempts;
        assert.equal(submitted.status, 'SUBMITTED');

        await collect(clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1)));

        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('whose gateway cannot be asked stays as it is, and is asked again after the next lease', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect();
        gateway.answers.push(new Error('connect ECONNREFUSED'));
        await collect(FIRST_RUN);
        gateway.findCollection = async () => {
            throw new Error('the gateway is down');
        };
        const [submitted] = collections.attempts;

        const run = await collect(clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1)));

        assert.equal(run.unanswered, 1);
        assert.equal(gateway.collections.length, 1, 'it was sent again without an answer');
        assert.equal(collections.attempts[0].status, 'SUBMITTED');
    });
});

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
describe('a direct debit on its way', () => {
    /** 09:00 in Berlin on its collection date. */
    const COLLECTED = new Date('2026-02-15T08:00:00.000Z');
    clockFrom(COLLECTED);

    test('is asked about once an hour, and settled by what the gateway says', async () => {
        const { collect, gateway, collections } = await anInvoiceToCollect('sepa_debit');
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await collect(COLLECTED);
        const [pending] = collections.attempts;
        gateway.held.set(pending.attemptKey, { status: 'succeeded', paymentRef: 'pi_debit' });

        await collect(clockAt(sinceHeld(pending, INVOICE_COLLECTION_ASK_EVERY_MS)));
        assert.deepEqual(gateway.asked, [], 'asked before the hour was over');

        const run = await collect(clockAt(sinceHeld(pending, INVOICE_COLLECTION_ASK_EVERY_MS + 1)));

        assert.equal(run.collected, 1);
        assert.equal(gateway.asked.length, 1);
        assert.equal(gateway.collections.length, 1);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
    });

    test('that the gateway holds nothing of is left on its way, and nothing is sent again', async () => {
        quietLog();
        const { collect, gateway, collections } = await anInvoiceToCollect('sepa_debit');
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await collect(COLLECTED);
        gateway.held.clear();
        const [pending] = collections.attempts;

        const run = await collect(clockAt(sinceHeld(pending, INVOICE_COLLECTION_ASK_EVERY_MS + 1)));

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

    // @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure
    test('not without the record of what the subscriber is told, which it names', () => {
        const installation = aCollectingInstallation();
        const untold = new InvoiceCollectionService(
            installation.collections,
            installation.store,
            installation.settings,
            installation.gateways,
            installation.paymentMethods,
            null,
            null,
            null,
            installation.mail,
            installation.subscribers,
        );

        assert.throws(
            () => untold.onModuleInit(),
            /tells the subscriber of a failure and announces a direct debit again: pass chargeJournal\.invoices\.notices/,
        );
    });

    // @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference
    test('not while an attempt not settled is held at an account the file no longer names, which it names', async () => {
        const installation = await anInvoiceToCollect('sepa_debit');
        installation.gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await installation.collect(new Date('2026-02-15T08:00:00.000Z'));
        installation.collections.attempts[0].gatewayAccount = 'stripe-old';

        await assert.rejects(
            installation.collection.onApplicationBootstrap(),
            /Collections not settled are held at 'stripe-old', which config\/saas\.yaml#payments\.accounts no longer names/,
        );

        installation.collections.attempts[0].status = 'SUCCEEDED';
        await installation.collection.onApplicationBootstrap();
    });
});

// @requirement SC-PRIC-082 — An invoice is collected as it, or an announcement after it, says
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
