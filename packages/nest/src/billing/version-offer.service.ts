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
// Nor while a scheduled change of plan or rhythm is still to land. An offer is
// judged against what the subscriber has, and until that change lands it is
// not known what they will have: a version that takes something away would
// take effect on the day they leave the plan anyway.
//
// Beside a retirement told for the version bound, the replacement is the early
// switch's to offer and one that takes something away waits for the move
// (`leftToTheRetirement`); a newer version that applies at once stands beside
// the notice.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    PlanRepository,
    PlanVersionRow,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    VersionOfferView,
} from '@saasicat/core';
import { classifyVersionOffer, isVersionActiveAt } from '@saasicat/core';

import { PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { termEndOf } from './billing-period.js';
import { leftToTheRetirement } from './offer-beside-a-retirement.js';
import { listPriceNet } from './plan-helpers.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from './tenant-billing.tokens.js';
import { versionOnSale } from './version-on-sale.js';
import { VersionRetirementService } from './version-retirement.service.js';
import { comparedFieldsOf, planOfVersion, versionSideOf } from './version-sides.js';
import { subscriptionNotFound } from './subscription-not-found.js';

/**
 * A scheduled change that has not landed yet. A change of rhythm alone is
 * scheduled with the plan it keeps, so `pendingPlan` names both.
 */
function awaitsAChange(sub: SubscriptionUsageRecord): boolean {
    return Boolean(sub.pendingPlan);
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
        // Present where plan versions are retired; without it no retirement
        // is told, and none has a way of its own to leave an offer to.
        @Optional()
        @Inject(VersionRetirementService)
        private readonly retirements: Pick<
            VersionRetirementService,
            'toldRetirementsOf'
        > | null = null,
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
        // The repository answers by window already; this holds a repository
        // of the application's own to the same rule, on the row it returned.
        if (!isVersionActiveAt(offeredRow, now)) return null;

        const boundPlan = planOfVersion(sub.plan, boundRow);
        const offeredPlan = planOfVersion(sub.plan, offeredRow);
        if (listPriceNet(offeredPlan, sub.billingCycle as BillingCycle) === null) return null;

        const bound = versionSideOf(boundRow, boundPlan);
        const offered = versionSideOf(offeredRow, offeredPlan);
        const verdict = classifyVersionOffer(
            comparedFieldsOf(boundPlan),
            comparedFieldsOf(offeredPlan),
        );
        if (verdict.class === 'same') return null;
        const told =
            sub.id && this.retirements
                ? await this.retirements.toldRetirementsOf({ ...sub, id: sub.id })
                : [];
        const replacementsTold = told.map((notice) => notice.replacement.planVersionId);
        if (
            leftToTheRetirement({ versionId: offeredRow.id, kind: verdict.class }, replacementsTold)
        ) {
            return null;
        }

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
