// What the operator reads of a tenant's deletion (`SC-ADM-058`): where it
// stands, decided as the run decides it, and the record kept of it with the
// subscriber — read on the tenant's page and on the subscriber's record, the
// latter also once the application has no tenant any more. The record names
// roles and numbers, never a person (`SC-PRIV-023`), also while the rows it is
// read from still name them.
//
// The reading runs over the in-memory ports the platform ships for tests, and
// the deletions it reads are made by the run itself.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { deletionReminderSubjectOf } from '@saasicat/core';

import { THIS_INSTALLATION } from './helpers/installation-mark.js';
import {
    DAY,
    DELETES_ON,
    ENDED_AT,
    aReaderOf,
    contracted,
    ended,
    endedAt,
    setUp,
} from './helpers/tenant-deletion.js';

/** The last second of 30 November in Berlin, before the deletion day. */
const EVE = new Date('2026-11-30T22:59:59.000Z');
/** An hour into the deletion day: after the run. */
const LATER = new Date(DAY.getTime() + 60 * 60_000);
/** Who took the export, as the audit log tags them, and their user id. */
const ANNA = 'web:anna@example.com:autohaus';
const ANNA_ID = 'user-anna-7';

/** Records a reminder of `end` for `daysBefore` at `at`, delivered to `recipients` unless null. */
async function reminded(run, end, daysBefore, at, recipients = ['anna@example.com', 'ben@x.de']) {
    const notice = await run.notices.claim(
        {
            tenantId: end.tenantId,
            subscriptionId: end.subscriptionId,
            kind: 'deletion-reminder',
            subject: deletionReminderSubjectOf({ subscriptionEndId: end.id, daysBefore }),
        },
        { kind: 'deletion-reminder' },
        at,
        new Date(0),
    );
    if (recipients) await run.notices.confirm(notice.id, at, { recipients, channel: 'email' }, at);
}

/** Records a download of `end`'s export by Anna at `at`. */
function downloaded(run, end, at, size = 48_000_000) {
    return run.ends.recordExportDownload({
        tenantId: end.tenantId,
        subscriptionId: end.subscriptionId,
        downloadedAt: at,
        downloadedBy: ANNA,
        downloadedByUserId: ANNA_ID,
        size,
    });
}

/** Fails if `view`, as JSON carries it, names a person: an address, a user id or a tag. */
function assertNamesNoPerson(view) {
    const json = JSON.stringify(view);
    for (const person of ['@', ANNA_ID, 'web:', 'anna']) {
        assert.ok(!json.includes(person), `${person} in ${json}`);
    }
}

/** Ends `t1`'s subscription, with an announcement, two reminders and one download before its day. */
async function endedWithItsTrail(run) {
    await run.ends.announce({
        tenantId: 't1',
        subscriptionId: 'subscription-t1',
        endsAt: ENDED_AT,
        readOnlyDays: 31,
        deletesOn: DELETES_ON,
        announcedAt: new Date('2026-10-20T09:00:00.000Z'),
        announcedBy: ANNA,
    });
    const end = await ended(run, 't1');
    await reminded(run, end, 30, new Date('2026-11-01T08:00:00.000Z'));
    await reminded(run, end, 7, new Date('2026-11-24T08:00:00.000Z'));
    await downloaded(run, end, new Date('2026-11-03T10:00:00.000Z'));
    return end;
}

/** A keep report answering one line for every tenant. */
const keepingReceipts = () => ({
    keep: async () => [
        { category: 'receipts', count: 412, labels: { en: 'Receipts', de: 'Belege' } },
    ],
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('a deletion not begun, on the tenant page', () => {
    test('over an unmarked database on its day is halted, naming the identifier to mark it with; marked, it is due', async () => {
        const run = await setUp({ marked: null });
        await ended(run, 't1');
        const reader = aReaderOf(run);

        assert.deepEqual(await reader.ofTenant('t1', DAY), {
            tenantId: 't1',
            status: {
                kind: 'halted',
                deletesOn: DELETES_ON,
                heldBy: [{ reason: 'installation-unmarked', expected: THIS_INSTALLATION }],
            },
            record: null,
        });

        await run.marks.markIfUnmarked({
            identifier: THIS_INSTALLATION,
            markedAt: DAY,
            markedBy: 'cli:ops',
        });
        assert.deepEqual((await reader.ofTenant('t1', DAY)).status, {
            kind: 'due',
            deletesOn: DELETES_ON,
        });
    });

    test('before its day is scheduled, with what would hold it were the day today', async () => {
        const run = await setUp({ marked: null });
        await ended(run, 't1');

        assert.deepEqual((await aReaderOf(run).ofTenant('t1', EVE)).status, {
            kind: 'scheduled',
            deletesOn: DELETES_ON,
            wouldBeHeldBy: [{ reason: 'installation-unmarked', expected: THIS_INSTALLATION }],
        });
    });

    test('is halted while a contract concluded since runs past the end, and due where the contract ended with it', async () => {
        const running = await setUp();
        await ended(running, 't1');
        await contracted(running, 't1', new Date('2026-11-10T00:00:00.000Z'));
        assert.deepEqual((await aReaderOf(running).ofTenant('t1', DAY)).status, {
            kind: 'halted',
            deletesOn: DELETES_ON,
            heldBy: [{ reason: 'contract-runs-past-end' }],
        });

        const endedWithIt = await setUp();
        await ended(endedWithIt, 't1');
        await contracted(endedWithIt, 't1', new Date('2026-01-01T00:00:00.000Z'), ENDED_AT);
        assert.equal((await aReaderOf(endedWithIt).ofTenant('t1', DAY)).status.kind, 'due');
    });

    test('is halted where the tenant has no subscriber to keep the record with', async () => {
        const nobody = { findByTenantId: async () => null, listTenantLinks: async () => [] };
        const run = await setUp({ subscribers: nobody });
        await ended(run, 't1');

        assert.deepEqual((await aReaderOf(run).ofTenant('t1', DAY)).status, {
            kind: 'halted',
            deletesOn: DELETES_ON,
            heldBy: [{ reason: 'no-subscriber' }],
        });
    });

    test('names every reason that holds it, in the order the run asks them', async () => {
        const nobody = { findByTenantId: async () => null, listTenantLinks: async () => [] };
        const run = await setUp({ marked: null, subscribers: nobody });
        await ended(run, 't1');
        await contracted(run, 't1', new Date('2026-11-10T00:00:00.000Z'));

        assert.deepEqual(
            (await aReaderOf(run).ofTenant('t1', DAY)).status.heldBy.map((held) => held.reason),
            ['installation-unmarked', 'no-subscriber', 'contract-runs-past-end'],
        );
    });

    test('is nothing to come where the reason holding the tenant was lifted, though its end stands', async () => {
        const run = await setUp();
        await ended(run, 't1');
        const [hold] = await run.holds.listOpen('t1');
        await run.holds.lift(hold.id, ENDED_AT, 'web:ops@example.com:s1');

        assert.equal(await aReaderOf(run).ofTenant('t1', DAY), null);
        assert.deepEqual(await aReaderOf(run).ofSubscriber('subscriber-t1', DAY), {
            deletions: [],
        });
    });

    test('is nothing to come for a tenant whose subscription never ended', async () => {
        const run = await setUp();
        assert.equal(await aReaderOf(run).ofTenant('t1', DAY), null);
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
// @requirement SC-PRIV-023 — A tenant's deletion leaves a record with the subscriber that names no person
// @requirement SC-PRIV-024 — A tenant is deleted only after its full export was offered in the read-only period
// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('a deletion done, on the record of its subscriber', () => {
    test('is read once the application has no tenant any more, with every store, the commercial record, the reminders and the downloads, naming no person', async () => {
        const run = await setUp({ keep: keepingReceipts() });
        await endedWithItsTrail(run);
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });

        const { deletions } = await aReaderOf(run).ofSubscriber('subscriber-t1', LATER);

        assert.equal(deletions.length, 1);
        const [{ tenantId, status, record }] = deletions;
        assert.equal(tenantId, 't1');
        assert.equal(status.kind, 'deleted');
        assert.equal(status.deletesOn, DELETES_ON);
        assert.equal(status.closedAt, record.closedAt);
        assert.equal(typeof record.closedAt, 'string');
        assert.deepEqual(
            record.stores.map(({ store, position, counts, countedAt, erasedAt }) => ({
                store,
                position,
                counts,
                counted: typeof countedAt,
                erased: typeof erasedAt,
            })),
            ['files', 'data'].map((store, position) => ({
                store,
                position,
                counts: [{ category: 'notes', count: 12 }],
                counted: 'string',
                erased: 'string',
            })),
        );
        assert.deepEqual(record.commercialAfter, record.commercialBefore);
        assert.notEqual(record.commercialBefore, null);
        assert.deepEqual(record.keep, [
            { category: 'receipts', count: 412, labels: { en: 'Receipts', de: 'Belege' } },
        ]);
        assert.equal(record.exportOfferedFrom, ENDED_AT.toISOString());
        assert.equal(record.exportBlockedBySuspension, false);
        assert.equal(record.announcedOn, '2026-10-20');
        assert.deepEqual(record.reminders, [
            {
                daysBefore: 30,
                createdAt: '2026-11-01T08:00:00.000Z',
                deliveredAt: '2026-11-01T08:00:00.000Z',
                recipientCount: 2,
                channel: 'email',
            },
            {
                daysBefore: 7,
                createdAt: '2026-11-24T08:00:00.000Z',
                deliveredAt: '2026-11-24T08:00:00.000Z',
                recipientCount: 2,
                channel: 'email',
            },
        ]);
        assert.deepEqual(record.downloads, [
            { at: '2026-11-03T10:00:00.000Z', size: 48_000_000, by: 'tenant-admin' },
        ]);
        assertNamesNoPerson(deletions);
    });

    test('names no person while the deletion is under way and the rows still name them', async () => {
        const run = await setUp({
            answers: { data: { erase: () => Promise.reject(new Error('down')) } },
        });
        await endedWithItsTrail(run);
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        const [download] = await run.ends.listExportDownloadsFor(['subscription-t1']);
        assert.equal(download.downloadedBy, ANNA);

        const fromTheRecord = await aReaderOf(run).ofSubscriber('subscriber-t1', LATER);
        const fromThePage = await aReaderOf(run).ofTenant('t1', LATER);

        assert.deepEqual(fromTheRecord.deletions, [fromThePage]);
        assert.equal(fromThePage.status.kind, 'retrying');
        assert.equal(fromThePage.record.downloads[0].by, 'tenant-admin');
        assert.equal(fromThePage.record.reminders.length, 2);
        assertNamesNoPerson(fromTheRecord);
    });

    test('counts a reminder that reached nobody as 0, and one not delivered as not delivered', async () => {
        const run = await setUp();
        const end = await ended(run, 't1');
        await reminded(run, end, 30, new Date('2026-11-01T08:00:00.000Z'), []);
        await reminded(run, end, 7, new Date('2026-11-24T08:00:00.000Z'), null);
        await run.service.deleteDue(DAY);

        const view = await aReaderOf(run).ofTenant('t1', LATER);

        assert.deepEqual(view.record.reminders, [
            {
                daysBefore: 30,
                createdAt: '2026-11-01T08:00:00.000Z',
                deliveredAt: '2026-11-01T08:00:00.000Z',
                recipientCount: 0,
                channel: 'email',
            },
            {
                daysBefore: 7,
                createdAt: '2026-11-24T08:00:00.000Z',
                deliveredAt: null,
                recipientCount: null,
                channel: null,
            },
        ]);
    });

    test('says on both pages that a suspension kept the export from being taken between the end and the deletion', async () => {
        const run = await setUp();
        await ended(run, 't1');
        const hold = await run.holds.record({
            tenantId: 't1',
            kind: 'suspended',
            reference: null,
            note: null,
            since: new Date('2026-11-05T00:00:00.000Z'),
            recordedBy: 'web:ops@example.com:s1',
        });
        await run.holds.lift(
            hold.id,
            new Date('2026-11-06T00:00:00.000Z'),
            'web:ops@example.com:s1',
        );
        await run.service.deleteDue(DAY);

        const reader = aReaderOf(run);
        assert.equal((await reader.ofTenant('t1', LATER)).record.exportBlockedBySuspension, true);
        const { deletions } = await reader.ofSubscriber('subscriber-t1', LATER);
        assert.equal(deletions[0].record.exportBlockedBySuspension, true);
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('a deletion begun and stopped', () => {
    test('by a store that took the commercial record along is halted, naming the store and what fell', async () => {
        const run = await setUp();
        await ended(run, 't1');
        let counted = 0;
        run.records.commercialRecord = () => {
            counted += 1;
            return {
                subscriber: 1,
                contracts: 1,
                charges: 4,
                invoices: counted === 1 ? 3 : 2,
                payments: 2,
                credits: 0,
            };
        };
        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 1, failed: 0 });

        const view = await aReaderOf(run).ofTenant('t1', LATER);

        assert.deepEqual(view.status, {
            kind: 'halted',
            deletesOn: DELETES_ON,
            heldBy: [{ reason: 'commercial-record-lost', store: 'files', lost: ['invoices'] }],
        });
        assert.equal(view.record.commercialBefore.invoices, 3);
        assert.equal(view.record.commercialAfter.invoices, 2);
    });

    test('by stores listed otherwise than when it began is retried, with the code', async () => {
        const first = await setUp({
            answers: { data: { erase: () => Promise.reject(new Error('down')) } },
        });
        await ended(first, 't1');
        await first.service.deleteDue(DAY);
        const later = await setUp({ names: ['data'], shared: first.ports });
        await later.service.deleteDue(DAY);

        const { status } = await aReaderOf(later, first.subscribers).ofTenant('t1', LATER);

        assert.equal(status.kind, 'retrying');
        assert.equal(status.attempts, 2);
        assert.equal(status.lastFailure.code, 'stores-changed');
        assert.equal(typeof status.lastFailure.at, 'string');
        assert.equal(typeof status.startedAt, 'string');
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('the record of a subscriber', () => {
    test("shows its own tenants' deletions and not another subscriber's", async () => {
        const run = await setUp();
        await ended(run, 't1');
        await run.service.deleteDue(DAY);
        await endedAt(run, 't2', {
            subscriptionId: 'subscription-t2',
            endsAt: ENDED_AT,
            deletesOn: '2026-12-20',
        });

        const reader = aReaderOf(run);
        const ofT1 = await reader.ofSubscriber('subscriber-t1', LATER);
        const ofT2 = await reader.ofSubscriber('subscriber-t2', LATER);

        assert.deepEqual(
            ofT1.deletions.map(({ tenantId, status }) => [tenantId, status.kind]),
            [['t1', 'deleted']],
        );
        assert.deepEqual(ofT2.deletions, [
            {
                tenantId: 't2',
                status: { kind: 'scheduled', deletesOn: '2026-12-20', wouldBeHeldBy: [] },
                record: null,
            },
        ]);
    });

    test('shows the deletion still to come first, then the begun ones, each with its own reminders and downloads', async () => {
        // One subscriber, `s`, whose tenants t1 and t2 were deleted in turn and
        // whose tenant t3 is to be: the links as a returning customer leaves them.
        const links = new Map([
            ['t1', new Date('2026-11-01T00:00:00.000Z')],
            ['t2', new Date('2026-11-01T00:00:00.000Z')],
            ['t3', null],
        ]);
        const subscribers = {
            findById: async (subscriberId) => (subscriberId === 's' ? { id: 's' } : null),
            async findByTenantId(tenantId) {
                return links.get(tenantId) === null ? { id: 's' } : null;
            },
            async listTenantLinks(subscriberId) {
                if (subscriberId !== 's') return [];
                return [...links].map(([tenantId, unlinkedAt]) => ({
                    tenantId,
                    linkedAt: ENDED_AT,
                    unlinkedAt,
                }));
            },
            async unlinkTenant() {
                return true;
            },
        };
        const run = await setUp({ subscribers });
        const deleted = [
            { tenantId: 't1', deletesOn: '2026-11-20', told: '2026-11-13T08:00:00.000Z' },
            { tenantId: 't2', deletesOn: DELETES_ON, told: '2026-11-24T08:00:00.000Z' },
        ];
        for (const { tenantId, deletesOn, told } of deleted) {
            links.set(tenantId, null);
            const end = await ended(run, tenantId, deletesOn);
            await downloaded(run, end, new Date(told));
            await reminded(run, end, 7, new Date(told));
            await run.service.deleteDue(new Date(`${deletesOn}T12:00:00.000Z`));
            links.set(tenantId, DAY);
        }
        await ended(run, 't3', '2026-12-20');

        const { deletions } = await aReaderOf(run, subscribers).ofSubscriber('s', LATER);

        assert.deepEqual(
            deletions.map(({ tenantId, status, record }) => [
                tenantId,
                status.kind,
                record?.downloads.map((download) => download.at) ?? null,
                record?.reminders.map((reminder) => reminder.createdAt) ?? null,
            ]),
            [
                ['t3', 'scheduled', null, null],
                ['t2', 'deleted', [deleted[1].told], [deleted[1].told]],
                ['t1', 'deleted', [deleted[0].told], [deleted[0].told]],
            ],
        );
    });
});
