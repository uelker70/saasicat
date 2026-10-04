// The free switch a retirement offers (`SC-SUB-032`): a subscriber told that
// their version is being retired may move to the named replacement at once,
// rather than wait for the date.
//
// The switch takes effect immediately and keeps the term and the period. Where
// the replacement costs more, the subscriber goes on paying the price they had
// until the date they were told: the contract the switch writes names the
// replacement at its own price and holds the difference as a discount line, so
// a contract written again before the date — an add-on booked — leaves it where
// it was agreed. Where it costs the same or less, its price applies from the
// next period, as any cheaper price does. Agreeing to the replacement ends the
// right to cancel without notice, which rests on the version being retired.
//
// Like a version offer, the switch is open only where nothing is outstanding —
// no change scheduled, the subscription not ended, its plan not held for a
// special contract — and not in a trial, which has no contract yet to hold a
// price on. The write is claimed against the retired version and the
// cancellation as read, so a change made in between is refused, not written
// over. The switch and the contract it writes are one: where the contract
// cannot be written, the switch is put back and refused, and nothing changed.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    retirementSwitchTerms,
    type BillingCycle,
    type BundleRepository,
    type RetirementSwitchResult,
    type RetirementSwitchTerms,
    type SelfServiceBlockedPlans,
    type SubscriptionBundleRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type TenantSubscriptionWritePort,
    type VersionRetiredNotice,
} from '@saasicat/core';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { cancellationHasLanded, cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import {
    continuationBlocksTheSwitch,
    heldAddOnMisfits,
    heldBlocksTheSwitch,
    type AddOnsAhead,
} from './add-on-fits-plan.js';
import { addOnInTheWay } from './add-on-in-the-way.js';
import type { BundleBookingRefusal } from './bundle-version-not-on-sale.js';
import { bindReplacement, bindRetiredAgain } from './retirement-binding.js';
import { SELF_SERVICE_BLOCKED_PLANS_TOKEN } from './self-service-policy.js';
import { subscriptionNotFound } from './subscription-not-found.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    ADD_ONS_AHEAD_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { VersionRetirementService } from './version-retirement.service.js';

/** The switch a subscription could take now: the retirement it answers, and what it costs. */
export interface OpenRetirementSwitch {
    readonly notice: VersionRetiredNotice;
    readonly terms: RetirementSwitchTerms;
}

@Injectable()
export class RetirementSwitchService {
    private readonly logger = new Logger(RetirementSwitchService.name);

    constructor(
        @Inject(VersionRetirementService)
        private readonly retirements: VersionRetirementService,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly writes: TenantSubscriptionWritePort,
        @Inject(ENTITLEMENT_SERVICE_TOKEN)
        private readonly entitlements: EntitlementService,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_PLANS_TOKEN)
        private readonly blockedPlans: SelfServiceBlockedPlans | null = null,
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
        // The add-ons booked, and the versions they name. Absent where nothing
        // books add-ons; `TenantBillingModule` refuses the one without the other.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository | null = null,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        // Where add-on versions are retired: a booking told of one continues
        // on the replacement, which has to run beside the plan switched to.
        @Optional()
        @Inject(ADD_ONS_AHEAD_TOKEN)
        private readonly addOnsAhead: AddOnsAhead | null = null,
    ) {}

    /** The switch the subscription could take now, or null where it can take none. */
    async openFor(sub: SubscriptionUsageRecord, now: Date): Promise<OpenRetirementSwitch | null> {
        if (!sub.id) return null;
        const notice = await this.retirements.pendingFor(
            { id: sub.id, planVersion: sub.planVersion },
            now,
        );
        if (!notice || sub.status === 'TRIAL' || !this.isOpen(sub, notice, now)) return null;
        const terms = retirementSwitchTerms(notice, sub.billingCycle);
        return terms ? { notice, terms } : null;
    }

    /** Switches to `planVersionId`, provided it is still the replacement the retirement names. */
    async switchNow(
        tenantId: string,
        planVersionId: string,
        now = new Date(),
    ): Promise<RetirementSwitchResult> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub?.id) throw subscriptionNotFound(tenantId);
        const notice = await this.retirements.pendingFor(
            { id: sub.id, planVersion: sub.planVersion },
            now,
        );
        if (!notice) {
            throw refused(
                BILLING_ERROR_CODES.RETIREMENT_SWITCH_NOT_PENDING,
                'No retirement of your version is waiting for its date, so there is nothing to switch to.',
            );
        }
        if (notice.replacement.planVersionId !== planVersionId) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.RETIREMENT_SWITCH_CHANGED,
                message:
                    'The retirement changed since it was shown. Look at it again before switching.',
                params: {},
                retirement: notice,
            });
        }
        if (sub.status === 'TRIAL') {
            throw refused(
                BILLING_ERROR_CODES.RETIREMENT_SWITCH_IN_TRIAL,
                'The switch opens when your trial ends.',
            );
        }
        const terms = this.isOpen(sub, notice, now)
            ? retirementSwitchTerms(notice, sub.billingCycle)
            : null;
        if (!terms) {
            throw refused(
                BILLING_ERROR_CODES.RETIREMENT_SWITCH_NOT_OPEN,
                'This subscription cannot switch now: a change is scheduled, it has ended, or its ' +
                    'plan is held for a special contract.',
            );
        }
        // A switch moves the subscription onto the replacement's plan today, so
        // every add-on running today has to be able to run there (`SC-CHG-024`).
        // The announcement asked only about those still running at the date.
        const standing = await this.refusalForAnAddOn(sub, notice, now);
        if (standing) throw new UnprocessableEntityException(standing);
        // Where contracts are frozen, the switch ends in one naming the
        // subscriber: refused here, while nothing has moved.
        await this.contractFreeze?.assertPartyFor(tenantId);

        const result = await bindReplacement(this.writes, tenantId, sub, notice, false);
        if (!result.claimed) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
                message:
                    'This subscription changed while the request was being decided. Reload it.',
            });
        }
        this.entitlements.invalidateTenant(tenantId);
        try {
            await this.contractFreeze?.freezeOnPlanChange(
                tenantId,
                notice.replacement.planKey,
                sub.billingCycle as BillingCycle,
                now,
                sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
                {
                    retirementId: notice.retirementId,
                    priceHold: terms.held
                        ? {
                              amountNet: terms.held.amountNet,
                              until: new Date(notice.effectiveAt),
                              lastDay: terms.held.lastDay,
                          }
                        : null,
                },
            );
        } catch (error) {
            // Without its contract the switch would hold no price, and from the
            // date nothing would charge it: put back, and refused as it came.
            await this.putBack(tenantId, sub, notice);
            throw error;
        }
        await recordChargesAfter(this.charges, tenantId, 'a retirement switch', this.logger);
        return {
            fromPlanVersionId: notice.retired.planVersionId,
            planVersionId: notice.replacement.planVersionId,
            heldUntilDay: terms.held?.lastDay ?? null,
        };
    }

    /**
     * Binds the subscription back to the version retired, where the switch's
     * contract failed, keeping a change scheduled meanwhile. Where that fails
     * too, the log names the subscription.
     */
    private async putBack(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        notice: VersionRetiredNotice,
    ): Promise<void> {
        await bindRetiredAgain(this.writes, tenantId, sub, notice, this.logger);
        this.entitlements.invalidateTenant(tenantId);
    }

    /**
     * The refusal for the first add-on running today that cannot run beside the
     * replacement's plan, in the rhythm the subscription keeps; null where
     * none stands in the way.
     */
    private async refusalForAnAddOn(
        sub: SubscriptionUsageRecord,
        notice: VersionRetiredNotice,
        now: Date,
    ): Promise<BundleBookingRefusal | null> {
        if (!this.subscriptionBundles || !sub.id) return null;
        const target = {
            planKey: notice.replacement.planKey,
            billingCycle: sub.billingCycle as BillingCycle,
        };
        const [first] = await heldAddOnMisfits(
            this.subscriptionBundles,
            this.bundles,
            { id: sub.id, endsAt: cancellationLandsAt(sub) },
            target,
            now,
            (await this.addOnsAhead?.of(sub.id)) ?? [],
        );
        if (!first) return null;
        const inTheWay = addOnInTheWay(first, sub, now);
        const { continuesOn } = inTheWay;
        return continuesOn
            ? continuationBlocksTheSwitch(
                  { bundleName: inTheWay.bundleName, continuesOn },
                  target.planKey,
              )
            : heldBlocksTheSwitch(inTheWay, target.planKey);
    }

    /**
     * Whether the subscription could take a switch at all: not ended, nothing
     * scheduled, neither plan held for a special contract — the rule a
     * version offer follows.
     */
    private isOpen(sub: SubscriptionUsageRecord, notice: VersionRetiredNotice, now: Date): boolean {
        if (cancellationHasLanded(sub, now) || sub.pendingPlan) return false;
        const fromHeld = this.blockedPlans?.asSource?.includes(sub.plan) ?? false;
        const toHeld = this.blockedPlans?.asTarget?.includes(notice.replacement.planKey) ?? false;
        return !fromHeld && !toHeld;
    }
}

function refused(code: string, message: string): UnprocessableEntityException {
    return new UnprocessableEntityException({ code, message, params: {} });
}
