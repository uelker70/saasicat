// The run that deletes a tenant on its day, over the in-memory ports the
// platform ships for tests. What a deletion writes in a transaction is kept
// here in one that takes it back where it fails, as a database does; a write
// made outside it stays.

import { InstallationMarkService, TenantDeletionService } from '../../dist/billing/index.js';
import {
    FakeInstallationMarkRepository,
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
    FakeTenantDeletionRepository,
} from '../../dist/testing/index.js';
import { THIS_INSTALLATION, aKeepReport } from './installation-mark.js';
import { noticeRecord } from './version-notices.js';

export const ZONE = { timeZone: 'Europe/Berlin' };
export const ENDED_AT = new Date('2026-10-31T12:00:00.000Z');
export const DELETES_ON = '2026-12-01';
/** The first second of 1 December in Berlin: the day `DELETES_ON` names. */
export const DAY = new Date('2026-11-30T23:00:00.000Z');
/** How the run that records ends is tagged. */
export const RUN = 'job:platform:subscription-ends';

/**
 * Keeps `rows` as they stand, to be put back where `tx` fails. The whole list
 * is put back, so a test whose transaction fails runs one instance only.
 */
function keepForUndo(tx, rows) {
    if (!tx) return;
    const before = structuredClone(rows);
    tx.undo.push(() => rows.splice(0, rows.length, ...before));
}

/** Reasons that a failed transaction takes back where they were written in it. */
class TransactionalHolds extends FakeTenantAccessHoldRepository {
    async record(hold, tx) {
        keepForUndo(tx, this.holds);
        return super.record(hold);
    }

    async lift(id, liftedAt, liftedBy, tx) {
        keepForUndo(tx, this.holds);
        return super.lift(id, liftedAt, liftedBy);
    }

    async replaceActors(replacements, tx) {
        keepForUndo(tx, this.holds);
        return super.replaceActors(replacements);
    }
}

/** Ends that a failed transaction takes back where their actors were replaced in it. */
class TransactionalEnds extends FakeSubscriptionEndRepository {
    async replaceActors(replacements, tx) {
        keepForUndo(tx, this.ends);
        keepForUndo(tx, this.announcements);
        keepForUndo(tx, this.downloads);
        return super.replaceActors(replacements);
    }
}

/** Deletions that a failed transaction takes back where they were begun or closed in it. */
class TransactionalDeletions extends FakeTenantDeletionRepository {
    async begin(record, tx) {
        keepForUndo(tx, this.deletions);
        return super.begin(record);
    }

    async close(id, at, tx) {
        keepForUndo(tx, this.deletions);
        return super.close(id, at);
    }
}

/** Notices whose recipients a failed transaction gives back where they were forgotten in it. */
function transactionalNotices() {
    const notices = noticeRecord();
    const forget = notices.forgetRecipients;
    notices.forgetRecipients = async (tenantId, at, tx) => {
        if (tx) {
            const before = structuredClone([...notices.rows.entries()]);
            tx.undo.push(() => {
                notices.rows.clear();
                for (const [key, row] of before) notices.rows.set(key, row);
            });
        }
        return forget(tenantId, at, tx);
    };
    return notices;
}

/** A runner whose transaction takes back what was written in it where it fails; `failNext` fails one. */
function aTransactionRunner() {
    const runner = {
        failNext: false,
        async run(work) {
            const tx = { undo: [] };
            try {
                const result = await work(tx);
                if (runner.failNext) {
                    runner.failNext = false;
                    throw new Error('the transaction failed');
                }
                return result;
            } catch (error) {
                for (const undo of tx.undo.reverse()) undo();
                throw error;
            }
        },
    };
    return runner;
}

/**
 * Stores named `names` that note each call in `calls`. Each counts 12 notes
 * until it erased, and nothing after; `answers` replaces a store's `count` or
 * `erase` with its own.
 */
export function storesNoting(calls, names, answers = {}) {
    return names.map((name) => {
        let erased = false;
        return {
            name,
            async count(tenantId) {
                calls.push(`${name}.count:${tenantId}`);
                if (answers[name]?.count) return answers[name].count();
                return erased ? [] : [{ category: 'notes', count: 12 }];
            },
            async erase(tenantId) {
                calls.push(`${name}.erase:${tenantId}`);
                erased = true;
                if (answers[name]?.erase) await answers[name].erase();
            },
        };
    });
}

/** A logger that keeps what it is told, by level. */
export function aQuietLogger() {
    const said = { log: [], warn: [], error: [] };
    return {
        said,
        log: (message) => said.log.push(message),
        warn: (message) => said.warn.push(message),
        error: (message) => said.error.push(message),
    };
}

/** In-memory ports for one database, marked as no installation yet. */
export function aDatabase() {
    return {
        holds: new TransactionalHolds(),
        ends: new TransactionalEnds(),
        records: new TransactionalDeletions(),
        notices: transactionalNotices(),
        marks: new FakeInstallationMarkRepository(),
        transactions: aTransactionRunner(),
    };
}

/**
 * The run over in-memory ports, the database marked as this installation's
 * unless `marked` says otherwise, every tenant with a subscriber unless
 * `subscribers` says otherwise. `shared` hands it another run's ports, as a
 * second instance over the same database; `audit` is the audit log it writes
 * to, none unless given.
 */
export async function setUp({
    erasers,
    names = ['files', 'data'],
    answers,
    marked = THIS_INSTALLATION,
    keep = aKeepReport(),
    subscribers = { findByTenantId: async (tenantId) => ({ id: `subscriber-${tenantId}` }) },
    audit = null,
    shared,
} = {}) {
    const calls = [];
    const ports = shared ?? aDatabase();
    if (!shared && marked) {
        await ports.marks.markIfUnmarked({
            identifier: marked,
            markedAt: ENDED_AT,
            markedBy: 'cli:ops',
        });
    }
    const service = new TenantDeletionService(
        erasers ?? storesNoting(calls, names, answers),
        keep,
        ports.records,
        subscribers,
        ports.transactions,
        ports.ends,
        ports.notices,
        new InstallationMarkService(ports.marks, THIS_INSTALLATION, null),
        ZONE,
        ports.holds,
        null,
        audit,
    );
    const logger = aQuietLogger();
    service.logger = logger;
    service.onModuleInit();
    return { ...ports, ports, service, calls, said: logger.said };
}

/** Ends the subscription of `tenantId` with its deletion day, holding the tenant to reading. */
export async function ended(run, tenantId, deletesOn = DELETES_ON, recordedBy = RUN) {
    const subscriptionId = `subscription-${tenantId}`;
    await run.holds.record({
        tenantId,
        kind: 'ended',
        reference: subscriptionId,
        note: null,
        since: ENDED_AT,
        recordedBy: RUN,
    });
    return run.ends.record({
        tenantId,
        subscriptionId,
        endsAt: ENDED_AT,
        deletesOn,
        recordedAt: ENDED_AT,
        recordedBy,
    });
}

/** The deletion record of `tenantId`, as the store keeps it. */
export const recordOf = (run, tenantId) =>
    run.records.deletions.find((deletion) => deletion.tenantId === tenantId);
