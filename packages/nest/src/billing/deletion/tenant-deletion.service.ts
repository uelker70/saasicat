// The deletion of a tenant on the day its end names (`SC-PRIV-022`).
//
// A tenant whose subscription ended stays readable until its deletion day.
// From that day, in the installation's zone, the run has the application erase
// the tenant's data and files through its erasers, one per store and in the
// order the application lists them, and keeps the record of it with the
// subscriber (`SC-PRIV-023`).
//
// Nothing is deleted anywhere but in the installation the database is marked
// as (`SC-PRIV-021`): the brake is asked once a run before anything begins —
// beginning holds the tenant back for good, so an unmarked database, whose due
// tenants are the operator's preview, must not reach it — and again before each
// store, so a mark changed while a deletion is under way stops it before the
// next store.
//
// Nor does a deletion begin while a contract of the tenant runs after the end
// that made it due: one concluded since, as a checkout offer may be for a
// tenant whose contract has ended (`SC-MKT-028`), keeps the tenant
// (`SC-PRIV-026`). The run holds it and writes nothing.
//
// A deletion begins in one transaction: its record and the `deleting` reason,
// which stops everybody of the tenant, the operator acting as it included, from
// then on. Every store counts what it holds before the first one erases, and
// those counts stand: a store counted again after it erased would count
// nothing. After every store that erases, the run counts the subscriber's
// commercial record again (`SC-PRIV-011`): a store that took any of it along
// stops the deletion there, halted until the operator acts, rather than
// closing it. A deletion outlives a run — a store may take hours, a run may stop
// — so a run claims the record before it works on it, renews the claim before
// each store, and lets it go when it stops; the next run goes on after the
// last store that confirmed, and a store asked again answers what is already
// gone as done (`SC-PRIV-018`). A call that runs past its time is left
// unanswered with its claim held until the claim goes stale, so no second run
// erases beside a call that may still be erasing.
//
// What a failure leaves in the record is a code, never the application's
// message: the record outlives the tenant, and a message may name anybody.
// For the same reason, the transaction that closes a deletion has the rows
// the platform keeps of the tenant name roles instead of persons, and its
// reasons keep no note (`SC-PRIV-023`). The same transaction lifts every
// reason still open but the deletion's own (`SC-PRIV-025`): nothing holds back
// a tenant that is gone, and what its subscriber owes stays in the ledger. It
// also ends the subscriber's link to the tenant (`SC-PRIV-027`), so the
// subscriber has no live tenant from then on, and a returning customer's new
// one can be joined into it (`SC-ADM-027`).
//
// What holds a deletion before it begins is decided by the functions the
// operator's pages read it through (`deletionHeldBy`), and said in the server
// log when it first holds, when it changes, and otherwise once a day
// (`DeletionLogThrottle`).
//
// Platform-wide: the reasons, the ends and the records are read across
// tenants, and the erasers run, inside `RlsBypassPort`.

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
    commercialRecordLost,
    dayInZone,
    deletionDayHasCome,
    deletionGoesOn,
    deletionHeldBy,
    deletionHeldByTheMark,
    installationZoneOf,
    tenantCountsProblem,
    tenantIdProblem,
    type CalendarDay,
    type CommercialRecordCounts,
    type DeletionActorRole,
    type InstallationMarkVerdict,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberRepository,
    type SubscriptionContractRecord,
    type SubscriptionContractRepository,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    type SubscriptionNoticeRepository,
    type TenantAccessHold,
    type TenantAccessHoldPort,
    type TenantDeletionHeldBeforeBeginning,
    type TenantDeletionMarkHalt,
    type TenantDeletionRecord,
    type TenantDeletionRecordHalt,
    type TenantDeletionRecordPort,
    type TenantDeletionStep,
    type TenantEraser,
    type TenantKeepReportPort,
    type TransactionRunner,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { TimeoutError, withTimeout } from '../../core/with-timeout.js';
import { actorTagOf } from '../../core/web-audit.js';
import { contractRunningPast } from '../../subscription-contract/contract-runs-from.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { referencesOf } from '../../tenant-access/hold-references.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from '../../tenant-access/tenant-access.tokens.js';
import { decidingEnds, type DecidingEnd } from '../deciding-end.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    SUBSCRIPTION_END_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    TENANT_DELETION_RECORD_PORT_TOKEN,
    TENANT_DELETION_SUBSCRIBERS_TOKEN,
    TENANT_DELETION_TRANSACTION_RUNNER_TOKEN,
    TENANT_ERASERS_TOKEN,
    TENANT_KEEP_REPORT_PORT_TOKEN,
} from '../tenant-billing.tokens.js';
import { DeletionLogThrottle } from './deletion-log-throttle.js';
import { rolesInsteadOfPersons } from './forget-persons.js';
import { InstallationMarkService } from './installation-mark.service.js';
import { whatATenantKeeps } from './keep-report.js';
import {
    erasersRefused,
    keepReportNotWired,
    tenantErasersProblem,
} from './tenant-deletion-option.js';

/**
 * How long a run's claim on a deletion holds. Renewed before each store, so it
 * only has to outlast one call, which `DELETION_STEP_TIMEOUT_MS` bounds.
 */
export const DELETION_CLAIM_LEASE_MS = 6 * 60 * 60_000;

/**
 * How long one `count`, `erase` or `keep` may take before the run stops
 * waiting for it — a large file store included. Shorter than the claim, so a
 * call left unanswered is not taken over while it may still be erasing.
 */
export const DELETION_STEP_TIMEOUT_MS = 5 * 60 * 60_000;

/** Who begins and closes deletions, as the audit log tags a run. */
const TENANT_DELETION_RUN = actorTagOf(platformJobActor('tenant-deletions'));

/** Who lifts the reasons still open when a deletion closes, in rows that outlive the tenant. */
const RUN_ROLE: DeletionActorRole = 'run';

/** What the audit log names a deletion under. */
const AUDITED_ENTITY = 'TenantDeletion';

/** The longest code a failure keeps. */
const FAILURE_CODE_MAX_LENGTH = 64;

/** What a line about a held deletion ends with, so that its reader knows why it does not repeat. */
const SAID_AGAIN = 'This is said again when it changes, and otherwise once a day.';

/** What one run came to. */
export interface TenantDeletionRun {
    /** Deletions closed in this run. */
    deleted: number;
    /**
     * Due, but held: the installation's mark does not let them go on, nothing
     * names one tenant or its subscriber, a contract of the tenant runs after
     * its end, or a store took the subscriber's commercial record along.
     */
    halted: number;
    /** Begun or continued and stopped by a failure; the next run goes on. */
    failed: number;
}

/** A deletion due: the end that decides its day and the reason that names it, its record once begun. */
interface DueDeletion extends DecidingEnd {
    readonly record: TenantDeletionRecord | null;
}

/** What one run decides by: its moment, the installation's day at it, and the mark it found. */
interface DeletionRound {
    readonly now: Date;
    readonly today: CalendarDay;
    readonly verdict: InstallationMarkVerdict;
}

/** What one tenant's deletion came to in a run; null where this run did nothing to it. */
type DeletionOutcome = 'deleted' | 'halted' | 'failed' | null;

/** The claim a run holds on a record, moved forward each time it is renewed. */
interface HeldClaim {
    readonly id: string;
    claimedAt: Date;
}

/** A step that failed, as the record keeps it. */
class DeletionStepFailed extends Error {
    constructor(
        readonly step: TenantDeletionStep,
        readonly store: string | null,
        readonly code: string,
        /** Whether the call may still be running: its claim is held until it goes stale. */
        readonly unanswered: boolean,
        readonly reason: unknown,
    ) {
        super(`The ${step} step of a tenant's deletion failed with ${code}.`);
        this.name = 'DeletionStepFailed';
    }
}

/** The installation's mark stopped a deletion under way before its next store. */
class HeldByTheMark extends Error {
    constructor(readonly halt: TenantDeletionMarkHalt) {
        super('The installation mark holds the deletion.');
        this.name = 'HeldByTheMark';
    }
}

/** A store took part of the subscriber's commercial record along with the tenant. */
class CommercialRecordTaken extends Error {
    constructor(
        /** The store that erased last before the record was found short. */
        readonly store: string | null,
        readonly lost: readonly (keyof CommercialRecordCounts)[],
        readonly before: CommercialRecordCounts,
        readonly after: CommercialRecordCounts,
    ) {
        super(`The store ${store ?? '(none)'} took the subscriber's ${lost.join(', ')} along.`);
        this.name = 'CommercialRecordTaken';
    }
}

/** Another run took the deletion on after this run's claim went stale. */
class ClaimLost extends Error {
    constructor() {
        super('The claim on the deletion went stale and another run took it on.');
        this.name = 'ClaimLost';
    }
}

@Injectable()
export class TenantDeletionService implements OnModuleInit {
    private readonly logger = new Logger('SaaSiCat.TenantDeletion');
    private readonly heldSaid = new DeletionLogThrottle();

    constructor(
        @Inject(TENANT_ERASERS_TOKEN) private readonly erasers: readonly TenantEraser[],
        @Inject(TENANT_KEEP_REPORT_PORT_TOKEN) private readonly keep: TenantKeepReportPort,
        @Inject(TENANT_DELETION_RECORD_PORT_TOKEN)
        private readonly records: TenantDeletionRecordPort,
        @Inject(TENANT_DELETION_SUBSCRIBERS_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(TENANT_DELETION_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner,
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) private readonly ends: SubscriptionEndPort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(InstallationMarkService) private readonly marks: InstallationMarkService,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'>,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing keeps the reasons then, so no end holds its
        // tenant and nothing is found due.
        @Optional()
        @Inject(TENANT_ACCESS_HOLDS_TOKEN)
        private readonly holds: TenantAccessHoldPort | null = null,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
        // Absent where the installation keeps no contracts: `SaaSiCatModule`
        // passes tenant billing the store of whichever module writes them.
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: Pick<SubscriptionContractRepository, 'list'> | null = null,
    ) {}

    /**
     * Refuses erasers a tenant cannot be deleted through, once a factory has
     * built them, and a report of what a tenant keeps that cannot be asked.
     */
    onModuleInit(): void {
        const problem = tenantErasersProblem(this.erasers);
        if (problem) {
            throw new Error(erasersRefused('`subscriptionEnds.deletion.erasers`', problem));
        }
        if (!reportsWhatIsKept(this.keep)) {
            throw new Error(keepReportNotWired('`subscriptionEnds.deletion.keep`'));
        }
        if (!this.holds) {
            this.logger.warn(
                'Nothing keeps the reasons a tenant is held back, so no end holds its tenant and ' +
                    'no tenant is ever reminded of its deletion or found due for it; ' +
                    'SaaSiCatModule provides them.',
            );
        }
    }

    /**
     * Deletes every tenant due at `now`, one at a time: those whose end names
     * a deletion day no later than the installation's day at `now`, and those
     * whose deletion began and has not closed.
     */
    async deleteDue(now: Date): Promise<TenantDeletionRun> {
        const holds = this.holds;
        const run: TenantDeletionRun = { deleted: 0, halted: 0, failed: 0 };
        if (!holds) return run;
        return readAcrossTenants(this.rlsBypass, async () => {
            const today = dayInZone(now, installationZoneOf(this.settings));
            const due = await this.dueAt(holds, today);
            if (due.length === 0) return run;
            const verdict = await this.marks.verdict();
            const mark = deletionHeldByTheMark(verdict);
            if (mark) {
                const said = `${JSON.stringify(mark)} ${due.length}`;
                if (this.heldSaid.shouldSay('installation-mark', said, today)) {
                    this.logger.warn(
                        `${due.length} tenant(s) due for deletion, none deleted: ` +
                            `${whyTheMarkHolds(mark)} ${SAID_AGAIN}`,
                    );
                }
                return { ...run, halted: due.length };
            }
            const round: DeletionRound = { now, today, verdict };
            for (const deletion of due) {
                const outcome = await this.deleteOne(holds, deletion, round);
                if (outcome) run[outcome] += 1;
            }
            return run;
        });
    }

    /**
     * The deletions due at `now`, each tenant once: a tenant held to reading
     * by the end of its subscription, whose record is open and not halted, or
     * which has none and whose deletion day has come. A reason lifted is no
     * end any more, so its tenant is not due, whatever the end says. Where
     * several ends hold a tenant, the one that ended last decides
     * (`decidingEnds`).
     */
    private async dueAt(holds: TenantAccessHoldPort, today: CalendarDay): Promise<DueDeletion[]> {
        const tenantIds = await holds.listTenantIdsHeldBy(['ended']);
        if (tenantIds.length === 0) return [];
        const open = await holds.listOpenFor(tenantIds);
        const deciding = decidingEnds(open, await this.ends.listFor(referencesOf(open, 'ended')));
        const records = new Map(
            (await this.records.findForTenants(tenantIds)).map((record) => [
                record.tenantId,
                record,
            ]),
        );
        const due: DueDeletion[] = [];
        for (const [tenantId, { end, ended }] of deciding) {
            const record = records.get(tenantId) ?? null;
            if (record && !deletionGoesOn(record)) continue;
            if (!record && !deletionDayHasCome(end, today)) continue;
            due.push({ end, ended, record });
        }
        return due;
    }

    /** Begins the deletion of one tenant where it has not begun, and carries it on. */
    private async deleteOne(
        holds: TenantAccessHoldPort,
        due: DueDeletion,
        round: DeletionRound,
    ): Promise<DeletionOutcome> {
        const tenantId = due.end.tenantId;
        const problem = tenantIdProblem(tenantId);
        if (problem !== null) {
            if (this.heldSaid.shouldSay(`end:${due.end.id}`, problem, round.today)) {
                this.logger.error(
                    `The end ${due.end.id} names no single tenant (${problem}); nothing is erased ` +
                        `for it until it does (SC-PRIV-016). ${SAID_AGAIN}`,
                );
            }
            return 'halted';
        }
        let record = due.record;
        if (!record) {
            let begun: TenantDeletionRecord | 'held' | null;
            try {
                begun = await this.begin(holds, due, round);
            } catch (error) {
                this.logger.error(
                    `The deletion of tenant ${tenantId} could not begin (${failureCodeOf(error)}); ` +
                        'the next run tries again.',
                    error instanceof Error ? error.stack : String(error),
                );
                return 'failed';
            }
            if (begun === 'held') return 'halted';
            if (!begun) return null;
            record = begun;
            await this.record(record, 'TENANT_DELETION_BEGUN');
        }
        return this.carryOn(holds, record);
    }

    /**
     * Records the deletion and holds the tenant back, in one transaction,
     * where the reason holding it to reading still stands; null where it does
     * not, or another run began the deletion first. Held, with nothing
     * written and the application not asked what the tenant keeps, where the
     * tenant has no subscriber or a contract of it runs after its end.
     */
    private async begin(
        holds: TenantAccessHoldPort,
        { end, ended }: DueDeletion,
        round: DeletionRound,
    ): Promise<TenantDeletionRecord | 'held' | null> {
        const { now } = round;
        const subscriber = await this.subscribers.findByTenantId(end.tenantId);
        const running = await contractRunningPast(this.contracts, end);
        // A missing subscriber is among the reasons that hold; named again
        // so that the subscriber is known from here on.
        if (this.heldBeforeBeginning(end, round, subscriber !== null, running) || !subscriber) {
            return 'held';
        }
        const keep = await whatATenantKeeps(this.keep, end.tenantId, DELETION_STEP_TIMEOUT_MS);
        const exportBlockedBySuspension = suspendedBetween(
            await holds.listAllOf(end.tenantId),
            end.endsAt,
            now,
        );
        // Read again last before the transaction that begins the deletion, as
        // close to it as the store allows: the contracts are read through no
        // transaction of the deletion's, and one may have been concluded while
        // the application answered what the tenant keeps.
        if (
            this.heldBeforeBeginning(
                end,
                round,
                true,
                await contractRunningPast(this.contracts, end),
            )
        ) {
            return 'held';
        }
        return this.transactions.run(async (tx) => {
            if (!(await holds.lockOpen(ended.id, tx))) return null;
            const record = await this.records.begin(
                {
                    tenantId: end.tenantId,
                    subscriberId: subscriber.id,
                    subscriptionId: end.subscriptionId,
                    subscriptionEndId: end.id,
                    deletesOn: end.deletesOn,
                    exportOfferedFrom: end.recordedAt,
                    exportBlockedBySuspension,
                    keep,
                    startedAt: now,
                    stores: this.erasers.map((eraser, position) => ({
                        store: eraser.name,
                        position,
                    })),
                },
                tx,
            );
            if (!record) return null;
            await holds.record(
                {
                    tenantId: end.tenantId,
                    kind: 'deleting',
                    reference: end.subscriptionId,
                    note: null,
                    since: now,
                    recordedBy: TENANT_DELETION_RUN,
                },
                tx,
            );
            return record;
        });
    }

    /**
     * Whether anything holds the deletion of `end`'s tenant before it begins
     * (`deletionHeldBy`), saying every reason where something does: an error
     * where the tenant has no subscriber to keep the record with, a warning
     * otherwise.
     */
    private heldBeforeBeginning(
        end: SubscriptionEnd,
        round: DeletionRound,
        hasSubscriber: boolean,
        running: SubscriptionContractRecord | null,
    ): boolean {
        const heldBy = deletionHeldBy({
            verdict: round.verdict,
            hasSubscriber,
            contractRunsPastEnd: running !== null,
        });
        if (heldBy.length === 0) return false;
        const reasons = heldBy.map((held) => held.reason).join(' ');
        if (this.heldSaid.shouldSay(`tenant:${end.tenantId}`, reasons, round.today)) {
            const message =
                `Tenant ${end.tenantId} is due for deletion and is not deleted while ` +
                `${heldBy.map((held) => whyItHolds(held, end, running)).join(', and while ')}. ` +
                SAID_AGAIN;
            if (hasSubscriber) this.logger.warn(message);
            else this.logger.error(message);
        }
        return true;
    }

    /**
     * Claims the record and goes on from where it stands: every store counts
     * before the first erases, then each erases in turn, then it closes.
     */
    private async carryOn(
        holds: TenantAccessHoldPort,
        begun: TenantDeletionRecord,
    ): Promise<DeletionOutcome> {
        const takenAt = new Date();
        const record = await this.records.claim(
            begun.id,
            takenAt,
            new Date(takenAt.getTime() - DELETION_CLAIM_LEASE_MS),
        );
        if (!record) return null;
        const claim: HeldClaim = { id: record.id, claimedAt: record.claimedAt ?? takenAt };
        // Where the deletion stands, for a failure outside a store's own call.
        const at: { step: TenantDeletionStep; store: string | null } = {
            step: 'count',
            store: null,
        };
        try {
            const erasers = this.erasersOf(record);
            for (const eraser of erasers) {
                if (partOf(record, eraser).countedAt !== null) continue;
                at.store = eraser.name;
                await this.holdOn(claim);
                const counts = await this.ask('count', eraser, () => eraser.count(record.tenantId));
                if (tenantCountsProblem(counts) !== null) {
                    throw new DeletionStepFailed(
                        'count',
                        eraser.name,
                        'invalid-counts',
                        false,
                        null,
                    );
                }
                await this.records.recordCounts(record.id, eraser.name, counts, new Date());
            }
            at.store = null;
            let before = record.commercialBefore;
            if (before === null) {
                before = await this.records.countCommercialRecord(record.subscriberId);
                await this.records.recordCommercial(record.id, 'before', before);
            }
            // The store that erased last in an earlier run: its own check may
            // not have been made, so it is made before the next store erases,
            // and a loss is laid at the store that caused it.
            let lastErased = erasers.findLast((eraser) => partOf(record, eraser).erasedAt !== null);
            let after: CommercialRecordCounts | null = null;
            for (const eraser of erasers) {
                if (partOf(record, eraser).erasedAt !== null) continue;
                if (lastErased) {
                    Object.assign(at, { step: 'guard', store: lastErased.name });
                    await this.guard(record, lastErased.name, before);
                    lastErased = undefined;
                }
                Object.assign(at, { step: 'erase', store: eraser.name });
                await this.holdOn(claim);
                if (tenantIdProblem(record.tenantId) !== null) {
                    throw new DeletionStepFailed(
                        'erase',
                        eraser.name,
                        'tenant-id-invalid',
                        false,
                        null,
                    );
                }
                await this.ask('erase', eraser, () => eraser.erase(record.tenantId));
                await this.records.recordErased(record.id, eraser.name, new Date());
                at.step = 'guard';
                after = await this.guard(record, eraser.name, before);
            }
            // Every store erased in an earlier run, and the last one's check
            // may not have been made.
            if (after === null) {
                Object.assign(at, { step: 'guard', store: lastErased?.name ?? null });
                after = await this.guard(record, lastErased?.name ?? null, before);
            }
            Object.assign(at, { step: 'close', store: null });
            return await this.close(holds, record, after);
        } catch (error) {
            return this.stopped(record, claim, error, at);
        }
    }

    /**
     * The erasers in the order the record keeps them in. Refused where the
     * application lists other stores than the deletion began with: a store
     * added since would be left with the tenant's data, and one taken away
     * could not confirm.
     */
    private erasersOf(record: TenantDeletionRecord): TenantEraser[] {
        const byName = new Map(this.erasers.map((eraser) => [eraser.name, eraser]));
        const ordered = [...record.stores]
            .sort((a, b) => a.position - b.position)
            .flatMap((part) => byName.get(part.store) ?? []);
        if (ordered.length !== record.stores.length || ordered.length !== this.erasers.length) {
            throw new DeletionStepFailed('count', null, 'stores-changed', false, null);
        }
        return ordered;
    }

    /**
     * Renews the claim and asks the brake again, before each store: a claim
     * that went stale is another run's now, and a mark changed since the run
     * began stops the deletion before anything more is erased.
     */
    private async holdOn(claim: HeldClaim): Promise<void> {
        const now = new Date();
        if (!(await this.records.renew(claim.id, claim.claimedAt, now))) throw new ClaimLost();
        claim.claimedAt = now;
        const mark = deletionHeldByTheMark(await this.marks.verdict());
        if (mark) throw new HeldByTheMark(mark);
    }

    /** Asks a store, within the time a step may take; what it throws is a failure of this step. */
    private async ask<T>(
        step: 'count' | 'erase',
        eraser: TenantEraser,
        call: () => Promise<T>,
    ): Promise<T> {
        try {
            return await withTimeout(call, DELETION_STEP_TIMEOUT_MS);
        } catch (error) {
            const unanswered = error instanceof TimeoutError;
            throw new DeletionStepFailed(
                step,
                eraser.name,
                unanswered ? 'timeout' : failureCodeOf(error),
                unanswered,
                error,
            );
        }
    }

    /**
     * Counts the subscriber's commercial record after `store` erased, and
     * answers the count where nothing of what was counted `before` is missing.
     * A part that grew lost nothing: an invoice may be issued meanwhile.
     */
    private async guard(
        record: TenantDeletionRecord,
        store: string | null,
        before: CommercialRecordCounts,
    ): Promise<CommercialRecordCounts> {
        const after = await this.records.countCommercialRecord(record.subscriberId);
        const lost = commercialRecordLost(before, after);
        if (lost.length > 0) throw new CommercialRecordTaken(store, lost, before, after);
        return after;
    }

    /**
     * Closes the record once every store confirmed, in one transaction with
     * what the tenant's rows say of who acted — roles, not persons —, the
     * notes its reasons lose, the lifting of every reason still open but the
     * `deleting` one, which stays, since a deleted tenant never acts again,
     * and the end of its subscriber's link to it (`SC-PRIV-027`).
     *
     * The reasons are read inside the transaction, under a lock on each: the
     * operator may lift a suspension that stands until the deletion closes
     * (`SC-PRIV-025`), and a role planned from a read before the transaction
     * would write over that lift. Locked, a lift that committed first is
     * read as it left the reason, and one that comes later waits and finds
     * the reason lifted by the run. The ends, announcements and downloads
     * are read before it, unlocked: from the beginning of the deletion
     * nothing records one (`SC-PRIV-023`).
     */
    private async close(
        holds: TenantAccessHoldPort,
        record: TenantDeletionRecord,
        after: CommercialRecordCounts,
    ): Promise<DeletionOutcome> {
        await this.records.recordCommercial(record.id, 'after', after);
        const tenantId = record.tenantId;
        const rows = {
            ends: await this.ends.listEndsOfTenant(tenantId),
            announcements: await this.ends.listAnnouncedOfTenant(tenantId),
            downloads: await this.ends.listExportDownloadsOfTenant(tenantId),
        };
        const closed = await this.transactions.run(async (tx) => {
            const at = new Date();
            if (!(await this.records.close(record.id, at, tx))) return false;
            const reasons = await holds.lockAllOf(tenantId, tx);
            const roles = rolesInsteadOfPersons({ ...rows, holds: reasons });
            await holds.replaceActors(roles.holds, tx);
            await holds.forgetNotes(tenantId, tx);
            await this.ends.replaceActors(roles.ends, tx);
            await this.notices.forgetRecipients(tenantId, at, tx);
            // After the roles: they were planned from the reasons while open.
            for (const reason of reasons) {
                if (reason.liftedAt === null && reason.kind !== 'deleting') {
                    await holds.lift(reason.id, at, RUN_ROLE, tx);
                }
            }
            await this.subscribers.unlinkTenant(tenantId, at, tx);
            return true;
        });
        if (!closed) return null;
        await this.record(record, 'TENANT_DELETION_CLOSED');
        return 'deleted';
    }

    /**
     * What a stop leaves: a failure is recorded as a code, and the claim let
     * go for the next run — unless a call may still be running, whose claim
     * stays until it goes stale; a mark that holds is said and kept nowhere,
     * since the next run decides it anew.
     */
    private async stopped(
        record: TenantDeletionRecord,
        claim: HeldClaim,
        error: unknown,
        at: { readonly step: TenantDeletionStep; readonly store: string | null },
    ): Promise<DeletionOutcome> {
        if (error instanceof ClaimLost) {
            this.logger.warn(
                `The claim on the deletion of tenant ${record.tenantId} went stale and another ` +
                    'run took it on; this run leaves it to that one.',
            );
            return null;
        }
        if (error instanceof HeldByTheMark) {
            this.logger.warn(
                `The deletion of tenant ${record.tenantId} stops before its next store: ` +
                    whyTheMarkHolds(error.halt),
            );
            await this.letGo(claim);
            return 'halted';
        }
        if (error instanceof CommercialRecordTaken) {
            await this.haltForTheRecord(record, error);
            await this.letGo(claim);
            return 'halted';
        }
        const failed =
            error instanceof DeletionStepFailed
                ? error
                : new DeletionStepFailed(at.step, at.store, failureCodeOf(error), false, error);
        this.logger.error(
            `The deletion of tenant ${record.tenantId} stopped at its ${failed.step} step` +
                `${failed.store ? ` for store ${failed.store}` : ''} (${failed.code}); the next ` +
                `run goes on${failed.unanswered ? ' once the unanswered call has had its time' : ''}.`,
            stackOf(failed.reason ?? error),
        );
        try {
            await this.records.recordFailure(
                record.id,
                { step: failed.step, store: failed.store, code: failed.code, at: new Date() },
                null,
            );
        } catch (recording) {
            this.logger.error(
                `The failure of the deletion of tenant ${record.tenantId} could not be recorded.`,
                stackOf(recording),
            );
        }
        if (!failed.unanswered) await this.letGo(claim);
        return 'failed';
    }

    /**
     * Halts the deletion until the operator acts: a store took part of the
     * subscriber's commercial record along, and erasing on would take more
     * or hide which store it was.
     */
    private async haltForTheRecord(
        record: TenantDeletionRecord,
        taken: CommercialRecordTaken,
    ): Promise<void> {
        const counts = taken.lost
            .map((part) => `${part} ${taken.before[part]} → ${taken.after[part]}`)
            .join(', ');
        this.logger.error(
            `The deletion of tenant ${record.tenantId} is halted: after store ` +
                `${taken.store ?? '(none)'} erased, the subscriber's commercial record is short ` +
                `(${counts}; SC-PRIV-011). No further store erases until the operator acts.`,
        );
        try {
            await this.records.recordCommercial(record.id, 'after', taken.after);
            await this.records.recordFailure(
                record.id,
                {
                    step: 'guard',
                    store: taken.store,
                    code: 'commercial-record-lost',
                    at: new Date(),
                },
                'commercial-record-lost',
            );
        } catch (recording) {
            this.logger.error(
                `The halt of the deletion of tenant ${record.tenantId} could not be recorded; ` +
                    'the next run finds the record short again.',
                stackOf(recording),
            );
            return;
        }
        await this.record(record, 'TENANT_DELETION_HALTED', {
            halt: 'commercial-record-lost',
            store: taken.store,
            lost: [...taken.lost],
        });
    }

    /** Lets the claim go; one that cannot be let go goes stale and is taken on then. */
    private async letGo(claim: HeldClaim): Promise<void> {
        try {
            await this.records.release(claim.id, claim.claimedAt);
        } catch (error) {
            this.logger.error(
                `The claim on deletion ${claim.id} could not be let go; it is taken on once it ` +
                    'goes stale.',
                stackOf(error),
            );
        }
    }

    /** Best effort, naming no person: the deletion stands whether or not its entry is written. */
    private async record(
        record: TenantDeletionRecord,
        action: string,
        halted?: {
            readonly halt: TenantDeletionRecordHalt;
            readonly store: string | null;
            readonly lost: readonly (keyof CommercialRecordCounts)[];
        },
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor: platformJobActor('tenant-deletions'),
                entity: AUDITED_ENTITY,
                entityId: record.id,
                action,
                changes: {
                    subscriptionId: record.subscriptionId,
                    deletesOn: record.deletesOn,
                    ...halted,
                },
                tenantId: record.tenantId,
            });
        } catch (error) {
            this.logger.error(
                `The audit record of ${action} for tenant ${record.tenantId} could not be written.`,
                stackOf(error),
            );
        }
    }
}

/** Whether `value` is a `TenantKeepReportPort`; a factory may answer anything. */
function reportsWhatIsKept(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        'keep' in value &&
        typeof value.keep === 'function'
    );
}

/** The part `eraser` has in `record`; `erasersOf` has made sure there is one. */
function partOf(
    record: TenantDeletionRecord,
    eraser: TenantEraser,
): { countedAt: Date | null; erasedAt: Date | null } {
    return (
        record.stores.find((part) => part.store === eraser.name) ?? {
            countedAt: null,
            erasedAt: null,
        }
    );
}

/**
 * Whether a suspension held at some moment between `endsAt` and `now`: its
 * span, open until it was lifted, meets the span the export was offered in
 * (`SC-PRIV-024`).
 */
function suspendedBetween(holds: readonly TenantAccessHold[], endsAt: Date, now: Date): boolean {
    return holds.some(
        (hold) => hold.kind === 'suspended' && hold.since < now && (hold.liftedAt ?? now) > endsAt,
    );
}

/** Why the installation's mark holds every deletion, and the line that lets them go on. */
function whyTheMarkHolds(halt: TenantDeletionMarkHalt): string {
    if (halt.reason === 'installation-unmarked') {
        return (
            "the database is not marked as this installation's own (SC-PRIV-021). Once it is " +
            `the one to delete in, mark it with \`<app> installation mark ${halt.expected}\`.`
        );
    }
    return (
        `the database is marked as installation ${halt.marked}, and this process runs as ` +
        `${halt.expected} (SC-PRIV-021). Where it is ${halt.expected}'s database, as after ` +
        `restoring a backup, mark it with \`<app> installation mark ${halt.expected} --replace\`.`
    );
}

/** Why `reason` holds the deletion of `end`'s tenant before it begins; `contract` is the one that runs past it. */
function whyItHolds(
    reason: TenantDeletionHeldBeforeBeginning,
    end: Pick<SubscriptionEnd, 'endsAt'>,
    contract: Pick<SubscriptionContractRecord, 'id'> | null,
): string {
    switch (reason.reason) {
        case 'installation-unmarked':
        case 'installation-differs':
            return whyTheMarkHolds(reason);
        case 'no-subscriber':
            return 'it has no subscriber to keep the record of it with (SC-PRIV-023)';
        case 'contract-runs-past-end':
            return (
                `its contract ${contract?.id ?? '(unknown)'} runs after the end of ` +
                `${end.endsAt.toISOString()} (SC-PRIV-026)`
            );
    }
}

/** Whether `character` may stand in a failure's code. */
function isCodeCharacter(character: string): boolean {
    return /^[A-Za-z0-9_.-]$/.test(character);
}

/**
 * The code a failure is kept under: the error's own `code`, or its name,
 * stripped to letters, digits, `_`, `.` and `-` and cut to
 * `FAILURE_CODE_MAX_LENGTH`. Never the message, which may name anybody.
 */
function failureCodeOf(error: unknown): string {
    const candidates = [
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
        error instanceof Error ? error.name : undefined,
    ];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const code = [...candidate]
            .filter(isCodeCharacter)
            .join('')
            .slice(0, FAILURE_CODE_MAX_LENGTH);
        if (code !== '') return code;
    }
    return 'unknown';
}

function stackOf(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
