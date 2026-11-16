// What the subscriber keeps for tax outlives its tenant's deletion: the
// subscriber, its contracts, its charges — one of them not invoiced yet — its
// invoices, payments and credits (`SC-PRIV-011`), with no retention setting
// that could take them (`SC-PRIV-012`). The run counts them before the first
// store erases and again after each, and stops loudly at a store that took any
// of them with it, rather than closing the deletion.
//
// The application's data store here erases the tenant's own rows — its
// subscription, its bookings and its redemptions, which go with the tenant's
// row — and the invoicing runs over the same in-memory stores afterwards.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anInvoicingInstallation, berlin } from './helpers/invoice-run.js';
import { DAY, ended, recordOf, setUp } from './helpers/tenant-deletion.js';

/** A run of the invoicing after the deletion day. */
const AFTER_THE_DAY = new Date('2026-12-01T09:00:00.000Z');

/**
 * A subscriber of tenant t1 with a contract, February invoiced and March
 * charged but not invoiced yet, a payment and a credit; and the rows the
 * tenant itself holds.
 */
async function aSubscriberWithItsRecord() {
    const installation = anInvoicingInstallation();
    const subscriber = await installation.aSubscriber('t1');
    const contract = await installation.aContract(subscriber);
    installation.charge(contract, 'plan');
    installation.charge(contract, 'discount');
    await installation.run();
    installation.charge(contract, 'plan', {
        periodStart: berlin('2026-03-01'),
        periodEnd: berlin('2026-04-01'),
    });
    const payments = [{ subscriberId: subscriber.id, amount: 52.48 }];
    const credits = [{ subscriberId: subscriber.id, amount: 5 }];
    const tenantRows = {
        subscriptions: [{ tenantId: 't1' }],
        bookings: [{ tenantId: 't1' }],
        redemptions: [{ tenantId: 't1' }],
    };
    /** The subscriber's commercial record as a store counts it. */
    const countRecord = async (subscriberId) => {
        const of = (rows) => rows.filter((row) => row.subscriberId === subscriberId).length;
        return {
            subscriber: (await installation.subscriberRepository.findById(subscriberId)) ? 1 : 0,
            contracts: (await installation.contracts.list({ subscriberId })).length,
            charges: of(installation.journal),
            invoices: of(installation.store.invoices),
            payments: of(payments),
            credits: of(credits),
        };
    };
    return { installation, subscriber, tenantRows, countRecord };
}

/**
 * The application's stores, noting each call in `calls`: `data` erases the
 * tenant's rows and whatever `alsoTakes` takes, `files` erases nothing the
 * subscriber keeps.
 */
function theStores(calls, { tenantRows }, names, alsoTakes = () => {}) {
    const stores = {
        data: {
            name: 'data',
            async count() {
                calls.push('data.count');
                return [{ category: 'subscriptions', count: tenantRows.subscriptions.length }];
            },
            async erase() {
                calls.push('data.erase');
                for (const rows of Object.values(tenantRows)) rows.length = 0;
                alsoTakes();
            },
        },
        files: {
            name: 'files',
            async count() {
                calls.push('files.count');
                return [{ category: 'files', count: 3 }];
            },
            async erase() {
                calls.push('files.erase');
            },
        },
    };
    return names.map((name) => stores[name]);
}

/** The deletion run over `world`'s subscribers and commercial record, writing to `audit`. */
async function aRunOver(world, erasers, audit = []) {
    const run = await setUp({
        erasers,
        subscribers: world.installation.subscriberRepository,
        audit: { log: async (entry) => audit.push(entry) },
    });
    run.records.commercialRecord = world.countRecord;
    await ended(run, 't1');
    return run;
}

// @requirement SC-PRIV-011 — Contracts, invoices and payments outlive the tenant they were for
// @requirement SC-PRIV-012 — A record kept for tax purposes is not deleted automatically
describe("the subscriber's commercial record", () => {
    test("outlives the tenant's deletion whole, and the charge not yet invoiced is invoiced after it", async () => {
        const world = await aSubscriberWithItsRecord();
        const calls = [];
        const run = await aRunOver(world, theStores(calls, world, ['files', 'data']));
        const before = await world.countRecord(world.subscriber.id);
        assert.deepEqual(before, {
            subscriber: 1,
            contracts: 1,
            charges: 3,
            invoices: 1,
            payments: 1,
            credits: 1,
        });

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });

        const record = recordOf(run, 't1');
        assert.ok(record.closedAt instanceof Date);
        assert.deepEqual(record.commercialBefore, before);
        assert.deepEqual(record.commercialAfter, before);
        assert.deepEqual(world.tenantRows, { subscriptions: [], bookings: [], redemptions: [] });

        assert.deepEqual(await world.installation.run(AFTER_THE_DAY), {
            issued: 1,
            held: 0,
            failed: 0,
        });
        assert.equal(world.installation.store.invoices.length, 2);
        assert.equal(world.installation.store.invoices[1].servicePeriodFrom, '2026-03-01');
    });

    test('taken by a store stops the deletion there: the record stays open and halted, naming the store, and no later store erases', async () => {
        const world = await aSubscriberWithItsRecord();
        const calls = [];
        const audit = [];
        const takeTheInvoice = () => world.installation.store.invoices.splice(0, 1);
        const run = await aRunOver(
            world,
            theStores(calls, world, ['data', 'files'], takeTheInvoice),
            audit,
        );

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });

        assert.deepEqual(calls, ['data.count', 'files.count', 'data.erase']);
        const record = recordOf(run, 't1');
        assert.equal(record.closedAt, null);
        assert.equal(record.halt, 'commercial-record-lost');
        assert.deepEqual(
            { ...record.lastFailure, at: undefined },
            { step: 'guard', store: 'data', code: 'commercial-record-lost', at: undefined },
        );
        assert.equal(record.claimedAt, null, 'the claim is let go');
        assert.equal(record.commercialBefore.invoices, 1);
        assert.equal(record.commercialAfter.invoices, 0);
        assert.equal(run.said.error.length, 1, run.said.error.join('\n'));
        assert.match(run.said.error[0], /\bdata\b/);
        assert.match(run.said.error[0], /\binvoices\b/);
        assert.deepEqual(
            (await run.holds.listOpen('t1')).map((hold) => hold.kind).sort(),
            ['deleting', 'ended'],
            'the tenant is still held to reading by its end',
        );
        const halted = audit.filter((entry) => entry.action === 'TENANT_DELETION_HALTED');
        assert.equal(halted.length, 1);
        assert.equal(halted[0].tenantId, 't1');
        assert.deepEqual(halted[0].changes.lost, ['invoices']);

        calls.length = 0;
        assert.deepEqual(
            await run.service.deleteDue(DAY),
            { deleted: 0, halted: 0, failed: 0 },
            'a halted deletion waits for the operator',
        );
        assert.deepEqual(calls, []);
    });

    test('taken by a store whose count after it failed is laid at that store on the next run, before any later store erases', async () => {
        const world = await aSubscriberWithItsRecord();
        const calls = [];
        const takeTheInvoice = () => world.installation.store.invoices.splice(0, 1);
        const run = await aRunOver(
            world,
            theStores(calls, world, ['data', 'files'], takeTheInvoice),
        );
        let counted = 0;
        run.records.commercialRecord = async (subscriberId) => {
            counted += 1;
            if (counted === 2) throw Object.assign(new Error('down'), { code: 'ECONNRESET' });
            return world.countRecord(subscriberId);
        };

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        assert.deepEqual(
            { ...recordOf(run, 't1').lastFailure, at: undefined },
            { step: 'guard', store: 'data', code: 'ECONNRESET', at: undefined },
        );

        calls.length = 0;
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });
        assert.deepEqual(calls, []);
        const record = recordOf(run, 't1');
        assert.equal(record.halt, 'commercial-record-lost');
        assert.equal(record.lastFailure.store, 'data');
    });

    test('that grew while a store erased lost nothing, and the deletion closes', async () => {
        const world = await aSubscriberWithItsRecord();
        const calls = [];
        const anotherCharge = () =>
            world.installation.journal.push({ subscriberId: world.subscriber.id });
        const run = await aRunOver(
            world,
            theStores(calls, world, ['data', 'files'], anotherCharge),
        );

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
        assert.equal(recordOf(run, 't1').commercialAfter.charges, 4);
    });
});
