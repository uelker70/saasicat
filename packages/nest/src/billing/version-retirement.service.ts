// An orderly retirement: an operator ends a plan version for the subscriptions
// already on it and names the version they continue on.
//
// It is the one exception to a subscription keeping its version, so the
// platform keeps it narrow. It rests on a clause in the operator's terms, which
// `config/saas.yaml` confirms; only a version no longer on sale can be retired,
// so nobody books it after the announcement; the replacement is on sale; and a
// subscription is reached at most once in twelve months. Every subscription it
// reaches is told, and keeps its version until a term end at least three
// calendar months away (`retirementReach`). The announcement and what it means
// for each subscription are written in one transaction, before anybody is told,
// so the cancellation right it opens exists exactly when the announcement does.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    CATALOG_ERROR_CODES,
    type AdminActor,
    type BillingCycle,
    type BundleRepository,
    type PlanCatalogSettings,
    type PlanRepository,
    type PlanVersionRow,
    type RetiredVersionRef,
    type RetirementSide,
    type VersionOfferSide,
    type RetirementAnnounced,
    type RetirementBlocker,
    type RetirementPreview,
    type RetirementReachedRow,
    type RetirementSkippedRow,
    type RlsBypassPort,
    type SubscriptionBundleRepository,
    type SubscriptionNoticePort,
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type TransactionRunner,
    type VersionRetiredNotice,
    type VersionRetirementReminder,
    type VersionRetirementRepository,
    type VersionRetirementView,
    classifyVersionOffer,
    versionSale,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    type PlanVersionEndingCheck,
} from '../catalog/catalog.tokens.js';
import { heldAddOnMisfits, type AddOnsAhead, type PlanBeside } from './add-on-fits-plan.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { actorTagOf } from '../core/web-audit.js';
import {
    NOTICE_CLAIM_LEASE_MS,
    NOTICE_DELIVERY_TIMEOUT_MS,
    NoticeSender,
} from './notice-sender.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import {
    groupByRetiredVersion,
    retirementNoticesOnRecord,
    retirementsOfItsVersion,
    subscriptionsReachedSince,
    toldOfAnotherRetirementWithinAYear,
    toldRetirementNotices,
    type RetirementNoticeOnRecord,
} from './retirement-notices.js';
import { comparedFieldsOf, planOfVersion, versionSideOf } from './version-sides.js';
import { progressOf, sameSet, type ReachedState } from './retirement-progress.js';
import { onceEach } from './versions-read-once.js';
import {
    RETIREMENT_REPEAT_MONTHS,
    calendarMonthsAfter,
    retirementReach,
} from './retirement-reach.js';
import {
    ADD_ONS_AHEAD_TOKEN,
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    VERSION_RETIREMENT_REPOSITORY_TOKEN,
    VERSION_RETIREMENT_TRANSACTION_RUNNER_TOKEN,
} from './tenant-billing.tokens.js';

/** What one catch-up run did. */
export interface RetirementNoticeRun {
    readonly told: number;
    readonly failed: number;
}

/** Whether `config/saas.yaml` confirms the operator's terms carry the clause a retirement rests on. */
export function retirementTermsConfirmed(settings: PlanCatalogSettings): boolean {
    return settings.tenantBilling?.orderlyRetirement?.termsConfirmed === true;
}

@Injectable()
export class VersionRetirementService implements OnModuleInit, PlanVersionEndingCheck {
    private readonly logger = new Logger(VersionRetirementService.name);
    private readonly deliveryTimeoutMs = NOTICE_DELIVERY_TIMEOUT_MS;
    private readonly sender: NoticeSender;

    constructor(
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        @Inject(VERSION_RETIREMENT_REPOSITORY_TOKEN)
        private readonly retirements: VersionRetirementRepository,
        @Inject(VERSION_RETIREMENT_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // The reach is the installation's, not a tenant's: under a row policy
        // it would otherwise find nobody on the version.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
        // The add-ons booked on the subscriptions a retirement reaches, and the
        // versions they name: every one still running at the date has to be
        // able to run on the replacement's plan. Absent where nothing books
        // add-ons; `TenantBillingModule` refuses the one without the other.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository | null = null,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        // Where add-on versions are retired: a booking told of one continues
        // on the replacement, which has to run beside the new plan too.
        @Optional()
        @Inject(ADD_ONS_AHEAD_TOKEN)
        private readonly addOnsAhead: AddOnsAhead | null = null,
    ) {
        // A retirement counts from its notice reaching somebody, so one the
        // application tells nobody of is tried again.
        this.sender = new NoticeSender(notices, port, { retriesNobody: true });
    }

    /** Refuses a wiring that could never find the subscriptions a retirement reaches. */
    onModuleInit(): void {
        // Unconfirmed terms leave retiring off, and an installation that never
        // retires is not asked for what only retiring reads.
        if (!retirementTermsConfirmed(this.settings)) return;
        if (!this.subscriptions.listBoundToVersion) {
            throw new Error(
                'Retiring versions is turned on, but the SubscriptionUsagePort has no ' +
                    '`listBoundToVersion`: the platform cannot find the subscriptions a ' +
                    'retirement reaches. Both shipped adapters have it; a port of your own adds it.',
            );
        }
        if (!this.plans.findVersionById) {
            throw new Error(
                'Retiring versions is turned on, but the PlanRepository has no `findVersionById`. ' +
                    'Both shipped adapters have it.',
            );
        }
    }

    /**
     * What retiring `retiredId` for `replacementId` would do if announced at
     * `now`. Everything that would refuse the announcement is reported as a
     * blocker rather than thrown, so the operator sees all of it at once —
     * except terms that are not confirmed, which leave retiring off altogether
     * and are refused before anything is read.
     */
    async preview(retiredId: string, replacementId: string, now: Date): Promise<RetirementPreview> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.previewAcrossTenants(retiredId, replacementId, now),
        );
    }

    private async previewAcrossTenants(
        retiredId: string,
        replacementId: string,
        now: Date,
    ): Promise<RetirementPreview> {
        if (!retirementTermsConfirmed(this.settings)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.RETIREMENT_TERMS_NOT_CONFIRMED,
                message:
                    'Retiring a version for running subscriptions needs a clause in your terms. ' +
                    'Set tenantBilling.orderlyRetirement.termsConfirmed in config/saas.yaml once ' +
                    'they carry it.',
                params: {},
            });
        }
        if (retiredId === replacementId) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.RETIREMENT_REPLACEMENT_IS_RETIRED,
                message: 'A version cannot be its own replacement.',
                params: {},
            });
        }
        const retired = await this.versionOf(retiredId);
        const replacement = await this.versionOf(replacementId);
        const retiredPlan = planOfVersion(retired.planId, retired);
        const replacementPlan = planOfVersion(replacement.planId, replacement);
        const { changes } = classifyVersionOffer(
            comparedFieldsOf(retiredPlan),
            comparedFieldsOf(replacementPlan),
        );
        const blockers: RetirementBlocker[] = [];
        if (versionSale(retired, now).kind !== 'off-sale') {
            blockers.push(blocker(BILLING_ERROR_CODES.RETIREMENT_VERSION_ON_SALE, retired));
        }
        if (versionSale(replacement, now).kind !== 'on-sale') {
            blockers.push(
                blocker(BILLING_ERROR_CODES.RETIREMENT_REPLACEMENT_NOT_ON_SALE, replacement),
            );
        }

        const { reached, skipped } = await this.reachOf(retired.id, now);
        if (reached.length === 0) {
            blockers.push(blocker(BILLING_ERROR_CODES.RETIREMENT_NOTHING_AFFECTED, retired));
        }
        // Continuing on a version means being billed at its price in the
        // subscription's own rhythm; where it has none, there is nothing to
        // bill, and the move cannot be made.
        const replacementSide = versionSideOf(replacement, replacementPlan);
        const unsold = reached.filter((row) => priceIn(replacementSide, row.billingCycle) === null);
        if (unsold.length > 0) {
            blockers.push({
                code: BILLING_ERROR_CODES.RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM,
                message:
                    `${unsold.length} of these subscriptions are billed in a rhythm version ` +
                    `${replacement.version} of ${replacement.planId} has no price for, so they ` +
                    'cannot continue on it.',
                params: {
                    count: unsold.length,
                    planKey: replacement.planId,
                    version: replacement.version,
                },
            });
        }
        // Continuing on a version means continuing beside its plan, with every
        // add-on still booked at the date; where one cannot run there, the
        // subscription cannot continue on it either.
        const stranded = await this.holdingWhatTheReplacementCannotCarry(
            reached,
            replacement.planId,
        );
        if (stranded > 0) {
            blockers.push({
                code: BILLING_ERROR_CODES.RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES,
                message:
                    `${stranded} of these subscriptions hold a bundle that cannot run on ` +
                    `version ${replacement.version} of ${replacement.planId}, so they cannot ` +
                    'continue on it.',
                params: {
                    count: stranded,
                    planKey: replacement.planId,
                    version: replacement.version,
                },
            });
        }
        const recent = reached.filter((row) => row.reachedRecently);
        if (recent.length > 0) {
            blockers.push({
                code: BILLING_ERROR_CODES.RETIREMENT_WITHIN_TWELVE_MONTHS,
                message:
                    `${recent.length} of these subscriptions were reached by a retirement within ` +
                    'the last twelve months. A subscription is reached at most once a year.',
                params: { count: recent.length },
            });
        }
        return {
            retired: { planKey: retired.planId, ...versionSideOf(retired, retiredPlan) },
            replacement: { planKey: replacement.planId, ...replacementSide },
            changes,
            asOf: now.toISOString(),
            reached,
            skipped,
            blockers,
        };
    }

    /**
     * Announces the retirement, provided it reaches exactly the subscriptions
     * the operator was shown (`shownSubscriptionIds`): a subscription that
     * appeared or left since would otherwise be told, or not, without anybody
     * having looked. Every notice is recorded before any is sent; one that
     * cannot be sent now is sent by the next run.
     */
    async announce(
        retiredId: string,
        replacementId: string,
        shownSubscriptionIds: readonly string[],
        actor: AdminActor,
        now: Date,
    ): Promise<RetirementAnnounced> {
        // Across tenants from the first read to the last notice: the
        // transaction has to open inside the frame, and every row it writes
        // belongs to a tenant the operator's request is not scoped to.
        return readAcrossTenants(this.rlsBypass, () =>
            this.announceAcrossTenants(retiredId, replacementId, shownSubscriptionIds, actor, now),
        );
    }

    private async announceAcrossTenants(
        retiredId: string,
        replacementId: string,
        shownSubscriptionIds: readonly string[],
        actor: AdminActor,
        now: Date,
    ): Promise<RetirementAnnounced> {
        const preview = await this.previewAcrossTenants(retiredId, replacementId, now);
        const [first] = preview.blockers;
        if (first) {
            throw new UnprocessableEntityException({ ...first, blockers: preview.blockers });
        }
        if (
            !sameSet(
                preview.reached.map((row) => row.subscriptionId),
                shownSubscriptionIds,
            )
        ) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.RETIREMENT_PREVIEW_CHANGED,
                message:
                    'The subscriptions this retirement reaches changed since they were shown. ' +
                    'Look at them again before announcing it.',
                params: {},
                preview,
            });
        }

        const retirement = await this.transactions.run(async (tx) => {
            const created = await this.retirements.create(
                {
                    retired: refOf(preview.retired),
                    replacement: refOf(preview.replacement),
                    announcedAt: now,
                    announcedBy: actorTagOf(actor),
                },
                tx,
            );
            const recorded = await this.notices.record(
                preview.reached.map((row) => {
                    const notice = noticeOf(created.id, preview, row);
                    return { ...keyOf(notice), content: notice };
                }),
                now,
                tx,
            );
            // A notice is kept once per subscription and retired version, so
            // one already there was written by another announcement of this
            // version — one that ran beside this one and passed the same
            // twelve-month check before either had written. Thrown inside the
            // transaction, so this announcement is not kept either.
            const alreadyReached = preview.reached.length - recorded;
            if (alreadyReached > 0) {
                throw new ConflictException({
                    code: BILLING_ERROR_CODES.RETIREMENT_WITHIN_TWELVE_MONTHS,
                    message:
                        `${alreadyReached} of these subscriptions were reached by another ` +
                        'retirement of this version meanwhile. A subscription is reached at most ' +
                        'once a year.',
                    params: { count: alreadyReached },
                });
            }
            return created;
        });
        // From here on the retirement is announced, whatever fails: what is
        // left is reported, not thrown, so the operator is not told it failed
        // when it did not.
        try {
            await this.audit?.log({
                actor,
                entity: 'PlanVersion',
                entityId: retirement.retired.planVersionId,
                action: 'PLAN_VERSION_RETIRE',
                changes: {
                    retirementId: retirement.id,
                    replacementPlanVersionId: retirement.replacement.planVersionId,
                    subscriptions: preview.reached.length,
                },
            });
        } catch (error) {
            // The announcement row names who made it and when; the audit entry
            // is the second record of it, and its loss is said loudly.
            this.logger.error(
                `Retirement ${retirement.id} is announced, but writing its audit entry failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }

        let told = 0;
        let failed = 0;
        for (const row of preview.reached) {
            const notice = noticeOf(retirement.id, preview, row);
            const outcome = await this.sender.tell(
                notice,
                keyOf(notice).subject,
                this.deliveryTimeoutMs,
            );
            if (outcome === 'told') told += 1;
            // Told to nobody is not told: the next run tries again, as it
            // does a notice the application could not send.
            if (outcome === 'failed' || outcome === 'untold') failed += 1;
        }
        return { retirement, told, failed };
    }

    /**
     * Sends every retirement notice that is recorded and has reached nobody
     * yet. A retirement counts from its notice reaching the subscriber
     * (`SC-SUB-038`), so a notice sent now names the date counted from now —
     * the first end of a term at least three calendar months away — and the
     * last day to cancel with it, from the subscription as it stands. One that
     * has left the version, or that the retirement no longer reaches, is not
     * told: its notice stays on record, unsent. Nor, while they last, is one
     * whose replacement could not carry the subscription's add-ons at its date,
     * or one whose subscription was told of another retirement within twelve
     * months: those wait. One the application tells nobody of counts as
     * neither told nor failed here: the next run tries it again, and it is
     * said in the log once a day, not by every run.
     */
    async sendUndelivered(now: Date): Promise<RetirementNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            let told = 0;
            let failed = 0;
            // `now` is when the run began; each notice counts from the moment
            // it is sent, which the ones before it may have pushed back.
            const started = Date.now();
            const sendingAt = () => new Date(now.getTime() + (Date.now() - started));
            const staleBefore = new Date(now.getTime() - NOTICE_CLAIM_LEASE_MS);
            const waiting = await this.notices.listUndelivered('version-retired', staleBefore);
            const byVersion = groupByRetiredVersion(
                waiting.map((record) => record.content as VersionRetiredNotice),
            );
            for (const [retiredId, notices] of byVersion) {
                const onIt = await this.boundTo(retiredId);
                for (const stored of notices) {
                    const sub = onIt.get(stored.subscriptionId);
                    const at = sendingAt();
                    const reach = sub ? retirementReach(sub, at) : null;
                    if (!reach?.reached) continue;
                    // The add-ons may have changed while the notice waited:
                    // it says what happens only where the replacement's plan
                    // can carry them at the date (`SC-SUB-037`), and waits
                    // where it cannot.
                    if (
                        await this.holdsWhatThePlanCannotCarry(
                            stored.subscriptionId,
                            {
                                planKey: stored.replacement.planKey,
                                billingCycle: reach.billingCycle,
                            },
                            reach.effectiveAt,
                        )
                    ) {
                        continue;
                    }
                    // One retirement in twelve months: this one waits until
                    // those since the last the subscription was told of are
                    // over (`SC-BUN-041`).
                    if (
                        await toldOfAnotherRetirementWithinAYear(
                            this.notices,
                            stored.subscriptionId,
                            retiredId,
                            at,
                        )
                    ) {
                        continue;
                    }
                    const outcome = await this.sender.tell(
                        {
                            ...stored,
                            billingCycle: reach.billingCycle,
                            effectiveAt: reach.effectiveAt.toISOString(),
                            lastDayToCancel: reach.lastDayToCancel,
                        },
                        retiredId,
                        this.deliveryTimeoutMs,
                    );
                    if (outcome === 'told') told += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { told, failed };
        });
    }

    /**
     * The retirement that reaches the subscription and has not taken effect at
     * `now`, or null. What it says is what the subscriber was told, and only
     * once it was: a notice that has reached nobody sets no date (`SC-SUB-038`).
     * One the subscription has already left the retired version for — a newer
     * version taken, say — no longer reaches it.
     */
    async pendingFor(
        subscription: {
            readonly id: string;
            readonly planVersion?: { readonly id: string } | null;
        },
        now: Date,
    ): Promise<VersionRetiredNotice | null> {
        const told = await this.toldRetirementsOf(subscription);
        return told.find((notice) => new Date(notice.effectiveAt) > now) ?? null;
    }

    /**
     * The retirements of the version the subscription is bound to whose notice
     * reached it, whatever their date: until the move has run, the
     * subscription is still on that version and each of them still moves it.
     */
    async toldRetirementsOf(subscription: {
        readonly id: string;
        readonly planVersion?: { readonly id: string } | null;
    }): Promise<VersionRetiredNotice[]> {
        if (!subscription.planVersion?.id) return [];
        return retirementsOfItsVersion(
            toldRetirementNotices(await this.notices.listForSubscription(subscription.id)),
            subscription,
        );
    }

    /**
     * Every announcement, the most recent first, with how far it has come
     * (`SC-SUB-033`): counted over the subscriptions it reached, from where
     * each one is now — not told yet among them (`SC-SUB-038`) — and how many
     * of them were reminded (`SC-SUB-034`).
     */
    async list(now = new Date()): Promise<VersionRetirementView[]> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const [retirements, told, reminded] = await Promise.all([
                this.retirements.list(),
                this.allNotices(),
                this.remindedByRetirement(),
            ]);
            const stillOn = new Map<string, Promise<Map<string, SubscriptionUsageRecord>>>();
            const onVersion = (planVersionId: string) => {
                let found = stillOn.get(planVersionId);
                if (!found) {
                    found = this.boundTo(planVersionId);
                    stillOn.set(planVersionId, found);
                }
                return found;
            };
            return Promise.all(
                retirements.map(async (retirement) => ({
                    ...retirement,
                    progress: {
                        ...progressOf(
                            subscriptionStates(
                                told.filter(({ notice }) => notice.retirementId === retirement.id),
                                await onVersion(retirement.retired.planVersionId),
                            ),
                            now,
                        ),
                        reminded: reminded.get(retirement.id) ?? 0,
                    },
                })),
            );
        });
    }

    /**
     * Refuses ending a version while subscriptions a retirement reached still
     * move onto it (`SC-PLAN-029`): the move binds the replacement, and nothing
     * binds a version that has ended. While one has not been told yet — its
     * date counts from its notice reaching it, so it is not set — or is past
     * its date and still to move, a move the run could not make yet, it cannot
     * end at all (`SC-SUB-038`); otherwise it may end from the day after the
     * last of their dates, which leaves the run a day to catch up.
     */
    async assertMayEnd(versionId: string, endsAt: Date, now = new Date()): Promise<void> {
        await readAcrossTenants(this.rlsBypass, async () => {
            const onto = (await this.allNotices()).filter(
                ({ notice }) => notice.replacement.planVersionId === versionId,
            );
            const stillToMove: RetirementNoticeOnRecord[] = [];
            for (const retiredId of new Set(
                onto.map(({ notice }) => notice.retired.planVersionId),
            )) {
                const bound = await this.boundTo(retiredId);
                for (const onRecord of onto) {
                    const { notice } = onRecord;
                    if (notice.retired.planVersionId !== retiredId) continue;
                    const sub = bound.get(notice.subscriptionId);
                    if (sub && !cancellationHasLanded(sub, new Date(notice.effectiveAt))) {
                        stillToMove.push(onRecord);
                    }
                }
            }
            if (stillToMove.length === 0) return;
            const [{ notice: first }] = stillToMove as [RetirementNoticeOnRecord];
            const { replacement } = first;
            // A notice that has reached nobody has no date yet: once it is
            // told, the date counts from then, and could lie past any end.
            const untold = stillToMove.filter((onRecord) => !onRecord.told);
            if (untold.length > 0) {
                throw new UnprocessableEntityException({
                    code: CATALOG_ERROR_CODES.PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED,
                    message:
                        `${untold.length} subscriptions have not yet been told that they move to ` +
                        `version ${replacement.version} of ${replacement.planKey}, so it cannot ` +
                        'end until they have been.',
                    params: {
                        count: untold.length,
                        version: replacement.version,
                        planKey: replacement.planKey,
                    },
                });
            }
            const toMove = stillToMove.map((onRecord) => onRecord.notice);
            const overdue = toMove.filter((notice) => new Date(notice.effectiveAt) <= now);
            if (overdue.length > 0) {
                throw new UnprocessableEntityException({
                    code: CATALOG_ERROR_CODES.PLAN_TERMINATE_WHILE_MOVES_OVERDUE,
                    message:
                        `${overdue.length} subscriptions are past their date and still to be ` +
                        `moved to version ${replacement.version} of ${replacement.planKey}, so ` +
                        'it cannot end until they have moved.',
                    params: {
                        count: overdue.length,
                        version: replacement.version,
                        planKey: replacement.planKey,
                    },
                });
            }
            const last = Math.max(...toMove.map((n) => new Date(n.effectiveAt).getTime()));
            const earliest = new Date(startOfUtcDay(last) + DAY_MS);
            if (endsAt >= earliest) return;
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES,
                message:
                    `Subscriptions still move to version ${replacement.version} of ` +
                    `${replacement.planKey}, so it can end on ` +
                    `${earliest.toISOString().slice(0, 10)} at the earliest.`,
                params: {
                    version: replacement.version,
                    planKey: replacement.planKey,
                    date: earliest.toISOString().slice(0, 10),
                },
            });
        });
    }

    /** Every retirement notice on record, as it was told, and whether it was. */
    private allNotices(): Promise<RetirementNoticeOnRecord[]> {
        return retirementNoticesOnRecord(this.notices);
    }

    /**
     * How many subscriptions each retirement has reminded: reminders that went
     * out to somebody. One the application could send to nobody reminded no one.
     */
    private async remindedByRetirement(): Promise<Map<string, number>> {
        const counts = new Map<string, number>();
        for (const record of await this.notices.listOfKindSince(
            'version-retirement-reminder',
            new Date(0),
        )) {
            if (!record.delivery || record.delivery.recipients.length === 0) continue;
            const { retirementId } = record.content as VersionRetirementReminder;
            counts.set(retirementId, (counts.get(retirementId) ?? 0) + 1);
        }
        return counts;
    }

    /** The subscriptions on a version, by id. */
    private async boundTo(planVersionId: string): Promise<Map<string, SubscriptionUsageRecord>> {
        // `onModuleInit` refused a port without it where retiring is on, and a
        // notice exists only where it was.
        const rows = await this.subscriptions.listBoundToVersion!(planVersionId);
        return new Map(rows.map((row) => [row.subscription.id, row.subscription]));
    }

    private async versionOf(id: string): Promise<PlanVersionRow> {
        // `onModuleInit` refused a repository without it.
        const version = await this.plans.findVersionById!(id);
        if (!version) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.PLAN_VERSION_NOT_FOUND,
                message: `PlanVersion '${id}' not found`,
                params: { versionId: id },
            });
        }
        return version;
    }

    /**
     * How many of the subscriptions reached hold, at their date, an add-on that
     * cannot run beside `planKey` in the rhythm they are billed in then.
     */
    private async holdingWhatTheReplacementCannotCarry(
        reached: readonly RetirementReachedRow[],
        planKey: string,
    ): Promise<number> {
        // The add-on versions are read once for every subscription reached.
        const versions = onceEach(this.bundles);
        let holding = 0;
        for (const row of reached) {
            const plan = { planKey, billingCycle: row.billingCycle as BillingCycle };
            const at = new Date(row.effectiveAt);
            if (await this.holdsWhatThePlanCannotCarry(row.subscriptionId, plan, at, versions)) {
                holding += 1;
            }
        }
        return holding;
    }

    /**
     * Whether the subscription holds, at `at`, an add-on that cannot run beside
     * `plan` — the version it is on, or the one it was told it continues on.
     */
    private async holdsWhatThePlanCannotCarry(
        subscriptionId: string,
        plan: PlanBeside,
        at: Date,
        versions = onceEach(this.bundles),
    ): Promise<boolean> {
        const bookings = this.subscriptionBundles;
        if (!bookings) return false;
        const held = await heldAddOnMisfits(
            bookings,
            versions,
            subscriptionId,
            plan,
            at,
            (await this.addOnsAhead?.of(subscriptionId)) ?? [],
        );
        return held.length > 0;
    }

    /** Which subscriptions on the version a retirement now reaches, and which it does not. */
    private async reachOf(
        planVersionId: string,
        now: Date,
    ): Promise<{ reached: RetirementReachedRow[]; skipped: RetirementSkippedRow[] }> {
        // `onModuleInit` refused a port without it.
        const bound = await this.subscriptions.listBoundToVersion!(planVersionId);
        const recently = await subscriptionsReachedSince(
            this.notices,
            calendarMonthsAfter(now, -RETIREMENT_REPEAT_MONTHS),
        );
        // Told of this version's retirement already, by an earlier announcement:
        // that one stands, and its notice is the one the subscription keeps. At
        // most one per subscription and version retired, so this grows with
        // subscriptions and years, not with runs.
        const told = new Set(
            (await this.notices.listOfKindSince('version-retired', new Date(0)))
                .filter((notice) => notice.subject === planVersionId)
                .map((notice) => notice.subscriptionId),
        );
        const reached: RetirementReachedRow[] = [];
        const skipped: RetirementSkippedRow[] = [];
        for (const { tenantId, subscription } of bound) {
            if (told.has(subscription.id)) {
                skipped.push({ tenantId, subscriptionId: subscription.id, reason: 'already-told' });
                continue;
            }
            const reach = retirementReach(subscription, now);
            if (!reach.reached) {
                skipped.push({ tenantId, subscriptionId: subscription.id, reason: reach.reason });
                continue;
            }
            reached.push({
                tenantId,
                subscriptionId: subscription.id,
                status: subscription.status,
                billingCycle: reach.billingCycle,
                effectiveAt: reach.effectiveAt.toISOString(),
                lastDayToCancel: reach.lastDayToCancel,
                reachedRecently: recently.has(subscription.id),
            });
        }
        return { reached, skipped };
    }
}

/** A version's net price in `billingCycle`, or null where it is not sold in that rhythm. */
function priceIn(side: VersionOfferSide, billingCycle: string): number | null {
    return billingCycle === 'YEARLY' ? side.yearlyNet : side.monthlyNet;
}

function refOf(side: RetirementSide): RetiredVersionRef {
    return { planVersionId: side.planVersionId, planKey: side.planKey, version: side.version };
}

function blocker(code: string, version: PlanVersionRow): RetirementBlocker {
    const params = { planKey: version.planId, version: version.version };
    const sentences: Record<string, string> = {
        [BILLING_ERROR_CODES.RETIREMENT_VERSION_ON_SALE]:
            `Version ${params.version} of ${params.planKey} is still on sale. End its sale ` +
            'first, so nobody books it after the announcement.',
        [BILLING_ERROR_CODES.RETIREMENT_REPLACEMENT_NOT_ON_SALE]:
            `Version ${params.version} of ${params.planKey} is not on sale, so subscriptions ` +
            'cannot continue on it.',
        [BILLING_ERROR_CODES.RETIREMENT_NOTHING_AFFECTED]:
            `No running subscription is on version ${params.version} of ${params.planKey}, so ` +
            'there is nobody to tell.',
    };
    return { code, message: sentences[code] ?? code, params };
}

function noticeOf(
    retirementId: string,
    preview: RetirementPreview,
    row: RetirementReachedRow,
): VersionRetiredNotice {
    return {
        kind: 'version-retired',
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        retirementId,
        retired: preview.retired,
        replacement: preview.replacement,
        changes: preview.changes,
        billingCycle: row.billingCycle,
        effectiveAt: row.effectiveAt,
        lastDayToCancel: row.lastDayToCancel,
    };
}

/**
 * Where a retirement notice is kept: once per subscription and retired version,
 * whichever announcement made it. Two announcements of one version that run
 * side by side therefore meet on the same rows, and the store keeps the first.
 */
function keyOf(notice: VersionRetiredNotice) {
    return {
        tenantId: notice.tenantId,
        subscriptionId: notice.subscriptionId,
        kind: notice.kind,
        subject: notice.retired.planVersionId,
    };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(ms: number): number {
    return ms - (ms % DAY_MS);
}

/** Where each subscription a retirement reached stands now. */
function subscriptionStates(
    onRecord: readonly RetirementNoticeOnRecord[],
    stillOn: ReadonlyMap<string, SubscriptionUsageRecord>,
): ReachedState[] {
    return onRecord.map(({ notice, told }) => {
        const sub = stillOn.get(notice.subscriptionId);
        const effectiveAt = new Date(notice.effectiveAt);
        return {
            stillOn: Boolean(sub),
            endedByTheDate: Boolean(sub && cancellationHasLanded(sub, effectiveAt)),
            told,
            effectiveAt,
        };
    });
}
