import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SubscriptionUsageRecord, VersionRetiredNotice } from '@saasicat/core';

import type { PlanAhead } from './add-on-fits-plan.js';
import { rhythmAt } from './retirement-reach.js';
import { rhythmTheChangeLandsIn } from './scheduled-change.js';
import { VersionRetirementService } from './version-retirement.service.js';

/** What `PlansAhead` reads a subscription by. */
export type PlansAheadSubject = Pick<
    SubscriptionUsageRecord,
    | 'id'
    | 'plan'
    | 'billingCycle'
    | 'pendingPlan'
    | 'pendingBillingCycle'
    | 'pendingEffectiveAt'
    | 'planVersion'
>;

/** The plans a subscription is already set to move to, and from when. */
export interface PlansAhead {
    of(subscription: PlansAheadSubject): Promise<readonly PlanAhead[]>;
}

/**
 * The plans `subscription` is set to move to, given `told`: the retirements of
 * the version it is on that reached it. It gets there in two ways.
 *
 * - A change it scheduled itself, from the day that change lands, in the
 *   rhythm it lands in. A change of rhythm alone is one too: the same plan in
 *   another rhythm, which a yearly add-on cannot run beside once it is monthly.
 * - The retirement of the version it is on, from the date it was told, in the
 *   rhythm billed then, for as long as the subscription is on that version —
 *   the date passing does not end it, only the move does. Before its notice
 *   reached the subscription a retirement moves nothing (`SC-SUB-038`), so it
 *   sets no plan ahead either. It counts even where a scheduled change would
 *   take the subscription off the version first, since that change can still
 *   be withdrawn, and the retirement would then move it after all.
 */
export function plansAheadOf(
    subscription: PlansAheadSubject,
    told: readonly VersionRetiredNotice[],
): PlanAhead[] {
    const ahead: PlanAhead[] = [];
    if (subscription.pendingPlan && subscription.pendingEffectiveAt) {
        ahead.push({
            planKey: subscription.pendingPlan,
            billingCycle: rhythmTheChangeLandsIn(subscription),
            from: subscription.pendingEffectiveAt,
            by: 'change',
        });
    }
    for (const retirement of told) {
        const from = new Date(retirement.effectiveAt);
        ahead.push({
            planKey: retirement.replacement.planKey,
            billingCycle: rhythmAt(subscription, from),
            from,
            by: 'retirement',
        });
    }
    return ahead;
}

/** The plans a subscription is set to move to (`plansAheadOf`), its retirements read where they are configured. */
@Injectable()
export class PlansAheadService implements PlansAhead {
    constructor(
        // Only where retirements are configured; without them a scheduled
        // change is the only way a subscription moves.
        @Optional()
        @Inject(VersionRetirementService)
        private readonly retirements: VersionRetirementService | null = null,
    ) {}

    async of(subscription: PlansAheadSubject): Promise<readonly PlanAhead[]> {
        const told =
            subscription.id && this.retirements
                ? await this.retirements.toldRetirementsOf({
                      id: subscription.id,
                      planVersion: subscription.planVersion,
                  })
                : [];
        return plansAheadOf(subscription, told);
    }
}
