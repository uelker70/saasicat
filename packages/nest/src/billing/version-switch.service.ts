// Taking a version offer: the switch to a newer version of the subscriber's
// own plan (`SC-SUB-021`).
//
// The offer decides and this carries it out. The offer is read again here
// rather than taken from the page: the caller names the version it was shown,
// and the switch goes ahead only while that is still the version offered — a
// version published, ended or taken in between, or a subscription that moved,
// is refused with the offer as it now stands. The write holds the row to what
// the decision was read from — the version bound, nothing scheduled, the
// cancellation — and binds the version named or nothing, so a change landing
// between the read and the write is refused rather than written over.
//
// What kind of offer it is decides how it is taken. An improvement and one
// that costs more for more apply at once, on the plan and in the rhythm the
// subscription has, and keep its term and its period. What that costs is the
// charge journal's to say, not this service's: a successor contract taking
// effect inside a paid period is charged the difference where its plan line is
// dearer, and nothing where it is not (`SC-CHG-020`, `SC-PRIC-003`) — so an
// improvement is free, and a version dearer only in the rhythm the subscriber
// does not pay in costs them nothing either. One that takes something away is
// scheduled for the end of the term like a downgrade, bound to the version
// offered, and refused like one while today's usage would not fit — and where
// that version stops being sold before the term ends, since it could not be
// bound then.

import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    Optional,
} from '@nestjs/common';
import type {
    BillingCycle,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
    UsageSnapshotPort,
    VersionOfferView,
    VersionSwitchResult,
} from '@saasicat/core';
import { BILLING_ERROR_CODES, isVersionActiveAt } from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { answeringRefusals } from '../errors/answering-refusals.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { freezeContractAfter } from './freeze-contract-after.js';
import { quotaOverTargetBlockers } from './quota-over-target.js';
import { subscriptionNotFound } from './subscription-not-found.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    USAGE_SNAPSHOT_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { VersionOfferService } from './version-offer.service.js';

@Injectable()
export class VersionSwitchService {
    private readonly logger = new Logger(VersionSwitchService.name);

    constructor(
        @Inject(VersionOfferService) private readonly offers: VersionOfferService,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(USAGE_SNAPSHOT_PORT_TOKEN) private readonly usage: UsageSnapshotPort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly subscriptionWrite: TenantSubscriptionWritePort,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
    ) {}

    /** Takes the offer of `planVersionId`, provided it is still the one offered. */
    async take(
        tenantId: string,
        planVersionId: string,
        now = new Date(),
    ): Promise<VersionSwitchResult> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub) {
            throw subscriptionNotFound(tenantId);
        }
        const offer = await this.offers.offerForSubscription(sub, now);
        if (offer?.offered.planVersionId !== planVersionId) {
            throw offerChanged(planVersionId, offer);
        }

        // Where contracts are frozen, a switch ends in one naming the tenant's
        // subscriber. Refused here, while nothing has moved: the freeze runs
        // after the switch is written and only logs its refusal.
        await this.contractFreeze?.assertPartyFor(tenantId);

        return offer.class === 'takes-something-away'
            ? this.scheduleAtTermEnd(tenantId, sub, offer, now)
            : this.switchNow(tenantId, sub, offer, now);
    }

    private async switchNow(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        offer: VersionOfferView,
        now: Date,
    ): Promise<VersionSwitchResult> {
        const cycle = sub.billingCycle as BillingCycle;
        // A version gone since the offer was read is refused by the store with
        // the code the offer would have given.
        const result = await answeringRefusals(() =>
            this.subscriptionWrite.changePlanImmediate(tenantId, {
                planId: sub.plan,
                cycle,
                // The term and the period stay as they are: nothing restarts.
                periodStart: null,
                periodEnd: null,
                nextStatus: null,
                expectedCanceledAt: sub.canceledAt ?? null,
                expectedPlanVersionId: offer.bound.planVersionId,
                keepsBoundVersion: false,
                quotedPlanVersionId: offer.offered.planVersionId,
                quotedVersionOnly: true,
            }),
        );
        if (!result.claimed) throw await this.refusedAfterTheRead(tenantId, offer, now);
        this.entitlements.invalidateTenant(tenantId);

        // A trial commits to no period and is charged nothing; its contract is
        // frozen when it converts.
        if (sub.status !== 'TRIAL') {
            await freezeContractAfter(
                this.contractFreeze,
                tenantId,
                {
                    plan: sub.plan,
                    cycle,
                    effectiveFrom: now,
                    endsAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
                },
                'a version switch',
                this.logger,
            );
            await recordChargesAfter(this.charges, tenantId, 'a version switch', this.logger);
        }
        return resultOf(offer, true, now);
    }

    private async scheduleAtTermEnd(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        offer: VersionOfferView,
        now: Date,
    ): Promise<VersionSwitchResult> {
        const takesEffectAt = new Date(offer.takesEffectAt);
        // A cancellation outstanding lands at the end of the term at the
        // latest, and a change due on a subscription that has ended is declined
        // when it comes due — so recording it would promise something that
        // never happens.
        const endsAt = sub.canceledEffectiveAt ?? sub.canceledAt ?? null;
        if (endsAt !== null && endsAt <= takesEffectAt) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.VERSION_SWITCH_AFTER_CANCELLATION,
                message:
                    'This subscription ends before this version would take effect, so it cannot be switched to.',
                params: {
                    canceledEffectiveAt: endsAt.toISOString(),
                    takesEffectAt: offer.takesEffectAt,
                },
            });
        }
        // Bound when the change comes due, so it has to be sold then.
        if (!isVersionActiveAt(offer.offered, takesEffectAt)) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.VERSION_ENDS_BEFORE_SWITCH,
                message:
                    'This version stops being sold before it would take effect, so it cannot be switched to.',
                params: {
                    takesEffectAt: offer.takesEffectAt,
                    validUntil: offer.offered.validUntil,
                    endsAt: offer.offered.endsAt,
                },
            });
        }
        await this.refuseWhatWouldNotFit(tenantId, offer);

        const scheduled = await this.subscriptionWrite.schedulePlanChange(tenantId, {
            pendingPlan: sub.plan,
            pendingBillingCycle: sub.billingCycle,
            pendingEffectiveAt: takesEffectAt,
            expectedCanceledAt: sub.canceledAt ?? null,
            expectedPlanVersionId: offer.bound.planVersionId,
            expectedPendingPlan: null,
            pendingChangeVersionId: offer.offered.planVersionId,
        });
        if (!scheduled.claimed) throw await this.refusedAfterTheRead(tenantId, offer, now);
        this.entitlements.invalidateTenant(tenantId);
        return resultOf(offer, false, takesEffectAt);
    }

    /**
     * Why a write claimed nothing, as far as can be told afterwards: where the
     * version named is no longer the one offered, that is the answer, with the
     * offer as it now stands; otherwise the subscription moved.
     */
    private async refusedAfterTheRead(
        tenantId: string,
        taken: VersionOfferView,
        now: Date,
    ): Promise<ConflictException> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        const offer = sub ? await this.offers.offerForSubscription(sub, now) : null;
        const named = taken.offered.planVersionId;
        return offer?.offered.planVersionId === named
            ? subscriptionChanged()
            : offerChanged(named, offer);
    }

    /** Refused like a downgrade: usage today that the version offered would not hold. */
    private async refuseWhatWouldNotFit(tenantId: string, offer: VersionOfferView): Promise<void> {
        const used = await this.usage.snapshot(tenantId);
        const target = offer.offered.quotas;
        const keys = new Set([...Object.keys(offer.bound.quotas), ...Object.keys(target)]);
        const blockers = quotaOverTargetBlockers(
            [...keys].map((quotaKey) => ({
                quotaKey,
                used: used[quotaKey] ?? 0,
                targetMax: target[quotaKey] ?? 0,
            })),
            offer.plan,
        );
        if (blockers.length === 0) return;
        throw new BadRequestException({
            code: BILLING_ERROR_CODES.PLAN_CHANGE_BLOCKED,
            message: 'Plan change is blocked.',
            blockers,
        });
    }
}

function resultOf(
    offer: VersionOfferView,
    immediate: boolean,
    takesEffectAt: Date,
): VersionSwitchResult {
    return {
        class: offer.class,
        fromPlanVersionId: offer.bound.planVersionId,
        planVersionId: offer.offered.planVersionId,
        immediate,
        takesEffectAt: takesEffectAt.toISOString(),
    };
}

function offerChanged(planVersionId: string, offer: VersionOfferView | null): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.VERSION_OFFER_CHANGED,
        message: 'The offer changed since it was shown. Look at the current one before switching.',
        params: { planVersionId },
        offer,
    });
}

function subscriptionChanged(): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
        message: 'This subscription changed while the request was being decided. Reload it.',
    });
}
