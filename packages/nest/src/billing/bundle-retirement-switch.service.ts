// The free switch an add-on retirement offers (`SC-BUN-054`): a booking told
// that its add-on version is being retired may move to the named replacement at
// once, rather than wait for the date.
//
// The switch takes effect immediately and keeps the booking, its period, its
// terms and its rhythm. Where the replacement costs more, the subscription goes
// on paying what it paid for the add-on until the date: the contract the switch
// writes names the replacement at its own price, marked as the move's is, and
// holds the difference as a discount line (`SC-BUN-055`). Where it costs the
// same or less, its price applies from the booking's next period. Agreeing to
// the replacement ends the right to cancel without the minimum term, which
// rests on the booking being on the version retired.
//
// What the switch holds is the difference between the two versions' prices for
// the plan the add-on runs beside, so it is open only while neither that plan
// nor the rhythm it is billed in changes before the date: a change scheduled
// to land before it, or a retirement told to move the subscription to another
// plan before it. A retirement onto another version of the same plan changes
// neither, since an add-on's price and fit depend on the plan's key and rhythm
// alone. The difference is priced from the catalogue for the plan the
// subscription is on, not from the notice, whose prices are those of the plan
// it was told for, and it stays as agreed: a change of plan after the switch
// prices the add-on anew and takes the same difference off. It is not open in a
// trial, which has no contract to hold a price on, nor for a booking that does
// not run past the date, which has nothing to move to. The write is claimed only
// while the booking is still on the version retired, and the switch and the
// contract it writes are one: where the contract cannot be written, the switch
// is put back and refused.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    retirementSwitchTerms,
    type BillingCycle,
    type BundleRepository,
    type BundleRetirementSwitchResult,
    type BundleRetirementSwitchTerms,
    type BundleVersionRetiredNotice,
    type BundleVersionRow,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
} from '@saasicat/core';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { addOnMisfits, misfitRefusal } from './add-on-fits-plan.js';
import { resolveBundlePriceNet } from './bundle-price.js';
import { bookingOverBy, planAt } from './bundle-retirement-reach.js';
import { BundleVersionRetirementService } from './bundle-version-retirement.service.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { intendedContractOf } from './freeze-contract-after.js';
import type { PlansAhead } from './plans-ahead.js';
import { subscriptionNotFound } from './subscription-not-found.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { PLANS_AHEAD_TOKEN, SUBSCRIPTION_USAGE_PORT_TOKEN } from './tenant-billing.tokens.js';

/** The switch a booking could take now, or why it cannot. */
type Decided =
    | { readonly notice: BundleVersionRetiredNotice; readonly terms: BundleRetirementSwitchTerms }
    | { readonly refusal: UnprocessableEntityException };

@Injectable()
export class BundleRetirementSwitchService {
    private readonly logger = new Logger(BundleRetirementSwitchService.name);

    constructor(
        @Inject(BundleVersionRetirementService)
        private readonly retirements: BundleVersionRetirementService,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(PLANS_AHEAD_TOKEN)
        private readonly plansAhead: PlansAhead,
        @Inject(ENTITLEMENT_SERVICE_TOKEN)
        private readonly entitlements: EntitlementService,
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
    ) {}

    /** What switching the booking now would cost, or null where it cannot switch. */
    async openFor(
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        now: Date,
    ): Promise<BundleRetirementSwitchTerms | null> {
        const decided = await this.decide(sub, booking, now);
        return 'terms' in decided ? decided.terms : null;
    }

    /**
     * Switches the booking `subscriptionBundleId` to `bundleVersionId`,
     * provided it is still the replacement the retirement names.
     */
    async switchNow(
        tenantId: string,
        subscriptionBundleId: string,
        bundleVersionId: string,
        now = new Date(),
    ): Promise<BundleRetirementSwitchResult> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub?.id) throw subscriptionNotFound(tenantId);
        const booking = await this.bookings.findById(subscriptionBundleId);
        // A booking of another subscription reads as not found, as a missing
        // one does, so a request learns nothing about bookings not its own.
        if (!booking || booking.subscriptionId !== sub.id) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND,
                message: `SubscriptionBundle '${subscriptionBundleId}' not found`,
                params: { subscriptionBundleId },
            });
        }
        const decided = await this.decide(sub, booking, now);
        if ('refusal' in decided) throw decided.refusal;
        const { notice, terms } = decided;
        if (notice.replacement.bundleVersionId !== bundleVersionId) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.RETIREMENT_SWITCH_CHANGED,
                message:
                    'The retirement changed since it was shown. Look at it again before switching.',
                params: {},
                retirement: notice,
            });
        }
        // Where contracts are frozen, the switch ends in one naming the
        // subscriber: refused here, while nothing has moved.
        await this.contractFreeze?.assertPartyFor(tenantId, intendedContractOf(sub, now));
        // `moveToVersion` is required where add-on versions are retired.
        const moved = await this.bookings.moveToVersion!(
            booking.id,
            notice.retired.bundleVersionId,
            notice.replacement.bundleVersionId,
        );
        if (!moved) throw subscriptionChanged();
        this.entitlements.invalidateTenant(tenantId);
        try {
            // Decided on the subscription read before the claim: a
            // cancellation declared or a change of plan scheduled in between
            // would leave the contract an end, and the hold a price, the
            // subscription no longer has. Read again, and refused where it
            // changed.
            const reread = await this.subscriptions.findForTenant(tenantId);
            if (!reread || !decidedAlike(sub, reread)) throw subscriptionChanged();
            await this.contractFreeze?.freezeOnPlanChange(
                tenantId,
                sub.planVersion.planId,
                sub.billingCycle as BillingCycle,
                now,
                cancellationLandsAt(sub),
                {
                    retirementId: notice.retirementId,
                    addOn: {
                        bundleVersionId: notice.replacement.bundleVersionId,
                        subscriptionBundleId: booking.id,
                    },
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
            // date nothing would charge it: whatever stopped it between the
            // claim and the contract, put back, and refused as it came.
            await this.putBack(notice);
            throw error;
        }
        await recordChargesAfter(
            this.charges,
            tenantId,
            'an add-on retirement switch',
            this.logger,
        );
        return {
            subscriptionBundleId: booking.id,
            fromBundleVersionId: notice.retired.bundleVersionId,
            bundleVersionId: notice.replacement.bundleVersionId,
            heldUntilDay: terms.held?.lastDay ?? null,
        };
    }

    /** Whether the booking can switch at `now`, and what it then costs; or why it cannot. */
    private async decide(
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        now: Date,
    ): Promise<Decided> {
        const notice = sub.id
            ? await this.retirements.pendingForBooking(sub.id, booking.id, now)
            : null;
        // Nothing to switch: no retirement waits for its date, or the booking
        // does not run past it — it, or the subscription paying for it, ends
        // by then — and has nothing to move to. One whose cancellation lands
        // after the date may switch, and its cancellation stands.
        if (
            !notice ||
            bookingOverBy(booking, cancellationLandsAt(sub), new Date(notice.effectiveAt))
        ) {
            return {
                refusal: refused(
                    BILLING_ERROR_CODES.RETIREMENT_SWITCH_NOT_PENDING,
                    'No retirement of your version is waiting for its date, so there is nothing to switch to.',
                ),
            };
        }
        if (sub.status === 'TRIAL') {
            return {
                refusal: refused(
                    BILLING_ERROR_CODES.RETIREMENT_SWITCH_IN_TRIAL,
                    'The switch opens when your trial ends.',
                ),
            };
        }
        const [retired, replacement] = await Promise.all([
            this.versionNamed(notice.retired.bundleVersionId),
            this.versionNamed(notice.replacement.bundleVersionId),
        ]);
        const bundleName = replacement.label;
        const date = new Date(notice.effectiveAt);
        const ahead = await this.plansAhead.of(sub);
        // The plan for every moment the price would be held: the last one
        // before the date included, a change landing on the date not.
        const plan = planAt(sub, now, ahead);
        const lastBefore = planAt(sub, new Date(date.getTime() - 1), ahead);
        if (plan.planKey !== lastBefore.planKey || plan.billingCycle !== lastBefore.billingCycle) {
            return {
                refusal: new UnprocessableEntityException({
                    code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES,
                    message:
                        `${bundleName} moves to its new version on ${notice.effectiveAt.slice(0, 10)}, ` +
                        'and your plan changes before then, so the price a switch would keep is ' +
                        'not known yet. Switch once your plan has changed, or let it move on that date.',
                    params: { bundleName, date: notice.effectiveAt.slice(0, 10) },
                }),
            };
        }
        const rhythm = (booking.billingCycle as BillingCycle | null) ?? plan.billingCycle;
        // The announcement asked the replacement to run beside the plan at the
        // date, and every plan change since has asked it again (`SC-BUN-044`);
        // with nothing changing the plan before the date, that is the plan now.
        // Asked here all the same, for the rhythm a booking billed with the
        // plan takes from it.
        const [misfit] = addOnMisfits(replacement, plan, rhythm);
        if (misfit) {
            return {
                refusal: new UnprocessableEntityException(
                    misfitRefusal(misfit, replacement, plan, rhythm),
                ),
            };
        }
        // Not null: `addOnMisfits` refuses a replacement without a price here.
        const terms = retirementSwitchTerms(
            {
                retired: pricedFor(retired, plan.planKey),
                replacement: pricedFor(replacement, plan.planKey),
                lastDayToCancel: notice.lastDayToCancel,
            },
            rhythm,
        )!;
        return { notice, terms: { ...terms, billingCycle: rhythm } };
    }

    /**
     * A version a retirement names. Versions are not deleted, so a missing one
     * is a catalogue that lost a row the retirement was announced with: said,
     * rather than answered for.
     */
    private async versionNamed(id: string): Promise<BundleVersionRow> {
        const version = await this.bundles.findVersionById(id);
        if (!version) {
            throw new Error(`The add-on version ${id} a retirement names is not in the catalogue.`);
        }
        return version;
    }

    /**
     * Moves the booking back onto the version retired, where the switch's
     * contract could not be written. Where that fails too, the booking is on
     * the replacement without its contract, and the log names it.
     */
    private async putBack(notice: BundleVersionRetiredNotice): Promise<void> {
        let why: string;
        try {
            const back = await this.bookings.moveToVersion!(
                notice.subscriptionBundleId,
                notice.replacement.bundleVersionId,
                notice.retired.bundleVersionId,
            );
            if (back) return;
            why = 'it changed in between';
        } catch (error) {
            why = String(error);
        } finally {
            this.entitlements.invalidateTenant(notice.tenantId);
        }
        this.logger.error(
            `Booking ${notice.subscriptionBundleId} of tenant ${notice.tenantId} is on the ` +
                `replacement without its contract, and could not be put back: ${why}.`,
        );
    }
}

/**
 * The subscription's fields the switch is decided on: which one it is, its
 * state, its plan and rhythm, a change it scheduled, and a cancellation.
 */
const DECIDED_ON = [
    'id',
    'status',
    'plan',
    'billingCycle',
    'pendingPlan',
    'pendingBillingCycle',
    'pendingEffectiveAt',
    'canceledAt',
    'canceledEffectiveAt',
] as const satisfies readonly (keyof SubscriptionUsageRecord)[];

/** Whether `after` is the subscription the switch was decided on as `before`. */
function decidedAlike(before: SubscriptionUsageRecord, after: SubscriptionUsageRecord): boolean {
    return DECIDED_ON.every((field) => sameValue(before[field], after[field]));
}

function sameValue(a: unknown, b: unknown): boolean {
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
}

function subscriptionChanged(): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
        message: 'This subscription changed while the request was being decided. Reload it.',
    });
}

/** A version's price in each rhythm for `planKey`, as the switch reads a side. */
function pricedFor(version: BundleVersionRow, planKey: string) {
    return {
        monthlyNet: resolveBundlePriceNet(version, planKey, 'MONTHLY'),
        yearlyNet: resolveBundlePriceNet(version, planKey, 'YEARLY'),
    };
}

function refused(code: string, message: string): UnprocessableEntityException {
    return new UnprocessableEntityException({ code, message, params: {} });
}
