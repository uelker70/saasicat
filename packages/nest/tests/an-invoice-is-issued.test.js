// The run that issues the invoices the charge journal is owed.
//
// Every case goes through `SubscriptionInvoiceService.issueDue`, the one call
// the quarter-hourly job makes, over an installation in memory whose invoice
// store keeps numbers the way the persistence contract holds both adapters to —
// so what is asserted is the invoice an operator would find, and the number it
// carries, not what a helper returns.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    INVOICE_ERROR_CODES,
    SUBSCRIBER_ERROR_CODES,
    TAX_ERROR_CODES,
    contractPartiesOf,
} from '@saasicat/core';

import { SubscriptionInvoiceCron } from '../dist/billing/index.js';

import {
    ADDRESS,
    INVOICING_SETTINGS,
    ISSUER,
    anInvoicingInstallation,
    berlin,
    invoicingAdapter,
    line,
} from './helpers/invoice-run.js';
import { FakeAppliedSettingsPort } from './helpers/applied-settings-port.js';

/** The first moment of April in Berlin, in summer time. */
const APRIL = new Date('2026-04-01T00:00:00.000+02:00');

/** An installation with one subscriber and its contract, charged its opening of February. */
async function aChargedSubscriber(options = {}, details = {}) {
    const installation = anInvoicingInstallation(options);
    const subscriber = await installation.aSubscriber('t1', details);
    const contract = await installation.aContract(subscriber);
    installation.charge(contract, 'plan');
    installation.charge(contract, 'discount');
    return { ...installation, subscriber, contract };
}

// @requirement SC-PRIC-022 — Every charge of a subscription is invoiced once, on that subscription's invoice
// @requirement SC-AUD-013 — Every invoice line can be traced to the charge and the contract line it came from
describe('an invoice is issued for the charges booked together', () => {
    test('the opening of a period is one invoice, its lines in the contract’s order', async () => {
        const { run, store, journal, contract } = await aChargedSubscriber();

        assert.deepEqual(await run(), { issued: 1, held: 0, failed: 0 });

        const [invoice] = store.invoices;
        assert.equal(invoice.number, 'AHP-2026-000001');
        assert.equal(invoice.contractId, contract.id);
        assert.deepEqual(
            invoice.lines.map((l) => [
                l.position,
                l.chargeId,
                l.contractLineItemId,
                l.title,
                l.amountNet,
            ]),
            [
                [1, journal[0].id, contract.lineItems[0].id, 'Standard, monthly', 49],
                [2, journal[1].id, contract.lineItems[1].id, 'Welcome discount', -4.9],
            ],
        );
    });

    test('a charge that arises later in the period is an invoice of its own, numbered after', async () => {
        const installation = await aChargedSubscriber();
        await installation.run();
        installation.charge(installation.contract, 'plan', {
            origin: 'planChange',
            periodStart: berlin('2026-02-14'),
            amountNet: 12.5,
        });

        assert.deepEqual(await installation.run(new Date('2026-02-14T09:00:00.000Z')), {
            issued: 1,
            held: 0,
            failed: 0,
        });
        assert.deepEqual(
            installation.store.invoices.map((inv) => [inv.number, inv.lines.length]),
            [
                ['AHP-2026-000001', 2],
                ['AHP-2026-000002', 1],
            ],
        );
    });

    test('groups waiting from earlier are issued oldest first, so their numbers follow the charges', async () => {
        const installation = anInvoicingInstallation();
        const subscriber = await installation.aSubscriber('t1');
        const contract = await installation.aContract(subscriber);
        installation.charge(contract, 'plan', {
            periodStart: berlin('2026-03-01'),
            periodEnd: APRIL,
        });
        installation.charge(contract, 'plan');

        await installation.run(new Date('2026-03-01T09:00:00.000Z'));

        assert.deepEqual(
            installation.store.invoices.map((inv) => [inv.number, inv.servicePeriodFrom]),
            [
                ['AHP-2026-000001', '2026-02-01'],
                ['AHP-2026-000002', '2026-03-01'],
            ],
        );
    });

    test('a second run issues nothing the first one issued', async () => {
        const { run, store } = await aChargedSubscriber();
        await run();

        assert.deepEqual(await run(), { issued: 0, held: 0, failed: 0 });
        assert.equal(store.invoices.length, 1);
    });

    test('a charge another instance invoiced first is passed over, neither issued nor failed', async () => {
        const { run, store, journal } = await aChargedSubscriber();
        store.takenByAnother = [journal[0].id];

        assert.deepEqual(await run(), { issued: 0, held: 0, failed: 0 });
        assert.equal(store.invoices.length, 0);
    });

    test('a failure of one invoice holds up none of the others, and the next run issues it', async () => {
        const installation = anInvoicingInstallation();
        for (const tenant of ['t1', 't2']) {
            const contract = await installation.aContract(await installation.aSubscriber(tenant));
            installation.charge(contract, 'plan');
        }
        installation.store.failNextIssue = new Error('connection reset');

        assert.deepEqual(await installation.run(), { issued: 1, held: 0, failed: 1 });
        assert.deepEqual(await installation.run(), { issued: 1, held: 0, failed: 0 });
        assert.deepEqual(
            installation.store.invoices.map((inv) => inv.number),
            ['AHP-2026-000001', 'AHP-2026-000002'],
        );
    });
});

// @requirement SC-PRIC-048 — A billing period whose charges are all zero issues no invoice
describe('a period whose charges are all zero', () => {
    test('issues no invoice and draws no number', async () => {
        const installation = anInvoicingInstallation();
        const contract = await installation.aContract(await installation.aSubscriber('t1'), {
            lineItems: [line('plan', 'FREE', 0)],
        });
        installation.charge(contract, 'plan');

        assert.deepEqual(await installation.run(), { issued: 0, held: 0, failed: 0 });
        assert.equal(installation.store.invoices.length, 0);
    });

    test('beside a period with an amount leaves that one to be issued', async () => {
        const installation = anInvoicingInstallation();
        const contract = await installation.aContract(await installation.aSubscriber('t1'), {
            lineItems: [line('plan', 'STANDARD', 49), line('bundle', 'FREE-ADDON', 0)],
        });
        installation.charge(contract, 'plan', { amountNet: 0 });
        installation.charge(contract, 'bundle', { periodStart: berlin('2026-02-10') });
        installation.charge(contract, 'plan', {
            periodStart: berlin('2026-03-01'),
            periodEnd: APRIL,
        });

        await installation.run(new Date('2026-03-01T09:00:00.000Z'));

        assert.deepEqual(
            installation.store.invoices.map((inv) => [inv.number, inv.servicePeriodFrom]),
            [['AHP-2026-000001', '2026-03-01']],
        );
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('the parties an invoice names', () => {
    test('are the subscriber as its record stands and the issuer the file names', async () => {
        const { run, store, subscribers, subscriber } = await aChargedSubscriber();
        await subscribers.changeContact(subscriber.id, { addressLine1: 'Neue Straße 2' }, 'test');

        await run();

        assert.deepEqual(store.invoices[0].subscriber, {
            customerNumber: subscriber.customerNumber,
            legalName: 'Customer of t1',
            vatId: null,
            taxNumber: null,
            ...ADDRESS,
            addressLine1: 'Neue Straße 2',
            addressLine2: null,
        });
        assert.deepEqual(store.invoices[0].issuer, {
            ...ISSUER,
            taxNumber: null,
            addressLine2: null,
        });
    });

    test('name the issuer’s corrected identity where the operator declared the correction', async () => {
        const corrected = { ...ISSUER, legalName: 'Issuer Software GmbH' };

        const issuer = await invoicedUnder(corrected, [
            recordedCorrection('2026-01-15', ISSUER, corrected, 'Renamed'),
        ]);

        assert.equal(issuer.legalName, 'Issuer Software GmbH');
    });

    test('follow the corrections in the order the record went through them, whatever the clocks said', async () => {
        const renamed = { ...ISSUER, legalName: 'Issuer Software GmbH' };
        const converted = { ...renamed, legalName: 'Issuer Software SE' };

        // Listed the latest first, as the port lists them; the start that
        // recorded the later correction ran on a clock behind the first one's.
        const issuer = await invoicedUnder(converted, [
            recordedCorrection('2026-01-10', renamed, converted, 'Change of legal form'),
            recordedCorrection('2026-01-15', ISSUER, renamed, 'Renamed'),
        ]);

        assert.equal(issuer.legalName, 'Issuer Software SE');
    });

    test('name the contract’s copy where nothing recorded connects it to the file’s issuer', async () => {
        const installation = anInvoicingInstallation({
            appliedSettings: new FakeAppliedSettingsPort(),
        });
        const subscriber = await installation.aSubscriber('t1');
        const contract = await installation.aContract(subscriber, {
            issuer: {
                ...ISSUER,
                legalName: 'Predecessor GmbH',
                vatId: 'DE111111111',
                taxNumber: null,
                addressLine2: null,
            },
        });
        installation.charge(contract, 'plan');

        await installation.run();

        assert.equal(installation.store.invoices[0].issuer.legalName, 'Predecessor GmbH');
    });
});

// @requirement SC-PRIC-045 — Invoice dates and tax periods count in the installation's time zone
// @requirement SC-PRIC-046 — An invoice states the day it is due
// @requirement SC-PRIC-072 — Invoice numbers run without gaps in one range per issuer, restarting each year
describe('the days and the number of an invoice', () => {
    test('are counted in the installation’s zone: issued at 00:30 on 1 January in Berlin it is the new year’s first', async () => {
        const { run, store } = await aChargedSubscriber();

        await run(new Date('2026-12-31T23:30:00.000Z'));

        assert.deepEqual(
            [store.invoices[0].number, store.invoices[0].issueDate, store.invoices[0].dueDate],
            ['AHP-2027-000001', '2027-01-01', '2027-01-15'],
        );
    });

    test('fall due the payment term the file names after the issue date', async () => {
        const { run, store } = await aChargedSubscriber({
            settings: {
                ...INVOICING_SETTINGS,
                invoicing: { numberPrefix: 'AHP', paymentTermDays: 0 },
            },
        });

        await run(new Date('2026-02-01T05:15:00.000Z'));

        assert.equal(store.invoices[0].dueDate, store.invoices[0].issueDate);
    });

    test('carry the prefix the file names', async () => {
        const { run, store } = await aChargedSubscriber({
            settings: {
                ...INVOICING_SETTINGS,
                invoicing: { numberPrefix: 'VFX', paymentTermDays: 14 },
            },
        });

        await run();

        assert.equal(store.invoices[0].number, 'VFX-2026-000001');
    });
});

// @requirement SC-PRIC-041 — An invoice computes its tax once per rate, by the rule its tax adapter names
// @requirement SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice
// @requirement SC-PRIC-038 — A contract and an invoice record the tax treatment and the adapter that decided it
describe('the tax of an invoice', () => {
    test('is the adapter’s, computed once per rate, with the treatment and the adapter recorded', async () => {
        const { run, store } = await aChargedSubscriber();

        await run();

        const [invoice] = store.invoices;
        assert.deepEqual(invoice.taxTreatment, {
            kind: 'standard',
            rate: 19,
            note: null,
            adapter: { name: 'test-tax', version: '3.0.0' },
        });
        assert.deepEqual(invoice.taxes, [{ rate: 19, net: 44.1, tax: 8.38 }]);
        assert.deepEqual(
            [invoice.totalNet, invoice.totalTax, invoice.totalGross],
            [44.1, 8.38, 52.48],
        );
        assert.deepEqual(
            invoice.lines.map((l) => l.taxRate),
            [19, 19],
        );
    });

    test('is decided anew for the subscriber as it stands when the invoice is issued', async () => {
        const { run, store, subscribers, subscriber } = await aChargedSubscriber(
            {},
            { business: true },
        );
        await subscribers.changeContact(subscriber.id, { country: 'CH' }, 'operator:test');

        await run();

        assert.deepEqual(
            [store.invoices[0].taxTreatment.kind, store.invoices[0].totalTax],
            ['not-taxable', 0],
        );
    });
});

/** A start that recorded the issuer moving from `before` to `after`, declared a correction of it. */
function recordedCorrection(noticedOn, before, after, reason) {
    return {
        id: `change-${noticedOn}`,
        noticedAt: new Date(`${noticedOn}T00:00:00.000Z`),
        source: 'config/saas.yaml',
        previous: { issuer: before },
        current: { issuer: { ...after, correctionOf: { legalName: before.legalName, reason } } },
        acknowledgedAt: null,
        acknowledgedBy: null,
    };
}

/**
 * The issuer an invoice names under a file naming `issuer`, for a contract
 * concluded while the file named `ISSUER`, with `changes` recorded since.
 */
async function invoicedUnder(issuer, changes) {
    const appliedSettings = new FakeAppliedSettingsPort();
    appliedSettings.changes = changes;
    const installation = anInvoicingInstallation({
        settings: { ...INVOICING_SETTINGS, issuer },
        appliedSettings,
    });
    const subscriber = await installation.aSubscriber('t1');
    const contract = await installation.aContract(subscriber, {
        issuer: contractPartiesOf(subscriber, ISSUER).issuer,
    });
    installation.charge(contract, 'plan');
    await installation.run();
    return installation.store.invoices[0].issuer;
}

/** The audit entries the run wrote for holds, as code and params. */
const holdsIn = (audits) =>
    audits
        .filter((entry) => entry.action === 'SUBSCRIPTION_INVOICE_HELD')
        .map((entry) => [entry.changes.code, entry.changes.params]);

// @requirement SC-PRIC-032 — No contract is frozen and no invoice issued before the subscriber's identity is complete
// @requirement SC-PRIC-027 — An invoice carries what the tax law of its issuer requires of it
describe('an invoice that cannot be issued yet', () => {
    test('waits for the subscriber’s address, draws no number, and takes the next one once it is complete', async () => {
        const installation = await aChargedSubscriber({}, { postalCode: null });

        assert.deepEqual(await installation.run(), { issued: 0, held: 1, failed: 0 });
        assert.deepEqual(holdsIn(installation.audits), [
            [SUBSCRIBER_ERROR_CODES.SUBSCRIBER_IDENTITY_INCOMPLETE, { missing: ['postalCode'] }],
        ]);

        await installation.subscribers.changeContact(
            installation.subscriber.id,
            { postalCode: '10115' },
            'tenant:test',
        );
        assert.deepEqual(await installation.run(), { issued: 1, held: 0, failed: 0 });
        assert.equal(installation.store.invoices[0].number, 'AHP-2026-000001');
    });

    test('is recorded in the audit log once, however many runs find it waiting', async () => {
        const installation = await aChargedSubscriber({}, { city: null });

        await installation.run();
        await installation.run();
        await installation.run();

        assert.equal(holdsIn(installation.audits).length, 1);
        const [entry] = installation.audits;
        assert.equal(entry.entity, 'SubscriptionContract');
        assert.equal(entry.entityId, installation.contract.id);
        assert.deepEqual(entry.actor, {
            userId: null,
            email: 'platform',
            source: 'job',
            context: 'subscription-invoices',
        });
    });

    test('waits where the adapter supports no treatment for the subscriber', async () => {
        const installation = await aChargedSubscriber({}, { country: 'FR', business: false });

        assert.deepEqual(await installation.run(), { issued: 0, held: 1, failed: 0 });
        assert.deepEqual(holdsIn(installation.audits), [
            [
                TAX_ERROR_CODES.TAX_TREATMENT_NOT_SUPPORTED,
                { adapter: 'test-tax', reason: 'A consumer outside Germany is not supported.' },
            ],
        ]);
    });

    test('waits for what the adapter finds missing, and draws no number', async () => {
        const installation = await aChargedSubscriber({
            adapter: invoicingAdapter({ gaps: () => ['issuer.taxIdentifier'] }),
        });

        assert.deepEqual(await installation.run(), { issued: 0, held: 1, failed: 0 });
        assert.deepEqual(holdsIn(installation.audits), [
            [
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CONTENT_INCOMPLETE,
                { adapter: 'test-tax', missing: ['issuer.taxIdentifier'] },
            ],
        ]);
        assert.equal(installation.store.invoices.length, 0);
    });

    test('is shown to the adapter as it would be issued', async () => {
        const seen = [];
        const { run } = await aChargedSubscriber({
            adapter: invoicingAdapter({ gaps: (draft) => (seen.push(draft), []) }),
        });

        await run();

        assert.equal(seen.length, 1);
        assert.deepEqual(
            [seen[0].issueDate, seen[0].dueDate, seen[0].servicePeriod, seen[0].lines.length],
            ['2026-02-01', '2026-02-15', { from: '2026-02-01', until: '2026-02-28' }, 2],
        );
    });

    for (const [what, contractOptions] of [
        ['whose parties a migration copied', { partiesMigrated: true }],
        ['that names no issuer', { issuer: null }],
    ]) {
        test(`waits under a contract ${what}`, async () => {
            const installation = anInvoicingInstallation();
            const contract = await installation.aContract(
                await installation.aSubscriber('t1'),
                contractOptions,
            );
            installation.charge(contract, 'plan');

            assert.deepEqual(await installation.run(), { issued: 0, held: 1, failed: 0 });
            assert.deepEqual(holdsIn(installation.audits), [
                [
                    INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_PARTIES_UNCONFIRMED,
                    { contractId: contract.id },
                ],
            ]);
        });
    }

    test('keeps no other subscription waiting, however many wait before it', async () => {
        const installation = anInvoicingInstallation();
        const waiting = await installation.aContract(await installation.aSubscriber('waiting'), {
            partiesMigrated: true,
        });
        for (let index = 0; index < 120; index += 1) {
            installation.charge(waiting, 'plan', {
                subscriptionId: `sub-a-${String(index).padStart(3, '0')}`,
            });
        }
        const ready = await installation.aContract(await installation.aSubscriber('ready'));
        installation.charge(ready, 'plan', { subscriptionId: 'sub-z' });

        assert.deepEqual(await installation.run(), { issued: 1, held: 120, failed: 0 });
        assert.equal(installation.store.invoices[0].subscriptionId, 'sub-z');
    });
});

describe('the quarter-hourly run', () => {
    test('issues what the journal is owed', async () => {
        const { service, store } = await aChargedSubscriber();

        await new SubscriptionInvoiceCron(service).issueDueInvoices();

        assert.equal(store.invoices.length, 1);
    });

    test('is skipped while the application is locked for maintenance, and the next one catches up', async () => {
        const { service, store } = await aChargedSubscriber();
        let locked = true;
        const cron = new SubscriptionInvoiceCron(service, { isLocked: async () => locked });

        await cron.issueDueInvoices();
        assert.equal(store.invoices.length, 0);

        locked = false;
        await cron.issueDueInvoices();
        assert.equal(store.invoices.length, 1);
    });

    test('lets a run due while one is still issuing pass', async () => {
        let calls = 0;
        const pending = [];
        const slow = {
            issueDue: () => {
                calls += 1;
                return new Promise((resolve) =>
                    pending.push(() => resolve({ issued: 0, held: 0, failed: 0 })),
                );
            },
        };
        /** Lets the runs started so far finish, once each has reached the service. */
        const release = async () => {
            await new Promise(setImmediate);
            for (const finish of pending.splice(0)) finish();
        };
        const cron = new SubscriptionInvoiceCron(slow);

        const first = cron.issueDueInvoices();
        const second = cron.issueDueInvoices();
        await release();
        await Promise.all([first, second]);
        assert.equal(calls, 1, 'the run due while the first one was issuing passed');

        const next = cron.issueDueInvoices();
        await release();
        await next;
        assert.equal(calls, 2, 'the run after it issued again');
    });

    test('that fails says so and leaves the next one to try again', async () => {
        let calls = 0;
        const failing = {
            issueDue: async () => {
                calls += 1;
                throw new Error('database unreachable');
            },
        };
        const cron = new SubscriptionInvoiceCron(failing);

        await cron.issueDueInvoices();
        await cron.issueDueInvoices();

        assert.equal(calls, 2);
    });
});
