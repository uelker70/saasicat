// What follows a collection that failed, and an invoice whose payment method
// was replaced: the subscriber told, the same payment method charged once more
// where the reason can pass, a direct debit announced again before it is
// debited, and the replacement collecting what is still open.
//
// Every case goes through `InvoiceCollectionService.collectDue` over the
// installation in memory of `an-invoice-is-collected.test.js`, on a clock the
// test runs: the service stamps a failure, a hold and an announcement with it,
// and the day of a second charge counts from the day the failure was recorded.

// @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import {
    FIRST_RUN,
    ISSUED,
    after,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    entriesOf,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';
import { aMailbox } from './helpers/invoice-documents.js';
import { lostAfter } from './helpers/payments.js';

/** A card or an account short of funds: a reason that can pass. */
const FUNDS_SHORT = {
    status: 'failed',
    paymentRef: 'pi_short',
    reason: 'insufficient-funds',
    gatewayCode: 'insufficient_funds',
};

/** A card reported stolen: a reason that cannot pass. */
const UNUSABLE = {
    status: 'failed',
    paymentRef: 'pi_stolen',
    reason: 'payment-method-unusable',
    gatewayCode: 'stolen_card',
};

/** Midnight in Berlin at the start of `day`, `YYYY-MM-DD` in winter time. */
const berlinMidnight = (day) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 3_600_000);

/** One minute before midnight in Berlin at the start of `day`. */
const justBefore = (day) => new Date(berlinMidnight(day).getTime() - 60_000);

/** What the subscriber was told, by kind. */
const toldOf = (mail, kind) =>
    mail.told.filter((each) => each.notice.kind === kind).map((each) => each.notice);

/** The attempts of the installation, as status and the payment method they charge. */
const attemptsOf = (collections) =>
    collections.attempts.map((each) => [each.attempt, each.status, each.paymentMethodRef]);

describe('a card that failed for a reason that can pass', () => {
    clockFrom(FIRST_RUN);

    test('is told to the subscriber once, at their invoice email, with the day it is charged again', async () => {
        quietLog();
        const { collect, gateway, mail, notices, invoice, subscriber } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);

        const run = await collect(FIRST_RUN);
        await collect(clockAt(after(FIRST_RUN, { minutes: 15 })));
        await collect(clockAt(after(FIRST_RUN, { minutes: 30 })));

        assert.deepEqual([run.failed, run.planned, run.told], [1, 1, 1]);
        assert.equal(notices.recordedIn.length, 1, 'what follows the failure was decided again');
        assert.deepEqual(mail.told, [
            {
                to: 'billing@t1.example',
                notice: {
                    kind: 'collection-failed',
                    tenantId: 't1',
                    subscriptionId: invoice.subscriptionId,
                    subscriberId: subscriber.id,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.number,
                    amount: invoice.totalGross,
                    currency: 'EUR',
                    paymentMethodType: 'card',
                    reason: 'insufficient-funds',
                    next: { action: 'charged-again', on: '2026-02-08' },
                },
            },
        ]);
    });

    test('is charged once more with the same card seven days after the failure, not the minute before', async () => {
        quietLog();
        const { collect, gateway, audits, invoice, method } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        await collect(FIRST_RUN);

        await collect(clockAt(justBefore('2026-02-08')));
        assert.equal(gateway.collections.length, 1, 'charged again before the seventh day');

        const run = await collect(clockAt(berlinMidnight('2026-02-08')));

        assert.equal(run.collected, 1);
        assert.deepEqual(
            gateway.collections.map((each) => [each.attemptKey, each.paymentMethodRef]),
            [
                [`saasicat:collect:${invoice.id}:1`, method.paymentMethodRef],
                [`saasicat:collect:${invoice.id}:2`, method.paymentMethodRef],
            ],
        );
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED'), [
            {
                number: invoice.number,
                attempt: 2,
                paymentMethodType: 'card',
                collectOn: '2026-02-08',
                because: 'retry',
            },
        ]);
    });

    test('that fails again is told so, and not tried a third time: the subscriber is asked to replace the card', async () => {
        quietLog();
        const { collect, gateway, collections, mail } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT, FUNDS_SHORT);
        await collect(FIRST_RUN);
        await collect(clockAt(berlinMidnight('2026-02-08')));

        await collect(clockAt(berlinMidnight('2026-03-31')));

        assert.equal(gateway.collections.length, 2);
        assert.deepEqual(
            toldOf(mail, 'collection-failed').map((each) => each.next),
            [{ action: 'charged-again', on: '2026-02-08' }, { action: 'replace-payment-method' }],
        );
        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['FAILED', 'FAILED'],
        );
    });
});

describe('a collection that failed for a reason that cannot pass', () => {
    clockFrom(FIRST_RUN);

    test('is told, and not tried again until the payment method is replaced', async () => {
        quietLog();
        const { collect, gateway, collections, mail } = await anInvoiceToCollect();
        gateway.answers.push(UNUSABLE);
        await collect(FIRST_RUN);

        await collect(clockAt(berlinMidnight('2026-02-09')));

        assert.equal(gateway.collections.length, 1);
        assert.deepEqual(
            toldOf(mail, 'collection-failed').map((each) => [each.reason, each.next]),
            [['payment-method-unusable', { action: 'replace-payment-method' }]],
        );
        assert.equal(collections.attempts.length, 1);
    });
});

// @requirement SC-PRIC-028 — A direct debit is announced before it is collected
describe('a direct debit that failed for a reason that can pass', () => {
    /** 09:00 in Berlin on the day the invoice announced. */
    const COLLECTED = new Date('2026-02-15T08:00:00.000Z');
    clockFrom(COLLECTED);

    test('is announced again under its mandate for the lead time after, and debited on that day, not the minute before', async () => {
        quietLog();
        const { collect, gateway, mail, invoice, subscriber, method } =
            await anInvoiceToCollect('sepa_debit');
        gateway.answers.push(FUNDS_SHORT);

        const run = await collect(COLLECTED);

        assert.deepEqual([run.failed, run.planned, run.announced, run.told], [1, 1, 1, 1]);
        assert.deepEqual(
            mail.told.map((each) => each.notice.kind),
            ['collection-failed', 'collection-announced'],
            'the subscriber heard of the new debit before the failure',
        );
        assert.deepEqual(
            toldOf(mail, 'collection-failed').map((each) => each.next),
            [{ action: 'announced-again' }],
        );
        assert.deepEqual(toldOf(mail, 'collection-announced'), [
            {
                kind: 'collection-announced',
                tenantId: 't1',
                subscriptionId: invoice.subscriptionId,
                subscriberId: subscriber.id,
                invoiceId: invoice.id,
                invoiceNumber: invoice.number,
                amount: invoice.totalGross,
                currency: 'EUR',
                // Fourteen days after the 15th, later than seven after the failure.
                collectOn: '2026-03-01',
                mandateReference: method.mandateReference,
                last4: '3000',
            },
        ]);

        await collect(clockAt(justBefore('2026-03-01')));
        assert.equal(gateway.collections.length, 1, 'debited before the day it announced');

        await collect(clockAt(berlinMidnight('2026-03-01')));

        assert.deepEqual(
            gateway.collections.map((each) => [each.attemptKey, each.type]),
            [
                [`saasicat:collect:${invoice.id}:1`, 'sepa_debit'],
                [`saasicat:collect:${invoice.id}:2`, 'sepa_debit'],
            ],
        );
    });

    test('whose announcement the mail refused is announced the next day, for the lead time after that day', async () => {
        quietLog();
        const { collect, gateway, collections, mail } = await anInvoiceToCollect('sepa_debit', {
            mail: aMailbox({ tellFailures: 1, tellFailing: 'collection-announced' }),
        });
        gateway.answers.push(FUNDS_SHORT);
        await collect(COLLECTED);
        assert.deepEqual(toldOf(mail, 'collection-announced'), []);

        await collect(clockAt(new Date('2026-02-16T08:00:00.000Z')));

        assert.deepEqual(
            toldOf(mail, 'collection-announced').map((each) => each.collectOn),
            ['2026-03-02'],
        );
        assert.equal(collections.attempts[1].collectOn, '2026-03-02');
    });

    test('that was announced without the announcement being recorded keeps the day it was told, and is not announced twice', async () => {
        quietLog();
        const { collect, gateway, collections, mail } = await anInvoiceToCollect('sepa_debit');
        gateway.answers.push(FUNDS_SHORT);
        collections.failNextAnnounce = new Error('database unreachable');
        await collect(COLLECTED);
        assert.equal(collections.attempts[1].announcedAt, null);

        await collect(clockAt(new Date('2026-02-16T08:00:00.000Z')));

        assert.deepEqual(
            toldOf(mail, 'collection-announced').map((each) => each.collectOn),
            ['2026-03-01'],
        );
        assert.equal(collections.attempts[1].collectOn, '2026-03-01');
        assert.deepEqual(collections.attempts[1].announcedAt, COLLECTED);
    });
});

// @requirement SC-PRIC-082 — An invoice is collected as it, or an announcement after it, says
describe('a payment method that replaced the one an invoice named, or the one that failed', () => {
    clockFrom(FIRST_RUN);

    test('before the invoice is collected, a card in use instead of its direct debit is charged on the day it named', async () => {
        const { collect, collections, audits, invoice, paymentMethods, subscriber } =
            await anInvoiceToCollect('sepa_debit');
        const { method: card } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', { confirmedAt: new Date('2026-02-03') }),
        );

        const run = await collect(clockAt(new Date('2026-02-15T08:00:00.000Z')));

        assert.deepEqual([run.planned, run.collected], [1, 1]);
        assert.deepEqual(attemptsOf(collections), [[1, 'SUCCEEDED', card.paymentMethodRef]]);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED'), [
            {
                number: invoice.number,
                attempt: 1,
                paymentMethodType: 'card',
                collectOn: '2026-02-15',
                because: 'payment-method-replaced',
            },
        ]);
    });

    test('before the invoice is collected, a direct debit in use instead of its card is announced and debited the lead time after', async () => {
        const { collect, gateway, mail, paymentMethods, subscriber } = await anInvoiceToCollect();
        const { method: debit } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'sepa_debit', { confirmedAt: new Date('2026-01-31') }),
        );

        await collect(FIRST_RUN);
        await collect(clockAt(justBefore('2026-02-15')));
        assert.deepEqual(gateway.collections, []);

        await collect(clockAt(berlinMidnight('2026-02-15')));

        assert.deepEqual(
            toldOf(mail, 'collection-announced').map((each) => [
                each.collectOn,
                each.mandateReference,
            ]),
            [['2026-02-15', debit.mandateReference]],
        );
        assert.deepEqual(
            gateway.collections.map((each) => [each.type, each.paymentMethodRef]),
            [['sepa_debit', debit.paymentMethodRef]],
        );
    });

    test('after a failure that cannot pass, the replacement collects the invoice', async () => {
        quietLog();
        const { collect, gateway, collections, paymentMethods, subscriber, method } =
            await anInvoiceToCollect();
        gateway.answers.push(UNUSABLE);
        await collect(FIRST_RUN);
        const { method: card } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', {
                paymentMethodRef: 'pm_card_new',
                confirmedAt: new Date('2026-02-02'),
            }),
        );

        await collect(clockAt(after(FIRST_RUN, { days: 1 })));

        assert.deepEqual(attemptsOf(collections), [
            [1, 'FAILED', method.paymentMethodRef],
            [2, 'SUCCEEDED', card.paymentMethodRef],
        ]);
    });

    test('a failure learned after the payment method was replaced is followed by the replacement at once, as the subscriber is told', async () => {
        quietLog();
        const { collect, gateway, collections, mail, paymentMethods, subscriber, method } =
            await anInvoiceToCollect();
        gateway.answers.push(lostAfter(FUNDS_SHORT));
        await collect(FIRST_RUN);
        const { method: card } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', {
                paymentMethodRef: 'pm_card_new',
                confirmedAt: new Date('2026-02-01T05:35:00.000Z'),
            }),
        );

        // After the lease the gateway is asked, and says the charge failed.
        await collect(clockAt(after(FIRST_RUN, { minutes: 16 })));

        assert.deepEqual(attemptsOf(collections), [
            [1, 'FAILED', method.paymentMethodRef],
            [2, 'SUCCEEDED', card.paymentMethodRef],
        ]);
        assert.deepEqual(
            toldOf(mail, 'collection-failed').map((each) => each.next),
            [{ action: 'charged-again', on: '2026-02-01' }],
        );
    });

    test('while a second charge is planned, the plan is withdrawn and the replacement charged instead', async () => {
        quietLog();
        const {
            collect,
            gateway,
            collections,
            audits,
            invoice,
            paymentMethods,
            subscriber,
            method,
        } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        await collect(FIRST_RUN);
        const { method: card } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', {
                paymentMethodRef: 'pm_card_new',
                confirmedAt: new Date('2026-02-03'),
            }),
        );

        await collect(clockAt(new Date('2026-02-03T08:00:00.000Z')));
        await collect(clockAt(new Date('2026-02-03T08:15:00.000Z')));

        assert.deepEqual(attemptsOf(collections), [
            [1, 'FAILED', method.paymentMethodRef],
            [2, 'WITHDRAWN', method.paymentMethodRef],
            [3, 'SUCCEEDED', card.paymentMethodRef],
        ]);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN'), [
            {
                number: invoice.number,
                attempt: 2,
                paymentMethodId: method.id,
                because: 'payment-method-replaced',
            },
        ]);
    });

    test('no payment method in use: the invoice waits, and the audit log says so once', async () => {
        quietLog();
        const { collect, gateway, audits, invoice, paymentMethods, subscriber } =
            await anInvoiceToCollect();
        paymentMethods.rows = [];

        const run = await collect(FIRST_RUN);
        await collect(clockAt(after(FIRST_RUN, { minutes: 15 })));

        assert.equal(run.waiting, 1);
        assert.deepEqual(gateway.collections, []);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING'), [
            {
                number: invoice.number,
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_PAYMENT_METHOD,
                params: { subscriberId: subscriber.id },
            },
        ]);
    });

    test('a direct debit without a mandate reference is not announced, and waits', async () => {
        quietLog();
        const { collect, gateway, mail, audits, paymentMethods, subscriber } =
            await anInvoiceToCollect();
        const { method: debit } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'sepa_debit', {
                mandateReference: null,
                confirmedAt: new Date('2026-01-31'),
            }),
        );

        const run = await collect(FIRST_RUN);

        assert.equal(run.waiting, 1);
        assert.deepEqual([mail.told, gateway.collections], [[], []]);
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING').map((each) => [
                each.code,
                each.params,
            ]),
            [
                [
                    INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_MANDATE_MISSING,
                    { paymentMethodId: debit.id },
                ],
            ],
        );
    });
});

// @requirement SC-PRIC-028 — A direct debit is announced before it is collected
// @requirement SC-PRIC-082 — An invoice is collected as it, or an announcement after it, says
describe('a direct debit whose invoice reached the subscriber too late for its day', () => {
    clockFrom(ISSUED);

    test('is announced again for the lead time after, and debited then rather than on the day it named', async () => {
        // Mailed on the 2nd: the 14 days end on the 16th, after the 15th it announced.
        const { collect, gateway, mail, audits, invoice } = await anInvoiceToCollect('sepa_debit', {
            mailedAt: new Date('2026-02-02T09:00:00.000Z'),
        });

        await collect(clockAt(new Date('2026-02-15T08:00:00.000Z')));
        await collect(clockAt(justBefore('2026-03-01')));
        assert.deepEqual(gateway.collections, []);

        await collect(clockAt(berlinMidnight('2026-03-01')));

        assert.equal(gateway.collections.length, 1);
        assert.deepEqual(
            toldOf(mail, 'collection-announced').map((each) => each.collectOn),
            ['2026-03-01'],
        );
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED').map((each) => [
                each.because,
                each.attempt,
            ]),
            [['announced-too-late', 1]],
        );
        assert.equal(invoice.collectionDate, '2026-02-15', 'the invoice changed');
    });
});

describe('what the subscriber is told of a failure', () => {
    clockFrom(FIRST_RUN);

    test('a run that stops after it planned records the notice the next time, saying what was planned, once', async () => {
        quietLog();
        const { collect, gateway, collections, mail, notices } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        const record = notices.record;
        notices.record = async () => {
            notices.record = record;
            throw new Error('database unreachable');
        };

        await collect(FIRST_RUN);
        assert.deepEqual(
            collections.attempts.map((each) => [each.status, each.followedUpAt]),
            [
                ['FAILED', null],
                ['SCHEDULED', null],
            ],
        );
        await collect(clockAt(after(FIRST_RUN, { minutes: 15 })));
        await collect(clockAt(after(FIRST_RUN, { minutes: 30 })));

        assert.deepEqual(
            toldOf(mail, 'collection-failed').map((each) => each.next),
            [{ action: 'charged-again', on: '2026-02-08' }],
        );
        assert.equal(collections.attempts.length, 2, 'what follows was planned twice');
    });

    test('a plan whose card was replaced before the failure was told is not told: its replacement is, and charged', async () => {
        quietLog();
        const { collect, gateway, collections, mail, notices, paymentMethods, subscriber, method } =
            await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        const record = notices.record;
        notices.record = async () => {
            notices.record = record;
            throw new Error('database unreachable');
        };
        await collect(FIRST_RUN);
        const { method: card } = await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', {
                paymentMethodRef: 'pm_card_new',
                confirmedAt: new Date('2026-02-01T05:35:00.000Z'),
            }),
        );

        await collect(clockAt(after(FIRST_RUN, { minutes: 15 })));
        await collect(clockAt(after(FIRST_RUN, { minutes: 30 })));

        assert.deepEqual(attemptsOf(collections), [
            [1, 'FAILED', method.paymentMethodRef],
            [2, 'WITHDRAWN', method.paymentMethodRef],
            [3, 'SUCCEEDED', card.paymentMethodRef],
        ]);
        assert.deepEqual(
            toldOf(mail, 'collection-failed').map((each) => each.next),
            [{ action: 'charged-again', on: '2026-02-01' }],
        );
    });

    test('a notice that cannot be read holds up no planned collection', async () => {
        quietLog();
        const { collect, gateway, notices } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        await collect(FIRST_RUN);
        await notices.record(
            [
                {
                    tenantId: 't9',
                    subscriptionId: 'subscription-9',
                    kind: 'collection-failed',
                    subject: 'saasicat:collect:invoice-9:1',
                    content: { kind: 'collection-failed' },
                },
            ],
            FIRST_RUN,
        );

        await collect(clockAt(berlinMidnight('2026-02-08')));

        assert.equal(gateway.collections.length, 2);
    });

    test('is sent by the next run where the mail refused it', async () => {
        quietLog();
        const { collect, gateway, mail, notices } = await anInvoiceToCollect('card', {
            mail: aMailbox({ tellFailures: 1 }),
        });
        gateway.answers.push(UNUSABLE);

        const first = await collect(FIRST_RUN);
        const second = await collect(clockAt(after(FIRST_RUN, { minutes: 15 })));

        assert.deepEqual([first.told, second.told], [0, 1]);
        assert.equal(toldOf(mail, 'collection-failed').length, 1);
        assert.ok([...notices.rows.values()].every((row) => row.deliveredAt !== null));
    });

    test('a run that stops before it planned what follows plans it the next time, from the day it failed, and tells it once', async () => {
        quietLog();
        const { collect, gateway, collections, mail } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        collections.failNextPlan = new Error('database unreachable');

        await collect(FIRST_RUN);
        assert.equal(collections.attempts.length, 1);
        // Two days later: the second charge still counts from the 1st.
        await collect(clockAt(after(FIRST_RUN, { days: 2 })));

        assert.equal(toldOf(mail, 'collection-failed').length, 1);
        assert.deepEqual(
            collections.attempts.map((each) => [each.status, each.collectOn]),
            [
                ['FAILED', null],
                ['SCHEDULED', '2026-02-08'],
            ],
        );
        assert.ok(
            collections.attempts[0].followedUpAt,
            'the failure was not marked as followed up',
        );
    });
});

describe('a failure the subscriber has not heard of yet', () => {
    /** 09:00 in Berlin on the day the invoice announced. */
    const COLLECTED = new Date('2026-02-15T08:00:00.000Z');
    clockFrom(COLLECTED);

    test('holds back the direct debit announced after it until it is told, and the audit log says why', async () => {
        quietLog();
        const { collect, gateway, mail, collections, audits, invoice } = await anInvoiceToCollect(
            'sepa_debit',
            { mail: aMailbox({ tellFailures: 1, tellFailing: 'collection-failed' }) },
        );
        gateway.answers.push(FUNDS_SHORT);

        await collect(COLLECTED);
        assert.deepEqual(mail.told, [], 'the debit was announced before the failure was told');
        assert.equal(collections.attempts[1].announcedAt, null);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING'), [
            {
                number: invoice.number,
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_FAILURE_NOT_TOLD,
                params: { attemptKey: collections.attempts[0].attemptKey },
            },
        ]);

        await collect(clockAt(after(COLLECTED, { minutes: 15 })));

        assert.deepEqual(
            mail.told.map((each) => each.notice.kind),
            ['collection-failed', 'collection-announced'],
        );
        assert.equal(collections.attempts[1].collectOn, '2026-03-01');
    });

    test('a debit held behind each of two failures is audited for each', async () => {
        quietLog();
        // The first failure's notice is refused once, the second's twice.
        const refusals = new Map([
            ['announced-again', 1],
            ['replace-payment-method', 2],
        ]);
        const mail = aMailbox({
            tellRefuses: (notice) => {
                if (notice.kind !== 'collection-failed') return false;
                const left = refusals.get(notice.next.action) ?? 0;
                refusals.set(notice.next.action, left - 1);
                return left > 0;
            },
        });
        const { collect, gateway, collections, audits, paymentMethods, subscriber } =
            await anInvoiceToCollect('sepa_debit', { mail });
        gateway.answers.push(FUNDS_SHORT, FUNDS_SHORT);
        const firstOfMarch = berlinMidnight('2026-03-01');
        await collect(COLLECTED);
        await collect(clockAt(after(COLLECTED, { minutes: 15 })));
        await collect(clockAt(firstOfMarch));
        await collect(clockAt(after(firstOfMarch, { minutes: 15 })));
        await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'sepa_debit', {
                paymentMethodRef: 'pm_debit_new',
                mandateReference: 'MANDAT-NEW',
                confirmedAt: new Date('2026-03-01T00:20:00.000Z'),
            }),
        );

        await collect(clockAt(after(firstOfMarch, { minutes: 30 })));

        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING').map(
                (each) => each.params.attemptKey,
            ),
            [collections.attempts[0].attemptKey, collections.attempts[1].attemptKey],
        );
    });

    test('never announces a debit after a failure nobody was told of, even one marked followed up', async () => {
        quietLog();
        const { collect, gateway, mail, collections, notices } = await anInvoiceToCollect(
            'sepa_debit',
            { mail: aMailbox({ tellFailures: 1, tellFailing: 'collection-failed' }) },
        );
        gateway.answers.push(FUNDS_SHORT);
        await collect(COLLECTED);
        assert.ok(collections.attempts[0].followedUpAt, 'the failure was not followed up');
        // What a run reads where its snapshot of the notices predates the record.
        notices.rows.clear();

        await collect(clockAt(after(COLLECTED, { minutes: 15 })));

        assert.deepEqual(toldOf(mail, 'collection-announced'), []);
        assert.equal(collections.attempts[1].announcedAt, null);
    });

    test('holds back a direct debit planned by a run that stopped before it recorded the failure', async () => {
        quietLog();
        const { collect, gateway, mail, collections, notices } =
            await anInvoiceToCollect('sepa_debit');
        gateway.answers.push(FUNDS_SHORT);
        const record = notices.record;
        notices.record = async () => {
            notices.record = record;
            throw new Error('database unreachable');
        };

        await collect(COLLECTED);
        assert.deepEqual(
            [collections.attempts[1].status, mail.told],
            ['SCHEDULED', []],
            'the debit was announced before its failure was even recorded',
        );

        await collect(clockAt(after(COLLECTED, { minutes: 15 })));

        assert.deepEqual(
            mail.told.map((each) => each.notice.kind),
            ['collection-failed', 'collection-announced'],
        );
    });
});

describe('runs side by side', () => {
    clockFrom(FIRST_RUN);

    test('two runs that both see a failure tell it once and plan one second charge', async () => {
        quietLog();
        const { collect, gateway, collections, mail } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);

        await Promise.all([collect(FIRST_RUN), collect(FIRST_RUN)]);

        assert.equal(toldOf(mail, 'collection-failed').length, 1);
        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['FAILED', 'SCHEDULED'],
        );
    });

    test('two runs on the day a second charge is due send it once', async () => {
        quietLog();
        const { collect, gateway } = await anInvoiceToCollect();
        gateway.answers.push(FUNDS_SHORT);
        await collect(FIRST_RUN);
        const due = clockAt(berlinMidnight('2026-02-08'));

        await Promise.all([collect(due), collect(due)]);

        assert.equal(gateway.collections.length, 2);
    });
});
