// A newer version of a subscriber's plan, read as an offer.
//
// A subscription keeps the version it is bound to (`SC-SUB-019`); a version
// published since is offered, never applied. What kind of offer it is decides
// how it can be taken, and it is judged against the version bound — the one
// the subscriber has — rather than against the candidate's predecessor.
// Taking it is `VersionSwitchService`'s; this reads what it would be.
//
// The version offered is the one a booking made now would bind — on sale by
// its validity window, as checkout prices it — and only when it is newer than
// the version bound: a subscription bound ahead of a window is not offered the
// version before it. An offer is only made where it could be taken: a
// subscription that has ended cannot switch, a plan kept for a special contract
// is not changed by self-service, and a version not sold in the subscription's
// rhythm cannot be switched to without changing the rhythm too.
//
// Nor while a decision the subscription already carries is still to land — a
// scheduled change of plan or rhythm, or a pending version. An offer is judged
// against what the subscriber has, and until that decision lands it is not
// known what they will have: a version that takes something away would take
// effect on the day they leave the plan anyway, and a pending version would be
// offered a second time, to be taken another way.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    PlanDef,
    PlanRepository,
    PlanVersionRow,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    VersionOfferFields,
    VersionOfferSide,
    VersionOfferView,
} from '@saasicat/core';
import { classifyVersionOffer, isVersionActiveAt } from '@saasicat/core';

import { PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { termEndOf } from './billing-period.js';
import { planDefFromVersion } from './plan-catalog-from-snapshot.js';
import { listPriceNet } from './plan-helpers.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from './tenant-billing.tokens.js';
import { subscriptionNotFound } from './subscription-not-found.js';

/** A version row as the comparison reads it: a price the row does not carry is `null`. */
function planOf(planKey: string, row: PlanVersionRow): PlanDef {
    return planDefFromVersion({ id: planKey, name: planKey }, row);
}

/** What the classification compares of a plan. */
function fieldsOf(plan: PlanDef): VersionOfferFields {
    return {
        features: plan.features,
        quotas: plan.quotas,
        monthlyNet: plan.monthlyNet ?? null,
        yearlyNet: plan.yearlyNet ?? null,
    };
}

/**
 * The version a booking made now would bind: the one active by its validity
 * window, and the newest live one only where the repository reads no windows.
 * An active lookup that finds nothing means nothing is on sale — falling back
 * past it would offer a version whose window has not opened.
 */
async function versionOnSale(
    plans: PlanRepository,
    planKey: string,
    now: Date,
): Promise<PlanVersionRow | null> {
    if (plans.findActivePlanVersion) return plans.findActivePlanVersion(planKey, now);
    return (await plans.findLatestLivePlanVersion?.(planKey)) ?? null;
}

/**
 * A scheduled change or a pending version that has not landed yet. A change of
 * rhythm alone is scheduled with the plan it keeps, so `pendingPlan` names both.
 */
function awaitsAChange(sub: SubscriptionUsageRecord): boolean {
    return Boolean(sub.pendingPlan) || Boolean(sub.pendingPlanVersion);
}

function sideOf(row: PlanVersionRow, plan: PlanDef): VersionOfferSide {
    return {
        planVersionId: row.id,
        version: row.version,
        features: [...plan.features],
        quotas: { ...plan.quotas },
        monthlyNet: plan.monthlyNet ?? null,
        yearlyNet: plan.yearlyNet ?? null,
    };
}

@Injectable()
export class VersionOfferService {
    private readonly logger = new Logger(VersionOfferService.name);

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        // Optional — without a repository that reads versions there is no
        // version bound to compare, and so no offer.
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_PLANS_TOKEN)
        private readonly blockedPlans: SelfServiceBlockedPlans | null = null,
    ) {}

    /** The offer for the tenant's subscription, or null where there is none it could take. */
    async offerFor(tenantId: string, now = new Date()): Promise<VersionOfferView | null> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub) {
            throw subscriptionNotFound(tenantId);
        }
        return this.offerForSubscription(sub, now);
    }

    /** The same, for a subscription the caller has already read. */
    async offerForSubscription(
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<VersionOfferView | null> {
        if (!this.couldSwitch(sub, now)) return null;

        const read = await this.readVersions(sub, now);
        if (!read) return null;
        const { boundRow, offeredRow } = read;
        if (offeredRow.version <= boundRow.version) return null;
        // The repository's own lookup already reads the window; the fallback
        // for one without it does not.
        if (!isVersionActiveAt(offeredRow, now)) return null;

        const boundPlan = planOf(sub.plan, boundRow);
        const offeredPlan = planOf(sub.plan, offeredRow);
        if (listPriceNet(offeredPlan, sub.billingCycle as BillingCycle) === null) return null;

        const bound = sideOf(boundRow, boundPlan);
        const offered = sideOf(offeredRow, offeredPlan);
        const verdict = classifyVersionOffer(fieldsOf(boundPlan), fieldsOf(offeredPlan));
        if (verdict.class === 'same') return null;

        const takesEffectAt =
            verdict.class === 'takes-something-away'
                ? termEndOf(
                      {
                          status: sub.status,
                          trialEndsAt: sub.trialEndsAt,
                          currentPeriodEnd: sub.currentPeriodEnd,
                          minimumTermUntil: sub.minimumTermUntil ?? null,
                          startedAt: sub.startedAt,
                          currentBillingCycle: sub.billingCycle,
                      },
                      now,
                  )
                : now;

        return {
            plan: sub.plan,
            bound,
            offered,
            class: verdict.class,
            changes: [...verdict.changes],
            takesEffectAt: takesEffectAt.toISOString(),
        };
    }

    /**
     * Whether the subscription could take a switch at all: not ended, nothing
     * outstanding, not held for a special contract.
     */
    private couldSwitch(sub: SubscriptionUsageRecord, now: Date): boolean {
        if (cancellationHasLanded(sub, now) || awaitsAChange(sub)) return false;
        const blocked = [
            ...(this.blockedPlans?.asSource ?? []),
            ...(this.blockedPlans?.asTarget ?? []),
        ];
        return !blocked.includes(sub.plan);
    }

    /**
     * The version bound and the one on sale now. Null where either cannot be
     * read — a binding the repository does not find as a version of the plan is
     * logged, since the subscription came with it joined.
     */
    private async readVersions(
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<{ boundRow: PlanVersionRow; offeredRow: PlanVersionRow } | null> {
        const boundId = sub.planVersion?.id;
        const plans = this.plans;
        if (!boundId || !plans?.findVersionById) return null;
        const [boundRow, offeredRow] = await Promise.all([
            plans.findVersionById(boundId),
            versionOnSale(plans, sub.plan, now),
        ]);
        if (!boundRow || boundRow.planId !== sub.plan) {
            this.logger.warn(
                `A subscription on plan '${sub.plan}' is bound to plan version '${boundId}', ` +
                    'which the plan repository does not read as a version of that plan. ' +
                    'No newer version is offered until the binding is repaired.',
            );
            return null;
        }
        if (!offeredRow || offeredRow.planId !== sub.plan) return null;
        return { boundRow, offeredRow };
    }
}
