// A subscriber pays every invoice still open at once, with the payment method
// in use, and a payment method the subscriber enters does the same
// (`SC-PRIC-099`, `SC-PRIC-100`): a card is charged now, a direct debit is
// announced and collected the lead time after.
//
// Every case runs over the collecting installation in memory: the invoice of
// February is issued on 1 February and due on 15 February, and a card is
// charged at the first run.

// @requirement SC-PRIC-100 — A subscriber pays what is open now

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { toCents } from '@saasicat/core';

import { TenantInvoicesController } from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import {
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    clockAt,
    clockFrom,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';
import { reversalReported } from './helpers/money-events.js';
import { MAIN_ACCOUNT, signedCallback } from './helpers/payments.js';

/** A card reported stolen: refused for good, so nothing is collected until it is replaced. */
const UNUSABLE = {
    status: 'failed',
    paymentRef: 'pi_stolen',
    reason: 'payment-method-unusable',
    gatewayCode: 'stolen_card',
};

/** Funds short: a reason that can pass, so a second card attempt is planned. */
const FUNDS_SHORT = {
    status: 'failed',
    paymentRef: 'pi_short',
    reason: 'insufficient-funds',
    gatewayCode: 'insufficient_funds',
};

/** Midnight in Berlin at the start of `day`, `YYYY-MM-DD` in winter time. */
const berlinMidnight = (day) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 3_600_000);

const DUE_DAY = berlinMidnight('2026-02-15');
const LATER = new Date(DUE_DAY.getTime() + 60 * 60_000);
/** Well before the day the February invoice names, with the lead time still ahead of it. */
const EARLY = berlinMidnight('2026-02-03');

/** `t1` paying by `method`, its February invoice mailed, and the reasons kept beside it. */
async function aSubscriberOwing(method = 'card', firstAnswer = UNUSABLE) {
    const holds = new FakeTenantAccessHoldRepository();
    const installation = aCollectingInstallation({ holds });
    const { subscriber } = await installation.aPayingSubscriber('t1', method);
    const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
    if (firstAnswer) installation.gateway.answers.push(firstAnswer);
    await installation.collect(FIRST_RUN);
    const access = new TenantAccessService(holds, new Reflector());
    return { ...installation, holds, access, subscriber, invoice };
}

/**
 * An installation whose collection is told of every payment method confirmed,
 * as `SubscriberPaymentMethodService` tells it; `confirmed` tells it.
 */
function anInstallationTold() {
    let tell = null;
    const installation = aCollectingInstallation({
        paymentMethodChanges: {
            afterConfirming: (listener) => {
                tell = listener;
            },
        },
    });
    installation.collection.onModuleInit();
    return { ...installation, confirmed: (subscriberId) => tell(subscriberId) };
}

/** `t1` paying by direct debit, its February invoice mailed and naming 15 February. */
async function aDirectDebitAnnounced(installation) {
    const { subscriber } = await installation.aPayingSubscriber('t1', 'sepa_debit');
    const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
    assert.equal(invoice.collectionDate, '2026-02-15', 'the premise: the day it names');
    return { subscriber, invoice };
}

const stateOf = async (access, tenantId) => (await access.accessOf(tenantId)).state;

/** Why each collection was planned, as the audit log records it. */
const plannedBecause = ({ audits }) =>
    audits
        .filter((entry) => entry.action === 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED')
        .map((entry) => entry.changes.because);

/** Replaces the payment method of `subscriberId` with `type`, confirmed at `at`. */
const replaceWith = (installation, subscriberId, type, at) =>
    installation.paymentMethods.recordConfirmed(
        paymentMethodOf(subscriberId, type, {
            paymentMethodRef: `pm_${type}_new`,
            confirmedAt: at,
        }),
    );

describe('paying now', () => {
    clockFrom(FIRST_RUN);

    test('charges the card in use at once, and a tenant held back is let go', async () => {
        quietLog();
        const installation = await aSubscriberOwing();
        const { collection, overdue, access, payments, invoice, subscriber } = installation;
        await overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'read-only', 'the premise');
        await replaceWith(installation, subscriber.id, 'card', DUE_DAY);

        const started = await collection.payNow('t1', clockAt(LATER));

        assert.equal(started.paymentMethod, true);
        assert.equal(started.collected, 1);
        assert.equal(await payments.owedBy(invoice.id), 0);
        assert.equal(await stateOf(access, 't1'), 'open');
    });

    test('with the same card, once it has funds again, pays before the second attempt was due', async () => {
        quietLog();
        const installation = await aSubscriberOwing('card', FUNDS_SHORT);
        const { collection, collections, invoice, audits } = installation;
        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['FAILED', 'SCHEDULED'],
            'the premise: a second attempt planned for a later day',
        );

        const started = await collection.payNow('t1', clockAt(berlinMidnight('2026-02-02')));

        assert.equal(started.collected, 1);
        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['FAILED', 'WITHDRAWN', 'SUCCEEDED'],
        );
        assert.ok(
            audits.some(
                (entry) =>
                    entry.action === 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN' &&
                    entry.changes.because === 'started-by-subscriber' &&
                    entry.changes.number === invoice.number,
            ),
        );
    });

    test('answered later leaves the tenant read-only until the payment is there', async () => {
        quietLog();
        const installation = await aSubscriberOwing();
        const { collection, overdue, access, gateway, subscriber } = installation;
        await overdue.holdBackDue(clockAt(DUE_DAY));
        await replaceWith(installation, subscriber.id, 'card', DUE_DAY);
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_wait' });

        const started = await collection.payNow('t1', clockAt(LATER));
        await overdue.holdBackDue(clockAt(new Date(LATER.getTime() + 15 * 60_000)));

        assert.equal(started.pending, 1);
        assert.equal(await stateOf(access, 't1'), 'read-only');
    });

    test('by direct debit announces it, and collects it the lead time after', async () => {
        quietLog();
        const installation = await aSubscriberOwing();
        const { collection, collections, subscriber, invoice } = installation;
        await replaceWith(installation, subscriber.id, 'sepa_debit', DUE_DAY);

        const started = await collection.payNow('t1', clockAt(LATER));

        assert.equal(started.announced, 1);
        const planned = collections.attempts.filter((each) => each.invoiceId === invoice.id).at(-1);
        assert.equal(planned.status, 'SCHEDULED');
        assert.ok(planned.collectOn > '2026-02-15', 'collected the lead time after');
    });

    test('with a card entered since, charges a direct debit’s invoice at once, before the day it names', async () => {
        quietLog();
        const installation = aCollectingInstallation();
        const { subscriber, invoice } = await aDirectDebitAnnounced(installation);
        await replaceWith(installation, subscriber.id, 'card', EARLY);

        const started = await installation.collection.payNow('t1', clockAt(EARLY));

        assert.equal(started.collected, 1);
        assert.equal(await installation.payments.owedBy(invoice.id), 0);
    });

    test('leaves a direct debit the invoice announced with the payment method in use to its day', async () => {
        quietLog();
        const installation = aCollectingInstallation();
        await aDirectDebitAnnounced(installation);

        const started = await installation.collection.payNow(
            't1',
            clockAt(berlinMidnight('2026-02-13')),
        );

        assert.equal(started.onTheirWay, 1);
        assert.deepEqual(installation.collections.attempts, [], 'not announced a second time');
    });

    test('leaves a direct debit planned with the payment method in use to the day it was announced for', async () => {
        quietLog();
        const installation = anInstallationTold();
        const { subscriber } = await aDirectDebitAnnounced(installation);
        clockAt(EARLY);
        await replaceWith(installation, subscriber.id, 'sepa_debit', EARLY);
        await installation.confirmed(subscriber.id);
        const planned = () =>
            installation.collections.attempts.map((each) => [each.status, each.collectOn]);
        const announced = planned();
        assert.equal(announced.length, 1, 'the premise: one direct debit');
        assert.equal(announced[0][0], 'SCHEDULED');
        assert.ok(installation.collections.attempts[0].announcedAt, 'the premise: announced');

        const started = await installation.collection.payNow(
            't1',
            clockAt(berlinMidnight('2026-02-13')),
        );

        assert.equal(started.onTheirWay, 1);
        assert.deepEqual(planned(), announced, 'the day the subscriber was told');
    });

    test('leaves an invoice on its way to that collection', async () => {
        quietLog();
        const installation = await aSubscriberOwing('card', {
            status: 'pending',
            paymentRef: 'pi_on',
        });
        const { collection, gateway } = installation;
        const sent = gateway.collections.length;

        const started = await collection.payNow('t1', clockAt(LATER));

        assert.equal(started.onTheirWay, 1);
        assert.equal(gateway.collections.length, sent, 'nothing sent twice');
    });

    test('does not collect again with a payment method a payment was taken back on', async () => {
        quietLog();
        const installation = await aSubscriberOwing('card', null);
        const { collection, collections, callbacks, invoice } = installation;
        const [paid] = collections.attempts;
        assert.equal(paid.status, 'SUCCEEDED', 'the premise: paid');
        clockAt(berlinMidnight('2026-02-20'));
        await callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                reversalReported('evt_cb', paid.attemptKey, {
                    reversalRef: 'du_1',
                    paymentRef: paid.paymentRef,
                    withdrawnCents: toCents(invoice.totalGross),
                    reinstatedCents: 0,
                }),
            ),
        );

        const started = await collection.payNow('t1', clockAt(berlinMidnight('2026-02-21')));

        assert.equal(started.refused, 1);
        assert.equal(started.collected, 0);
    });

    test('without a payment method in use starts nothing, and says so', async () => {
        quietLog();
        const installation = aCollectingInstallation();
        const subscriber = await installation.aSubscriber('t1', { invoiceEmail: 'b@t1.example' });
        installation.charge(await installation.aContract(subscriber), 'plan');
        await installation.anInvoiceMailed(subscriber.id, ISSUED);

        const started = await installation.collection.payNow('t1', clockAt(LATER));

        assert.deepEqual(started, {
            paymentMethod: false,
            collected: 0,
            pending: 0,
            failed: 0,
            announced: 0,
            onTheirWay: 0,
            refused: 0,
            waiting: 0,
            notSentYet: 0,
        });
    });

    test('leaves an invoice not handed to the subscriber yet to the run that mails it', async () => {
        quietLog();
        const installation = aCollectingInstallation();
        await installation.aPayingSubscriber('t1', 'card');
        await installation.run(ISSUED);

        const started = await installation.collection.payNow('t1', clockAt(FIRST_RUN));

        assert.equal(started.collected, 0);
        assert.equal(started.notSentYet, 1, 'counted, so the page can say why it is still owed');
        assert.equal(installation.gateway.collections.length, 0);
    });

    test('pays nothing twice for an invoice already paid', async () => {
        quietLog();
        const installation = await aSubscriberOwing('card', null);
        const sent = installation.gateway.collections.length;

        const started = await installation.collection.payNow('t1', clockAt(LATER));

        assert.equal(started.collected, 0);
        assert.equal(installation.gateway.collections.length, sent);
    });
});

describe('a payment method the subscriber enters', () => {
    clockFrom(FIRST_RUN);

    test('collects at once an invoice issued while none was in use', async () => {
        quietLog();
        const installation = anInstallationTold();
        const subscriber = await installation.aSubscriber('t1', { invoiceEmail: 'b@t1.example' });
        installation.charge(await installation.aContract(subscriber), 'plan');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        assert.equal(invoice.payment, null, 'the premise: issued without a payment method');
        await replaceWith(installation, subscriber.id, 'card', DUE_DAY);

        clockAt(LATER);
        await installation.confirmed(subscriber.id);

        assert.equal(await installation.payments.owedBy(invoice.id), 0);
        assert.deepEqual(
            plannedBecause(installation),
            ['payment-method-entered'],
            'as the run says it',
        );
    });

    test('where its confirmation collected nothing, leaves an invoice issued while none was in use to the run', async () => {
        quietLog();
        const installation = aCollectingInstallation();
        const subscriber = await installation.aSubscriber('t1', { invoiceEmail: 'b@t1.example' });
        installation.charge(await installation.aContract(subscriber), 'plan');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        await installation.collect(clockAt(FIRST_RUN));
        assert.deepEqual(
            installation.collections.attempts,
            [],
            'the premise: nothing to collect with',
        );
        await replaceWith(installation, subscriber.id, 'card', DUE_DAY);

        await installation.collect(clockAt(LATER));

        assert.equal(await installation.payments.owedBy(invoice.id), 0);
        assert.ok(
            installation.audits.some(
                (entry) =>
                    entry.action === 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED' &&
                    entry.changes.because === 'payment-method-entered',
            ),
        );
    });

    test('leaves an invoice that reaches the mail only after it to the run', async () => {
        quietLog();
        const installation = anInstallationTold();
        const subscriber = await installation.aSubscriber('t1', { invoiceEmail: 'b@t1.example' });
        installation.charge(await installation.aContract(subscriber), 'plan');
        await installation.run(ISSUED);
        const [invoice] = installation.store.invoices;
        await replaceWith(installation, subscriber.id, 'card', DUE_DAY);
        clockAt(LATER);
        await installation.confirmed(subscriber.id);
        assert.deepEqual(installation.gateway.collections, [], 'the premise: not mailed yet');

        installation.mailed(invoice.id, LATER);
        await installation.collect(clockAt(new Date(LATER.getTime() + 15 * 60_000)));

        assert.equal(await installation.payments.owedBy(invoice.id), 0);
    });

    test('before the day a direct debit’s invoice names, charges a card on that day and not earlier', async () => {
        quietLog();
        const installation = anInstallationTold();
        const { subscriber, invoice } = await aDirectDebitAnnounced(installation);
        clockAt(EARLY);
        await replaceWith(installation, subscriber.id, 'card', EARLY);

        await installation.confirmed(subscriber.id);

        assert.deepEqual(installation.gateway.collections, [], 'nothing brought forward');
        assert.deepEqual(
            plannedBecause(installation),
            ['payment-method-replaced'],
            'as the run says it',
        );
        assert.deepEqual(
            installation.collections.attempts.map((each) => [each.status, each.collectOn]),
            [['SCHEDULED', '2026-02-15']],
        );
        await installation.collect(clockAt(LATER));
        assert.equal(await installation.payments.owedBy(invoice.id), 0, 'charged on the day');
    });
});

describe('the route a tenant pays on', () => {
    test('answers that nothing can be paid where invoices are not collected', async () => {
        const controller = new TenantInvoicesController({}, () => 't1', null);
        await assert.rejects(
            controller.pay({}),
            (error) =>
                error.getStatus() === 409 && error.getResponse().code === 'PAYMENTS_NOT_CONFIGURED',
        );
    });

    test('pays for the session’s tenant', async () => {
        const asked = [];
        const controller = new TenantInvoicesController({}, () => 't-session', {
            payNow: async (tenantId) => {
                asked.push(tenantId);
                return { paymentMethod: true, collected: 1 };
            },
        });
        assert.deepEqual(await controller.pay({ user: { tenantId: 't-elsewhere' } }), {
            paymentMethod: true,
            collected: 1,
        });
        assert.deepEqual(asked, ['t-session']);
    });
});
