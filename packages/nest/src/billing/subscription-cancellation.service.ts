// A tenant's cancellation of its subscription: what declaring one now would
// do, and declaring it.
//
// A tenant declares; the rules decide when it lands — the minimum term, the
// notice period the contract in force or the file names, a retirement on its
// way. What the account shows before the tenant confirms and what the
// declaration applies are worked out by the same method, and where the end of
// a subscription is recorded, both name the day the tenant's data is deleted
// on (`SC-CANC-021`). The tenant comes from the caller, who read it off the
// authenticated request; nothing here reads a request.

import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    installationZoneOf,
    type AdminActor,
    type AnnouncedDeletion,
    type BillingCycle,
    type CalendarDay,
    type PlanCatalogSettings,
    type SubscriptionContractRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type TenantSubscriptionWritePort,
    type VersionRetiredNotice,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { actorTagOf } from '../core/web-audit.js';
import type { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { answeringRefusals } from '../errors/answering-refusals.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../subscription-contract/subscription-contract.tokens.js';
import {
    decideCancellationFor,
    NO_NOTICE_PERIOD,
    noticeDaysFor,
    type CancellationDecision,
    type CancellationNoticePeriods,
} from './cancellation.js';
import { cancellationTermsChanged } from './cancellation-terms-changed.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { endContractAfter } from './freeze-contract-after.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import {
    deletionDayDiffersFromShown,
    SubscriptionEndService,
    type DeletionOnConfirming,
} from './subscription-end.service.js';
import {
    CANCELLATION_NOTICE_DAYS_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { VersionRetirementService } from './version-retirement.service.js';

/** What cancelling now would do, and what confirming it would tell the tenant of its deletion. */
export type ProjectedCancellation = CancellationDecision & {
    /**
     * The deletion day confirming now leaves on record, which is the day a
     * confirmation sent back with it is held to: counted from where cancelling
     * now would land; once a cancellation is declared, the day it was told, or
     * else the one counted from the date it lands on; once it has landed, null.
     * Null as well where the end of a subscription is not recorded, or the
     * subscription has no id.
     */
    deletion: AnnouncedDeletion | null;
};

/** What the account says of ending the subscription, read once. */
export interface CancellationProjection {
    cancellation: ProjectedCancellation;
    /** What the tenant was told when it confirmed its cancellation; null where it was told none. */
    announcedDeletion: AnnouncedDeletion | null;
    /** The retirement reaching the subscription that has not taken effect yet, or null. */
    retirement: VersionRetiredNotice | null;
}

/** What the page showed before the tenant confirmed; each is checked, not trusted. */
export interface ShownCancellation {
    expectedEffectiveAt?: string;
    expectedDeletesOn?: CalendarDay | null;
}

/** What declaring a cancellation answers, before the days of its moments are put beside them. */
export interface DeclaredCancellation {
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    status: string;
    termEndsAt: Date | null;
    noticeDeadline: Date | null;
    afterNoticeDeadline: boolean | null;
    deletion: AnnouncedDeletion | null;
    alreadyCanceled: boolean;
}

/** What the audit entry of a declared cancellation records. */
type CancellationAuditChanges = {
    canceledAt: string;
    effectiveAt: string;
    afterNoticeDeadline: boolean;
    status: string;
    /** The day announced, and the period it was counted with; null where none was recorded. */
    deletesOn: CalendarDay | null;
    readOnlyDays: number | null;
};

/** What the audit entry of a deletion day recorded by a repeat names. */
type DeletionDayAuditChanges = {
    /** When the cancellation the day was counted from lands. */
    effectiveAt: string;
    deletesOn: CalendarDay;
    readOnlyDays: number;
};

/**
 * An audit entry this service writes. A deletion day recorded by a repeat is
 * its own action rather than a second cancellation: the cancellation was
 * audited when it was declared, and counting cancellations by their entries
 * counts it once.
 */
type CancellationAuditEntry =
    | { action: 'CANCEL_SUBSCRIPTION'; changes: CancellationAuditChanges }
    | { action: 'ANNOUNCE_DELETION_DAY'; changes: DeletionDayAuditChanges };

@Injectable()
export class SubscriptionCancellationService {
    private readonly logger = new Logger(SubscriptionCancellationService.name);

    // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptionUsage: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly subscriptionWrite: TenantSubscriptionWritePort,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        // Zero unless an installation asked for a notice period. See the token.
        // `TenantBillingModule` always registers this, read from
        // `config/saas.yaml#tenantBilling`. `NO_NOTICE_PERIOD` is not a
        // configuration default — an application that omits the setting does
        // not boot — it is what lets this service be built directly in a test
        // that does not exercise a notice period.
        @Optional()
        @Inject(CANCELLATION_NOTICE_DAYS_TOKEN)
        private readonly cancellationNoticeDays: CancellationNoticePeriods = NO_NOTICE_PERIOD,
        // Where contracts are frozen, the one in force ends with the
        // subscription; a consumer without contracts has nothing to end.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        // Without it — a minimal deploy without AdminModule — no audit entry is
        // written.
        @Optional()
        @Inject(AdminAuditService)
        private readonly auditService: AdminAuditService | null = null,
        // Only where an operator may retire versions.
        @Optional()
        @Inject(VersionRetirementService)
        private readonly retirements: VersionRetirementService | null = null,
        // Where the installation keeps contracts, the one in force says the
        // notice a cancellation is owed; read from the store, which
        // `contractFreeze` or the option of the same name brings, whichever
        // module writes them.
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: Pick<
            SubscriptionContractRepository,
            'findActiveByTenantId'
        > | null = null,
        // The zone a refusal names its days in; UTC where the file names none,
        // or where a test builds the service without it.
        @Optional()
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'> | null = null,
        // Where the end of a subscription is recorded, a cancellation tells its
        // tenant the day its data is deleted on and records it; without it, no
        // day is told.
        @Optional()
        @Inject(SubscriptionEndService)
        private readonly subscriptionEnds: SubscriptionEndService | null = null,
    ) {}

    /**
     * What the account of `sub` says at `now` of ending it: what cancelling
     * would do and tell, what was told when it was cancelled, and the
     * retirement on its way.
     */
    async projectionFor(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<CancellationProjection> {
        const retirement = await this.pendingRetirement(sub, now);
        const decision = await this.projectCancellation(tenantId, sub, now, retirement);
        const told = declaredCancellationOf(sub)
            ? ((await this.subscriptionEnds?.announcedFor(sub.id)) ?? null)
            : null;
        return {
            cancellation: {
                ...decision,
                deletion:
                    this.deletionOnConfirming(sub, decision.effectiveAt, told, now)?.days ?? null,
            },
            announcedDeletion: told,
            retirement,
        };
    }

    /**
     * Declares the cancellation of `tenantId`'s subscription at `now`, made by
     * `actor` after a page showed `shown`, and answers what is recorded.
     */
    async declare(
        tenantId: string,
        shown: ShownCancellation,
        actor: AdminActor,
        now: Date,
    ): Promise<DeclaredCancellation> {
        const noSubscription = () =>
            new NotFoundException({
                code: BILLING_ERROR_CODES.NO_SUBSCRIPTION,
                message: 'This tenant has no subscription to cancel.',
            });
        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) throw noSubscription();
        const confirming = { tenantId, subscriptionId: sub.id, by: actorTagOf(actor) };

        // Already cancelled? Say so, and leave its date as it is.
        //
        // Not politeness — arithmetic. With a notice period configured, running
        // the decision again against a later `now` can land the cancellation a
        // whole period further out: an on-time declaration landing January 2027,
        // retried after the deadline, becomes January 2028. The customer pressed
        // the same button twice and bought another year. A cancellation is
        // declared once; a repeat is a question about it, not a new one.
        const existing = declaredCancellationOf(sub);
        if (existing) {
            // What the tenant was told is answered as it stands. Where it was
            // told nothing and the cancellation has not landed, it is told now,
            // checked against what its page showed as a first confirmation is:
            // the request that won the cancellation can fail after it, and
            // only a repeat comes back. One that has landed is never announced
            // afterwards — its end is recorded with a day counted then.
            const told = (await this.subscriptionEnds?.announcedFor(sub.id)) ?? null;
            const onConfirming = this.deletionOnConfirming(sub, existing, told, now);
            const toTell = onConfirming && !onConfirming.onRecord ? onConfirming.days : null;
            if (toTell && deletionDayDiffersFromShown(shown.expectedDeletesOn, toTell)) {
                throw cancellationTermsChanged({
                    effectiveAt: existing,
                    termEndsAt: null,
                    noticeDeadline: null,
                    afterNoticeDeadline: null,
                    deletion: toTell,
                });
            }
            // Repairing rather than merely reporting. A cancellation can stand
            // with its contract still open: the contract call after the
            // cancellation write is non-fatal, and a row can be written by a
            // path that never makes the call. Nothing else will ever cap that
            // contract, because only the request that wins the cancellation
            // write reaches the call below, so a repeat ends it. Ending it again
            // changes nothing: the lookup asks as of the effective date, and a
            // contract already capped there is gone.
            await endContractAfter(
                this.contractFreeze,
                tenantId,
                existing,
                'an existing cancellation',
                this.logger,
            );
            // A day this repeat records is audited, as made by whoever made
            // the request, and only then: a day on record already was audited
            // by the request that recorded it, and where recording fails the
            // request answers the failure, with no day to name.
            const recorded =
                toTell &&
                (await this.subscriptionEnds?.announce(confirming, existing, toTell, now));
            if (recorded && !recorded.onRecord) {
                await this.audit(actor, tenantId, {
                    action: 'ANNOUNCE_DELETION_DAY',
                    changes: {
                        effectiveAt: existing.toISOString(),
                        deletesOn: recorded.days.deletesOn,
                        readOnlyDays: recorded.days.readOnlyDays,
                    },
                });
            }
            const deletion = told ?? recorded?.days ?? null;
            return {
                canceledAt: sub.canceledAt ?? null,
                canceledEffectiveAt: existing,
                status: sub.status,
                // Null rather than recomputed, because the three below explain a
                // decision that was taken once and is not stored. Deriving them
                // from the effective date tells the wrong story exactly where it
                // matters: a declaration that landed a period late has an
                // earlier term end and `afterNoticeDeadline: true`, and a retry
                // would report the effective date as the term end and the late
                // declaration as on time. Null says "not recomputed", which is
                // the truth; the date, which is stored, is above.
                termEndsAt: null,
                noticeDeadline: null,
                afterNoticeDeadline: null,
                deletion,
                alreadyCanceled: true,
            };
        }

        // A tenant declares; the rules decide when it lands. The request
        // carries no way to ask for an end on the spot: honouring one would let
        // a customer end a term they are still inside — the one thing a
        // tenant's declaration may not do. Ending a contract on the spot is an
        // operator's act, and it goes through the operator's own path.
        const decision = await this.projectCancellation(
            tenantId,
            sub,
            now,
            await this.pendingRetirement(sub, now),
        );

        // What the page showed has to be what the customer agreed to. Refused
        // rather than silently applied, with the new date in the error so the
        // page can re-ask instead of guessing why.
        //
        // Equality is the wrong test where the answer IS the moment of asking.
        // A subscription with nothing left to run lands its cancellation now,
        // and "now" is read once when the page is drawn and again when the
        // button is pressed — never the same number, seconds apart. Comparing
        // them for equality refuses every confirmation, the retry included,
        // because the retry moves the date it is compared against. What the
        // reader agreed to there is "immediately", and every reading of the
        // clock up to this one says that. A date still in the FUTURE does not:
        // no projection of this service produced it, so it is refused.
        //
        // The deletion day is held to the same rule, by equality: it is a day,
        // so two readings of the clock agree on it unless a midnight passed
        // between them, and then the tenant is shown the new one first.
        const expected = shown.expectedEffectiveAt ? new Date(shown.expectedEffectiveAt) : null;
        const landsImmediately = decision.effectiveAt <= now;
        const disagrees =
            expected !== null &&
            (landsImmediately
                ? expected.getTime() > decision.effectiveAt.getTime()
                : expected.getTime() !== decision.effectiveAt.getTime());
        const deletion =
            this.deletionOnConfirming(sub, decision.effectiveAt, null, now)?.days ?? null;
        if (disagrees || deletionDayDiffersFromShown(shown.expectedDeletesOn, deletion)) {
            throw cancellationTermsChanged({ ...decision, deletion });
        }

        // Two further writes the decision implies, and neither is the client's
        // to ask for.
        //
        // `terminateNow` follows the DATE the rules returned, not a flag: it is
        // true exactly when they found nothing left to run — no period, no term,
        // as on a trial or a subscription still waiting for sales — and there
        // `effectiveAt` is `now`. Without it the row keeps saying ACTIVE for
        // good, because nothing downstream would ever transition it:
        // `computeNextPeriod` returns early on a subscription whose period end
        // is null, and there is no other materialisation path.
        //
        // It is not what stops the entitlements: the entitlement service reads
        // the date a cancellation lands itself (`cancellationHasLanded`), and
        // from then on grants only what an ended subscription keeps, whatever
        // the status says.
        //
        // A declaration made after the notice deadline is the mirror image. It
        // buys the following period, and the commitment has to say so, because
        // every reader of the term end looks at `minimumTermUntil` rather than
        // at this cancellation — a downgrade scheduled meanwhile would otherwise
        // land at the old term end, inside the period just paid for.
        const result = await answeringRefusals(
            () =>
                this.subscriptionWrite.cancelSubscription(tenantId, {
                    canceledAt: now,
                    effectiveAt: decision.effectiveAt,
                    terminateNow: decision.effectiveAt <= now,
                    minimumTermUntil: decision.afterNoticeDeadline
                        ? decision.effectiveAt
                        : undefined,
                }),
            { [BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND]: noSubscription },
            installationZoneOf(this.settings),
        );
        // The check above and this write are two moments, and a second request
        // can arrive between them. The store settles it — the claim either took
        // the row or found it taken — and a claim that lost neither audits a
        // cancellation that did not happen nor explains its own decision, which
        // was never applied. Nor does it announce a day: it answers the one the
        // winner recorded, where that is on record yet.
        if (result.alreadyCanceled) {
            return {
                canceledAt: result.canceledAt,
                canceledEffectiveAt: result.canceledEffectiveAt,
                status: result.status,
                termEndsAt: null,
                noticeDeadline: null,
                afterNoticeDeadline: null,
                deletion: (await this.subscriptionEnds?.announcedFor(sub.id)) ?? null,
                alreadyCanceled: true,
            };
        }
        this.entitlements.invalidateTenant(tenantId);
        // The frozen contract ends when the subscription does. Non-fatal, like
        // every other use of this port: the cancellation is already recorded,
        // and a consumer without contracts has nothing to end.
        await endContractAfter(
            this.contractFreeze,
            tenantId,
            decision.effectiveAt,
            'a cancellation',
            this.logger,
        );
        // The days the page showed are recorded by the request that won the
        // cancellation, and by no other. Recording them can fail with the
        // cancellation already written, which stands (`SC-CANC-019`): its
        // audit entry is written all the same, naming no day, and the request
        // answers the failure. A repeat records them while the cancellation
        // has not landed, in an audit entry of their own; one that lands at
        // once has its day counted when its end is recorded.
        let announced: AnnouncedDeletion | null = null;
        try {
            const recorded =
                deletion &&
                (await this.subscriptionEnds?.announce(
                    confirming,
                    decision.effectiveAt,
                    deletion,
                    now,
                ));
            announced = recorded?.days ?? null;
        } finally {
            await this.audit(actor, tenantId, {
                action: 'CANCEL_SUBSCRIPTION',
                changes: {
                    canceledAt: now.toISOString(),
                    effectiveAt: decision.effectiveAt.toISOString(),
                    afterNoticeDeadline: decision.afterNoticeDeadline,
                    status: result.status,
                    deletesOn: announced?.deletesOn ?? null,
                    readOnlyDays: announced?.readOnlyDays ?? null,
                },
            });
        }
        return {
            canceledAt: result.canceledAt,
            canceledEffectiveAt: result.canceledEffectiveAt,
            status: result.status,
            // What the page needs to say which period it landed in, and why.
            termEndsAt: decision.termEndsAt,
            noticeDeadline: decision.noticeDeadline,
            afterNoticeDeadline: decision.afterNoticeDeadline,
            deletion: announced,
            alreadyCanceled: false,
        };
    }

    /**
     * The deletion day confirming the cancellation of `sub` at `now` leaves on
     * record, and whether it is there already. The account states it as
     * `cancellation.deletion` and a confirmation is held to it, by this one
     * rule, so the day a page is shown is the day it is checked against:
     *
     * - before a cancellation is declared, the day counted from `landsAt`,
     *   where declaring one now would land;
     * - once one is declared and until it lands, `told`, the day it was told,
     *   or else the day counted from the date it lands on, which a repeat
     *   records;
     * - once it has landed, none: nothing is told afterwards, and its end is
     *   recorded with a day counted then.
     *
     * None as well where the end of a subscription is not recorded, or the
     * subscription has no id to record the day under.
     */
    private deletionOnConfirming(
        sub: SubscriptionUsageRecord,
        landsAt: Date,
        told: AnnouncedDeletion | null,
        now: Date,
    ): DeletionOnConfirming | null {
        const declared = declaredCancellationOf(sub);
        if (declared && cancellationHasLanded(sub, now)) return null;
        if (declared && told) return { days: told, onRecord: true };
        const days = this.subscriptionEnds?.deletionFor(sub.id, declared ?? landsAt, now) ?? null;
        return days && { days, onRecord: false };
    }

    /**
     * What a cancellation declared at `now` would do. One method, because the
     * account states the date and the declaration applies it, and two
     * constructions of the same input are two chances to disagree about a
     * rule the customer meets once.
     */
    private async projectCancellation(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        now: Date,
        retirement: VersionRetiredNotice | null,
    ): Promise<CancellationDecision> {
        return decideCancellationFor(
            {
                status: sub.status,
                // SAFETY: the usage port types it as a string, but the column
                // behind it is the `BillingCycle` enum in the canonical schema,
                // so the database holds it to the two values.
                billingCycle: sub.billingCycle as BillingCycle,
                currentPeriodEnd: sub.currentPeriodEnd ?? null,
                // A retirement on its way lets the subscriber leave for the end
                // of the period they are in, whatever term they committed to:
                // the terms are what the operator is changing.
                minimumTermUntil: retirement ? null : (sub.minimumTermUntil ?? null),
                trialEndsAt: sub.trialEndsAt ?? null,
                billingAnchorDay: sub.billingAnchorDay ?? null,
            },
            now,
            // None while a retirement is on its way: it is left without notice.
            retirement ? 0 : await this.noticeDaysOf(tenantId, sub, now),
        );
    }

    /**
     * The notice a cancellation declared at `now` is owed: what the contract
     * in force recorded when the subscriber concluded or changed it
     * (`SC-CANC-026`), and
     * never what the file names since. Without a contract in force — an
     * installation that keeps none, or a subscription nothing was confirmed
     * for — the file's, for the rhythm of the subscription rather than of the
     * plan somebody is looking at: a customer on a yearly subscription is owed
     * the yearly notice even where the same plan is also sold monthly.
     */
    private async noticeDaysOf(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<number> {
        const contract = await this.contracts?.findActiveByTenantId(tenantId, now);
        return contract
            ? contract.cancellationNoticeDays
            : noticeDaysFor(this.cancellationNoticeDays, sub.billingCycle);
    }

    /** The retirement reaching the subscription that has not taken effect yet, or null. */
    private async pendingRetirement(
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<VersionRetiredNotice | null> {
        if (!this.retirements || !sub.id) return null;
        return this.retirements.pendingFor({ id: sub.id, planVersion: sub.planVersion }, now);
    }

    /**
     * Writes an audit entry of the tenant's subscription, best effort: it does
     * not block the answer, and without `AdminAuditService` — a minimal deploy
     * without AdminModule — there is nothing to write it to.
     */
    private async audit(
        actor: AdminActor,
        tenantId: string,
        { action, changes }: CancellationAuditEntry,
    ): Promise<void> {
        if (!this.auditService) return;
        try {
            await this.auditService.log({
                actor,
                entity: 'Subscription',
                entityId: tenantId,
                action,
                changes,
            });
        } catch {
            // Audit failures must not break the tenant write path.
            // (An observability gap is better than an operations outage.)
        }
    }
}

/**
 * The date the cancellation of `sub` lands on, where one is declared — its
 * effective date, or the date it was declared where the row names none — and
 * null where none is.
 */
function declaredCancellationOf(sub: SubscriptionUsageRecord): Date | null {
    return sub.canceledEffectiveAt ?? sub.canceledAt ?? null;
}
