// An invoice unpaid on its due date makes its subscriber's tenant read-only,
// and settling it lifts that reason and no other (`SC-PRIC-098`).
//
// Every case runs over the collecting installation in memory: the invoice of
// February is issued on 1 February and due on 15 February — fourteen days of
// payment term. A card is charged at once, so a card refused for good at the
// first run leaves it open; it holds the tenant back from 15 February,
// midnight in Berlin, and not a moment before. A direct debit is collected on
// that day.

// @requirement SC-PRIC-098 — An invoice unpaid on its due date makes the tenant read-only until it is paid

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { toCents } from '@saasicat/core';

import { SubscriptionInvoiceCron } from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import {
    COLLECTING_SETTINGS,
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    clockAt,
    clockFrom,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';
import { reversalReported, succeeded } from './helpers/money-events.js';
import { MAIN_ACCOUNT, signedCallback } from './helpers/payments.js';

/** A card reported stolen: refused for good, so nothing is collected until it is replaced. */
const UNUSABLE = {
    status: 'failed',
    paymentRef: 'pi_stolen',
    reason: 'payment-method-unusable',
    gatewayCode: 'stolen_card',
};

/** Midnight in Berlin at the start of `day`, `YYYY-MM-DD` in winter time. */
const berlinMidnight = (day) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 3_600_000);

/** `minutes` minutes after `at`. */
const later = (at, minutes) => new Date(at.getTime() + minutes * 60_000);

/** The due date of February's invoice, and the last moment before it. */
const DUE_DAY = berlinMidnight('2026-02-15');
const BEFORE_DUE_DAY = new Date(DUE_DAY.getTime() - 1);

const RUN_TAG = 'job:platform:overdue-invoices';

/** The actor a payment is audited as, and lifts a reason as. */
const PAYMENT_TAG = 'job:platform:subscription-invoices';

/**
 * The tenants `tenantIds`, each with a subscriber whose February invoice was
 * refused for good at the first run, and the reasons kept beside them.
 */
async function unpaidInvoices(tenantIds = ['t1'], settings = structuredClone(COLLECTING_SETTINGS)) {
    const holds = new FakeTenantAccessHoldRepository();
    const installation = aCollectingInstallation({ holds, settings });
    const paying = [];
    for (const tenantId of tenantIds) {
        paying.push(await installation.aPayingSubscriber(tenantId, 'card'));
    }
    const invoices = [];
    for (const { subscriber } of paying) {
        invoices.push(await installation.anInvoiceMailed(subscriber.id, ISSUED));
    }
    for (const _ of invoices) installation.gateway.answers.push(UNUSABLE);
    await installation.collect(FIRST_RUN);
    const access = new TenantAccessService(holds, new Reflector());
    return { ...installation, settings, holds, access, paying, invoices };
}

/** `t1` paying by direct debit, its February invoice mailed, collected on 15 February. */
async function aDirectDebit() {
    const holds = new FakeTenantAccessHoldRepository();
    const installation = aCollectingInstallation({ holds });
    const { subscriber } = await installation.aPayingSubscriber('t1', 'sepa_debit');
    const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
    assert.equal(invoice.dueDate, '2026-02-15', 'the premise: due on its collection day');
    const access = new TenantAccessService(holds, new Reflector());
    return { ...installation, holds, access, subscriber, invoice };
}

const stateOf = async (access, tenantId) => (await access.accessOf(tenantId)).state;

const openReasons = (holds) =>
    holds.holds
        .filter((hold) => hold.liftedAt === null)
        .map((hold) => [hold.tenantId, hold.kind, hold.reference]);

/** Replaces the payment method of `subscriberId` with a card the gateway charges. */
const replaceCard = (installation, subscriberId, at) =>
    installation.paymentMethods.recordConfirmed(
        paymentMethodOf(subscriberId, 'card', { paymentMethodRef: 'pm_card_new', confirmedAt: at }),
    );

/** What the gateway answers, asked about the attempt `attempt` after it was pending. */
const answerLater = (installation, attempt, outcome) =>
    installation.gateway.held.set(attempt.attemptKey, outcome);

describe('an invoice left unpaid', () => {
    clockFrom(FIRST_RUN);

    test('is open and due on 15 February, its card refused on the day it was issued', async () => {
        quietLog();
        const { invoices, payments, collections } = await unpaidInvoices();
        assert.equal(invoices[0].dueDate, '2026-02-15');
        assert.ok((await payments.owedBy(invoices[0].id)) > 0);
        assert.equal(collections.attempts[0].status, 'FAILED');
    });

    test('holds nobody back before its due date, a refused card included', async () => {
        quietLog();
        const { overdue, holds, access } = await unpaidInvoices();

        const run = await overdue.holdBackDue(clockAt(BEFORE_DUE_DAY));

        assert.deepEqual(run, { held: 0, lifted: 0 });
        assert.equal(await stateOf(access, 't1'), 'open');
        assert.deepEqual(openReasons(holds), []);
    });

    test('makes the tenant read-only on its due date, recorded by the run', async () => {
        quietLog();
        const { overdue, holds, access, invoices } = await unpaidInvoices();

        const run = await overdue.holdBackDue(clockAt(DUE_DAY));

        assert.deepEqual(run, { held: 1, lifted: 0 });
        assert.equal(await stateOf(access, 't1'), 'read-only');
        const [reason] = holds.holds;
        assert.deepEqual(
            [reason.tenantId, reason.kind, reason.reference, reason.note, reason.recordedBy],
            ['t1', 'overdue', invoices[0].id, null, RUN_TAG],
        );
        assert.equal(reason.since.getTime(), DUE_DAY.getTime());
    });

    test('is one reason however often the run finds it', async () => {
        quietLog();
        const { overdue, holds } = await unpaidInvoices();
        await overdue.holdBackDue(clockAt(DUE_DAY));

        const again = await overdue.holdBackDue(clockAt(later(DUE_DAY, 15)));

        assert.deepEqual(again, { held: 0, lifted: 0 });
        assert.equal(holds.holds.length, 1);
    });

    test('with no payment method to collect it, holds the tenant back from its due date', async () => {
        quietLog();
        const holds = new FakeTenantAccessHoldRepository();
        const installation = aCollectingInstallation({ holds });
        const subscriber = await installation.aSubscriber('t1', {
            invoiceEmail: 'billing@t1.example',
        });
        const contract = await installation.aContract(subscriber);
        installation.charge(contract, 'plan');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        assert.equal(invoice.payment, null, 'the premise: nothing collects it');
        const access = new TenantAccessService(holds, new Reflector());

        await installation.overdue.holdBackDue(clockAt(BEFORE_DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'open');
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'read-only');
    });

    test('holds back only the tenant whose subscriber owes it', async () => {
        quietLog();
        const { overdue, access, payments, invoices } = await unpaidInvoices(['t1', 't2']);
        await payments.recordPayment({
            invoiceId: invoices[1].id,
            collectionId: null,
            gatewayAccount: 'main',
            provider: 'stripe',
            gatewayRef: 'pi_paid_t2',
            amount: invoices[1].totalGross,
            currency: 'EUR',
            at: BEFORE_DUE_DAY,
        });

        await overdue.holdBackDue(clockAt(DUE_DAY));

        assert.deepEqual(
            [await stateOf(access, 't1'), await stateOf(access, 't2')],
            ['read-only', 'open'],
        );
    });

    test('holds nobody back where its subscriber is live for no tenant any more', async () => {
        quietLog();
        const { overdue, holds, subscriberRepository, paying } = await unpaidInvoices();
        subscriberRepository.closeTenantLink(paying[0].subscriber.id, BEFORE_DUE_DAY);

        assert.deepEqual(await overdue.holdBackDue(clockAt(DUE_DAY)), { held: 0, lifted: 0 });
        assert.deepEqual(openReasons(holds), []);
    });
});

describe('a direct debit collected on its due date', () => {
    clockFrom(FIRST_RUN);

    test('holds nobody back while it waits for the bank', async () => {
        quietLog();
        const installation = await aDirectDebit();
        installation.gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await installation.collect(clockAt(DUE_DAY));
        assert.equal(installation.collections.attempts[0].status, 'PENDING', 'the premise');

        await installation.overdue.holdBackDue(clockAt(later(DUE_DAY, 15)));

        assert.equal(await stateOf(installation.access, 't1'), 'open');
    });

    test('that the bank refuses days later holds the tenant back once the refusal is there', async () => {
        quietLog();
        const installation = await aDirectDebit();
        installation.gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await installation.collect(clockAt(DUE_DAY));
        const [attempt] = installation.collections.attempts;
        answerLater(installation, attempt, { ...UNUSABLE, paymentRef: 'pi_debit' });

        const refusedOn = berlinMidnight('2026-02-19');
        await installation.collect(clockAt(refusedOn));
        assert.equal(installation.collections.attempts[0].status, 'FAILED', 'the premise');
        await installation.overdue.holdBackDue(clockAt(later(refusedOn, 1)));

        assert.equal(await stateOf(installation.access, 't1'), 'read-only');
    });
});

describe('settling an overdue invoice', () => {
    clockFrom(FIRST_RUN);

    /** The tenant held back from 15 February. */
    async function heldBack() {
        const installation = await unpaidInvoices();
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(installation.access, 't1'), 'read-only', 'the premise');
        return installation;
    }

    const AFTER_REPLACING = later(DUE_DAY, 15);

    test('by the payment that collects it lifts the reason at once, before any run', async () => {
        quietLog();
        const installation = await heldBack();
        const { holds, access, paying, invoices, payments } = installation;
        await replaceCard(installation, paying[0].subscriber.id, DUE_DAY);

        await installation.collect(clockAt(AFTER_REPLACING));

        assert.equal(await payments.owedBy(invoices[0].id), 0, 'the premise: paid');
        assert.equal(await stateOf(access, 't1'), 'open');
        const [reason] = holds.holds;
        assert.deepEqual(
            [reason.liftedAt?.getTime(), reason.liftedBy],
            [AFTER_REPLACING.getTime(), PAYMENT_TAG],
        );
    });

    test('started again by the tenant, lifts nothing while the payment waits, and lifts it once it is there', async () => {
        quietLog();
        const installation = await heldBack();
        const { access, paying, gateway, collections } = installation;
        await replaceCard(installation, paying[0].subscriber.id, DUE_DAY);
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_again' });

        await installation.collect(clockAt(AFTER_REPLACING));
        const again = collections.attempts.at(-1);
        assert.equal(again.status, 'PENDING', 'the premise: on its way');
        await installation.overdue.holdBackDue(clockAt(later(AFTER_REPLACING, 15)));
        assert.equal(await stateOf(access, 't1'), 'read-only');

        answerLater(installation, again, succeeded(installation.invoices[0], 'pi_again'));
        await installation.collect(clockAt(later(AFTER_REPLACING, 120)));

        assert.equal(collections.attempts.at(-1).status, 'SUCCEEDED', 'the premise: paid');
        assert.equal(await stateOf(access, 't1'), 'open');
    });

    test('in part lifts nothing: what is still owed holds the tenant back', async () => {
        quietLog();
        const installation = await heldBack();
        const { access, paying, invoices, payments, gateway } = installation;
        await replaceCard(installation, paying[0].subscriber.id, DUE_DAY);
        gateway.answers.push(succeeded(invoices[0], 'pi_part', invoices[0].totalGross / 2));

        await installation.collect(clockAt(AFTER_REPLACING));

        assert.ok((await payments.owedBy(invoices[0].id)) > 0, 'the premise: paid in part');
        assert.equal(await stateOf(access, 't1'), 'read-only');
    });

    test('lifts that reason and no other: a tenant the operator suspended stays suspended', async () => {
        quietLog();
        const installation = await heldBack();
        const { access, holds, paying } = installation;
        await access.suspend('t1', 'Contract under review', 'web:ops@example.com:s1', DUE_DAY);
        await replaceCard(installation, paying[0].subscriber.id, DUE_DAY);

        await installation.collect(clockAt(AFTER_REPLACING));

        assert.equal(await stateOf(access, 't1'), 'suspended');
        assert.deepEqual(openReasons(holds), [['t1', 'suspended', null]]);
    });

    test('reads the reasons of its own tenant alone, however many others are held back', async () => {
        quietLog();
        const installation = await unpaidInvoices(['t1', 't2']);
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        const { holds, access, paying } = installation;
        const asked = [];
        for (const method of ['listOpen', 'listOpenFor', 'listTenantIdsHeldBy']) {
            const original = holds[method].bind(holds);
            holds[method] = (...args) => {
                asked.push(method);
                return original(...args);
            };
        }
        await replaceCard(installation, paying[0].subscriber.id, DUE_DAY);

        await installation.collect(clockAt(AFTER_REPLACING));

        assert.deepEqual(asked, ['listOpen']);
        assert.deepEqual(
            [await stateOf(access, 't1'), await stateOf(access, 't2')],
            ['open', 'read-only'],
        );
    });

    test('in another way than a collection is found by the next run, which lets the tenant go', async () => {
        quietLog();
        const { overdue, access, payments, invoices } = await heldBack();
        await payments.recordPayment({
            invoiceId: invoices[0].id,
            collectionId: null,
            gatewayAccount: 'main',
            provider: 'stripe',
            gatewayRef: 'pi_elsewhere',
            amount: invoices[0].totalGross,
            currency: 'EUR',
            at: AFTER_REPLACING,
        });

        const run = await overdue.holdBackDue(clockAt(AFTER_REPLACING));

        assert.deepEqual(run, { held: 0, lifted: 1 });
        assert.equal(await stateOf(access, 't1'), 'open');
    });

    test('by cancelling it so that nothing is owed, lets the tenant go at the next run', async () => {
        quietLog();
        const { overdue, access, cancellation, invoices } = await heldBack();
        const { replacement } = await cancellation.cancel(
            invoices[0].id,
            {
                reason: 'Nothing of it was owed.',
                // The plan line; the discount beside it follows what it reduced.
                lines: [{ position: 1, owed: 0 }],
            },
            'operator:anna',
            AFTER_REPLACING,
        );
        assert.equal(replacement, null, 'the premise: nothing takes its place');

        const run = await overdue.holdBackDue(clockAt(AFTER_REPLACING));

        assert.deepEqual(run, { held: 0, lifted: 1 });
        assert.equal(await stateOf(access, 't1'), 'open');
    });

    test('a subscriber live for no tenant any more lets its former tenant go at the next run', async () => {
        quietLog();
        const { overdue, access, subscriberRepository, paying } = await heldBack();
        subscriberRepository.closeTenantLink(paying[0].subscriber.id, AFTER_REPLACING);

        assert.deepEqual(await overdue.holdBackDue(clockAt(AFTER_REPLACING)), {
            held: 0,
            lifted: 1,
        });
        assert.equal(await stateOf(access, 't1'), 'open');
    });
});

describe('a payment started after the due date', () => {
    clockFrom(FIRST_RUN);

    test('with nothing failed before, lets the tenant go once it is there, not while it waits', async () => {
        quietLog();
        const holds = new FakeTenantAccessHoldRepository();
        const installation = aCollectingInstallation({ holds });
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        // Issued, and not handed to the mail by its due date: nothing collects it.
        await installation.run(ISSUED);
        const [invoice] = installation.store.invoices;
        const access = new TenantAccessService(holds, new Reflector());
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'read-only', 'the premise: nothing collects it');
        assert.equal(invoice.subscriberId, subscriber.id);

        const sentAt = berlinMidnight('2026-02-16');
        installation.mailed(invoice.id, sentAt);
        installation.gateway.answers.push({ status: 'pending', paymentRef: 'pi_late' });
        await installation.collect(clockAt(sentAt));
        const [attempt] = installation.collections.attempts;
        assert.equal(attempt.status, 'PENDING', 'the premise: on its way, sent after the due date');
        await installation.overdue.holdBackDue(clockAt(later(sentAt, 15)));
        assert.equal(await stateOf(access, 't1'), 'read-only');

        answerLater(installation, attempt, succeeded(invoice, 'pi_late'));
        await installation.collect(clockAt(later(sentAt, 120)));

        assert.equal(installation.collections.attempts[0].status, 'SUCCEEDED', 'the premise: paid');
        assert.equal(await stateOf(access, 't1'), 'open');
    });
});

describe('an invoice that replaced a cancelled one', () => {
    clockFrom(FIRST_RUN);

    test('carries the refusal of the invoice it replaced, while its own collection waits', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        const { cancellation, invoices, paying, access, collections } = installation;
        const cancelledAt = berlinMidnight('2026-02-03');
        const { replacement } = await cancellation.cancel(
            invoices[0].id,
            { reason: 'The billing address was wrong.' },
            'operator:anna',
            cancelledAt,
        );
        assert.ok(replacement, 'the premise: a replacement stands');
        installation.mailed(replacement.id, cancelledAt);
        await replaceCard(installation, paying[0].subscriber.id, cancelledAt);
        installation.gateway.answers.push({ status: 'pending', paymentRef: 'pi_replacement' });
        await installation.collect(clockAt(later(cancelledAt, 15)));
        const own = collections.attempts.filter((each) => each.invoiceId === replacement.id);
        assert.deepEqual(
            own.map((each) => each.status),
            ['PENDING'],
            'the premise: its own collection was sent before its due date and waits',
        );

        const replacementDue = berlinMidnight(replacement.dueDate);
        await installation.overdue.holdBackDue(clockAt(new Date(replacementDue.getTime() - 1)));
        assert.equal(
            await stateOf(access, 't1'),
            'open',
            'cancelled before it came due, the invoice left the replacement its own due date',
        );
        await installation.overdue.holdBackDue(clockAt(replacementDue));

        assert.equal(await stateOf(access, 't1'), 'read-only');
    });

    test('cancelled once it was due and refused, keeps the tenant held until the replacement is paid', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        const { cancellation, invoices, paying, access, holds } = installation;
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'read-only', 'the premise: held back');
        const cancelledAt = berlinMidnight('2026-02-20');
        const { replacement } = await cancellation.cancel(
            invoices[0].id,
            { reason: 'The billing address was wrong.' },
            'operator:anna',
            cancelledAt,
        );
        assert.ok(replacement.dueDate > '2026-02-20', 'the premise: the replacement is due later');

        await installation.overdue.holdBackDue(clockAt(later(cancelledAt, 15)));

        assert.equal(await stateOf(access, 't1'), 'read-only', 'a correction is not a payment');
        assert.deepEqual(openReasons(holds), [['t1', 'overdue', replacement.id]]);

        installation.mailed(replacement.id, cancelledAt);
        await replaceCard(installation, paying[0].subscriber.id, cancelledAt);
        await installation.collect(clockAt(later(cancelledAt, 30)));

        assert.equal(await stateOf(access, 't1'), 'open');
    });
});

describe('a refusal a payment made good', () => {
    clockFrom(FIRST_RUN);

    test('counts no more once the invoice is replaced; a payment taken back after holds from the replacement’s due date', async () => {
        quietLog();
        const holds = new FakeTenantAccessHoldRepository();
        const installation = aCollectingInstallation({ holds });
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        const access = new TenantAccessService(holds, new Reflector());
        installation.gateway.answers.push({
            status: 'failed',
            paymentRef: 'pi_short',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        });
        await installation.collect(FIRST_RUN);
        await installation.collect(clockAt(berlinMidnight('2026-02-08')));
        const paid = installation.collections.attempts.at(-1);
        assert.deepEqual(
            installation.collections.attempts.map((each) => each.status),
            ['FAILED', 'SUCCEEDED'],
            'the premise: refused, then paid in full before its due date',
        );
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'open', 'the premise: never late');

        const cancelledAt = berlinMidnight('2026-02-20');
        const { replacement } = await installation.cancellation.cancel(
            invoice.id,
            { reason: 'The billing address was wrong.' },
            'operator:anna',
            cancelledAt,
        );
        const takenBackAt = berlinMidnight('2026-02-25');
        clockAt(takenBackAt);
        await installation.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                reversalReported('evt_cb', paid.attemptKey, {
                    reversalRef: 'du_cb',
                    paymentRef: paid.paymentRef,
                    withdrawnCents: toCents(invoice.totalGross),
                    reinstatedCents: 0,
                }),
            ),
        );
        assert.ok(
            (await installation.payments.owedBy(replacement.id)) > 0,
            'the premise: the replacement owes again',
        );

        await installation.overdue.holdBackDue(clockAt(later(takenBackAt, 15)));
        assert.equal(
            await stateOf(access, 't1'),
            'open',
            'the refusal was made good, and the replacement is not due yet',
        );
        // A collection of the replacement sent before its due date and waiting
        // for an answer — on its way, in time. Written as the store keeps one,
        // since the collection run does not take up a replacement issued with
        // nothing left to pay.
        installation.collections.attempts.push({
            ...structuredClone(paid),
            id: 'attempt-replacement',
            invoiceId: replacement.id,
            attempt: 1,
            attemptKey: `saasicat:collect:${replacement.id}:1`,
            status: 'PENDING',
            paymentRef: 'pi_after',
            submittedAt: later(takenBackAt, 30),
            resolvedAt: null,
            failureReason: null,
            failureCode: null,
            followedUpAt: null,
        });

        await installation.overdue.holdBackDue(clockAt(berlinMidnight(replacement.dueDate)));

        assert.equal(await stateOf(access, 't1'), 'read-only', 'a payment taken back counts');
    });
});

describe('a chain of corrections', () => {
    clockFrom(FIRST_RUN);

    test('forgets a refusal behind an invoice that was paid before it was replaced', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        const { cancellation, invoices, paying, access, collections } = installation;
        const subscriberId = paying[0].subscriber.id;
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        assert.equal(await stateOf(access, 't1'), 'read-only', 'the premise: A held back');

        const firstCorrection = berlinMidnight('2026-02-20');
        const { replacement: second } = await cancellation.cancel(
            invoices[0].id,
            { reason: 'The billing address was wrong.' },
            'operator:anna',
            firstCorrection,
        );
        installation.mailed(second.id, firstCorrection);
        await replaceCard(installation, subscriberId, firstCorrection);
        await installation.collect(clockAt(later(firstCorrection, 30)));
        const paidSecond = collections.attempts.find((each) => each.invoiceId === second.id);
        assert.equal(paidSecond?.status, 'SUCCEEDED', 'the premise: B paid in full');
        assert.equal(await stateOf(access, 't1'), 'open', 'the premise: let go once paid');

        const secondCorrection = berlinMidnight('2026-03-01');
        const { replacement: third } = await cancellation.cancel(
            second.id,
            { reason: 'The company name was wrong.' },
            'operator:anna',
            secondCorrection,
        );
        const takenBackAt = berlinMidnight('2026-03-03');
        clockAt(takenBackAt);
        await installation.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                reversalReported('evt_cb_b', paidSecond.attemptKey, {
                    reversalRef: 'du_b',
                    paymentRef: paidSecond.paymentRef,
                    withdrawnCents: toCents(second.totalGross),
                    reinstatedCents: 0,
                }),
            ),
        );
        assert.ok((await installation.payments.owedBy(third.id)) > 0, 'the premise: C owes again');

        await installation.overdue.holdBackDue(clockAt(later(takenBackAt, 15)));
        assert.equal(
            await stateOf(access, 't1'),
            'open',
            'A’s refusal was made good when B was paid, and C is not due yet',
        );
        await installation.overdue.holdBackDue(clockAt(berlinMidnight(third.dueDate)));
        assert.equal(await stateOf(access, 't1'), 'read-only');
    });
});

describe('a payment taken back on a corrected invoice', () => {
    clockFrom(FIRST_RUN);

    test('keeps the tenant held through the next correction, until the money comes back', async () => {
        quietLog();
        const holds = new FakeTenantAccessHoldRepository();
        const installation = aCollectingInstallation({ holds });
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        await installation.collect(FIRST_RUN);
        const [paid] = installation.collections.attempts;
        assert.equal(paid.status, 'SUCCEEDED', 'the premise: A paid');
        const access = new TenantAccessService(holds, new Reflector());

        const firstCorrection = berlinMidnight('2026-02-20');
        const { replacement: second } = await installation.cancellation.cancel(
            invoice.id,
            { reason: 'The billing address was wrong.' },
            'operator:anna',
            firstCorrection,
        );
        clockAt(berlinMidnight('2026-02-25'));
        await installation.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                reversalReported('evt_cb_a', paid.attemptKey, {
                    reversalRef: 'du_a',
                    paymentRef: paid.paymentRef,
                    withdrawnCents: toCents(invoice.totalGross),
                    reinstatedCents: 0,
                }),
            ),
        );
        assert.ok((await installation.payments.owedBy(second.id)) > 0, 'the premise: B owes');
        await installation.overdue.holdBackDue(clockAt(berlinMidnight(second.dueDate)));
        assert.equal(
            await stateOf(access, 't1'),
            'read-only',
            'the premise: held from B’s due date',
        );

        const secondCorrection = berlinMidnight('2026-03-08');
        installation.mailed(second.id, firstCorrection);
        const { replacement: third } = await installation.cancellation.cancel(
            second.id,
            { reason: 'The company name was wrong.' },
            'operator:anna',
            secondCorrection,
        );
        assert.ok(third.dueDate > '2026-03-08', 'the premise: C is due later');

        await installation.overdue.holdBackDue(clockAt(later(secondCorrection, 15)));
        assert.equal(await stateOf(access, 't1'), 'read-only', 'a correction is not a payment');

        // The dispute is won: the gateway gives the payment back, onto C.
        const givenBackAt = berlinMidnight('2026-03-10');
        clockAt(givenBackAt);
        await installation.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                reversalReported('evt_cb_a_won', paid.attemptKey, {
                    reversalRef: 'du_a',
                    paymentRef: paid.paymentRef,
                    withdrawnCents: toCents(invoice.totalGross),
                    reinstatedCents: toCents(invoice.totalGross),
                }),
            ),
        );
        await installation.overdue.holdBackDue(clockAt(later(givenBackAt, 15)));

        assert.equal(await stateOf(access, 't1'), 'open');
    });
});

describe('a payment taken back', () => {
    clockFrom(FIRST_RUN);

    test('opens the invoice again, and the next run holds the tenant back until it is paid again', async () => {
        quietLog();
        const holds = new FakeTenantAccessHoldRepository();
        const installation = aCollectingInstallation({ holds });
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        installation.gateway.answers.push(succeeded(invoice, 'pi_1', invoice.totalGross));
        await installation.collect(FIRST_RUN);
        const [attempt] = installation.collections.attempts;
        assert.equal(attempt.status, 'SUCCEEDED', 'the premise: paid');
        const access = new TenantAccessService(holds, new Reflector());

        const takenBackOn = berlinMidnight('2026-03-02');
        assert.deepEqual(await installation.overdue.holdBackDue(clockAt(takenBackOn)), {
            held: 0,
            lifted: 0,
        });
        await installation.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                reversalReported('evt_d1', attempt.attemptKey, {
                    reversalRef: 'du_1',
                    paymentRef: 'pi_1',
                    withdrawnCents: toCents(invoice.totalGross),
                    reinstatedCents: 0,
                }),
            ),
        );
        assert.equal(await stateOf(access, 't1'), 'open', 'nothing holds before the run');

        assert.deepEqual(await installation.overdue.holdBackDue(clockAt(later(takenBackOn, 15))), {
            held: 1,
            lifted: 0,
        });
        assert.equal(await stateOf(access, 't1'), 'read-only');
    });
});

describe('the quarter-hourly run', () => {
    clockFrom(FIRST_RUN);

    /** The run over `installation`, every step but the contract confirmations wired. */
    const cronOver = (installation) =>
        new SubscriptionInvoiceCron(
            installation.service,
            null,
            installation.documents,
            installation.collection,
            installation.money,
            null,
            installation.overdue,
        );

    test('holds a tenant back once its invoice is unpaid on its due date', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        clockAt(DUE_DAY);

        await cronOver(installation).issueDueInvoices();

        assert.equal(await stateOf(installation.access, 't1'), 'read-only');
    });

    test('collects first, so an invoice it collects holds nobody back, not even for a moment', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        await replaceCard(installation, installation.paying[0].subscriber.id, BEFORE_DUE_DAY);
        clockAt(DUE_DAY);

        await cronOver(installation).issueDueInvoices();

        assert.equal(await installation.payments.owedBy(installation.invoices[0].id), 0);
        assert.deepEqual(installation.holds.holds, [], 'no reason was recorded and lifted again');
    });

    test('with an invoice due the day it is issued, a refused card holds the tenant back in the run that issues it', async () => {
        quietLog();
        const settings = structuredClone(COLLECTING_SETTINGS);
        settings.invoicing.paymentTermDays = 0;
        const holds = new FakeTenantAccessHoldRepository();
        const installation = aCollectingInstallation({ holds, settings });
        await installation.aPayingSubscriber('t1', 'card');
        installation.gateway.answers.push(UNUSABLE);
        clockAt(ISSUED);

        await cronOver(installation).issueDueInvoices();

        assert.equal(installation.collections.attempts[0]?.status, 'FAILED', 'the premise');
        const access = new TenantAccessService(holds, new Reflector());
        assert.equal(await stateOf(access, 't1'), 'read-only');
    });
});

describe('a payment that lands while the run compares', () => {
    clockFrom(FIRST_RUN);

    /**
     * The payment the gateway reports for the whole invoice, and the lift its
     * callback makes, run at the moment `when` names: the run has read the
     * invoice as unpaid and has not recorded its reason yet.
     */
    function settleWhile(installation, when) {
        const { payments, overdue, invoices, holds } = installation;
        const settle = async () => {
            await payments.recordPayment({
                invoiceId: invoices[0].id,
                collectionId: null,
                gatewayAccount: 'main',
                provider: 'stripe',
                gatewayRef: 'pi_meanwhile',
                amount: invoices[0].totalGross,
                currency: 'EUR',
                at: DUE_DAY,
            });
            await overdue.liftSettled(invoices[0].id, DUE_DAY, PAYMENT_TAG);
        };
        const original = holds[when].bind(holds);
        let landed = false;
        holds[when] = async (...args) => {
            if (!landed) {
                landed = true;
                await settle();
            }
            return original(...args);
        };
    }

    test('before its reason is recorded leaves no reason standing', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        settleWhile(installation, 'record');

        const run = await installation.overdue.holdBackDue(clockAt(DUE_DAY));

        assert.deepEqual(openReasons(installation.holds), []);
        assert.equal(await stateOf(installation.access, 't1'), 'open');
        assert.deepEqual(run, { held: 0, lifted: 0 });
    });

    test('after the reason it lifts was read as gone leaves none recorded again', async () => {
        quietLog();
        const installation = await unpaidInvoices();
        await installation.overdue.holdBackDue(clockAt(DUE_DAY));
        // The callback lifts the standing reason after the run read the
        // invoice as unpaid, and before it read the reasons.
        settleWhile(installation, 'listTenantIdsHeldBy');

        await installation.overdue.holdBackDue(clockAt(later(DUE_DAY, 15)));

        assert.deepEqual(openReasons(installation.holds), []);
        assert.equal(await stateOf(installation.access, 't1'), 'open');
    });
});
